"use client";

import { useEffect } from "react";

import { switchUser } from "@/components/shell/switch-user-action";

/**
 * After "Switch user" the previous person's session can come BACK: the session cookie is renewed by every request that passes the proxy, so a
 * request that was already in flight when they tapped (a prefetch, a refresh) can answer after the sign-out and put the cookie back. The screen
 * would still show the sign-in form while the old session is alive in the browser.
 *
 *  - `active` (the server still sees a session when it draws this page): says so, waits a moment so those requests have landed, signs out again;
 *    the page then reloads and either shows the form or comes back here (at most MAX_SIGN_OUTS times).
 *  - otherwise (the form is showing): checks quietly, six times over about twelve seconds, whether a session has appeared, and signs out again if it has.
 */
export function SettleSignOut({ attempt, active }: { attempt: number; active: boolean }) {
  useEffect(() => {
    const timers: number[] = [];
    const signOutAgain = () => { void switchUser(attempt); };
    if (active) {
      timers.push(window.setTimeout(signOutAgain, 1500));
    } else {
      for (const ms of [1000, 2000, 3500, 5500, 8000, 12000]) {
        timers.push(
          window.setTimeout(async () => {
            try {
              const r = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
              const s = (await r.json()) as { user?: unknown } | null;
              if (s && s.user) signOutAgain();
            } catch {
              /* offline or interrupted: nothing to settle */
            }
          }, ms),
        );
      }
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [attempt, active]);
  return active ? (
    <p role="status" className="bg-secondary text-secondary-foreground rounded-md px-3 py-3 text-center text-sm">
      Signing out the previous person…
    </p>
  ) : null;
}
