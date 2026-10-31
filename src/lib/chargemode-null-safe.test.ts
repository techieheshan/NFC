import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * AGENTS.md (job 3A): `Payment.chargeMode` is NULL for a full-fee row — everything written before the
 * column existed and by any old client — so it must NEVER be filtered with `{ not: … }` (SQL `<>`
 * drops NULL) or compared "is not FULL" in a way that drops NULL. The only safe shapes are a positive
 * `in: [...]` / equals, or a JavaScript comparison with `!== "NO_CHARGE"` / `=== "HALF"`, which keep NULL.
 * This scans every source file (tests excluded) so the rule cannot be broken in one place by accident.
 */

const SRC = path.join(process.cwd(), "src");
const files = (readdirSync(SRC, { recursive: true, encoding: "utf8" }) as string[])
  .map(String)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("test-support"))
  .map((f) => path.join(SRC, f));
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const SQL_NOT = /chargeMode\s*:\s*\{\s*not\b/;
const NOT_FULL = /chargeMode\s*(?:!==?|<>)\s*["']FULL["']/;
const NOT_NULL_ONLY = /chargeMode\s*:\s*\{\s*(?:notIn|not)\b/;

test("the scan sees the source it is meant to scan", () => {
  assert.ok(files.length > 100, `only ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith(path.join("lib", "reports.ts"))));
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

test("the patterns catch what they are for (control)", () => {
  for (const bad of ["chargeMode: { not: 'NO_CHARGE' }", "chargeMode:{not:\"HALF\"}", "chargeMode: { notIn: ['HALF'] }"]) assert.match(bad, NOT_NULL_ONLY, bad);
  assert.match("p.chargeMode !== 'FULL'", NOT_FULL);
  for (const fine of ["p.chargeMode !== \"NO_CHARGE\"", "p.chargeMode === \"HALF\"", "chargeMode: { in: [\"HALF\", \"NO_CHARGE\"] }", "chargeMode: null"]) {
    assert.doesNotMatch(fine, SQL_NOT, fine);
    assert.doesNotMatch(fine, NOT_FULL, fine);
    assert.doesNotMatch(fine, NOT_NULL_ONLY, fine);
  }
});
