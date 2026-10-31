import "@/test-support/no-database";
import { setSession } from "@/test-support/server-stubs";

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { navItemByHref } from "@/config/nav";
import { OPERATIONAL_ROLES, requireNavAccess } from "@/lib/authz";

/*
 * The two read-only actions behind the new payment screens (job 2): role guards and input
 * validation, with no database. Each is its own HTTP endpoint, so each is guarded on its
 * own (AGENTS rule 10), and refusals are asserted by content (rule 30).
 */

let actions: typeof import("@/app/(app)/payment-new/actions");

// `no-database` points the client at an unresolvable host: nothing below can reach a real one.
describe("new payment screens: read-only actions", () => {
  before(async () => {
    actions = await import("@/app/(app)/payment-new/actions");
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

  // ---- the actions use the SAME guard as the screens -----------------------------------------

  test("the actions' role set is exactly the screen's: /payment's nav entry is ADMIN + STAFF, as is OPERATIONAL_ROLES", () => {
    const screen = [...(navItemByHref("/payment")?.roles ?? [])].sort();
    assert.deepEqual(screen, [...OPERATIONAL_ROLES].sort());
    assert.deepEqual(screen, ["ADMIN", "STAFF"]);
  });

  test("for every role the screen guard and both actions allow, or refuse, together", async () => {
    for (const role of ["ADMIN", "STAFF", "TEACHER", null] as const) {
      setSession(role);
      const screen = await requireNavAccess("/payment").then(() => true, () => false);
      const identify = await actions.identifyStudent({}).then(() => true, () => false);
      // month 13 fails validation, so an allowed role is answered with null and nothing reaches a database.
      const detail = await actions.loadMonthDetail({ studentId: 1, courseId: 1, year: 2026, month: 13 }).then(() => true, () => false);
      assert.deepEqual([identify, detail], [screen, screen], String(role));
    }
  });
});
