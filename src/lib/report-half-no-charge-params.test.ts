import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

let lib: typeof import("@/lib/report-half-no-charge");
const NOW = { year: 2026, month: 11 };

/*
 * Job 5 review F5: the admin view's month parameter. Pure — no database.
 */
describe("parseMonthParam", () => {
  before(async () => {
    lib = await import("@/lib/report-half-no-charge");
  });

  test("a real month between 2000 and 2100 is taken as is", () => {
    for (const [raw, year, month] of [["2026-10", 2026, 10], ["2000-01", 2000, 1], ["2100-12", 2100, 12], ["2026-01", 2026, 1], ["2026-12", 2026, 12]] as const) {
      assert.deepEqual(lib.parseMonthParam(raw, NOW), { year, month }, raw);
    }
  });

  test("well-formed years outside 2000-2100 are junk: the date maths cannot build them, so they mean 'the current month'", () => {
    for (const raw of ["0999-05", "0000-01", "1999-12", "2101-01", "9999-12", "0001-06"]) assert.deepEqual(lib.parseMonthParam(raw, NOW), NOW, raw);
  });

  test("anything that is not YYYY-MM with a real month is junk", () => {
    for (const raw of [undefined, "", "garbage", "2026-13", "2026-00", "2026-1", "26-10", "2026/10", "2026-10-01", " 2026-10", "2026-10 ", "10000-01", "2026-1e", "<b>"]) {
      assert.deepEqual(lib.parseMonthParam(raw, NOW), NOW, String(raw));
    }
  });

  test("the fallback is returned as given (the caller decides what 'current' is)", () => {
    assert.deepEqual(lib.parseMonthParam("nope", { year: 2030, month: 2 }), { year: 2030, month: 2 });
  });
});

/*
 * Job 5 review F10: how a person who recorded a month is NAMED. Pure.
 */
describe("takerName", () => {
  before(async () => {
    lib = await import("@/lib/report-half-no-charge");
  });
  const user = (role: string, staff: string | null = null) => ({ username: "sam", role, staff: staff ? { name: staff } : null });

  test("a current ADMIN or STAFF login: their Staff record's name, else their username", () => {
    assert.equal(lib.takerName("u1", user("STAFF", "Sadun Staff")), "Sadun Staff");
    assert.equal(lib.takerName("u1", user("ADMIN")), "sam");
    assert.equal(lib.takerName("u1", user("STAFF")), "sam");
  });

  test("anyone who no longer holds one of those logins is still named, with a small '(former role)' hint", () => {
    assert.equal(lib.takerName("u2", user("TEACHER", "Gus Former")), "Gus Former (former role)");
    assert.equal(lib.takerName("u2", user("TEACHER")), "sam (former role)");
  });

  test("a user that cannot be found at all reads 'Unknown user (#id)'", () => {
    assert.equal(lib.takerName("cl123abc", null), "Unknown user (#cl123abc)");
    assert.equal(lib.takerName("cl123abc", undefined), "Unknown user (#cl123abc)");
  });

  test("it is never a dash and never empty", () => {
    for (const u of [user("STAFF"), user("TEACHER"), null, undefined]) {
      const name = lib.takerName("id", u);
      assert.ok(name.length > 0 && !name.includes("—") && name !== "-");
    }
  });
});
