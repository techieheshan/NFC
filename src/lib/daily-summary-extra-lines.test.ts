import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { test } from "node:test";
import assert from "node:assert/strict";

import { halfAndNoChargeLines } from "@/app/(app)/daily-summary/extra-lines";

/*
 * Job 5: the two optional "Other income" lines are shared by the Daily Summary screen and its PDF.
 * With neither a Half nor a No-charge month the helper returns NOTHING — which is exactly what
 * keeps the screen and the PDF for today's data as they were (nothing is spread into the PDF's
 * Other-income table, no row is rendered).
 */

test("no Half month and no No-charge month: no lines at all", () => {
  assert.deepEqual(halfAndNoChargeLines({}), []);
  assert.deepEqual(halfAndNoChargeLines({ halfMonths: undefined, noChargeMonths: undefined }), []);
});

test("a Half month: one line, with the month count and the amount", () => {
  assert.deepEqual(halfAndNoChargeLines({ halfMonths: { count: 3, total: "2187.50" } }), [{ label: "Half months", count: 3, total: "2187.50" }]);
});

test("a No-charge month: one line, its amount is always 0.00", () => {
  assert.deepEqual(halfAndNoChargeLines({ noChargeMonths: { count: 2 } }), [{ label: "No charge months", count: 2, total: "0.00" }]);
});

test("both: Half first, No charge next to it", () => {
  assert.deepEqual(halfAndNoChargeLines({ halfMonths: { count: 1, total: "1250.00" }, noChargeMonths: { count: 4 } }).map((l) => l.label), ["Half months", "No charge months"]);
});
