import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { MAX_BANK_LINES } from "@/lib/cash-flow";
import { parseBankLine, serializeBankLine } from "@/app/(app)/daily-summary/typed-state";

import { matchBankLines } from "./bank-lines";
import { changesForEdit, changesForResave, changesForSave, describeChange, parseChanges, type ChangeItem } from "./changes";
import { decideBase } from "./conflict";
import { chooseHint, hintWindow, HINT_DAYS } from "./hint";
import { DS_LOCK_NAMESPACE, LOCK_WAIT_MS, lockKey, TX_MAX_WAIT_MS, TX_TIMEOUT_MS } from "./lock";
import { isExpired, retentionCutoff } from "./retention";
import { NOTE_MAX, parseSaveInput, SLIP_MAX } from "./validate";

// ---- retention ----
test("retentionCutoff: the same day three calendar months earlier", () => {
  assert.equal(retentionCutoff("2026-11-02"), "2026-08-02");
  assert.equal(retentionCutoff("2026-06-15"), "2026-03-15");
  assert.equal(retentionCutoff("2026-01-10"), "2025-10-10", "across a year");
  assert.equal(retentionCutoff("2026-03-01"), "2025-12-01");
});

test("retentionCutoff: month ends clamp to the last day of the earlier month, leap day included", () => {
  assert.equal(retentionCutoff("2026-12-31"), "2026-09-30");
  assert.equal(retentionCutoff("2026-05-31"), "2026-02-28");
  assert.equal(retentionCutoff("2028-05-31"), "2028-02-29", "leap year");
  assert.equal(retentionCutoff("2028-05-29"), "2028-02-29");
  assert.equal(retentionCutoff("2026-05-30"), "2026-02-28");
  assert.equal(retentionCutoff("2028-02-29"), "2027-11-29");
  assert.equal(retentionCutoff("2026-08-31"), "2026-05-31");
  assert.equal(retentionCutoff("2026-11-30"), "2026-08-30");
});

test("retentionCutoff refuses anything that is not a real date", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "", "x", "2026-1-1"]) assert.throws(() => retentionCutoff(bad), RangeError);
});

test("isExpired: the boundary day is kept, the day before it goes", () => {
  const today = "2026-11-02"; // cutoff 2026-08-02
  assert.equal(isExpired("2026-08-02", today), false, "exactly three months old: kept");
  assert.equal(isExpired("2026-08-01", today), true, "one day older: deleted");
  assert.equal(isExpired("2026-11-02", today), false);
  assert.equal(isExpired("2025-01-01", today), true);
});

// ---- hint ----
const cand = (date: string, left = 100_00, checked = true) => ({ date, leftCents: left, checked });

test("chooseHint: yesterday wins; its date and distance are named", () => {
  const h = chooseHint("2026-10-15", [cand("2026-10-14", 12_000_00), cand("2026-10-12", 1)]);
  assert.deepEqual(h, { date: "2026-10-14", leftCents: 1_200_000, checked: true, daysAgo: 1 });
});

test("chooseHint: with yesterday unsaved, the newest saved day within 7 days is offered with its own date", () => {
  const h = chooseHint("2026-10-12", [cand("2026-10-10", 5_000_00, false), cand("2026-10-07")]);
  assert.equal(h?.date, "2026-10-10");
  assert.equal(h?.daysAgo, 2);
  assert.equal(h?.checked, false);
});

test("chooseHint: exactly 7 days back is still offered, 8 is not; today and the future never", () => {
  assert.equal(chooseHint("2026-10-15", [cand("2026-10-08")])?.daysAgo, HINT_DAYS);
  assert.equal(chooseHint("2026-10-15", [cand("2026-10-07")]), null);
  assert.equal(chooseHint("2026-10-15", [cand("2026-10-15"), cand("2026-10-16")]), null);
  assert.equal(chooseHint("2026-10-15", []), null);
  assert.deepEqual(hintWindow("2026-10-15"), { from: "2026-10-08", to: "2026-10-14" });
});

test("chooseHint: a negative Left is offered as it is; month ends work", () => {
  assert.equal(chooseHint("2026-11-01", [cand("2026-10-31", -400_00)])?.leftCents, -40000);
  assert.equal(chooseHint("2026-03-01", [cand("2026-02-28")])?.daysAgo, 1);
});

// ---- conflict ----
test("decideBase: the exact version passes; anything else writes nothing", () => {
  assert.deepEqual(decideBase(0, null), { ok: true });
  assert.deepEqual(decideBase(3, 3), { ok: true });
  assert.deepEqual(decideBase(2, 3), { ok: false, reason: "conflict" });
  assert.deepEqual(decideBase(4, 3), { ok: false, reason: "conflict" });
  assert.deepEqual(decideBase(0, 1), { ok: false, reason: "already-saved" });
  assert.deepEqual(decideBase(2, null), { ok: false, reason: "not-saved" });
  for (const bad of [-1, 1.5, NaN, "1", null, undefined, {}]) assert.deepEqual(decideBase(bad, 1), { ok: false, reason: "bad-base" });
});

// ---- lock ----
test("the Daily Summary lock namespace is its own and differs from takePayment's (read from the payment source)", () => {
  const src = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "payment", "actions.ts"), "utf8");
  const m = /const PAYMENT_LOCK_NAMESPACE = (\d+);/.exec(src);
  assert.ok(m, "found takePayment's namespace in the payment source (a test that parses nothing proves nothing)");
  assert.notEqual(DS_LOCK_NAMESPACE, Number(m[1]));
  assert.equal(Number.isInteger(DS_LOCK_NAMESPACE) && DS_LOCK_NAMESPACE > 0 && DS_LOCK_NAMESPACE < 2 ** 31, true);
});

test("the lock key is the date as a 32-bit number, and the lock waits less than the transaction runs", () => {
  assert.equal(lockKey("2026-11-02"), 20261102);
  assert.ok(lockKey("2100-12-31") < 2 ** 31);
  assert.throws(() => lockKey("2026-1-2"), RangeError);
  assert.ok(LOCK_WAIT_MS < TX_TIMEOUT_MS && TX_MAX_WAIT_MS < TX_TIMEOUT_MS);
});

// ---- change items and their words ----
const L = (cents: number, time = "10:30", slip = "", note = "") => ({ cents, time, slip, note });

test("describeChange: every item in plain words, money formatted from integer cents", () => {
  const items: [ChangeItem, string][] = [
    [{ t: "saved", by: "Sadun" }, "Saved by Sadun"],
    [{ t: "edited-by", name: "Thilini" }, "Edited by Thilini"],
    [{ t: "bf", from: 500000, to: 650000 }, "Bring-forward changed from 5,000.00 to 6,500.00"],
    [{ t: "bank+", line: L(1_500_000, "10:30", "SLIP-2", "Peoples") }, "Bank deposit added: 10:30 AM, 15,000.00, slip SLIP-2, Peoples"],
    [{ t: "bank-", line: L(500_000, "09:15") }, "Bank deposit removed: 9:15 AM, 5,000.00"],
    [{ t: "bank~", from: L(500_000, "09:15", "A"), to: L(500_000, "09:45", "B") }, "Bank deposit changed from 9:15 AM, 5,000.00, slip A to 9:45 AM, 5,000.00, slip B"],
    [{ t: "check-cleared", by: "Nadeesha", at: "2026-11-02T10:00:00.000Z" }, "Check cleared: the money changed after Nadeesha checked it"],
    [{ t: "check-kept", by: "Nadeesha" }, "The check by Nadeesha was kept: only a slip, note or time changed"],
    [{ t: "unknown" }, "A change recorded by a newer version of the app"],
  ];
  for (const [item, text] of items) assert.equal(describeChange(item), text);
  assert.equal(
    describeChange({ t: "resaved", by: "Sadun", diffs: [{ label: "Total collected", saved: "35,100.00", live: "34,600.00" }] }),
    "Re-saved with live numbers by Sadun: Total collected 35,100.00 → 34,600.00",
  );
});

test("describeChange: a long re-save list is cut to five and says how many more", () => {
  const diffs = Array.from({ length: 8 }, (_, i) => ({ label: `Figure ${i}`, saved: "1.00", live: "2.00" }));
  const text = describeChange({ t: "resaved", by: "Sadun", diffs });
  assert.match(text, /Figure 4 1\.00 → 2\.00; and 3 more$/);
  assert.ok(!text.includes("Figure 5"));
});

test("changesForEdit: 'edited by' first, then only what changed, in a fixed order; nothing for what stayed", () => {
  const prev = [{ ...L(500_000, "09:15", "A"), recordedById: "u1", recordedAt: new Date(0) }, { ...L(100_000, "11:00"), recordedById: "u1", recordedAt: new Date(0) }];
  const next = [L(500_000, "09:45", "B"), L(250_000, "12:00")];
  const match = matchBankLines(prev, next, "u2", new Date(1));
  const items = changesForEdit({ by: "Thilini", prevBf: 100_000, nextBf: 150_000, match, check: { cleared: { by: "Nadeesha", at: "2026-11-02T10:00:00.000Z" } } });
  assert.deepEqual(items.map((i) => i.t), ["edited-by", "bf", "bank-", "bank~", "bank+", "check-cleared"]);
  const same = changesForEdit({ by: "T", prevBf: 5, nextBf: 5, match: { added: [], removed: [], edited: [] }, check: { kept: "Nadeesha" } });
  assert.deepEqual(same.map((i) => i.t), ["edited-by", "check-kept"]);
});

test("changesForSave and changesForResave", () => {
  assert.deepEqual(changesForSave("Sadun"), [{ t: "saved", by: "Sadun" }]);
  const r = changesForResave({ by: "Sadun", diffs: [{ key: "net", label: "Net", saved: "1.00", live: "2.00" }], cleared: { by: "Nadeesha", at: "x" } });
  assert.deepEqual(r.map((i) => i.t), ["resaved", "check-cleared"]);
});

test("parseChanges: stored items round-trip through JSON; unknown or broken ones become 'unknown', a non-array is empty", () => {
  const items: ChangeItem[] = [{ t: "saved", by: "S" }, { t: "bf", from: 1, to: 2 }, { t: "bank+", line: L(5) }];
  assert.deepEqual(parseChanges(JSON.parse(JSON.stringify(items))), items);
  assert.deepEqual(parseChanges([{ t: "from-the-future", x: 1 }, { t: "bf", from: "1", to: 2 }, null]), [{ t: "unknown" }, { t: "unknown" }, { t: "unknown" }]);
  assert.deepEqual(parseChanges(null), []);
  assert.deepEqual(parseChanges({}), []);
});

// ---- input validation ----
const input = (over: Record<string, unknown> = {}) => ({
  date: "2026-11-02", mode: "save", baseVersion: 0, doneById: "u1", bringForward: "5,000.00",
  bank: [{ time: "09:15", amount: "5,000.00", slip: "S1", note: "Peoples" }],
  seen: { collected: 3510000, deductions: 620000 },
  ...over,
});

test("parseSaveInput: a good save is read into integer cents", () => {
  const r = parseSaveInput(input());
  assert.ok(r.ok);
  assert.deepEqual(r.value, {
    date: "2026-11-02", mode: "save", baseVersion: 0, doneById: "u1", bringForwardCents: 500000,
    bank: [{ cents: 500000, time: "09:15", slip: "S1", note: "Peoples" }], seen: { collected: 3510000, deductions: 620000 },
  });
});

test("parseSaveInput: a first save must start from version 0, an edit and a re-save from a saved version", () => {
  assert.equal(parseSaveInput(input({ mode: "save", baseVersion: 1 })).ok, false);
  assert.equal(parseSaveInput(input({ mode: "edit", baseVersion: 0 })).ok, false);
  assert.equal(parseSaveInput(input({ mode: "resave", baseVersion: 0 })).ok, false);
  assert.equal(parseSaveInput(input({ mode: "resave", baseVersion: 3 })).ok, true);
});

test("parseSaveInput: an empty bring-forward is zero; an edit needs no 'seen'; a save and a re-save do", () => {
  const r = parseSaveInput(input({ bringForward: "", mode: "edit", baseVersion: 2, seen: undefined, bank: [] }));
  assert.ok(r.ok && r.value.bringForwardCents === 0 && r.value.seen === null);
  for (const mode of ["save", "resave"]) assert.equal(parseSaveInput(input({ mode, seen: undefined })).ok, false);
});

test("parseSaveInput refuses hostile values and echoes the sanitised text back (rule 14)", () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ bringForward: "-5" }, "bringForward"],
    [{ bringForward: "1.234" }, "bringForward"],
    [{ bringForward: "100,000,000.00" }, "bringForward"],
    [{ bringForward: "abc" }, "bringForward"],
    [{ date: "2026-02-30" }, "date"],
    [{ doneById: "" }, "doneById"],
    [{ bank: [{ time: "25:00", amount: "5", slip: "", note: "" }] }, "bank.0.time"],
    [{ bank: [{ time: "09:15", amount: "0", slip: "", note: "" }] }, "bank.0.amount"],
    [{ bank: [{ time: "09:15", amount: "-5", slip: "", note: "" }] }, "bank.0.amount"],
    [{ bank: Array.from({ length: MAX_BANK_LINES + 1 }, () => ({ time: "09:15", amount: "1", slip: "", note: "" })) }, "bank"],
  ];
  for (const [over, field] of bad) {
    const r = parseSaveInput(input(over));
    assert.equal(r.ok, false, JSON.stringify(over).slice(0, 60));
    if (!r.ok) {
      assert.ok(field in r.fieldErrors, `${field} is flagged (got ${Object.keys(r.fieldErrors)})`);
      assert.equal(typeof r.values.bringForward, "string");
      assert.ok(r.values.bank.length <= 50);
    }
  }
  const r = parseSaveInput(input({ bringForward: "abc" }));
  assert.ok(!r.ok && r.values.bringForward === "abc" && r.values.doneById === "u1", "what was typed comes back");
});

test("parseSaveInput: not an object, wrong types, an overlong value, a fractional or negative base version", () => {
  for (const raw of [null, undefined, "x", 5, [], {}, input({ baseVersion: 1.5 }), input({ baseVersion: -1 }), input({ mode: "delete" }), input({ doneById: "x".repeat(65) }), input({ bank: "none" })]) {
    const r = parseSaveInput(raw);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(typeof r.message, "string");
  }
});

test("parseSaveInput: slip and note are cleaned of control characters exactly as Release 1's address parser does (within the limits)", () => {
  const nasty = "  a\u0000b\tc\n  d  ";
  const r = parseSaveInput(input({ bank: [{ time: "09:15", amount: "12.50", slip: nasty, note: nasty }] }));
  assert.ok(r.ok);
  const theirs = parseBankLine(serializeBankLine({ cents: 1250, time: "09:15", slip: nasty, note: nasty }));
  assert.ok(theirs);
  assert.deepEqual(r.value.bank[0], theirs, "the same line comes out of both parsers");
});

test("parseSaveInput: the slip limit is 30 and the note limit 80 (the STORED limits): at the limit it is accepted, one over is REFUSED with the field named, never silently cut", () => {
  assert.equal(SLIP_MAX, 30);
  assert.equal(NOTE_MAX, 80);
  const at = parseSaveInput(input({ bank: [{ time: "09:15", amount: "1", slip: "s".repeat(30), note: "n".repeat(80) }] }));
  assert.ok(at.ok && at.value.bank[0].slip.length === 30 && at.value.bank[0].note.length === 80);
  const slip = parseSaveInput(input({ bank: [{ time: "09:15", amount: "1", slip: "s".repeat(31), note: "" }] }));
  assert.ok(!slip.ok && "bank.0.slip" in slip.fieldErrors && /at most 30 characters/.test(slip.message));
  const note = parseSaveInput(input({ bank: [{ time: "09:15", amount: "1", slip: "", note: "n".repeat(81) }] }));
  assert.ok(!note.ok && "bank.0.note" in note.fieldErrors && /at most 80 characters/.test(note.message));
  assert.ok(!slip.ok && slip.values.bank[0].slip.length === 30, "the echo is what the form can hold");
  // surrounding spaces are not counted (they are trimmed), so a 30-character slip with spaces around it is accepted
  assert.ok(parseSaveInput(input({ bank: [{ time: "09:15", amount: "1", slip: `  ${"s".repeat(30)}  `, note: "" }] })).ok);
  // a very long paste is still a plain refusal, not "could not be read"
  const huge = parseSaveInput(input({ bank: [{ time: "09:15", amount: "1", slip: "s".repeat(900), note: "" }] }));
  assert.ok(!huge.ok && "bank.0.slip" in huge.fieldErrors);
});

test("parseSaveInput accepts the largest typed amounts and refuses one above", () => {
  const ok = parseSaveInput(input({ bringForward: "99,999,999.99", bank: [{ time: "23:59", amount: "99999999.99", slip: "", note: "" }] }));
  assert.ok(ok.ok && ok.value.bringForwardCents === 9_999_999_999 && ok.value.bank[0].cents === 9_999_999_999);
  assert.equal(parseSaveInput(input({ bringForward: "100000000.00" })).ok, false);
});
