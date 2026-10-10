/**
 * The daily digest.
 *
 * One rule shaped everything here: **a digest that arrives every day saying
 * nothing trains people to ignore it**, and the day it finally matters they
 * will not read it either. So this reports things that need somebody to act,
 * and when there is nothing to act on it sends nothing at all.
 *
 * That is a setting rather than a law — some organisations want the daily
 * "all clear" as evidence that the tool is alive — but it is the default, and
 * the reason is written next to it.
 *
 * Everything is counted from the same tables the screens read, so the digest
 * and the dashboard can never disagree.
 */
import { query } from "../db/pool.js";
import { product } from "../config.js";
import { todayIso } from "../lib/time.js";

export interface DigestSettings {
  enabled: boolean;
  /**
   * Who receives it. Empty means every enabled administrator who has an email
   * address, which is the sensible default: it works the moment mail is turned
   * on, without a second list to keep up to date.
   */
  recipients: string[];
  /** Send even when there is nothing to report. Off by default; see above. */
  sendWhenEmpty: boolean;
  /** How far ahead to look for things coming due. */
  horizonDays: number;
}

export const DIGEST_DEFAULTS: DigestSettings = {
  enabled: false,
  recipients: [],
  sendWhenEmpty: false,
  horizonDays: 14,
};

export interface DigestSection {
  heading: string;
  lines: string[];
  /** More rows exist than are listed. */
  moreCount: number;
}

export interface Digest {
  subject: string;
  body: string;
  /** Rows that need action. Zero means there is nothing worth sending. */
  actionable: number;
  sections: DigestSection[];
}

/** Reads the stored settings, falling back to defaults for anything missing. */
export async function loadDigest(): Promise<DigestSettings> {
  const { rows } = await query<{ value: string }>(
    "select value from settings where key = 'digest'",
  );
  if (!rows[0]) return { ...DIGEST_DEFAULTS };
  try {
    return { ...DIGEST_DEFAULTS, ...(JSON.parse(rows[0].value) as Partial<DigestSettings>) };
  } catch {
    // Corrupt JSON means "not configured", not a broken settings screen.
    return { ...DIGEST_DEFAULTS };
  }
}

export async function saveDigest(settings: DigestSettings): Promise<void> {
  await query(
    `insert into settings (key, value, updated_at)
     values ('digest', $1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at`,
    [JSON.stringify(settings)],
  );
}

/** Never list more than this per section: a wall of text is not a summary. */
const MAX_ROWS = 8;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "3 things" / "1 thing" — small, but a digest that says "1 items" reads badly. */
function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

async function section(
  heading: string,
  sql: string,
  params: unknown[],
  render: (row: Record<string, unknown>) => string,
): Promise<DigestSection> {
  const { rows } = await query<Record<string, unknown>>(sql, params);
  return {
    heading,
    lines: rows.slice(0, MAX_ROWS).map(render),
    moreCount: Math.max(0, rows.length - MAX_ROWS),
  };
}

/**
 * Readiness now, and the change over the last week.
 *
 * Context rather than an action, so it does not count towards whether there is
 * anything worth sending. A digest should not be triggered by a number moving.
 */
async function readinessLine(): Promise<string> {
  const { rows } = await query<{ day: string; pct: number }>(
    "select day, pct from trend order by day desc limit 30",
  );
  if (!rows.length) return "Readiness: no history yet.";

  const today = rows[0]!;
  const weekAgo = rows.find((r) => r.day <= addDays(today.day, -7));
  if (!weekAgo) return `Readiness: ${today.pct}%.`;

  const delta = today.pct - weekAgo.pct;
  const movement =
    delta === 0 ? "unchanged over the last week" : `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} points in a week`;
  return `Readiness: ${today.pct}%, ${movement}.`;
}

/** Builds the digest. Reads only; safe to call for a preview. */
export async function buildDigest(settings: DigestSettings = DIGEST_DEFAULTS): Promise<Digest> {
  const today = todayIso();
  const soon = addDays(today, settings.horizonDays);

  const sections = await Promise.all([
    section(
      "Evidence out of date",
      `select name, owner, next_review from evidence
        where next_review is not null and next_review < $1
        order by next_review`,
      [today],
      (r) => `  ${r["name"]} — was due ${r["next_review"]}${r["owner"] ? `, ${r["owner"]}` : ""}`,
    ),
    section(
      `Evidence due within ${plural(settings.horizonDays, "day")}`,
      `select name, owner, next_review from evidence
        where next_review is not null and next_review >= $1 and next_review <= $2
        order by next_review`,
      [today, soon],
      (r) => `  ${r["name"]} — due ${r["next_review"]}${r["owner"] ? `, ${r["owner"]}` : ""}`,
    ),
    section(
      "Tasks overdue",
      `select seq, title, owner, due_date from tasks
        where status <> 'Done' and due_date is not null and due_date < $1
        order by due_date`,
      [today],
      (r) => `  #${r["seq"]} ${r["title"]} — was due ${r["due_date"]}${r["owner"] ? `, ${r["owner"]}` : ""}`,
    ),
    section(
      "Findings overdue",
      `select seq, title, owner, due_date from findings
        where status <> 'Closed' and due_date is not null and due_date < $1
        order by due_date`,
      [today],
      (r) => `  #${r["seq"]} ${r["title"]} — was due ${r["due_date"]}${r["owner"] ? `, ${r["owner"]}` : ""}`,
    ),
    section(
      "Policies due for review",
      `select seq, name, owner, review_date from policies
        where review_date is not null and review_date <= $1
        order by review_date`,
      [soon],
      (r) => `  ${r["name"]} — review ${r["review_date"]}${r["owner"] ? `, ${r["owner"]}` : ""}`,
    ),
    section(
      "Open risks in the top band",
      // The same expression the heat map colours by, so the digest and the
      // risk register cannot disagree about what "critical" means.
      `select seq, title, owner, (likelihood * impact) as inherent
         from risks
        where status in ('Open', 'Treated') and (likelihood * impact) >= 20
        order by inherent desc`,
      [],
      (r) => `  #${r["seq"]} ${r["title"]} — score ${r["inherent"]}${r["owner"] ? `, ${r["owner"]}` : ""}`,
    ),
  ]);

  const withRows = sections.filter((s) => s.lines.length > 0);
  const actionable = withRows.reduce((n, s) => n + s.lines.length + s.moreCount, 0);
  const readiness = await readinessLine();

  const parts: string[] = [`${product.name} — ${today}`, "", readiness, ""];

  if (withRows.length === 0) {
    parts.push("Nothing needs attention today.");
  } else {
    for (const s of withRows) {
      parts.push(`${s.heading} (${s.lines.length + s.moreCount})`);
      parts.push(...s.lines);
      if (s.moreCount) parts.push(`  … and ${s.moreCount} more`);
      parts.push("");
    }
  }

  parts.push(
    "",
    "Sent by " + product.name + ". Turn this off, or change who receives it,",
    "under Settings in the application.",
  );

  const subject =
    actionable === 0
      ? `${product.name}: nothing needs attention`
      : `${product.name}: ${plural(actionable, "item")} needing attention`;

  return { subject, body: parts.join("\n"), actionable, sections: withRows };
}

/**
 * Who the digest goes to.
 *
 * An explicit list wins. Otherwise every enabled administrator with an email
 * address, so it works as soon as mail is turned on rather than needing a
 * second list nobody remembers to update when someone leaves.
 */
export async function digestRecipients(settings: DigestSettings): Promise<string[]> {
  const explicit = settings.recipients.map((r) => r.trim()).filter(Boolean);
  if (explicit.length) return explicit;

  const { rows } = await query<{ email: string }>(
    "select email from users where role = 'admin' and disabled = 0 and email <> ''",
  );
  return rows.map((r) => r.email);
}
