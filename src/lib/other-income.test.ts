import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { codeFromLabel, incomeVoucherRef, parseCancelReason, parseIncomeInput, splitIncomeTotals } from "@/lib/other-income";

const TODAY = "2026-11-16";
const good = { categoryId: "3", amount: "1,250.50", date: "2026-11-15", source: " Mr Perera ", note: " roof rent ", method: "CASH", receivedById: "u1" };

describe("other income input", () => {
  test("a good form parses to integer cents, a trimmed source and note", () => {
    const r = parseIncomeInput(good, TODAY);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual(r.value, { categoryId: 3, cents: 125050, date: "2026-11-15", source: "Mr Perera", note: "roof rent", method: "CASH", receivedById: "u1" });
  });

  test("the method defaults to cash; an empty source is null", () => {
    const r = parseIncomeInput({ ...good, method: "", source: "  " }, TODAY);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.method, "CASH");
      assert.equal(r.value.source, null);
    }
  });

  test("a bank income is accepted; any other method is refused", () => {
    assert.ok(parseIncomeInput({ ...good, method: "BANK" }, TODAY).ok);
    assert.equal(parseIncomeInput({ ...good, method: "CHEQUE" }, TODAY).ok, false);
    assert.equal(parseIncomeInput({ ...good, method: "cash" }, TODAY).ok, false);
  });

  test("zero, negative, junk, and too-big amounts are refused with a plain message", () => {
    for (const amount of ["0", "0.00", "-5", "abc", "1.234", "", "100000000"]) {
      const r = parseIncomeInput({ ...good, amount }, TODAY);
      assert.equal(r.ok, false, `amount "${amount}"`);
      if (!r.ok) assert.ok(r.error.length > 0);
    }
    const zero = parseIncomeInput({ ...good, amount: "0.00" }, TODAY);
    assert.equal(!zero.ok && zero.error, "Amount must be greater than zero.");
  });

  test("the date must be a real day and never in the future (the Colombo today is passed in)", () => {
    assert.ok(parseIncomeInput({ ...good, date: TODAY }, TODAY).ok);
    for (const date of ["2026-11-17", "2026-02-30", "2026-13-01", "11/15/2026", "", "0999-01-01"]) {
      assert.equal(parseIncomeInput({ ...good, date }, TODAY).ok, false, `date "${date}"`);
    }
  });

  test("a missing category or receiver is refused; the source and note have a length limit", () => {
    assert.equal(parseIncomeInput({ ...good, categoryId: "" }, TODAY).ok, false);
    assert.equal(parseIncomeInput({ ...good, categoryId: "0" }, TODAY).ok, false);
    assert.equal(parseIncomeInput({ ...good, categoryId: "1.5" }, TODAY).ok, false);
    assert.equal(parseIncomeInput({ ...good, receivedById: " " }, TODAY).ok, false);
    assert.equal(parseIncomeInput({ ...good, source: "x".repeat(121) }, TODAY).ok, false);
    assert.equal(parseIncomeInput({ ...good, note: "x".repeat(301) }, TODAY).ok, false);
    assert.ok(parseIncomeInput({ ...good, source: "x".repeat(120), note: "x".repeat(300) }, TODAY).ok);
  });

  test("a non-string value in the form does not throw", () => {
    const r = parseIncomeInput({ categoryId: 3, amount: 10, date: null, receivedById: undefined }, TODAY);
    assert.equal(r.ok, false);
  });
});

describe("cancel reason, voucher number and category code", () => {
  test("a reason needs 3 characters and has an upper limit", () => {
    assert.equal(parseCancelReason("ab").ok, false);
    assert.equal(parseCancelReason("  ab  ").ok, false);
    assert.equal(parseCancelReason(undefined).ok, false);
    assert.equal(parseCancelReason("x".repeat(301)).ok, false);
    const r = parseCancelReason("  typed twice ");
    assert.ok(r.ok && r.reason === "typed twice");
  });

  test("the voucher number has its own series, never XN-", () => {
    assert.equal(incomeVoucherRef(42), "IN-42");
    assert.ok(!incomeVoucherRef(1).startsWith("XN-"));
  });

  test("a category code is capital letters, digits and underscores", () => {
    assert.equal(codeFromLabel("Equipment sale"), "EQUIPMENT_SALE");
    assert.equal(codeFromLabel("  Old-books & maps! "), "OLD_BOOKS_MAPS");
    assert.equal(codeFromLabel("!!!"), "");
  });
});

describe("what incomes add to the day", () => {
  test("only cash reaches the drawer; bank is apart; a cancelled row is in neither", () => {
    const t = splitIncomeTotals([
      { cents: 100000, method: "CASH", cancelled: false },
      { cents: 25050, method: "CASH", cancelled: false },
      { cents: 500000, method: "BANK", cancelled: false },
      { cents: 999999, method: "CASH", cancelled: true },
      { cents: 999999, method: "BANK", cancelled: true },
    ]);
    assert.deepEqual(t, { cash: 125050, bank: 500000, cashRows: 2, bankRows: 1 });
  });

  test("no rows is all zeros", () => {
    assert.deepEqual(splitIncomeTotals([]), { cash: 0, bank: 0, cashRows: 0, bankRows: 0 });
  });
});
