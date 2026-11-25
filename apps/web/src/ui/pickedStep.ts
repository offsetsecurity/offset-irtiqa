/**
 * Which Plan step to open when the screen is next shown.
 *
 * A card on the Dashboard ("Up next") names a step; opening Plan should
 * land on that step, not on whatever the plan suggests. The step id travels in
 * sessionStorage for one visit: kept for the browser tab only, read once, then
 * forgotten, so a later visit starts where the plan says.
 */
const KEY = "assure.getready.pick";

export function pickStep(id: string): void {
  try { sessionStorage.setItem(KEY, id); } catch { /* Plan just opens on its own suggestion */ }
}

export function takePickedStep(): string | null {
  try {
    const id = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return id;
  } catch {
    return null;
  }
}
