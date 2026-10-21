/**
 * Time, in one place.
 *
 * Timestamps (created_at, a session's expiry, an audit row) are stored as
 * ISO-8601 UTC text, which sorts and compares correctly as a string.
 *
 * Dates a person picks - when evidence was collected, when a task is due - are
 * calendar dates with no time, and "today" for those means the organisation's
 * today, not UTC's. Between midnight and 05:30 in India, UTC is still on
 * yesterday; working the date out in UTC there made evidence collected today
 * show as -1 days old. So every calendar date the product works out comes from
 * todayIso(), in the server's zone, and SQL gets the same date
 * through the today() function the database connection registers.
 */

export const nowIso = (): string => new Date().toISOString();

export const isoIn = (ms: number): string => new Date(Date.now() + ms).toISOString();

export const isoInHours = (hours: number): string => isoIn(hours * 3_600_000);

export const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

export const isPast = (iso: string | null | undefined): boolean =>
  !!iso && iso < nowIso();

/**
 * The server's own zone, which on the organisation's server is the
 * organisation's. A Docker container is UTC unless TZ is set in its .env.
 */
export function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(kind: "date" | "stamp"): Intl.DateTimeFormat {
  const zone = timeZone();
  const key = `${kind}:${zone}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", kind === "date"
      ? { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }
      : { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formats.set(key, f);
  }
  return f;
}

/** The calendar date, YYYY-MM-DD, in the organisation's zone, of a moment (now by default). */
export function dateIn(when: Date = new Date()): string {
  const parts = Object.fromEntries(format("date").formatToParts(when).map((p) => [p.type, p.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

/** Today in the organisation's zone. */
export const todayIso = (): string => dateIn();

/**
 * The date so many calendar days from today, earlier when negative. Counted on
 * the calendar, not in 24-hour steps, so a change of clocks cannot move it.
 */
export function dayIso(offsetDays: number): string {
  const [y, m, d] = todayIso().split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/** "2026-10-17 03:37 Asia/Kolkata": a moment as a person in the organisation reads it. */
export function stampLocal(when: Date = new Date()): string {
  const parts = Object.fromEntries(format("stamp").formatToParts(when).map((p) => [p.type, p.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]} ${parts["hour"]}:${parts["minute"]} ${timeZone()}`;
}

// ── evidence age, the same rule everywhere ───────────────────────────────────

/** Evidence older than this many days is stale. "Older than 90 days" means 91 or more. */
export const STALE_DAYS = 90;

/** Whole days since a collected date, never below nought: a date in the future is today. */
export const ageDaysSql = (column: string): string =>
  `max(0, cast(julianday(today()) - julianday(${column}) as integer))`;

/** Fresh up to 30 days, ageing to 60, due to 90, stale after that. */
export const freshnessSql = (column: string, labels = ["fresh", "ageing", "due", "stale", "unknown"]): string =>
  `case
     when ${column} is null then '${labels[4]}'
     when ${column} >= date(today(), '-30 days') then '${labels[0]}'
     when ${column} >= date(today(), '-60 days') then '${labels[1]}'
     when ${column} >= date(today(), '-${STALE_DAYS} days') then '${labels[2]}'
     else '${labels[3]}'
   end`;

/** True for evidence that is stale or has no date. */
export const staleSql = (column: string): string =>
  `(${column} is null or ${column} < date(today(), '-${STALE_DAYS} days'))`;
