import "@/test-support/no-database";
import "@/test-support/server-stubs";

import test from "node:test";
import assert from "node:assert/strict";

import { SETTLED_PAYMENT_WHERE } from "@/lib/student-arrears";

// Safety net for the Payment redesign (job 1). Every "is this month paid?" read
// goes through this one object (rule 23), so changing it changes the arrears
// colour, /reports/not-paid and the student list together. Lock its exact shape.

test("SETTLED_PAYMENT_WHERE: a month is settled by a non-cancelled CLASS row that names a course", () => {
  assert.deepEqual(SETTLED_PAYMENT_WHERE, {
    kind: "CLASS",
    cancelled: false,
    courseId: { not: null },
  });
});

test("SETTLED_PAYMENT_WHERE: never filters on the cash date or on transactionRef", () => {
  for (const key of Object.keys(SETTLED_PAYMENT_WHERE)) {
    assert.ok(!["paidAt", "transactionRef"].includes(key), key);
  }
});
