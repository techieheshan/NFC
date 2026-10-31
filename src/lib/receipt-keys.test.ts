import "@/test-support/no-database";
import "@/test-support/server-stubs";

import test from "node:test";
import assert from "node:assert/strict";

import { monthLabel, receiptReference, transactionKey } from "@/lib/receipts";

// Safety net for the Payment redesign (job 1): these lock what receipts do TODAY.

test("the receipt reference is XN- plus the LOWEST payment id in the transaction", () => {
  assert.equal(receiptReference([42]), "XN-42");
  assert.equal(receiptReference([1495, 1493, 1494]), "XN-1493");
});

test("the reference does not depend on the order the rows came back in", () => {
  assert.equal(receiptReference([7, 3, 9]), receiptReference([9, 7, 3]));
  assert.equal(receiptReference([3, 7, 9]), "XN-3");
});

test("rows sharing a transactionRef are one transaction key", () => {
  const ref = "5b1d6a52-0c1e-4d3a-9d52-7f7a1f0e2b11";
  assert.equal(transactionKey({ id: 10, transactionRef: ref }), `ref:${ref}`);
  assert.equal(transactionKey({ id: 11, transactionRef: ref }), `ref:${ref}`);
});

test("a legacy row with a null ref is a transaction of ONE, keyed by its own id", () => {
  assert.equal(transactionKey({ id: 12, transactionRef: null }), "pay:12");
  // Two un-backfilled rows must never collapse into one receipt (rule 18).
  assert.notEqual(
    transactionKey({ id: 12, transactionRef: null }),
    transactionKey({ id: 13, transactionRef: null }),
  );
});

test("a null-ref key can never be mistaken for a grouped one", () => {
  assert.ok(transactionKey({ id: 5, transactionRef: null }).startsWith("pay:"));
  assert.ok(transactionKey({ id: 5, transactionRef: "abc" }).startsWith("ref:"));
});

test("an empty-string ref is treated like a legacy row (falsy), not as ref:", () => {
  assert.equal(transactionKey({ id: 9, transactionRef: "" }), "pay:9");
});

test("monthLabel is Mon YYYY, one-based, across the year ends", () => {
  assert.equal(monthLabel(2026, 1), "Jan 2026");
  assert.equal(monthLabel(2026, 8), "Aug 2026");
  assert.equal(monthLabel(2026, 12), "Dec 2026");
});
