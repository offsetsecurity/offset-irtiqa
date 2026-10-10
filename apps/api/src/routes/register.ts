import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTransaction, type Sql } from "../db/pool.js";
import { canRead, canWrite, requireAuth, assertCanWrite } from "../auth/rbac.js";
import { audit } from "../audit/audit.js";
import { notFound } from "../lib/errors.js";
import { removeAttachmentsOf } from "./attachments.js";

/**
 * A CRUD register: list, read, create, update, delete, with link tables.
 *
 * Controls, evidence and risks each keep their own route file, because each has
 * real logic of its own — readiness, the freshness ladder, risk scoring. The
 * five registers added in Phase 3 have none of that; they are the same five
 * handlers with different column names. Writing them out five times would be
 * five places to forget an audit row or an RBAC guard, so they are configured
 * here instead and the behaviour is defined once.
 */

export interface LinkSpec {
  /** Join table, e.g. "asset_controls". */
  table: string;
  /** Column in the join table pointing at this entity, e.g. "asset_id". */
  self: string;
  /** Column pointing at the other side, e.g. "control_id". */
  other: string;
  /** Key on the request body, e.g. "controlIds". */
  input: string;
  /** Key on the response, e.g. "control_ids". */
  output: string;
}

export interface RegisterSpec<T extends z.ZodRawShape> {
  /** Table name, also the audit entity, e.g. "assets" -> entity "asset". */
  table: string;
  /** Singular noun used in audit entries and error messages, e.g. "Asset". */
  label: string;
  /**
   * The key one row comes back under, when the label makes an awkward one.
   * "Audit or review" is a good thing to say to a person and a poor JSON key,
   * so that register sets this to "review". Defaults to the lowercased label.
   */
  key?: string;
  /** URL segment, e.g. "assets" for /api/v1/assets. */
  path: string;
  /** Body schema for create. The update schema is derived as a strict partial. */
  shape: T;
  /** Request-body key -> database column. Keys absent here are ignored. */
  columns: Record<string, string>;
  links?: LinkSpec[];
  /** Default ordering, without the `order by`. */
  orderBy?: string;
  /**
   * Extra SQL columns for the list and read queries, e.g. an aggregate of a
   * child table. A column named `<name>_json` is parsed before it is returned,
   * the same way link columns are.
   */
  extraSelect?: string;
  /** Extra checks that cannot be expressed in the schema. Throw to reject. */
  validate?: (body: Record<string, unknown>, existing?: Record<string, unknown>) => void;
  /** Runs inside the write transaction, before the row is updated. */
  beforeUpdate?: (
    tx: Sql,
    id: string,
    body: Record<string, unknown>,
    existing: Record<string, unknown>,
  ) => Promise<void>;
}

const idParam = z.object({ id: z.string().uuid() });

/** Linked ids as a JSON array, built in the same pass as the row. */
const linkSelect = (spec: RegisterSpec<z.ZodRawShape>): string =>
  (spec.links ?? [])
    .map(
      (l) =>
        `, (select json_group_array(l.${l.other}) from ${l.table} l
             where l.${l.self} = t.id) as ${l.output}_json`,
    )
    .join("");

/** Parses the JSON columns so callers get arrays and objects, not strings. */
function hydrate(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const key of Object.keys(out)) {
    if (!key.endsWith("_json")) continue;
    const raw = out[key];
    delete out[key];
    out[key.slice(0, -"_json".length)] = JSON.parse(typeof raw === "string" ? raw : "[]");
  }
  if (typeof out["attrs"] === "string") {
    out["attrs"] = JSON.parse(out["attrs"] as string);
  }
  return out;
}

async function replaceLinks(
  tx: Sql,
  spec: RegisterSpec<z.ZodRawShape>,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  for (const l of spec.links ?? []) {
    const ids = body[l.input];
    if (ids === undefined) continue; // not supplied: leave the links alone
    await tx.query(`delete from ${l.table} where ${l.self} = $1`, [id]);
    for (const other of ids as string[]) {
      await tx.query(
        `insert or ignore into ${l.table} (${l.self}, ${l.other}) values ($1, $2)`,
        [id, other],
      );
    }
  }
}

export function registerRoutes<T extends z.ZodRawShape>(spec: RegisterSpec<T>) {
  const createBody = z.object(spec.shape);
  const patchBody = createBody.partial().strict();
  const base = `/api/v1/${spec.path}`;
  const one = spec.key ?? spec.label.toLowerCase();
  const select =
    `select t.*${linkSelect(spec as RegisterSpec<z.ZodRawShape>)}` +
    // How many files are attached, for the list. Every register has the column;
    // only those that take attachments ever have anything to count.
    `, (select count(*) from attachments a where a.entity = '${spec.table}' and a.entity_id = t.id) as attachment_count` +
    `${spec.extraSelect ? `, ${spec.extraSelect}` : ""} from ${spec.table} t`;
  const order = spec.orderBy ?? "t.seq";

  return async function routes(app: FastifyInstance): Promise<void> {
    app.get(base, { preHandler: canRead }, async () => {
      const { rows } = await query<Record<string, unknown>>(`${select} order by ${order}`);
      return { [spec.path]: rows.map(hydrate) };
    });

    app.get(`${base}/:id`, { preHandler: canRead }, async (request) => {
      const { id } = idParam.parse(request.params);
      const { rows } = await query<Record<string, unknown>>(`${select} where t.id = $1`, [id]);
      if (!rows[0]) throw notFound(`${spec.label} not found.`);
      return { [one]: hydrate(rows[0]) };
    });

    app.post(base, { preHandler: canWrite }, async (request, reply) => {
      requireAuth(request);
      assertCanWrite(request.user.role);
      const body = createBody.parse(request.body) as Record<string, unknown>;
      spec.validate?.(body);

      const id = randomUUID();
      const entries = Object.entries(body).filter(([k]) => k in spec.columns);

      const created = await withTransaction(async (tx) => {
        // SQLite has no identity column, so the display number is allocated
        // inside the write transaction, where it cannot race.
        const { rows: seqRows } = await tx.query<{ next: number }>(
          `select coalesce(max(seq), 0) + 1 as next from ${spec.table}`,
        );
        const seq = seqRows[0]?.next ?? 1;

        const cols = ["id", "seq", ...entries.map(([k]) => spec.columns[k]!)];
        const params = [id, seq, ...entries.map(([, v]) => v ?? null)];
        const holes = params.map((_, i) => `$${i + 1}`);

        const { rows } = await tx.query<Record<string, unknown>>(
          `insert into ${spec.table} (${cols.join(", ")}) values (${holes.join(", ")}) returning *`,
          params,
        );
        await replaceLinks(tx, spec as RegisterSpec<z.ZodRawShape>, id, body);
        return rows[0]!;
      });

      await audit(request, {
        action: `${spec.label} added`,
        entity: spec.label.toLowerCase(),
        entityId: id,
        after: created,
      });
      reply.code(201);
      return { [one]: created };
    });

    app.patch(`${base}/:id`, { preHandler: canWrite }, async (request) => {
      requireAuth(request);
      assertCanWrite(request.user.role);
      const { id } = idParam.parse(request.params);
      const body = patchBody.parse(request.body) as Record<string, unknown>;

      const { rows: existingRows } = await query<Record<string, unknown>>(
        `select * from ${spec.table} where id = $1`,
        [id],
      );
      const before = existingRows[0];
      if (!before) throw notFound(`${spec.label} not found.`);
      spec.validate?.(body, before);

      const updated = await withTransaction(async (tx) => {
        await spec.beforeUpdate?.(tx, id, body, before);

        const entries = Object.entries(body).filter(([k]) => k in spec.columns);
        let row = before;
        if (entries.length) {
          const sets = entries.map(([k], i) => `${spec.columns[k]} = $${i + 2}`);
          const { rows } = await tx.query<Record<string, unknown>>(
            `update ${spec.table} set ${sets.join(", ")} where id = $1 returning *`,
            [id, ...entries.map(([, v]) => v ?? null)],
          );
          row = rows[0]!;
        }
        await replaceLinks(tx, spec as RegisterSpec<z.ZodRawShape>, id, body);
        return row;
      });

      await audit(request, {
        action: `${spec.label} updated`,
        entity: spec.label.toLowerCase(),
        entityId: id,
        before,
        after: updated,
      });
      return { [one]: updated };
    });

    app.delete(`${base}/:id`, { preHandler: canWrite }, async (request, reply) => {
      requireAuth(request);
      assertCanWrite(request.user.role);
      const { id } = idParam.parse(request.params);
      const { rows } = await query<Record<string, unknown>>(
        `delete from ${spec.table} where id = $1 returning *`,
        [id],
      );
      if (!rows[0]) throw notFound(`${spec.label} not found.`);
      await removeAttachmentsOf(spec.table, id);
      await audit(request, {
        action: `${spec.label} deleted`,
        entity: spec.label.toLowerCase(),
        entityId: id,
        before: rows[0],
      });
      reply.code(204);
    });
  };
}
