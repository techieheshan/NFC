import "@/test-support/no-database";
import { setSession } from "@/test-support/server-stubs";

import test from "node:test";
import assert from "node:assert/strict";

import { loadPanel, searchStudents, takePayment } from "@/app/(app)/payment/actions";
import { cancelTransaction, reprintTransaction } from "@/app/(app)/receipts/actions";

/*
 * Safety net for the Payment redesign (job 1). These call the REAL server
 * actions with a stubbed session. Every case below is decided before the first
 * database query, and `no-database` points the client at an unresolvable host,
 * so a stray query would fail to connect rather than touch a real database.
 *
 * Refusals are asserted by CONTENT — the exact message, or the exact result —
 * never "something threw" (AGENTS rule 30).
 */

const NOT_AUTHORISED = { message: "Not authorised" };
const nothing = { studentId: 1, admission: false, smartCard: false, classMonths: [], comboDecisions: [] };
const noKey = () => {
  const f = new FormData();
  f.set("key", "ref:nope");
  f.set("reason", "x");
  return f;
};
const form = (key: string, reason: string) => {
  const f = new FormData();
  f.set("key", key);
  f.set("reason", reason);
  return f;
};

// ---- who may call what -------------------------------------------------------

for (const role of [null, "TEACHER"] as const) {
  const who = role ?? "signed-out";

  test(`${who}: every payment action is refused with "Not authorised"`, async () => {
    setSession(role);
    await assert.rejects(() => takePayment(nothing), NOT_AUTHORISED);
    await assert.rejects(() => loadPanel({ studentId: 1 }), NOT_AUTHORISED);
    await assert.rejects(() => searchStudents("a"), NOT_AUTHORISED);
    await assert.rejects(() => reprintTransaction("pay:1"), NOT_AUTHORISED);
    await assert.rejects(() => cancelTransaction({ ok: false }, noKey()), NOT_AUTHORISED);
  });
}

for (const role of ["ADMIN", "STAFF"] as const) {
  test(`${role}: gets past the payment guard (reaches the "nothing selected" check)`, async () => {
    setSession(role);
    assert.deepEqual(await takePayment(nothing), { ok: false, error: "Nothing selected to charge." });
  });

  test(`${role}: may reprint — a junk key comes back null, not an error`, async () => {
    setSession(role);
    assert.equal(await reprintTransaction("junk"), null);
  });
}

test("STAFF is refused when cancelling — at runtime, not just in the source (rule 29)", async () => {
  setSession("STAFF");
  await assert.rejects(() => cancelTransaction({ ok: false }, form("pay:12", "wrong student")), NOT_AUTHORISED);
});

test("ADMIN passes the cancel guard (it then validates the key)", async () => {
  setSession("ADMIN");
  assert.deepEqual(await cancelTransaction({ ok: false }, form("junk", "wrong student")), {
    ok: false,
    error: "Unknown transaction.",
    values: { reason: "wrong student" },
  });
});

// ---- takePayment input handling (before any query) ---------------------------

test("takePayment: a malformed request is 'Invalid payment request.'", async () => {
  setSession("ADMIN");
  const bad: unknown[] = [
    { ...nothing, studentId: 0 },
    { ...nothing, studentId: -3 },
    { ...nothing, admission: "yes" },
    { ...nothing, classMonths: [{ courseId: 1, year: 2026, month: 13 }] },
    { ...nothing, classMonths: [{ courseId: 1, year: 2026, month: 0 }] },
    { ...nothing, classMonths: [{ courseId: 0, year: 2026, month: 5 }] },
    { ...nothing, classMonths: Array.from({ length: 101 }, () => ({ courseId: 1, year: 2026, month: 5 })) },
    { ...nothing, comboDecisions: Array.from({ length: 21 }, () => ({ comboId: 1, apply: true })) },
    { ...nothing, comboDecisions: [{ comboId: 1, apply: true, reason: "x".repeat(301) }] },
  ];
  for (const input of bad) {
    assert.deepEqual(
      await takePayment(input as never),
      { ok: false, error: "Invalid payment request." },
      JSON.stringify(input).slice(0, 80),
    );
  }
});

// ---- the cancel/reprint key (regex) ------------------------------------------

const UUID = "5b1d6a52-0c1e-4d3a-9d52-7f7a1f0e2b11";
// With a valid key and a too-short reason the action stops at the reason check —
// still before any query — so the message tells us whether the KEY was accepted.
const REASON_ERROR = "A reason is required to cancel a receipt.";

async function keyVerdict(key: string): Promise<"accepted" | "rejected"> {
  setSession("ADMIN");
  const res = await cancelTransaction({ ok: false }, form(key, "no"));
  if (res.error === REASON_ERROR) return "accepted";
  assert.equal(res.error, "Unknown transaction.", key);
  return "rejected";
}

test("cancel key: a grouped receipt key (ref:<uuid>) is accepted", async () => {
  assert.equal(await keyVerdict(`ref:${UUID}`), "accepted");
  assert.equal(await keyVerdict(`  ref:${UUID}  `), "accepted"); // trimmed
});

test("cancel key: a legacy ref-less key (pay:<id>) is accepted", async () => {
  assert.equal(await keyVerdict("pay:1"), "accepted");
  assert.equal(await keyVerdict("pay:1495"), "accepted");
  assert.equal(await keyVerdict("pay:9999999999"), "accepted"); // 10 digits
});

test("cancel key: everything else is 'Unknown transaction.'", async () => {
  for (const key of [
    "",
    "pay:0",
    "pay:01",
    "pay:-1",
    "pay:12345678901", // 11 digits
    "pay:12a",
    "pay:",
    "ref:short", // under 10 chars
    `ref:${"a".repeat(65)}`, // over 64 chars
    "ref:not a uuid!!",
    UUID, // missing the ref: prefix
    "PAY:12",
    "pay:12;DROP TABLE payment",
    "transactionRef:null",
  ]) {
    assert.equal(await keyVerdict(key), "rejected", JSON.stringify(key));
  }
});

test("reprint uses the same key rule: a bad key is null before any lookup", async () => {
  setSession("STAFF");
  for (const key of ["", "pay:0", "ref:short", UUID, "pay:12;--"]) {
    assert.equal(await reprintTransaction(key), null, JSON.stringify(key));
  }
});

test("cancel echoes the typed reason back so a validation error does not wipe it (rule 14)", async () => {
  setSession("ADMIN");
  const res = await cancelTransaction({ ok: false }, form("pay:12", "  "));
  assert.deepEqual(res, { ok: false, error: REASON_ERROR, values: { reason: "  " } });
});

test("cancel: the reason is trimmed and must be at least 3 characters, at most 300", async () => {
  setSession("ADMIN");
  const short = await cancelTransaction({ ok: false }, form("pay:12", "  ab  "));
  assert.equal(short.error, REASON_ERROR);
  const long = await cancelTransaction({ ok: false }, form("pay:12", "x".repeat(301)));
  // zod's own wording — refused before any query, and the key was accepted.
  assert.equal(long.error, "Too big: expected string to have <=300 characters");
});
