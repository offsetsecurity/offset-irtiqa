import { randomUUID } from "node:crypto";
import { query } from "../db/pool.js";
import { product } from "../config.js";
import { loadSmtp, sendMail, whyNotSendable } from "./mailer.js";
import {
  allItems, buildReminder, daysBetween, niceDate, plural, stageFor, type DueItem,
} from "./reminders.js";

/**
 * Who is told when something is ignored.
 *
 * Until something is overdue, only the person who owns it hears about it (see
 * reminders.ts). Once it is overdue, up to four people are told in turn: the
 * administrator, their manager, that person's manager, and top management.
 * Each level has a name, an address and the number of days overdue at which it
 * is told.
 *
 * Everybody above is copied into each message, and the message says who else
 * has been told, so nobody is left wondering whether the manager knows. A level
 * is told when it is reached, then again every CHAIN_REPEAT_DAYS until the
 * thing is done: weekly, not daily, or the top of the chain stops reading.
 *
 * A level with no address is skipped, so a small organisation with one
 * administrator and a boss sets two and leaves two empty.
 */

export const CHAIN_ROLES = [
  { role: "Administrator", days: 1 },
  { role: "The administrator's manager", days: 7 },
  { role: "Their manager", days: 15 },
  { role: "Top management", days: 30 },
] as const;

export const CHAIN_REPEAT_DAYS = 7;

export interface ChainLevel {
  role: string;
  name: string;
  email: string;
  /** Days overdue at which this level is told. 1 is the day after the date. */
  days: number;
}

export interface EscalationSettings {
  /** Whether reminders go out on their own. On unless somebody turns it off. */
  enabled: boolean;
  chain: ChainLevel[];
}

const EMAIL_SHAPE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const looksLikeEmail = (s: string): boolean => EMAIL_SHAPE.test(s.trim());

/** Always four levels, in order, whatever was stored. */
export function normaliseChain(raw: unknown): ChainLevel[] {
  const list = Array.isArray(raw) ? (raw as Partial<ChainLevel>[]) : [];
  return CHAIN_ROLES.map((r, i) => {
    const x = list[i] ?? {};
    const days = Number(x.days);
    return {
      role: r.role,
      name: String(x.name ?? "").trim().slice(0, 120),
      email: String(x.email ?? "").trim().slice(0, 320),
      days: Number.isInteger(days) && days >= 1 && days <= 365 ? days : r.days,
    };
  });
}

export async function loadEscalation(): Promise<EscalationSettings> {
  const { rows } = await query<{ value: string }>("select value from settings where key = 'escalation'");
  let stored: { enabled?: boolean; chain?: unknown } = {};
  try {
    if (rows[0]) stored = JSON.parse(rows[0].value) as typeof stored;
  } catch {
    stored = {};
  }
  return { enabled: stored.enabled !== false, chain: normaliseChain(stored.chain) };
}

export async function saveEscalation(s: EscalationSettings): Promise<void> {
  await query(
    "insert or replace into settings (key, value) values ('escalation', $1)",
    [JSON.stringify({ enabled: s.enabled, chain: s.chain.map((c) => ({ name: c.name, email: c.email, days: c.days })) })],
  );
}

const labelOf = (l: ChainLevel): string => (l.name ? `${l.name} (${l.role})` : l.role);

/** The email to one level of the chain about one overdue thing. */
export function buildChainMessage(
  item: DueItem, index: number, chain: ChainLevel[], alsoTold: ChainLevel[], today: string,
): { subject: string; text: string } {
  const over = -daysBetween(item.due_date, today);
  const me = chain[index]!;
  const next = chain.slice(index + 1).find((l) => looksLikeEmail(l.email));
  const who = item.owner ? `${item.owner} (${item.owner_email})` : item.owner_email;

  const lines = [
    `Hello ${me.name || me.role},`,
    "",
    `${who} has not finished this, and it is overdue:`,
    "",
    `  ${item.ref}: ${item.title}`,
    `  due ${niceDate(item.due_date)}, ${plural(over, "day")} overdue`,
    "",
    alsoTold.length
      ? `This message was also sent to: ${alsoTold.map(labelOf).join(", ")}.`
      : "You are the first person told.",
  ];
  if (next) {
    lines.push(
      next.days > over
        ? `If it is still not done, ${labelOf(next)} will be told in ${plural(next.days - over, "day")}, with you copied in.`
        : `${labelOf(next)} is told as well.`,
    );
  }
  lines.push(
    "",
    `You will be reminded again in ${plural(CHAIN_REPEAT_DAYS, "day")} if it is still outstanding.`,
    "",
    `${product.name} sent this because the date on it has passed.`,
    "",
  );
  return {
    subject: `${product.name}: overdue ${plural(over, "day")} - ${item.ref}: ${item.title}`,
    text: lines.join("\n"),
  };
}

export interface RunResult {
  /** Why nothing was attempted, when that is so. */
  blocked?: string;
  owner: number;
  chain: number;
  failed: number;
  reasons: string[];
}

let running = false;

/**
 * One pass: sends whatever is due today. Safe to run twice in a day, because
 * every email sent is written to reminder_log and looked up before the next.
 * A failure for one address does not stop the rest.
 */
export async function sendReminders(today: string, opts: { force?: boolean } = {}): Promise<RunResult> {
  const out: RunResult = { owner: 0, chain: 0, failed: 0, reasons: [] };
  const smtp = await loadSmtp();
  const blocked = whyNotSendable(smtp);
  if (blocked) return { ...out, blocked };

  const settings = await loadEscalation();
  if (!settings.enabled && !opts.force) return { ...out, blocked: "Automatic reminders are turned off." };
  if (running) return { ...out, blocked: "A run is already in progress." };
  running = true;

  try {
    const log = (
      item: DueItem, kind: "owner" | "chain", stage: string, level: number,
      to: string, cc: string, subject: string, ok: boolean, reason?: string,
    ) =>
      query(
        `insert into reminder_log
           (id, item_key, item_ref, item_title, owner, due_date, kind, stage, level, to_email, cc, subject, sent_on, ok, error)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [randomUUID(), item.key, item.ref, item.title, item.owner, item.due_date, kind, stage, level,
         to, cc, subject, today, ok ? 1 : 0, ok ? null : (reason ?? "").slice(0, 300)],
      );

    for (const item of await allItems()) {
      // ——— the person who owns it ———
      const stage = stageFor(item.due_date, today);
      if (stage) {
        const done = await query(
          `select 1 from reminder_log where item_key = $1 and due_date = $2
              and kind = 'owner' and stage = $3 and ok = 1`,
          [item.key, item.due_date, stage],
        );
        if (!done.rows.length) {
          const r = buildReminder(item, stage, today);
          const result = await sendMail({ to: r.to, subject: r.subject, text: r.text });
          await log(item, "owner", stage, 0, r.to, "", r.subject, result.sent, result.reason);
          if (result.sent) out.owner++;
          else { out.failed++; out.reasons.push(`${r.to}: ${result.reason ?? "not sent"}`); }
        }
      }

      // ——— the chain, once it is overdue ———
      const over = -daysBetween(item.due_date, today);
      if (over < 1) continue;
      for (let i = 0; i < settings.chain.length; i++) {
        const level = settings.chain[i]!;
        if (!looksLikeEmail(level.email) || over < level.days) continue;

        const last = await query<{ d: string | null }>(
          `select max(sent_on) as d from reminder_log where item_key = $1 and due_date = $2
              and kind = 'chain' and level = $3 and ok = 1`,
          [item.key, item.due_date, i + 1],
        );
        const lastOn = last.rows[0]?.d;
        if (lastOn && daysBetween(today, lastOn) < CHAIN_REPEAT_DAYS) continue;

        // Everyone above who has been reached is copied in.
        const earlier = settings.chain
          .slice(0, i)
          .filter((l) => looksLikeEmail(l.email) && over >= l.days && l.email.toLowerCase() !== level.email.toLowerCase());
        const cc = [...new Set(earlier.map((l) => l.email.trim()))].join(", ");
        const msg = buildChainMessage(item, i, settings.chain, earlier, today);
        const result = await sendMail({ to: level.email.trim(), cc: cc || undefined, subject: msg.subject, text: msg.text });
        await log(item, "chain", `level-${i + 1}`, i + 1, level.email.trim(), cc, msg.subject, result.sent, result.reason);
        if (result.sent) out.chain++;
        else { out.failed++; out.reasons.push(`${level.email}: ${result.reason ?? "not sent"}`); }
      }
    }
    return out;
  } finally {
    running = false;
  }
}

export interface LogRow {
  id: string;
  sent_on: string;
  kind: string;
  stage: string;
  level: number;
  to_email: string;
  cc: string;
  subject: string;
  item_ref: string;
  item_title: string;
  owner: string;
  due_date: string;
  ok: number;
  error: string | null;
}

export async function recentLog(limit = 100): Promise<LogRow[]> {
  const { rows } = await query<LogRow>(
    `select id, sent_on, kind, stage, level, to_email, cc, subject, item_ref, item_title, owner, due_date, ok, error
       from reminder_log order by created_at desc, rowid desc limit $1`,
    [Math.min(Math.max(limit, 1), 1000)],
  );
  return rows;
}
