import { test } from "node:test";
import assert from "node:assert/strict";

import type { BankLine } from "@/lib/cash-flow";
import { decimalToCents, formatCents } from "@/lib/cents";
import { money } from "@/lib/daily-summary-rows";

import { matchBankLines, type StoredBankLine } from "./bank-lines";
import { classifyEdit, decideCheck } from "./check-rule";
import { centsToDecimalString, columnToCents } from "./money";

const line = (cents: number, time = "09:00", slip = "", note = ""): BankLine => ({ cents, time, slip, note });
const T0 = new Date("2026-11-02T04:00:00Z");
const T1 = new Date("2026-11-02T10:00:00Z");
const stored = (l: BankLine, by: string): StoredBankLine => ({ ...l, recordedById: by, recordedAt: T0 });

// ---- centsToDecimalString ----
test("centsToDecimalString: integer math, two decimals, no minus on zero, same shape as the data object's own text", () => {
  assert.equal(centsToDecimalString(125050), "1250.50");
  assert.equal(centsToDecimalString(5), "0.05");
  assert.equal(centsToDecimalString(0), "0.00");
  assert.equal(centsToDecimalString(-845000), "-8450.00");
  assert.equal(centsToDecimalString(-1), "-0.01");
  assert.equal(centsToDecimalString(9_999_999_999), "99999999.99");
  for (const c of [0, 1, 99, 100, 101, 12345, -12345, 9_999_999_999, -9_999_999_999, 1_234_567_890_123]) {
    assert.equal(centsToDecimalString(c), money(c), `parity with daily-summary-rows money() for ${c}`);
    assert.equal(decimalToCents(centsToDecimalString(c)), c, `round trip for ${c}`);
  }
});

test("centsToDecimalString refuses a number that is not a safe integer (no float ever reaches a money column)", () => {
  for (const bad of [1.5, NaN, Infinity, 2 ** 53, 0.1 + 0.2]) assert.throws(() => centsToDecimalString(bad), RangeError);
});

test("columnToCents reads a Decimal's exact two-decimal text", () => {
  assert.equal(columnToCents({ toFixed: (d: number) => (12.5).toFixed(d) }), 1250);
  assert.equal(columnToCents("99999999.99"), 9_999_999_999);
  assert.equal(columnToCents("-0.00"), 0);
  assert.equal(formatCents(columnToCents("76375.00")), "76,375.00");
});

// ---- matchBankLines ----
test("matchBankLines: an identical line is the same deposit and keeps who recorded it and when", () => {
  const prev = [stored(line(5000_00, "09:15", "S1", "Peoples"), "ann")];
  const m = matchBankLines(prev, [line(5000_00, "09:15", "S1", "Peoples")], "bob", T1);
  assert.deepEqual(m.lines.map((l) => [l.recordedById, l.recordedAt]), [["ann", T0]]);
  assert.deepEqual([m.added, m.removed, m.edited], [[], [], []]);
});

test("matchBankLines: a new line is recorded by this version's Done by, now", () => {
  const prev = [stored(line(5000_00), "ann")];
  const m = matchBankLines(prev, [line(5000_00), line(1500_00, "10:30")], "bob", T1);
  assert.deepEqual(m.lines.map((l) => [l.recordedById, l.recordedAt]), [["ann", T0], ["bob", T1]]);
  assert.equal(m.added.length, 1);
  assert.equal(m.added[0].cents, 1500_00);
});

test("matchBankLines: same amount with another time, slip or note is an EDITED line and keeps its original recorder", () => {
  const prev = [stored(line(5000_00, "09:15", "S1"), "ann")];
  const m = matchBankLines(prev, [line(5000_00, "09:45", "S2")], "bob", T1);
  assert.deepEqual(m.lines.map((l) => [l.recordedById, l.recordedAt]), [["ann", T0]]);
  assert.equal(m.edited.length, 1);
  assert.deepEqual([m.added.length, m.removed.length], [0, 0]);
});

test("matchBankLines: a changed amount is a removed line plus an added one (recorded by this version's Done by)", () => {
  const prev = [stored(line(5000_00), "ann")];
  const m = matchBankLines(prev, [line(6000_00)], "bob", T1);
  assert.deepEqual(m.lines.map((l) => l.recordedById), ["bob"]);
  assert.deepEqual([m.added.length, m.removed.length, m.edited.length], [1, 1, 0]);
});

test("matchBankLines: a line removed, another kept; two equal amounts are not matched twice", () => {
  const prev = [stored(line(100_00, "09:00"), "ann"), stored(line(100_00, "11:00"), "cy")];
  const m = matchBankLines(prev, [line(100_00, "11:00")], "bob", T1);
  assert.deepEqual(m.lines.map((l) => l.recordedById), ["cy"], "the identical one wins over the same-amount one");
  assert.deepEqual(m.removed.map((l) => l.time), ["09:00"]);
});

// ---- classifyEdit ----
const shape = (bf: number, ...bank: BankLine[]) => ({ bringForwardCents: bf, bank });

test("classifyEdit: nothing changed", () => {
  const a = shape(100_00, line(5000_00, "09:15", "S1", "n"));
  assert.deepEqual(classifyEdit(a, shape(100_00, line(5000_00, "09:15", "S1", "n"))), { nothingChanged: true, moneyChanged: false });
});

test("classifyEdit: bring-forward, a bank amount or the number of lines is a MONEY change", () => {
  const base = shape(100_00, line(5000_00));
  assert.equal(classifyEdit(base, shape(200_00, line(5000_00))).moneyChanged, true);
  assert.equal(classifyEdit(base, shape(100_00, line(5001_00))).moneyChanged, true);
  assert.equal(classifyEdit(base, shape(100_00, line(5000_00), line(1_00))).moneyChanged, true);
  assert.equal(classifyEdit(base, shape(100_00)).moneyChanged, true);
  assert.equal(classifyEdit(base, shape(100_00, line(5000_00), line(1_00))).nothingChanged, false);
});

test("classifyEdit: only slip, note, time or order changed is a change but NOT a money change", () => {
  const base = shape(0, line(10_00, "09:00", "A", "x"), line(20_00, "10:00"));
  for (const next of [
    shape(0, line(10_00, "09:00", "B", "x"), line(20_00, "10:00")),
    shape(0, line(10_00, "09:00", "A", "y"), line(20_00, "10:00")),
    shape(0, line(10_00, "09:30", "A", "x"), line(20_00, "10:00")),
    shape(0, line(20_00, "10:00"), line(10_00, "09:00", "A", "x")),
  ]) {
    assert.deepEqual(classifyEdit(base, next), { nothingChanged: false, moneyChanged: false });
  }
});

// ---- decideCheck ----
test("decideCheck: SAVE has no check to carry or clear", () => {
  assert.deepEqual(decideCheck({ kind: "SAVE", hadCheck: false }), { carryCheck: false, checkCleared: false });
});

test("decideCheck: EDIT with nothing changed is refused", () => {
  assert.deepEqual(decideCheck({ kind: "EDIT", hadCheck: true, edit: { nothingChanged: true, moneyChanged: false } }), { refuse: "nothing-changed" });
});

test("decideCheck: EDIT money change clears a check (and clears nothing when there was none)", () => {
  assert.deepEqual(decideCheck({ kind: "EDIT", hadCheck: true, edit: { nothingChanged: false, moneyChanged: true } }), { carryCheck: false, checkCleared: true });
  assert.deepEqual(decideCheck({ kind: "EDIT", hadCheck: false, edit: { nothingChanged: false, moneyChanged: true } }), { carryCheck: false, checkCleared: false });
});

test("decideCheck: EDIT of only slip / note / time keeps the check (carried), and carries nothing when there was none", () => {
  assert.deepEqual(decideCheck({ kind: "EDIT", hadCheck: true, edit: { nothingChanged: false, moneyChanged: false } }), { carryCheck: true, checkCleared: false });
  assert.deepEqual(decideCheck({ kind: "EDIT", hadCheck: false, edit: { nothingChanged: false, moneyChanged: false } }), { carryCheck: false, checkCleared: false });
});

test("decideCheck: RESAVE_LIVE with new live numbers clears the check; with identical numbers it is refused", () => {
  assert.deepEqual(decideCheck({ kind: "RESAVE_LIVE", hadCheck: true, liveDiffers: true }), { carryCheck: false, checkCleared: true });
  assert.deepEqual(decideCheck({ kind: "RESAVE_LIVE", hadCheck: true, liveDiffers: false }), { refuse: "nothing-changed" });
});

test("decideCheck: an EDIT without its classification is a programming error, not a silent default", () => {
  assert.throws(() => decideCheck({ kind: "EDIT", hadCheck: false }), /classification/);
});
