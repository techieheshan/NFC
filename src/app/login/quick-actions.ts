"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export type QuickLoginResult = { ok: true } | { ok: false; code: string };

/**
 * The login screen's card and QR sign-in. It runs the separate "quick" provider; every decision (registered terminal, STAFF only, the counter,
 * the audit) is made in `lib/quick-login.ts`. The browser learns only a coarse code: "unknown", "no-terminal", "paused", "off", "use-password" or
 * "password:<username>", never why a card was refused. Nothing here reads the terminal cookie: the provider reads it from the request itself.
 */
export async function quickLogin(kind: "NFC" | "QR", value: string): Promise<QuickLoginResult> {
  if ((kind !== "NFC" && kind !== "QR") || typeof value !== "string" || value.length === 0 || value.length > 300) return { ok: false, code: "unknown" };
  try {
    await signIn("quick", { kind, value, redirect: false });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      const code = (error as AuthError & { code?: unknown }).code;
      return { ok: false, code: typeof code === "string" && code.startsWith("quick:") ? code.slice("quick:".length) : "unknown" };
    }
    throw error;
  }
}
