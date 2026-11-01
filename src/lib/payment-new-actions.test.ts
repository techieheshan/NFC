import "@/test-support/no-database";
import { setSession } from "@/test-support/server-stubs";

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { navItemByHref } from "@/config/nav";
import { OPERATIONAL_ROLES } from "@/lib/authz";

/*
 * The two read-only actions and the two pages behind the new payment screens: role guards
 * and input validation, with no database. Each action is its own HTTP endpoint, so each is
 * guarded on its own (AGENTS rule 10), and refusals are asserted by content (rule 30).
 *
 * The new screens are ADMIN ONLY until the menu switch, through ONE constant
 * (`PAYMENT_NEW_ROLES`). At the switch it is flipped to OPERATIONAL_ROLES and the
 * expectations marked "FLIP" below change with it.
 */

let actions: typeof import("@/app/(app)/payment-new/actions");
let access: typeof import("@/app/(app)/payment-new/access");

// `no-database` points the client at an unresolvable host: nothing below can reach a real one.
describe("new payment screens: read-only actions", () => {
  before(async () => {
    actions = await import("@/app/(app)/payment-new/actions");
    access = await import("@/app/(app)/payment-new/access");
  });

  for (const role of [null, "TEACHER", "STAFF"] as const) { // FLIP: STAFF moves to the allowed list
    test(`${role ?? "signed-out"}: both actions are refused with "Not authorised"`, async () => {
      setSession(role);
      await assert.rejects(() => actions.identifyStudent({ cardUid: "04A1B2C3" }), { message: "Not authorised" });
      await assert.rejects(() => actions.loadMonthDetail({ studentId: 1, courseId: 1, year: 2026, month: 10 }), { message: "Not authorised" });
    });
  }

  for (const role of ["ADMIN"] as const) { // FLIP: add "STAFF"
    test(`${role}: bad input is answered with null before any lookup`, async () => {
      setSession(role);
      assert.equal(await actions.identifyStudent({}), null);
      assert.equal(await actions.identifyStudent({ cardUid: "x".repeat(101) }), null);
      for (const bad of [
        { studentId: 0, courseId: 1, year: 2026, month: 10 },
        { studentId: 1, courseId: -1, year: 2026, month: 10 },
        { studentId: 1, courseId: 1, year: 1999, month: 10 },
        { studentId: 1, courseId: 1, year: 2026, month: 13 },
        { studentId: 1, courseId: 1, year: 2026, month: 0 },
        { studentId: 1.5, courseId: 1, year: 2026, month: 10 },
      ]) {
        assert.equal(await actions.loadMonthDetail(bad), null, JSON.stringify(bad));
      }
    });
  }

  // ---- one constant, used by the pages and by both actions ----------------------------------------

  test("FLIP: the new screens are ADMIN only — the one constant says so", () => {
    assert.deepEqual(access.PAYMENT_NEW_ROLES, ["ADMIN"]);
  });

  test("the OLD screen is not affected: /payment is still ADMIN + STAFF (the old screen and its menu entry are untouched)", () => {
    const old = [...(navItemByHref("/payment")?.roles ?? [])].sort();
    assert.deepEqual(old, [...OPERATIONAL_ROLES].sort());
    assert.deepEqual(old, ["ADMIN", "STAFF"]);
  });

  test("for every role the page guard and BOTH actions allow, or refuse, together", async () => {
    for (const role of ["ADMIN", "STAFF", "TEACHER", null] as const) {
      setSession(role);
      const page = await access.requirePaymentNewPage().then(() => true, () => false);
      const identify = await actions.identifyStudent({}).then(() => true, () => false);
      // month 13 fails validation, so an allowed role is answered with null and nothing reaches a database.
      const detail = await actions.loadMonthDetail({ studentId: 1, courseId: 1, year: 2026, month: 13 }).then(() => true, () => false);
      assert.deepEqual([identify, detail], [page, page], String(role));
    }
  });

  test("the page guard answers a refused role with the not-found screen, never with content", async () => {
    for (const role of ["STAFF", "TEACHER", null] as const) {
      setSession(role);
      await assert.rejects(() => access.requirePaymentNewPage(), { message: "NEXT_NOT_FOUND" }, String(role));
    }
    setSession("ADMIN");
    assert.equal((await access.requirePaymentNewPage()).role, "ADMIN");
  });

  test("the guard follows the constant: with STAFF added to it, STAFF is allowed everywhere at once", async () => {
    const original = [...access.PAYMENT_NEW_ROLES];
    try {
      access.PAYMENT_NEW_ROLES.push("STAFF"); // what the menu switch will do, in one line
      setSession("STAFF");
      assert.equal(await access.requirePaymentNewPage().then(() => true, () => false), true);
      assert.equal(await actions.identifyStudent({}), null); // allowed through, answered with null
      assert.equal(await actions.loadMonthDetail({ studentId: 1, courseId: 1, year: 2026, month: 13 }), null);
      setSession("TEACHER");
      assert.equal(await access.requirePaymentNewPage().then(() => true, () => false), false);
    } finally {
      access.PAYMENT_NEW_ROLES.splice(0, access.PAYMENT_NEW_ROLES.length, ...original);
    }
    setSession("STAFF");
    assert.equal(await access.requirePaymentNewPage().then(() => true, () => false), false); // restored
  });
});
