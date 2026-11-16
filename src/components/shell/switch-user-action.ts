"use server";

import { signOut } from "@/auth";

/** Ends this session and opens the sign-in screen, where the next person taps their card, scans their QR or types a password. */
export async function switchUser() {
  await signOut({ redirectTo: "/login" });
}
