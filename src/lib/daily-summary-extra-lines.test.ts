import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { test } from "node:test";
import assert from "node:assert/strict";

import { halfAndNoChargeLines } from "@/app/(app)/daily-summary/extra-lines";

/*
 * Job 5: the two optional "Other income" lines are shared by the Daily Summary screen and its PDF.
 * With neither a Half nor a No-charge month the helper returns NOTHING — which is exactly what keeps the
 * screen and the PDF for today's data as they were (nothing is spread into the PDF's Other-income table,
 * no row is rendered).
 *
 * Review F3: the Half row's amount is already inside Class fees, so it sits in the LABEL and the Total cell
 * is "-" — nobody adding the Total column up counts it twice. The No-charge row is 0.00 and is unchanged.
 */

test("no Half month and no No-charge month: no lines at all", () => {
  assert.deepEqual(halfAndNoChargeLines({}), []);
  assert.deepEqual(halfAndNoChargeLines({ halfMonths: undefined, noChargeMonths: undefined }), []);
});

test("a Half month: the amount is in the label, 'included in Class fees', and the Total cell is '-'", () => {
  assert.deepEqual(halfAndNoChargeLines({ halfMonths: { count: 3, total: "2187.50" } }), [
    {
      label: "Half months (3): 2187.50, included in Class fees",
      screenLabel: "Half months (3): 2187.50, included in Class fees",
      count: 3,
      total: "-",
    },
  ]);
});

test("the Half row never puts a money figure in the Total cell (so it cannot be added to Class fees twice)", () => {
  for (const total of ["0.01", "1250.00", "99999.99"]) {
    const [line] = halfAndNoChargeLines({ halfMonths: { count: 1, total } });
    assert.equal(line.total, "-");
    assert.ok(line.label.includes(total));
  }
});

test("a No-charge month is unchanged: PDF label without the count (its own column), screen label with it, total 0.00", () => {
  assert.deepEqual(halfAndNoChargeLines({ noChargeMonths: { count: 2 } }), [
    { label: "No charge months", screenLabel: "No charge months (2)", count: 2, total: "0.00" },
  ]);
});

test("both: Half first, No charge next to it", () => {
  assert.deepEqual(halfAndNoChargeLines({ halfMonths: { count: 1, total: "1250.00" }, noChargeMonths: { count: 4 } }).map((l) => l.total), ["-", "0.00"]);
});

test("the screen and the PDF both take the label AND the total from the helper (nothing re-derives a figure there)", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const src = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "summary-screen.tsx"), "utf8");
  assert.ok(src.includes("...halfAndNoChargeLines(report).map((l) => [l.label, l.count, l.total]),"), "PDF row");
  assert.ok(src.includes("<Line key={l.label} label={l.screenLabel} value={l.total} muted />"), "screen row");
  assert.ok(!/report\.halfMonths\.total/.test(src), "the screen does not read the Half amount into a Total cell itself");
});
