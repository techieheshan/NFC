import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { ADMISSION_NOTE, includedMonthsNote, ofWhichLines, smartCardLabel } from "@/app/(app)/daily-summary/extra-lines";

/*
 * Daily Summary R1 (this replaces the job-5 "Half months (N): amount, included in Class fees / -" wording).
 * The two optional lines under Class fees are INDENTED "of which" lines, from ONE helper used by the day screen,
 * the range screen and the A4 document. With neither a Half nor a No-charge month the helper returns NOTHING, so a
 * day without them shows no extra line anywhere.
 *
 * A Half month's amount is already inside Class fees: it is an "of which", never a figure to add. A No-charge
 * month is 0.00 and says nothing was charged. The data object (halfMonths / noChargeMonths, omitted when none) is
 * untouched — reports-golden.test.ts pins it.
 */

test("no Half month and no No-charge month: no lines and no footnote", () => {
  assert.deepEqual(ofWhichLines({}), []);
  assert.deepEqual(ofWhichLines({ halfMonths: undefined, noChargeMonths: undefined }), []);
  assert.equal(includedMonthsNote({}), null);
});

test("a Half month: 'of which Half months (N)' with the amount formatted, count kept", () => {
  assert.deepEqual(ofWhichLines({ halfMonths: { count: 3, total: "2187.50" } }), [
    { key: "half", count: 3, label: "of which Half months (3)", total: "2,187.50" },
  ]);
  assert.deepEqual(ofWhichLines({ halfMonths: { count: 1, total: "1250000.00" } })[0].total, "1,250,000.00");
});

test("a No-charge month: 'No-charge months (N): nothing charged', 0.00", () => {
  assert.deepEqual(ofWhichLines({ noChargeMonths: { count: 2 } }), [
    { key: "noCharge", count: 2, label: "No-charge months (2): nothing charged", total: "0.00" },
  ]);
});

test("both: Half first, No-charge next to it", () => {
  const lines = ofWhichLines({ halfMonths: { count: 1, total: "1250.00" }, noChargeMonths: { count: 4 } });
  assert.deepEqual(lines.map((l) => l.key), ["half", "noCharge"]);
  assert.deepEqual(lines.map((l) => l.total), ["1,250.00", "0.00"]);
});

test("the document's footnote says both are INCLUDED in the amounts", () => {
  assert.equal(
    includedMonthsNote({ halfMonths: { count: 2, total: "2750.00" }, noChargeMonths: { count: 2 } }),
    "Half months (2: 2,750.00) and No-charge months (2: 0.00) are included in the amounts.",
  );
  assert.equal(includedMonthsNote({ noChargeMonths: { count: 1 } }), "No-charge months (1: 0.00) are included in the amounts.");
  assert.equal(includedMonthsNote({ halfMonths: { count: 1, total: "10.00" } }), "Half months (1: 10.00) are included in the amounts.");
});

test("ONE source: the day screen, the range screen and the document all take these lines from the helper", () => {
  const root = path.join(process.cwd(), "src", "app", "(app)", "daily-summary");
  const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");
  assert.ok(read("day-screen.tsx").includes("ofWhichLines(report)"));
  assert.ok(read("range", "page.tsx").includes("ofWhichLines(r)"));
  const model = read("document", "model.ts");
  assert.ok(model.includes("ofWhichLines(report)") && model.includes("includedMonthsNote(report)"));
  for (const f of [read("day-screen.tsx"), read("range", "page.tsx"), model, read("document", "blocks.tsx")]) {
    assert.ok(!/halfMonths\??\.total|noChargeMonths\??\.count/.test(f), "no screen reads the Half amount itself");
    assert.ok(!f.includes("included in Class fees"), "the old wording is gone");
  }
});

test("the Smart card line reads 'Smart card replacement (N)' and Admission carries the note 'Admission includes the first smart card'", () => {
  assert.equal(smartCardLabel(0), "Smart card replacement (0)");
  assert.equal(smartCardLabel(3), "Smart card replacement (3)");
  assert.equal(ADMISSION_NOTE, "Admission includes the first smart card");
});

test("ONE source for that wording: the day screen, the range screen and the document use the helpers, and no old 'Smart card (N)' label is left", () => {
  const root = path.join(process.cwd(), "src", "app", "(app)", "daily-summary");
  const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");
  for (const f of [read("day-screen.tsx"), read("range", "page.tsx"), read("document", "blocks.tsx")]) {
    assert.ok(f.includes("smartCardLabel(") && f.includes("ADMISSION_NOTE"), "uses the helpers");
    assert.ok(!/`Smart card \(\$\{/.test(f), "no hand-written 'Smart card (N)' label");
  }
  assert.ok(!read("day-screen.tsx").includes('label="Admission and smart card"'), "the old row title is gone");
});
