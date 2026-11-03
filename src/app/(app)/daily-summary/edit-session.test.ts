import { test } from "node:test";
import assert from "node:assert/strict";

import type { BankLine } from "@/lib/cash-flow";

import { editSessionReducer, initialEditSession, type EditAction, type EditSession } from "./edit-session";
import { BLOCK_BF, BLOCK_DONE_BY, BLOCK_OVER, blockReason } from "./block-reason";

const line = (cents: number, time = "09:00"): BankLine => ({ cents, time, slip: "", note: "" });
const run = (s: EditSession, ...actions: EditAction[]) => actions.reduce(editSessionReducer, s);

// F3
test("F3: Cancel throws the edit away (bring-forward, bank lines, Done by, edit mode) and the next Edit starts clean", () => {
  const original = { bf: "50.00", bank: [line(1000_00)] };
  const start = initialEditSession(original);
  const dirty = run(
    start,
    { type: "start" },
    { type: "typed", action: { type: "bf", text: "999" } },
    { type: "typed", action: { type: "bankAdd", line: line(5_00, "11:00") } },
    { type: "typed", action: { type: "bankRemove", index: 0 } },
    { type: "doneBy", id: "u-7" },
  );
  assert.equal(dirty.typed.bfText, "999");
  assert.deepEqual(dirty.typed.bank.map((l) => l.cents), [5_00]);
  assert.equal(dirty.doneById, "u-7");
  assert.equal(dirty.editing, true);

  const cancelled = run(dirty, { type: "cancel" });
  assert.deepEqual(cancelled, start, "exactly the state of a screen that was just opened");
  assert.equal(cancelled.editing, false);

  const again = run(cancelled, { type: "start" });
  assert.equal(again.editing, true);
  assert.equal(again.typed.bfText, "50.00", "re-opening Edit starts from the saved bring-forward");
  assert.deepEqual(again.typed.bank, original.bank, "and the saved bank lines");
  assert.equal(again.doneById, "", "Done by is empty again");
});

test("F3: Cancel never changes the saved numbers it returns to (the original is not shared with what is typed)", () => {
  const original = { bf: "", bank: [line(100_00)] };
  const s = run(initialEditSession(original), { type: "start" }, { type: "typed", action: { type: "bankAdd", line: line(1_00) } });
  assert.equal(original.bank.length, 1, "typing does not mutate the original");
  assert.equal(run(s, { type: "cancel" }).typed.bank.length, 1);
});

// F4 helper
test("blockReason: the first reason that applies wins; null when the buttons may be on", () => {
  assert.equal(blockReason({ bringForwardOk: false, overdrawn: true, needsDoneBy: true }), BLOCK_BF);
  assert.equal(blockReason({ bringForwardOk: true, overdrawn: true, needsDoneBy: true }), BLOCK_OVER);
  assert.equal(blockReason({ bringForwardOk: true, overdrawn: false, needsDoneBy: true }), BLOCK_DONE_BY);
  assert.equal(blockReason({ bringForwardOk: true, overdrawn: false }), null);
  assert.equal(blockReason({ bringForwardOk: true, overdrawn: false, needsDoneBy: false }), null);
});

// F3, the wiring: the screen's Cancel runs the reducer's "cancel" (not a partial reset of some of the state)
import { readFileSync } from "node:fs";
import path from "node:path";

test("F3: the saved screen's Cancel button runs cancelEdit, and cancelEdit dispatches the reducer's cancel", () => {
  const screen = readFileSync(path.join(process.cwd(), "src/app/(app)/daily-summary/saved-day-screen.tsx"), "utf8");
  assert.match(screen, /onClick=\{cancelEdit\}/, "the Cancel button");
  assert.match(screen, /const cancelEdit = \(\) => \{\s*sessionDispatch\(\{ type: "cancel" \}\);/, "cancelEdit");
});
