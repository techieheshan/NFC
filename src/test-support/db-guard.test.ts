import test from "node:test";
import assert from "node:assert/strict";

import { checkDatabaseUrl, hostOf, requireSafeTestDatabase } from "@/test-support/db-guard";

// A production-LOOKING Neon host that is not any real one.
const FAKE_PROD = "postgresql://app:hunter2-secret@ep-fake-prod-00000000-pooler.us-east-2.aws.neon.tech/db";
const ALLOWED = "ep-fake-demo-11111111";

test("an unset, empty or garbage DATABASE_URL is refused", () => {
  for (const url of [undefined, "", "not a url", "postgres//nope"]) {
    const verdict = checkDatabaseUrl(url, ALLOWED);
    assert.equal(verdict.ok, false, String(url));
  }
});

test("a production-looking Neon host is refused unless it was named", () => {
  const verdict = checkDatabaseUrl(FAKE_PROD, ALLOWED);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.host, "ep-fake-prod-00000000-pooler.us-east-2.aws.neon.tech");
});

test("with no allow-list at all, every remote host is refused", () => {
  assert.equal(checkDatabaseUrl(FAKE_PROD, "").ok, false);
  assert.equal(checkDatabaseUrl(FAKE_PROD, undefined).ok, false);
});

test("local Postgres is always allowed", () => {
  for (const url of [
    "postgresql://u:p@localhost:5432/t",
    "postgresql://u:p@127.0.0.1:5432/t",
    "postgresql://u:p@[::1]:5432/t",
  ]) {
    assert.equal(checkDatabaseUrl(url, "").ok, true, url);
  }
});

test("a named Neon endpoint is allowed on its direct AND pooler host", () => {
  assert.equal(checkDatabaseUrl(`postgresql://u:p@${ALLOWED}.c-1.us-east-1.aws.neon.tech/db`, ALLOWED).ok, true);
  assert.equal(
    checkDatabaseUrl(`postgresql://u:p@${ALLOWED}-pooler.c-1.us-east-1.aws.neon.tech/db`, ALLOWED).ok,
    true,
  );
});

test("a lookalike cannot ride on an allowed endpoint id", () => {
  for (const host of [
    `${ALLOWED}.evil.example`, // wrong suffix
    `${ALLOWED}x.c-1.us-east-1.aws.neon.tech`, // longer id that merely starts the same
    `x${ALLOWED}.c-1.us-east-1.aws.neon.tech`,
  ]) {
    assert.equal(checkDatabaseUrl(`postgresql://u:p@${host}/db`, ALLOWED).ok, false, host);
  }
});

test("hostOf returns the host only — never the credentials", () => {
  assert.equal(hostOf("postgresql://user:pw123@db.example.com:5432/x?sslmode=require"), "db.example.com");
});

test("the refusal names the host but never leaks the password or the URL", () => {
  assert.throws(
    () => requireSafeTestDatabase(FAKE_PROD, ALLOWED),
    (err: Error) => {
      assert.match(err.message, /REFUSING to run a database test/);
      assert.match(err.message, /ep-fake-prod-00000000-pooler/);
      assert.doesNotMatch(err.message, /hunter2-secret/);
      assert.doesNotMatch(err.message, /postgresql:\/\//);
      return true;
    },
  );
});

test("an allowed host passes and is printed", () => {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    assert.equal(requireSafeTestDatabase("postgresql://u:p@localhost:5432/t", ""), "localhost");
  } finally {
    console.log = log;
  }
  assert.deepEqual(lines, ["[test-db] using host: localhost"]);
});
