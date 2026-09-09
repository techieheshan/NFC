import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Is the app actually reachable, and can it see its database?
 *
 * Only the splash calls this, and only when it is still on screen after the
 * app has had its chance to start — so on a normal fast start this endpoint is
 * never hit at all. It answers "loading" vs "broken", nothing more: no session,
 * no counts, no names, so it is safe to serve unauthenticated.
 *
 * The database probe is time-boxed. A hanging connection is the exact failure
 * this is meant to REPORT, so it must never become a hanging response.
 */
export const dynamic = "force-dynamic";

/**
 * Generous enough for a cold Neon connection (~2s on the first request after a
 * deploy), tight enough that this can never become the hang it reports. A
 * shorter budget was tried and cried wolf on every first start.
 */
const DB_TIMEOUT_MS = 3000;

export async function GET() {
  let database = false;
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS)),
    ]);
    database = true;
  } catch {
    database = false;
  }

  return NextResponse.json(
    { ok: true, database },
    { headers: { "cache-control": "no-store" } },
  );
}
