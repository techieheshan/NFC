import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { NAV_ITEMS, navFor, navSectionsFor } from "@/config/nav";

const keys = (role: Parameters<typeof navFor>[0], surface: Parameters<typeof navFor>[1]) =>
  navFor(role, surface).map((i) => i.key);

test("dashboard tiles show the agreed order, with Hall Allocation last", () => {
  assert.deepEqual(keys("ADMIN", "terminal"), [
    "attendance",
    "payment",
    "registration",
    "search",
    "daily-attendance",
    "daily-summary",
    "schedules",
    "expenses",
    "reports",
    "my-students",
    "receipts",
    "payslips",
    "settings",
    "hall-allocation",
  ]);
});

test("burger and sidebar: counter work first, User Roles then Hall Allocation very last", () => {
  const order = keys("ADMIN", "desktop");
  assert.deepEqual(order.slice(0, 10), [
    "dashboard", // the home link, pinned on top; not one of the twelve modules
    "attendance",
    "payment",
    "registration",
    "search",
    "daily-attendance",
    "daily-summary",
    "schedules",
    "expenses",
    "reports",
  ]);
  assert.deepEqual(order.slice(-2), ["user-roles", "hall-allocation"]);
});

test("the Setup group stays together, under one heading, before the last two", () => {
  const sections = navSectionsFor("ADMIN");
  const setup = sections.filter((s) => s.heading === "Setup");
  assert.equal(setup.length, 1, "Setup must be one contiguous section");
  assert.deepEqual(
    setup[0].items.map((i) => i.key),
    ["subjects", "grades", "teachers", "courses", "combine-payment", "streams", "halls"],
  );
  const flat = sections.flatMap((s) => s.items.map((i) => i.key));
  assert.ok(flat.indexOf("halls") < flat.indexOf("user-roles"));
});

test("one config: the tiles are the burger's items, in the same relative order", () => {
  const desktop = keys("ADMIN", "desktop");
  const tiles = keys("ADMIN", "terminal").filter((k) => desktop.includes(k));
  const sameOrderInDesktop = desktop.filter((k) => tiles.includes(k));
  assert.deepEqual(tiles, sameOrderInDesktop);
  // …and both are subsequences of the ONE array, never a second ordering.
  const master = NAV_ITEMS.map((i) => i.key);
  for (const list of [keys("ADMIN", "terminal"), desktop]) {
    let at = -1;
    for (const k of list) {
      const next = master.indexOf(k);
      assert.ok(next > at, `${k} is out of NAV_ITEMS order`);
      at = next;
    }
  }
});

test("section keys are unique, so React never sees a duplicate key", () => {
  for (const role of ["ADMIN", "STAFF", "TEACHER"] as const) {
    const ks = navSectionsFor(role).map((s) => s.key);
    assert.equal(new Set(ks).size, ks.length, `${role}: ${ks.join(",")}`);
  }
});

test("a role that sees no Setup item never sees the Setup heading", () => {
  assert.equal(navSectionsFor("TEACHER").some((s) => s.heading === "Setup"), false);
});

test("STAFF: reprints stay, but the menu does not advertise Cancel, and User Roles is gone", () => {
  const staff = navFor("STAFF", "desktop");
  const receipts = staff.find((i) => i.key === "receipts");
  assert.ok(receipts, "staff reprint receipts, so the route stays (AGENTS rule 29)");
  assert.equal(receipts.label, "Receipts");
  assert.equal(
    staff.some((i) => /cancel/i.test(i.label)),
    false,
    "no staff-visible menu label mentions Cancel",
  );
  assert.equal(staff.some((i) => i.key === "user-roles"), false);
});

test("ADMIN keeps the long label, so the cancel control stays discoverable", () => {
  const receipts = navFor("ADMIN", "desktop").find((i) => i.key === "receipts");
  assert.equal(receipts?.label, "Receipts & Cancel");
});

test("TEACHER keeps only the scoped views and never sees receipts or money screens", () => {
  const teacher = keys("TEACHER", "desktop");
  for (const forbidden of ["receipts", "payment", "daily-summary", "user-roles", "expenses", "settings"]) {
    assert.equal(teacher.includes(forbidden), false, `teacher must not see ${forbidden}`);
  }
  for (const wanted of ["my-students", "daily-attendance", "reports", "payslips"]) {
    assert.equal(teacher.includes(wanted), true, `teacher should still see ${wanted}`);
  }
});

test("cancelling a payment is refused for anyone but ADMIN on the SERVER, not just hidden", () => {
  // The button being absent is a courtesy; this is the boundary. Read the action
  // and require that its first act is the ADMIN-only role guard.
  const src = readFileSync("src/app/(app)/receipts/actions.ts", "utf8");
  const body = src.slice(src.indexOf("export async function cancelTransaction"));
  const firstAwait = body.slice(body.indexOf("{"), body.indexOf("await") + 60);
  assert.match(firstAwait, /requireRole\(\["ADMIN"\]\)/);
  assert.doesNotMatch(body.slice(0, body.indexOf("requireRole")), /db\./, "no database work before the guard");
});
