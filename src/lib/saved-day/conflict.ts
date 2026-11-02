/**
 * The optimistic version check. Every write names the version the person's screen was showing (`base`; 0 for a day that was not
 * saved). It is compared with the stored `currentVersion` UNDER the day's lock; anything but an exact match writes nothing.
 */

export type BaseDecision =
  | { ok: true }
  | { ok: false; reason: "bad-base" }
  /** Someone saved this day first (the screen thought it was unsaved). */
  | { ok: false; reason: "already-saved" }
  /** The screen thought it was saved but no saved day exists (it was purged, or never saved). */
  | { ok: false; reason: "not-saved" }
  /** The day moved on while the person was working. */
  | { ok: false; reason: "conflict" };

/** `current`: the stored currentVersion, or null when no saved day exists. */
export function decideBase(base: unknown, current: number | null): BaseDecision {
  if (typeof base !== "number" || !Number.isInteger(base) || base < 0) return { ok: false, reason: "bad-base" };
  if (current === null) return base === 0 ? { ok: true } : { ok: false, reason: "not-saved" };
  if (base === 0) return { ok: false, reason: "already-saved" };
  return base === current ? { ok: true } : { ok: false, reason: "conflict" };
}
