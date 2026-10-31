import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

let lookup: typeof import("@/lib/receipt-lookup");

/*
 * Job 4: how a search box entry is read as a receipt number. Pure — no database. The
 * receipts themselves are checked in receipt-lookup.test.ts.
 */
describe("parseReceiptNumber", () => {
  before(async () => {
    lookup = await import("@/lib/receipt-lookup");
  });

  test("XN-1493, xn1493, xn 1493, XN 1493 and 1493 are all receipt 1493", () => {
    for (const q of ["XN-1493", "xn-1493", "xn1493", "xn 1493", "XN 1493", "XN - 1493", "1493", "  1493  ", " xn-1493 "]) {
      assert.equal(lookup.parseReceiptNumber(q), 1493, JSON.stringify(q));
    }
  });

  test("a single digit is a receipt number too (XN-5 is exact, not a scan)", () => {
    assert.equal(lookup.parseReceiptNumber("5"), 5);
    assert.equal(lookup.parseReceiptNumber("XN-5"), 5);
  });

  test("names, card numbers and other text are NOT receipt numbers", () => {
    for (const q of ["", "  ", "Nimal", "nimal 12", "0186-0002-2000", "0186-0002", "XN-", "XN", "XN-12-3", "12 34", "1e3", "-5", "xnx5", "x1493", "1493x", "XN-1493 Nimal", "٣٤٥"]) {
      assert.equal(lookup.parseReceiptNumber(q), null, JSON.stringify(q));
    }
  });

  test("zero and numbers too big to be an id are refused; leading zeros are read as the number", () => {
    assert.equal(lookup.parseReceiptNumber("0"), null);
    assert.equal(lookup.parseReceiptNumber("XN-0"), null);
    assert.equal(lookup.parseReceiptNumber("1234567890"), null); // 10 digits: beyond any id
    assert.equal(lookup.parseReceiptNumber("00042"), 42);
  });

  test("the limits are the ones the brief names", () => {
    assert.equal(lookup.LAST_RECEIPTS, 10);
    assert.equal(lookup.SEARCH_RECEIPTS, 20);
  });
});
