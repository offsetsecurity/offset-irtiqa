import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { query } from "../db/pool.js";
import { canRead } from "../auth/rbac.js";

/**
 * Everything with a date on it, in one list.
 *
 * The dates already exist, scattered over eight screens: a policy due for
 * review, a task, an open finding, evidence going stale, a supplier review, an
 * objective, somebody's training, a planned audit. Nobody visits eight screens
 * to find out what this month needs, so the answer is assembled here.
 *
 * Read-only and derived. Nothing is stored: a calendar that had its own rows
 * would be a second copy of the truth, wrong the moment somebody changed a due
 * date on the register it came from.
 */

export interface CalendarItem {
  kind: string;
  /** The screen it lives on, for the button that takes you there. */
  screen: string;
  id: string;
  title: string;
  detail: string;
  owner: string;
  due: string;
}

const params = z.object({
  /** How far ahead to look. Everything overdue comes back whatever this says. */
  days: z.coerce.number().int().min(1).max(730).default(90),
});

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/calendar", { preHandler: canRead }, async (request) => {
    const { days } = params.parse(request.query);
    const horizon = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    // One query per source, each already shaped as a calendar item. Kept apart
    // rather than union-ed in SQL because each has its own idea of "still open".
    const sources: { sql: string; args?: unknown[] }[] = [
      {
        sql: `select 'Policy review' as kind, 'policies' as screen, id, name as title,
                     'Version ' || version as detail, owner, review_date as due
                from policies where review_date is not null and review_date <= $1`,
      },
      {
        sql: `select 'Task' as kind, 'tasks' as screen, id, title,
                     priority || ' priority' as detail, owner, due_date as due
                from tasks where status <> 'Done' and due_date is not null and due_date <= $1`,
      },
      {
        sql: `select 'Finding' as kind, 'findings' as screen, id, title,
                     type as detail, owner, due_date as due
                from findings where status <> 'Closed' and due_date is not null and due_date <= $1`,
      },
      {
        sql: `select 'Evidence refresh' as kind, 'evidence' as screen, id, name as title,
                     type as detail, owner, next_review as due
                from evidence where next_review is not null and next_review <= $1`,
      },
      {
        sql: `select 'Supplier review' as kind, 'vendors' as screen, id, name as title,
                     criticality || ' criticality' as detail, owner, review_date as due
                from vendors where status <> 'Exited' and review_date is not null and review_date <= $1`,
      },
      {
        sql: `select 'Objective' as kind, 'objectives' as screen, id, title,
                     status as detail, owner, due_date as due
                from objectives where status not in ('Met', 'Missed')
                  and due_date is not null and due_date <= $1`,
      },
      {
        sql: `select 'Training' as kind, 'training' as screen, id,
                     person || ' — ' || course as title, result as detail, '' as owner,
                     next_due as due
                from training where next_due is not null and next_due <= $1`,
      },
      {
        sql: `select 'Audit or review' as kind, 'reviews' as screen, id, title,
                     kind as detail, led_by as owner, planned_date as due
                from reviews where status in ('Planned', 'In progress')
                  and planned_date is not null and planned_date <= $1`,
      },
      {
        sql: `select 'Communication' as kind, 'communications' as screen, id, topic as title,
                     audience as detail, owner, next_due as due
                from communications where next_due is not null and next_due <= $1`,
      },
      {
        // The certificate, from the ISMS screen. Recertification takes months
        // to arrange, so it shows as soon as it is inside the horizon.
        sql: `select 'Certificate expiry' as kind, 'isms' as screen, '1' as id,
                     'ISO/IEC 27001 certificate expires' as title,
                     coalesce(json_extract(attrs, '$.certification.number'), '') as detail,
                     coalesce(json_extract(attrs, '$.certification.body'), '') as owner,
                     json_extract(attrs, '$.certification.expires') as due
                from programme
               where id = 1 and coalesce(json_extract(attrs, '$.certification.expires'), '') <> ''
                 and json_extract(attrs, '$.certification.expires') <= $1`,
      },
      {
        sql: `select 'Control due' as kind, 'controls' as screen, id, ref || ' ' || title as title,
                     'Control' as detail, owner, due_date as due
                from controls where status <> 'implemented' and status <> 'not_applicable'
                  and due_date is not null and due_date <= $1`,
      },
    ];

    const items: CalendarItem[] = [];
    for (const source of sources) {
      const { rows } = await query<CalendarItem>(source.sql, [horizon]);
      items.push(...rows);
    }

    items.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.title.localeCompare(b.title)));

    const today = new Date().toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    return {
      today,
      horizon,
      items,
      counts: {
        overdue: items.filter((i) => i.due < today).length,
        soon: items.filter((i) => i.due >= today && i.due <= in30).length,
        later: items.filter((i) => i.due > in30).length,
      },
    };
  });
}
