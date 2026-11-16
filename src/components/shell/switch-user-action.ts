"use server";

import { signOut } from "@/auth";

import { MAX_SIGN_OUTS } from "./switch-user-rules";

/**
 * Ends this session and opens the sign-in screen, where the next person taps their card, scans their QR or types a password.
 *
 * `attempt` counts the sign-outs of ONE switch (0 for the person's tap). The session cookie is renewed by every request that passes the
 * proxy, so a request that was already in flight when the person tapped (a prefetch, a refresh) can answer AFTER this sign-out and put the cookie
 * back; the next person's card would then land on the previous person's session. The sign-in screen therefore checks, and while a session is
 * still there it waits a moment and signs out again (`SettleSignOut`), up to MAX_SIGN_OUTS times.
 */
export async function switchUser(attempt = 0) {
  const n = Number.isInteger(attempt) && attempt >= 0 && attempt < MAX_SIGN_OUTS ? attempt : MAX_SIGN_OUTS - 1;
  await signOut({ redirectTo: `/login?switched=${n + 1}` });
}
