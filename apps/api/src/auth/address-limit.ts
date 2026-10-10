/**
 * Failed sign-ins per address.
 *
 * The per-account lockout (five wrong passwords, fifteen minutes) stops one
 * account being guessed at. It does nothing about one address trying a few
 * passwords against every account, and it hands that address a way to lock
 * everyone out on purpose. This counts failures by address as well: past the
 * limit, the address is refused before any account is looked at, so it can no
 * longer guess and no longer lock anybody out.
 *
 * Only failures count. An office behind one address signs in dozens of times
 * at nine in the morning, and none of that should use up anything. A success
 * does not clear the count either, or one working account would let an
 * address reset its own limit between guesses.
 *
 * In memory: the product runs as one process, and a restart clearing the
 * count is acceptable for a limit measured in minutes.
 */

export const ADDRESS_MAX_FAILED = 20;
export const ADDRESS_WINDOW_MINUTES = 15;
const WINDOW_MS = ADDRESS_WINDOW_MINUTES * 60_000;

interface Tally {
  count: number;
  since: number;
}

const tallies = new Map<string, Tally>();

function current(address: string, now: number): Tally | undefined {
  const t = tallies.get(address);
  if (t && now - t.since >= WINDOW_MS) {
    tallies.delete(address);
    return undefined;
  }
  return t;
}

/** True when this address has used up its failed sign-ins for now. */
export function addressBlocked(address: string, now = Date.now()): boolean {
  return (current(address, now)?.count ?? 0) >= ADDRESS_MAX_FAILED;
}

/** Counts one failure. Returns the count, so the caller can note the moment it reaches the limit. */
export function noteAddressFailure(address: string, now = Date.now()): number {
  // Forget stale addresses now and then, so a scan from many addresses cannot
  // grow this without end.
  if (tallies.size > 10_000) {
    for (const [a, t] of tallies) if (now - t.since >= WINDOW_MS) tallies.delete(a);
  }
  const t = current(address, now) ?? { count: 0, since: now };
  t.count += 1;
  tallies.set(address, t);
  return t.count;
}

/** For tests. */
export function resetAddressLimits(): void {
  tallies.clear();
}
