/**
 * The one guard every database-touching test goes through.
 *
 * A test that can write must never be able to run against production by
 * accident (a stray `DATABASE_URL` in the shell, an editor that loads `.env`).
 * So this is an ALLOW-list, not a block-list: anything not named here is
 * refused, production included, without this file ever having to name it.
 *
 *  - Local Postgres is always allowed.
 *  - Anything else (a disposable Neon branch, the demo database) must be named
 *    in `XENON_TEST_DB_ALLOWED_HOSTS` — a comma-separated list of Neon endpoint
 *    ids or exact hostnames, set in the shell for that run. It is deliberately
 *    not hard-coded: the repo is public and a database host has no business in it.
 *
 * Nothing here ever prints a password or a full connection string — only the host.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type DatabaseVerdict =
  | { ok: true; host: string }
  | { ok: false; host: string | null; reason: string };

function allowedFromEnv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Hostname only, or null when the string is not a usable connection URL. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // WHATWG URL wraps an IPv6 literal in [] — strip it so "::1" compares equal.
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

/**
 * A Neon endpoint id matches its direct host and its `-pooler` host, and only
 * under `.neon.tech` — so `ep-x.evil.example` can never ride on a listed id.
 */
function matchesAllowed(host: string, entry: string): boolean {
  if (host === entry) return true;
  if (!host.endsWith(".neon.tech")) return false;
  return host.startsWith(`${entry}.`) || host.startsWith(`${entry}-pooler.`);
}

export function checkDatabaseUrl(
  url: string | undefined,
  allowedEnv: string | undefined = process.env.XENON_TEST_DB_ALLOWED_HOSTS,
): DatabaseVerdict {
  const host = hostOf(url);
  if (!host) return { ok: false, host: null, reason: "DATABASE_URL is missing or not a valid URL." };
  if (LOCAL_HOSTS.has(host)) return { ok: true, host };
  if (allowedFromEnv(allowedEnv).some((entry) => matchesAllowed(host, entry))) {
    return { ok: true, host };
  }
  return {
    ok: false,
    host,
    reason:
      "Not on the test allow-list (local Postgres, or a host named in XENON_TEST_DB_ALLOWED_HOSTS).",
  };
}

/**
 * Call first in any test that touches a database. Prints the host it will use
 * and throws — before anything connects — if the host is not allowed.
 */
export function requireSafeTestDatabase(
  url: string | undefined = process.env.DATABASE_URL,
  allowedEnv?: string,
): string {
  const verdict = checkDatabaseUrl(url, allowedEnv);
  if (!verdict.ok) {
    throw new Error(
      `REFUSING to run a database test: host "${verdict.host ?? "(none)"}". ${verdict.reason}`,
    );
  }
  console.log(`[test-db] using host: ${verdict.host}`);
  return verdict.host;
}
