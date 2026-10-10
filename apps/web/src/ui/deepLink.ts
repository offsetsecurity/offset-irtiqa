import { useEffect, useState } from "preact/hooks";

/**
 * Addresses that open one item, ready to fix: `#/controls/<id>?fix=owner&back=thread`.
 *
 * The Golden thread's fix buttons use them, so a person lands on the exact
 * control, risk or piece of evidence with the box to change already selected,
 * instead of on a list they then have to search. `back=thread` returns them to
 * the thread when they close it, so they can fix one break after another.
 */
export interface Target {
  id: string;
  fix: string;
  back: string;
}

export function readTarget(route: string): Target | null {
  const m = new RegExp(`^#/?${route}/([^?/]+)(?:[?](.*))?$`).exec(window.location.hash);
  if (!m) return null;
  const q = new URLSearchParams(m[2] ?? "");
  return { id: decodeURIComponent(m[1]!), fix: q.get("fix") ?? "", back: q.get("back") ?? "" };
}

/** The address for one item, with what to fix and where to go after. */
export function linkTo(route: "controls" | "risks" | "evidence", id: string, fix: string, back = "thread"): string {
  return `#/${route}/${encodeURIComponent(id)}?fix=${fix}${back ? `&back=${back}` : ""}`;
}

/** The target in the address now, kept current as the address changes. */
export function useTarget(route: string): Target | null {
  const [target, setTarget] = useState<Target | null>(() => readTarget(route));
  useEffect(() => {
    const read = (): void => setTarget(readTarget(route));
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [route]);
  return target;
}

/** Once the item is open: back to the plain screen address, so a reload does not reopen it. */
export function settle(route: string): void {
  history.replaceState(null, "", `#/${route}`);
}

/** Where to go when the item opened from a link is closed. */
export function goBack(target: Target | null): void {
  if (target?.back === "thread") window.location.hash = "#/risks/thread";
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
