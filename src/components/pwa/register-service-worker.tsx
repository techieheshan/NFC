"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js so the app can be installed to a home screen.
 * Intentionally tiny — this is the only client component in the root layout,
 * and it must stay that way to keep the terminal routes light.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Registration is not worth a console error on http:// dev origins.
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
