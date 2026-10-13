/**
 * SQLite has no date type. Timestamps are stored as ISO-8601 UTC text, which
 * sorts and compares correctly as a string. These helpers keep that format in
 * one place so comparisons in SQL and in JavaScript always agree.
 */

export const nowIso = (): string => new Date().toISOString();

export const isoIn = (ms: number): string => new Date(Date.now() + ms).toISOString();

export const isoInHours = (hours: number): string => isoIn(hours * 3_600_000);

export const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();

/** Date only, for collected_date / review dates. */
export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const isPast = (iso: string | null | undefined): boolean =>
  !!iso && iso < nowIso();
