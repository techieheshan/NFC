import { test } from "node:test";
import assert from "node:assert/strict";

import { NOTICE_TEXT, noticeKeys } from "@/app/(app)/daily-summary/notices";

/* Daily Summary R1: which notices the day screen shows after the address held something unusable. */

const none = { bringForwardInvalid: false, bankLinesInvalid: false };

test("nothing wrong and no notice parameter: no notice", () => {
  assert.deepEqual(noticeKeys(none, undefined), []);
});

test("what parsing found is shown, in a fixed order, each once", () => {
  assert.deepEqual(noticeKeys({ bringForwardInvalid: true, bankLinesInvalid: false }, undefined), ["bf"]);
  assert.deepEqual(noticeKeys({ bringForwardInvalid: false, bankLinesInvalid: true }, undefined), ["bank"]);
  assert.deepEqual(noticeKeys({ bringForwardInvalid: true, bankLinesInvalid: true }, undefined), ["bf", "bank"]);
  assert.deepEqual(noticeKeys({ bringForwardInvalid: true, bankLinesInvalid: true }, ["bank", "bf", "bf"]), ["bf", "bank"]);
});

test("the document route's `notice` parameters (one or several) are honoured; any other value is ignored", () => {
  assert.deepEqual(noticeKeys(none, "bf"), ["bf"]);
  assert.deepEqual(noticeKeys(none, ["bank", "bf"]), ["bf", "bank"]);
  for (const junk of ["", "x", "BF", "__proto__", "<script>", "constructor", ["nope", "also nope"]]) assert.deepEqual(noticeKeys(none, junk), [], String(junk));
  assert.deepEqual(noticeKeys(none, Array.from({ length: 1000 }, () => "bf")), ["bf"], "bounded and de-duplicated");
});

test("both notices have a sentence a cashier can act on", () => {
  assert.match(NOTICE_TEXT.bf, /bring-forward .* not a valid amount/);
  assert.match(NOTICE_TEXT.bank, /bank lines .* not valid .* more than 10/);
  assert.ok(NOTICE_TEXT.bank.includes("add any missing line again"));
});
