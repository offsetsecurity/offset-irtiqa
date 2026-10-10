import type { ControlStatus } from "../persistence/apiClient.js";

/**
 * SAMA's maturity scale.
 *
 * The names matter more than the numbers. "3" means nothing to somebody
 * filling this in; "Structured and formalised" tells them whether it is
 * true of their organisation, which is the judgement they are being asked
 * to make.
 */
export const MATURITY_LEVELS: { level: number; name: string; note: string }[] = [
  { level: 0, name: "Non-existent", note: "no documentation, no awareness" },
  { level: 1, name: "Ad-hoc", note: "done inconsistently, nothing defined" },
  { level: 2, name: "Repeatable but informal", note: "repeated, but not formally defined" },
  { level: 3, name: "Structured and formalised", note: "defined, approved, monitored" },
  { level: 4, name: "Managed and measurable", note: "effectiveness measured" },
  { level: 5, name: "Adaptive", note: "continuously improved" },
];

/** Red below target, amber at it, green above. The target is usually 3. */
export function maturityColour(level: number | null, target: number): string {
  if (level === null) return "#94a3b8";
  if (level < target) return "#dc2626";
  if (level === target) return "#16a34a";
  return "#0f766e";
}

export const STATUS_ORDER: ControlStatus[] = [
  "implemented",
  "in_progress",
  "not_started",
  "not_applicable",
];

export const STATUS_LABEL: Record<ControlStatus, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  implemented: "Implemented",
  not_applicable: "Not Applicable",
};

/** Kept in step with the pill classes in index.html. */
export const STATUS_PILL: Record<ControlStatus, string> = {
  not_started: "slate",
  in_progress: "amber",
  implemented: "green",
  not_applicable: "blue",
};

export const STATUS_COLOR: Record<ControlStatus, string> = {
  implemented: "#16a34a",
  in_progress: "#d97706",
  not_started: "#94a3b8",
  not_applicable: "#3b82f6",
};

/** CSF function accents. Falls back to the brand navy for other frameworks. */
export const THEME_COLOR: Record<string, string> = {
  GV: "#4338ca",
  ID: "#0891b2",
  PR: "#2457D6",
  DE: "#7c3aed",
  RS: "#c2410c",
  RC: "#0f766e",
};

export const themeColor = (key: string): string => THEME_COLOR[key] ?? "#334155";

/** "Subcategory" -> "Subcategories", "Control" -> "Controls". */
export const plural = (word: string): string =>
  /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;

export const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 100) : 0;

/** "3 days ago", "today" — short enough for a table cell. */
export function since(iso: string | null | undefined): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days)) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export const RISK_BAND_COLOR: Record<string, string> = {
  critical: "#dc2626",
  elevated: "#d97706",
  acceptable: "#16a34a",
};
