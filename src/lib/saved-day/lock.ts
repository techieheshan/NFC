/**
 * The per-day advisory lock and the transaction limits of a save, in the style of `takePayment`.
 *
 * `pg_advisory_xact_lock(DS_LOCK_NAMESPACE, yyyymmdd)` is a transaction-level lock, so it works through Neon's pooler and is released
 * at commit or rollback. The namespace keeps it from ever colliding with another feature's lock; it MUST differ from takePayment's
 * (7301), and a test fails if it does not.
 */

export const DS_LOCK_NAMESPACE = 7410;

/** How long to wait for ANOTHER save of the same day. Shorter than the transaction timeout on purpose (as in takePayment). */
export const LOCK_WAIT_MS = 4000;
export const TX_MAX_WAIT_MS = 2000;
export const TX_TIMEOUT_MS = 6000;

/** "2026-11-02" -> 20261102, which fits the lock's 32-bit key. */
export function lockKey(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`not a date: ${date}`);
  return Number(date.replace(/-/g, ""));
}
