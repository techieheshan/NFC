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
 * Since the menu switch the new screens are open to ADMIN + STAFF (what the old /payment allowed),
 * through ONE constant (`PAYMENT_NEW_ROLES`, a copy of OPERATIONAL_ROLES). TEACHER and a signed-out
 * visitor are refused. The expectations below follow that constant.
 */

let actions: typeof import("@/app/(app)/payment-new/actions");
let access: typeof import("@/app/(app)/payment-new/access");

// `no-database` points the client at an unresolvable host: nothing below can reach a real one.
describe("new payment screens: read-only actions", () => {
  before(async () => {
    actions = await import("@/app/(app)/payment-new/actions");
    access = await import("@/app/(app)/payment-new/access");
  });

  for (const role of [null, "TEACHER"] as const) {
    test(`${role ?? "signed-out"}: both actions are refused with "Not authorised"`, async () => {
      setSession(role);
      await assert.rejects(() => actions.identifyStudent({ cardUid: "04A1B2C3" }), { message: "Not authorised" });
      await assert.rejects(() => actions.loadMonthDetail({ studentId: 1, courseId: 1, year: 2026, month: 10 }), { message: "Not authorised" });
    });
  }

  for (const role of ["ADMIN", "STAFF"] as const) {
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

  test("the new screens are open to ADMIN + STAFF — the one constant says so, and it is a COPY of OPERATIONAL_ROLES", () => {
    assert.deepEqual([...access.PAYMENT_NEW_ROLES].sort(), ["ADMIN", "STAFF"]);
    assert.deepEqual([...access.PAYMENT_NEW_ROLES].sort(), [...OPERATIONAL_ROLES].sort());
    assert.notEqual(access.PAYMENT_NEW_ROLES, OPERATIONAL_ROLES, "a copy: changing one can never change the shared array");
  });

  test("the menu's Payment entry opens the new screen for ADMIN + STAFF; the old /payment address is no longer a menu entry", () => {
    const entry = navItemByHref("/payment-new");
    assert.equal(entry?.key, "payment");
    assert.equal(entry?.label, "Payment");
    assert.deepEqual([...(entry?.roles ?? [])].sort(), ["ADMIN", "STAFF"]);
    assert.deepEqual([...(entry?.roles ?? [])].sort(), [...access.PAYMENT_NEW_ROLES].sort());
    // requireNavAccess("/payment") looks the address up in the menu: with no entry the old page answers not-found to everyone.
    assert.equal(navItemByHref("/payment"), undefined);
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
    for (const role of ["TEACHER", null] as const) {
      setSession(role);
      await assert.rejects(() => access.requirePaymentNewPage(), { message: "NEXT_NOT_FOUND" }, String(role));
    }
    for (const role of ["ADMIN", "STAFF"] as const) {
      setSession(role);
      assert.equal((await access.requirePaymentNewPage()).role, role);
    }
  });

  test("the guard follows the constant: with STAFF removed from it, STAFF is refused everywhere at once (and the shared OPERATIONAL_ROLES is untouched)", async () => {
    const original = [...access.PAYMENT_NEW_ROLES];
    try {
      access.PAYMENT_NEW_ROLES.splice(access.PAYMENT_NEW_ROLES.indexOf("STAFF"), 1); // the one-line revert of the menu switch
      setSession("STAFF");
      assert.equal(await access.requirePaymentNewPage().then(() => true, () => false), false);
      await assert.rejects(() => actions.identifyStudent({}), { message: "Not authorised" });
      await assert.rejects(() => actions.loadMonthDetail({ studentId: 1, courseId: 1, year: 2026, month: 13 }), { message: "Not authorised" });
      assert.deepEqual([...OPERATIONAL_ROLES], ["ADMIN", "STAFF"]);
      setSession("ADMIN");
      assert.equal(await access.requirePaymentNewPage().then(() => true, () => false), true);
    } finally {
      access.PAYMENT_NEW_ROLES.splice(0, access.PAYMENT_NEW_ROLES.length, ...original);
    }
    setSession("STAFF");
    assert.equal(await access.requirePaymentNewPage().then(() => true, () => false), true); // restored
  });
});
