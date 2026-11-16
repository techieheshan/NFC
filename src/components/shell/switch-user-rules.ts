/** How many times one "Switch user" may sign out again while a request that was already in flight keeps putting the session cookie back. */
export const MAX_SIGN_OUTS = 8;

/** `?switched=N` on the sign-in screen: N is the number of sign-outs so far (1..MAX_SIGN_OUTS), or null when it is not a switch. */
export function switchedCount(raw: unknown): number | null {
  const n = Number(typeof raw === "string" ? raw : "");
  return Number.isInteger(n) && n >= 1 && n <= MAX_SIGN_OUTS ? n : null;
}
