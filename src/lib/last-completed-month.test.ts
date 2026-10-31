import "@/test-support/no-database";
import "@/test-support/server-stubs";

import test from "node:test";
import assert from "node:assert/strict";

import { lastCompletedMonth as forCombos } from "@/lib/combos";
import { lastCompletedMonth as forPayslips } from "@/lib/payslips";

// Two copies of this rule exist today (combos.ts and payslips.ts). Both are locked
// with the same cases so a change to one cannot drift from the other unnoticed.
// Colombo is UTC+5:30, so the months turn at 18:30 UTC on the last day.

const cases: { name: string; at: string; year: number; month: number }[] = [
  { name: "mid-August is judged on July", at: "2026-08-15T06:00:00Z", year: 2026, month: 7 },
  { name: "January wraps back to December of the year before", at: "2026-01-10T06:00:00Z", year: 2025, month: 12 },
  { name: "1 Aug 00:30 in Colombo is still 31 Jul in UTC, but it is already August", at: "2026-07-31T19:00:00Z", year: 2026, month: 7 },
  { name: "the last Colombo minute of August is still August", at: "2026-08-31T18:29:59Z", year: 2026, month: 7 },
  { name: "the first Colombo minute of September is September", at: "2026-08-31T18:30:00Z", year: 2026, month: 8 },
  { name: "1 Jan 00:00 in Colombo (31 Dec 18:30 UTC) is already January", at: "2026-12-31T18:30:00Z", year: 2026, month: 12 },
];

for (const impl of [
  { name: "combos", fn: forCombos },
  { name: "payslips", fn: forPayslips },
]) {
  for (const c of cases) {
    test(`lastCompletedMonth [${impl.name}]: ${c.name}`, () => {
      const got = impl.fn(new Date(c.at));
      assert.equal(got.year, c.year);
      assert.equal(got.month, c.month);
    });
  }
}

test("the combos copy also carries the label the pop-up shows", () => {
  assert.equal(forCombos(new Date("2026-08-15T06:00:00Z")).label, "Jul 2026");
  assert.equal(forCombos(new Date("2026-01-10T06:00:00Z")).label, "Dec 2025");
});
