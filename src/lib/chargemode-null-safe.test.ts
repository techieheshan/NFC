import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * AGENTS.md (job 3A): `Payment.chargeMode` is NULL for a full-fee row — everything written before the
 * column existed and by any old client — so it must NEVER be filtered with `{ not: … }` (SQL `<>`
 * drops NULL) or compared "is not FULL" in a way that drops NULL. The only safe shapes are a positive
 * `in: [...]` / equals, or a JavaScript comparison with `!== "NO_CHARGE"` / `=== "HALF"`, which keep NULL.
 * This scans every source file — including src/test-support, where helpers and scenarios live — so the rule
 * cannot be broken in one place by accident. (`*.test.ts` files are excluded: they hold the control strings, and
 * their own raw SQL, such as `"chargeMode" IS NOT NULL`, is NULL-aware.)
 *
 * Shapes caught (each is mutation-checked against the real code):
 *   - Prisma `chargeMode: { not … }` / `notIn`
 *   - Prisma `NOT: { chargeMode … }` and `NOT: [{ chargeMode … }]` (they become `NOT (col = x)`, which also drops NULL)
 *   - JavaScript "is not FULL" (`!== "FULL"`), because a full-fee row is NULL, never the string FULL
 *   - raw SQL `"chargeMode" <> …`, `"chargeMode" != …`, `"chargeMode" NOT IN (…)` / `NOT LIKE`
 */

const SRC = path.join(process.cwd(), "src");
const files = (readdirSync(SRC, { recursive: true, encoding: "utf8" }) as string[])
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => path.join(SRC, f));
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const SQL_NOT = /chargeMode\s*:\s*\{\s*not\b/;
const NOT_FULL = /chargeMode\s*(?:!==?|<>)\s*["']FULL["']/;
const NOT_NULL_ONLY = /chargeMode\s*:\s*\{\s*(?:notIn|not)\b/;
/** `NOT: { chargeMode … }`, `NOT: [{ chargeMode … }]`, `NOT: { OR: [{ chargeMode … }] }` — within one statement. */
const PRISMA_NOT = /\bNOT\s*:\s*[\[{][^;]{0,300}?chargeMode/;
/** Raw SQL that is not NULL-aware. (`IS NOT NULL`, `IS NULL` and `IS DISTINCT FROM` are fine and are not matched.) */
const RAW_SQL_NOT = /"chargeMode"\s*(?:<>|!=)|\bchargeMode\s*<>|"chargeMode"\s+NOT\s+(?:IN|LIKE)\b/i;

test("the scan sees the source it is meant to scan — including src/test-support", () => {
  assert.ok(files.length > 100, `only ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith(path.join("lib", "reports.ts"))));
  assert.ok(files.some((f) => f.endsWith(path.join("test-support", "report-scenarios.ts"))), "test-support is scanned");
  assert.ok(files.some((f) => f.endsWith(path.join("test-support", "test-db.ts"))));
});

test("no source file filters chargeMode with { not: … } or notIn (SQL would drop the NULL rows)", () => {
  for (const f of files) {
    const code = strip(readFileSync(f, "utf8"));
    assert.doesNotMatch(code, SQL_NOT, path.relative(SRC, f));
    assert.doesNotMatch(code, NOT_NULL_ONLY, path.relative(SRC, f));
  }
});

test("no source file treats 'not FULL' as a test: a full-fee row has chargeMode NULL, never the string FULL", () => {
  for (const f of files) assert.doesNotMatch(strip(readFileSync(f, "utf8")), NOT_FULL, path.relative(SRC, f));
});

test("no source file uses Prisma NOT: { chargeMode … } (it becomes NOT (col = x) and drops the NULL rows too)", () => {
  for (const f of files) assert.doesNotMatch(strip(readFileSync(f, "utf8")), PRISMA_NOT, path.relative(SRC, f));
});

test("no source file uses raw SQL that is not NULL-aware: chargeMode <> / != / NOT IN / NOT LIKE", () => {
  for (const f of files) assert.doesNotMatch(strip(readFileSync(f, "utf8")), RAW_SQL_NOT, path.relative(SRC, f));
});

test("the NOT and raw-SQL patterns catch what they are for, and leave the NULL-aware forms alone (control)", () => {
  for (const bad of [
    "where: { NOT: { chargeMode: 'NO_CHARGE' } }",
    "NOT:{chargeMode:\"HALF\"}",
    "NOT: [{ chargeMode: 'HALF' }, { courseId: 1 }]",
    "NOT: { OR: [{ chargeMode: 'HALF' }] }",
  ]) assert.match(bad, PRISMA_NOT, bad);
  for (const bad of ['WHERE "chargeMode" <> \'NO_CHARGE\'', 'AND "chargeMode" != \'HALF\'', 'WHERE chargeMode <> \'HALF\'', 'AND "chargeMode" NOT IN (\'HALF\')', 'AND "chargeMode" not like \'H%\'']) {
    assert.match(bad, RAW_SQL_NOT, bad);
  }
  for (const fine of [
    'WHERE "chargeMode" IS NOT NULL', 'WHERE "chargeMode" IS NULL', 'WHERE "chargeMode" IS DISTINCT FROM \'HALF\'', 'WHERE "chargeMode" = \'HALF\'',
    "NOT: { courseId: null }", "where: { chargeMode: { in: ['HALF'] } }", "{ NOT: { cancelled: true } }; const chargeMode = 1",
    'p.chargeMode !== "NO_CHARGE"', 'p.chargeMode != "HALF"', 'row.chargeMode !== null',
  ]) {
    assert.doesNotMatch(fine, PRISMA_NOT, fine);
    assert.doesNotMatch(fine, RAW_SQL_NOT, fine);
  }
});

test("the patterns catch what they are for (control)", () => {
  for (const bad of ["chargeMode: { not: 'NO_CHARGE' }", "chargeMode:{not:\"HALF\"}", "chargeMode: { notIn: ['HALF'] }"]) assert.match(bad, NOT_NULL_ONLY, bad);
  assert.match("p.chargeMode !== 'FULL'", NOT_FULL);
  for (const fine of ["p.chargeMode !== \"NO_CHARGE\"", "p.chargeMode === \"HALF\"", "chargeMode: { in: [\"HALF\", \"NO_CHARGE\"] }", "chargeMode: null"]) {
    assert.doesNotMatch(fine, SQL_NOT, fine);
    assert.doesNotMatch(fine, NOT_FULL, fine);
    assert.doesNotMatch(fine, NOT_NULL_ONLY, fine);
  }
});
