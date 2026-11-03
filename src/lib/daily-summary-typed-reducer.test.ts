import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_BANK_LINES, type BankLine } from "@/lib/cash-flow";
import { noticeKeys } from "@/app/(app)/daily-summary/notices";
import { initialTypedState, typedReducer, type TypedAction, type TypedUiState } from "@/app/(app)/daily-summary/typed-reducer";

/*
 * Daily Summary R1: the day screen's typed state is ONE pure reducer, and the screen does nothing to those values but dispatch
 * to it (ui-text.test.ts checks that). So these are the real transitions: what is typed, what the notices do, the ten-line cap.
 */

const line = (n: number): BankLine => ({ cents: 1000 + n, time: "10:00", slip: `S${n}`, note: "" });
const start = (over: Partial<{ bf: string; bank: BankLine[]; preparedId: string; checkedId: string }> = {}, notices: string[] = []) =>
  initialTypedState({ bf: "", bank: [], preparedId: "", checkedId: "", ...over }, notices);
const run = (s: TypedUiState, ...actions: TypedAction[]) => actions.reduce(typedReducer, s);

test("the bring-forward notice goes when a VALID amount is typed, stays for empty or invalid text, and does not come back", () => {
  let s = start({}, ["bf", "bank"]);
  s = run(s, { type: "bf", text: "a" });
  assert.deepEqual(s.openNotices, ["bf", "bank"], "an invalid character keeps it");
  s = run(s, { type: "bf", text: "" });
  assert.deepEqual(s.openNotices, ["bf", "bank"], "an empty box keeps it");
  s = run(s, { type: "bf", text: "5,000" });
  assert.deepEqual(s.openNotices, ["bank"], "a valid amount dismisses it, and only it");
  assert.equal(s.bfText, "5,000");
  s = run(s, { type: "bf", text: "5,00x" }, { type: "bf", text: "" }, { type: "bf", text: "-1" });
  assert.deepEqual(s.openNotices, ["bank"], "typing something invalid afterwards does not bring it back");
  assert.equal(s.bfText, "-1", "the text itself is exactly what was typed (the screen shows the error)");
});

test("each valid shape dismisses it: whole, grouped, decimals, zero, the maximum", () => {
  for (const ok of ["0", "5", "5000", "5,000", "5,000.5", "0.05", "99,999,999.99"]) assert.deepEqual(run(start({}, ["bf"]), { type: "bf", text: ok }).openNotices, [], ok);
  for (const bad of ["", " ", "-5", "1.234", "100,000,000.00", "5,00", "abc"]) assert.deepEqual(run(start({}, ["bf"]), { type: "bf", text: bad }).openNotices, ["bf"], `"${bad}"`);
});

test("adding or removing a bank line dismisses the bank notice (only), and a removal keeps the order of the rest", () => {
  const withLines = start({ bank: [line(1), line(2), line(3)] }, ["bf", "bank"]);
  const removed = run(withLines, { type: "bankRemove", index: 1 });
  assert.deepEqual(removed.bank.map((l) => l.slip), ["S1", "S3"]);
  assert.deepEqual(removed.openNotices, ["bf"]);
  const added = run(start({}, ["bf", "bank"]), { type: "bankAdd", line: line(9) });
  assert.deepEqual(added.bank.map((l) => l.slip), ["S9"]);
  assert.deepEqual(added.openNotices, ["bf"]);
});

test("the bank list never holds more than ten lines, and a refused add changes nothing (same state object)", () => {
  let s = start();
  for (let i = 1; i <= MAX_BANK_LINES + 2; i++) s = run(s, { type: "bankAdd", line: line(i) });
  assert.equal(s.bank.length, MAX_BANK_LINES);
  assert.equal(s.bank[MAX_BANK_LINES - 1].slip, `S${MAX_BANK_LINES}`, "the first ten are kept");
  const again = typedReducer(s, { type: "bankAdd", line: line(99) });
  assert.equal(again, s, "no new state object when nothing changed");
  const withNotice = start({ bank: Array.from({ length: MAX_BANK_LINES }, (_, i) => line(i)) }, ["bank"]);
  assert.deepEqual(typedReducer(withNotice, { type: "bankAdd", line: line(99) }).openNotices, ["bank"], "a refused add does not dismiss the notice");
});

test("removing a line that is not there changes nothing", () => {
  const s = start({ bank: [line(1)] }, ["bank"]);
  for (const index of [-1, 1, 5, 1.5, Number.NaN]) assert.equal(typedReducer(s, { type: "bankRemove", index }), s, String(index));
});

test("choosing Prepared by and Checked by changes only those, and leaves notices alone", () => {
  const s = run(start({ bf: "5", bank: [line(1)] }, ["bf"]), { type: "prepared", id: "s1" }, { type: "checked", id: "a1" });
  assert.deepEqual([s.preparedId, s.checkedId], ["s1", "a1"]);
  assert.deepEqual(s.openNotices, ["bf"]);
  assert.equal(s.bfText, "5");
  assert.equal(s.bank.length, 1);
});

test("a state is never mutated, and the initial state copies what it is given", () => {
  const bank = [line(1)];
  const notices = ["bf", "bank"];
  const s0 = initialTypedState({ bf: "", bank, preparedId: "", checkedId: "" }, notices);
  bank.push(line(2));
  notices.pop();
  assert.equal(s0.bank.length, 1);
  assert.deepEqual(s0.openNotices, ["bf", "bank"]);
  const frozen = Object.freeze({ ...s0, bank: Object.freeze([...s0.bank]) as BankLine[], openNotices: Object.freeze([...s0.openNotices]) as string[] });
  assert.doesNotThrow(() => run(frozen, { type: "bf", text: "7" }, { type: "bankAdd", line: line(3) }, { type: "bankRemove", index: 0 }, { type: "checked", id: "x" }));
});

test("the whole story from a hand-edited address: bf=abc and a junk bank line open both notices, then the user puts each right", () => {
  const keys = noticeKeys({ bringForwardInvalid: true, bankLinesInvalid: true }, undefined);
  assert.deepEqual(keys, ["bf", "bank"]);
  let s = initialTypedState({ bf: "", bank: [], preparedId: "s1", checkedId: "a1" }, keys);
  s = run(s, { type: "bf", text: "abc" });
  assert.equal(s.openNotices.length, 2, "still invalid: both still showing");
  s = run(s, { type: "bf", text: "5,000" });
  assert.deepEqual(s.openNotices, ["bank"], "a valid bring-forward clears its own notice");
  s = run(s, { type: "bankAdd", line: line(1) });
  assert.deepEqual(s.openNotices, [], "adding a bank line clears the other");
  assert.deepEqual([s.bfText, s.bank.length, s.preparedId, s.checkedId], ["5,000", 1, "s1", "a1"]);
});
