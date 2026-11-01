import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_RANGE_DAYS, daysBetween, dayLabelLong, dayLabelShort, documentNumber, parseRealDate, resolveDay, resolveRange, shiftDay,
} from "@/lib/daily-summary-dates";

const TODAY = "2026-11-01";

test("parseRealDate accepts real calendar days from 2000 to 2100 only", () => {
  for (const ok of ["2026-10-14", "2000-01-01", "2100-12-31", "2024-02-29", "2026-02-28"]) assert.equal(parseRealDate(ok), ok);
  for (const bad of [
    "2026-13-45", "2026-00-10", "2026-10-00", "2026-02-29", "2023-02-29", "2026-04-31", "1999-12-31", "2101-01-01",
    "0001-01-01", "9999-12-31", "2026-1-5", "26-10-14", "2026/10/14", " 2026-10-14", "2026-10-14T00:00", "banana", "", "NaN-aN-aN",
  ]) assert.equal(parseRealDate(bad), null, bad);
});

test("parseRealDate never throws on hostile values (arrays, numbers, objects, huge strings)", () => {
  for (const v of [undefined, null, 0, 20261014, [], ["2026-10-14"], {}, "9".repeat(10_000), "2026-10-14\n", "%00", "２０２６-10-14"]) {
    assert.doesNotThrow(() => parseRealDate(v));
    assert.equal(parseRealDate(v), null);
  }
});

test("resolveDay: invalid falls back to today, and the future is clamped to today", () => {
  assert.equal(resolveDay("2026-10-14", TODAY), "2026-10-14");
  assert.equal(resolveDay("2026-13-45", TODAY), TODAY);
  assert.equal(resolveDay("0001-01-01", TODAY), TODAY);
  assert.equal(resolveDay(undefined, TODAY), TODAY);
  assert.equal(resolveDay("2026-11-02", TODAY), TODAY);
  assert.equal(resolveDay("2100-01-01", TODAY), TODAY);
});

test("resolveRange: swapped when reversed, today for junk, bounded to 366 days", () => {
  assert.deepEqual(resolveRange("2026-10-14", "2026-10-12", TODAY), { from: "2026-10-12", to: "2026-10-14", clamped: false });
  assert.deepEqual(resolveRange("banana", "2026-10-12", TODAY), { from: "2026-10-12", to: TODAY, clamped: false });
  assert.deepEqual(resolveRange("0001-01-01", "9999-12-31", TODAY), { from: TODAY, to: TODAY, clamped: false });
  const wide = resolveRange("2000-01-01", "2100-12-31", TODAY);
  assert.equal(wide.clamped, true);
  assert.equal(daysBetween(wide.from, wide.to) + 1, MAX_RANGE_DAYS);
  assert.equal(wide.from, "2000-01-01");
  const year = resolveRange("2026-01-01", "2026-12-31", TODAY);
  assert.equal(year.clamped, false); // 365 days fits
});

test("shiftDay and daysBetween cross month, year and leap days", () => {
  assert.equal(shiftDay("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDay("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDay("2024-02-28", 1), "2024-02-29");
  assert.equal(shiftDay("2026-02-28", 1), "2026-03-01");
  assert.equal(daysBetween("2026-10-12", "2026-10-14"), 2);
  assert.equal(daysBetween("2026-10-14", "2026-10-14"), 0);
});

test("labels and document numbers", () => {
  assert.equal(dayLabelShort("2026-10-14"), "Wed 14 Oct 2026");
  assert.equal(dayLabelLong("2026-10-14"), "Wednesday, 14 October 2026");
  assert.equal(dayLabelShort("2026-11-01"), "Sun 1 Nov 2026");
  assert.equal(documentNumber("2026-10-14", "2026-10-14"), "DS-20261014");
  assert.equal(documentNumber("2026-10-12", "2026-10-14"), "DS-20261012-20261014");
});
