import { dbSkip, openTestDatabase, seedWorld, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";

import { pickSigner, splitSigners, type SignerUser } from "@/app/(app)/daily-summary/signer-lists";

/*
 * Daily Summary R1, rule 24: Prepared by = any active ADMIN or STAFF; Checked by = active ADMIN ONLY.
 * The rule is a pure function (tested against hand-made account sets) AND enforced in the server action
 * against a real database, including a deactivated admin and a refused TEACHER.
 */

const u = (id: string, role: string, extra: Partial<SignerUser> = {}): SignerUser => ({ id, username: id, role, ...extra });

test("an ADMIN and STAFF account set: Prepared by offers both, Checked by only the admin", () => {
  const r = splitSigners([u("a1", "ADMIN", { staff: { name: "Nadeesha" } }), u("s1", "STAFF", { staff: { name: "Sadun" } }), u("s2", "STAFF")]);
  assert.deepEqual(r.prepared.map((s) => s.name), ["Nadeesha", "Sadun", "s2"]);
  assert.deepEqual(r.checked.map((s) => s.name), ["Nadeesha"]);
  assert.ok(r.checked.every((s) => s.role === "ADMIN"));
});

test("a STAFF-only account set: nobody can check (the list is empty, never a staff fallback)", () => {
  const r = splitSigners([u("s1", "STAFF"), u("s2", "STAFF")]);
  assert.equal(r.prepared.length, 2);
  assert.deepEqual(r.checked, []);
});

test("an ADMIN-only account set: the admin can prepare and check", () => {
  const r = splitSigners([u("a1", "ADMIN"), u("a2", "ADMIN")]);
  assert.equal(r.prepared.length, 2);
  assert.equal(r.checked.length, 2);
});

test("a TEACHER row is never offered, even if one reaches the function", () => {
  const r = splitSigners([u("t1", "TEACHER"), u("a1", "ADMIN")]);
  assert.deepEqual(r.prepared.map((s) => s.id), ["a1"]);
  assert.deepEqual(r.checked.map((s) => s.id), ["a1"]);
});

test("pickSigner resolves an id only inside the list it is given; junk, repeats and stale ids are nobody", () => {
  const { checked } = splitSigners([u("a1", "ADMIN"), u("s1", "STAFF")]);
  assert.equal(pickSigner(checked, "a1")?.id, "a1");
  assert.equal(pickSigner(checked, "s1"), null); // a staff id in the admin-only list
  for (const bad of [undefined, null, 5, "", "nope", ["a1"], { id: "a1" }, "a1 ", "A1"]) assert.equal(pickSigner(checked, bad), null);
});

describe("listSigners against a real database", { skip: dbSkip }, () => {
  let handle: TestDatabase;
  let db: PrismaClient;
  let w: World;
  let listSigners: typeof import("@/app/(app)/daily-summary/actions").listSigners;

  before(async () => {
    handle = await openTestDatabase();
    ({ db } = await import("@/lib/db"));
    ({ listSigners } = await import("@/app/(app)/daily-summary/actions"));
    w = await seedWorld(db);
    await db.user.create({ data: { username: "gone-admin", passwordHash: "x", role: "ADMIN", active: false } });
    await db.user.create({ data: { username: "gone-staff", passwordHash: "x", role: "STAFF", active: false } });
    await db.user.create({ data: { username: "a-teacher", passwordHash: "x", role: "TEACHER" } });
  });
  after(async () => {
    await db.$disconnect();
    await handle.drop();
  });

  test("ADMIN and STAFF both read the lists; Checked by has the active admin only; inactive and teacher accounts are absent", async () => {
    for (const who of ["ADMIN", "STAFF"] as const) {
      setSession(who, who === "ADMIN" ? w.admin.id : w.staff.id);
      const r = await listSigners();
      assert.deepEqual(r.checked.map((s) => s.id), [w.admin.id], who);
      assert.deepEqual(new Set(r.prepared.map((s) => s.id)), new Set([w.admin.id, w.staff.id]), who);
      assert.ok(!r.prepared.some((s) => /gone|teacher/.test(s.name)), who);
    }
  });

  test("a STAFF-only institute: Checked by is empty", async () => {
    await db.user.update({ where: { id: w.admin.id }, data: { active: false } });
    setSession("STAFF", w.staff.id);
    const r = await listSigners();
    assert.deepEqual(r.checked, []);
    assert.deepEqual(r.prepared.map((s) => s.id), [w.staff.id]);
    await db.user.update({ where: { id: w.admin.id }, data: { active: true } });
  });

  test("a TEACHER (or nobody) is refused by the action itself", async () => {
    setSession("TEACHER", "t");
    await assert.rejects(() => listSigners(), /Not authorised/);
    setSession(null);
    await assert.rejects(() => listSigners(), /Not authorised/);
  });
});
