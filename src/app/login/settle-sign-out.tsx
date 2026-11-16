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
 *  - otherwise (the form is showing): checks quietly, over about twelve seconds, whether a session has appeared, and signs out again if it has.
 *    The moment ANYONE touches this screen (a tap, a key, a submit) the checking stops for good: a session that appears after that may be the
 *    NEXT person's own sign-in, and it must never be signed out by this check. Whatever they sign in as replaces the old cookie anyway.
 */
export function SettleSignOut({ attempt, active, passwordFor }: { attempt: number; active: boolean; passwordFor?: string }) {
  useEffect(() => {
    let stopped = false;
    const timers: number[] = [];
    const stop = () => {
      stopped = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
    const signOutAgain = () => { void switchUser(attempt, passwordFor); };
    const events = ["pointerdown", "touchstart", "keydown", "submit"] as const;
    if (active) {
      timers.push(window.setTimeout(signOutAgain, 1500));
    } else {
      for (const ms of [1000, 2000, 3500, 5500, 8000, 12000]) {
        timers.push(
          window.setTimeout(async () => {
            if (stopped) return;
            try {
              const r = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
              const s = (await r.json()) as { user?: unknown } | null;
              // the answer can arrive after someone started signing in: then it is not ours to act on
              if (!stopped && s && s.user) signOutAgain();
            } catch {
              /* offline or interrupted: nothing to settle */
            }
          }, ms),
        );
      }
      for (const e of events) document.addEventListener(e, stop, { capture: true, once: true });
    }
    return () => {
      stop();
      for (const e of events) document.removeEventListener(e, stop, { capture: true });
    };
  }, [attempt, active, passwordFor]);
  return active ? (
    <p role="status" className="bg-secondary text-secondary-foreground rounded-md px-3 py-3 text-center text-sm">
      Signing out the previous person…
    </p>
  ) : null;
}
