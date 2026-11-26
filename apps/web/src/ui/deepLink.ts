import { useEffect, useState } from "preact/hooks";

/**
 * Addresses that open one item, ready to fix: `#/controls/<id>?fix=owner&back=thread`.
 *
 * The Golden thread's fix buttons use them, so a person lands on the exact
 * control, risk or piece of evidence with the box to change already selected,
 * instead of on a list they then have to search. `back=thread` returns them to
 * the thread when they close it, so they can fix one break after another;
 * `back=monitoring?tab=…` returns them to the Monitoring tab they came from.
 */
export interface Target {
  id: string;
  fix: string;
  back: string;
}

const SETTLED = "offset:target-settled";

export function readTarget(route: string): Target | null {
  const m = new RegExp(`^#/?${route}/([^?/]+)(?:[?](.*))?$`).exec(window.location.hash);
  if (!m) return null;
  const q = new URLSearchParams(m[2] ?? "");
  return { id: decodeURIComponent(m[1]!), fix: q.get("fix") ?? "", back: q.get("back") ?? "" };
}

/** The address for one item, with what to fix and where to go after. */
export function linkTo(route: "controls" | "risks" | "evidence", id: string, fix: string, back = "thread"): string {
  return `#/${route}/${encodeURIComponent(id)}?fix=${fix}${back ? `&back=${encodeURIComponent(back)}` : ""}`;
}

/** The target in the address now, kept current as the address changes. */
export function useTarget(route: string): Target | null {
  const [target, setTarget] = useState<Target | null>(() => readTarget(route));
  useEffect(() => {
    const read = (): void => setTarget(readTarget(route));
    window.addEventListener("hashchange", read);
    // settle() rewrites the address without a hashchange; without this the old
    // target stayed, and closing the item (which reloads the list) opened it again.
    window.addEventListener(SETTLED, read);
    return () => { window.removeEventListener("hashchange", read); window.removeEventListener(SETTLED, read); };
  }, [route]);
  return target;
}

/** Once the item is open: back to the plain screen address, so a reload does not reopen it. */
export function settle(route: string): void {
  history.replaceState(null, "", `#/${route}`);
  window.dispatchEvent(new Event(SETTLED));
}

/** Where to go when the item opened from a link is closed. */
export function goBack(target: Target | null): void {
  if (target?.back === "thread") window.location.hash = "#/thread";
  // Monitoring sends its own address (tab, filters, the check open), so closing returns to that spot.
  else if (target?.back && /^monitoring(\?|$)/.test(target.back)) window.location.hash = `#/${target.back}`;
}

/**
 * Selects the box marked `data-fix="<fix>"`, once the form has drawn it.
 *
 * A dialog moves focus to its first field as it opens, which can land after
 * this. So it keeps putting focus back until it has stayed put for a moment.
 */
export function focusFix(fix: string): void {
  let ticks = 0;
  let steady = 0;
  const attempt = (): void => {
    const el = document.querySelector<HTMLElement>(`.modal [data-fix="${fix}"]`)
      ?? document.querySelector<HTMLElement>(`[data-fix="${fix}"]`);
    if (el) {
      const input = el.matches("input, select, textarea")
        ? el
        : el.querySelector<HTMLElement>("input, select, textarea") ?? el;
      if (document.activeElement === input) {
        steady++;
      } else {
        steady = 0;
        el.scrollIntoView({ block: "center" });
        input.focus({ preventScroll: true });
      }
      if (steady >= 3) return;
    }
    if (++ticks < 30) setTimeout(attempt, 100);
  };
  setTimeout(attempt, 50);
}

const STATUS_KEY = "offset.controls.status";

/** Opens the list of criteria (or controls) showing only one status, such as "in_progress" or "todo". */
export function openWithStatus(status: string): void {
  try { sessionStorage.setItem(STATUS_KEY, status); } catch { /* the list opens unfiltered */ }
  window.location.hash = "#/controls";
}

/** The status handed over by openWithStatus, read once. */
export function takeStatusFilter(): string {
  try {
    const v = sessionStorage.getItem(STATUS_KEY) ?? "";
    sessionStorage.removeItem(STATUS_KEY);
    return v;
  } catch {
    return "";
  }
}
