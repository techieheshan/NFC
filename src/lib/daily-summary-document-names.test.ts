import { dbSkip, enrol, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

import { buildDocModel } from "@/app/(app)/daily-summary/document/model";
import { parseTypedState } from "@/app/(app)/daily-summary/typed-state";

/*
 * Daily Summary R1: the document prints names EXACTLY as they are stored. This is the proof that no name source on the
 * document adds a role hint of its own: real stored names go in through the real loaders (loadDayBundle, dailySummary,
 * collectedByStaff, listSigners' split) and the same strings come out on the model — including a stored name that itself
 * contains a bracket, which must NOT be trimmed.
 */

const STORED = {
  admin: "Nadeesha",
  admin2: "Ruwan (Admin)", // someone typed the hint into the stored name: it is the stored name, so it prints
  staff: "Sadun",
  staff2: "තිලිණි පෙරේරා",
  staffPerson: "Chathura (Staff)",
  teacher: "සුනිල් ගුණසේන මහතා (Maths)",
};

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let bundle: typeof import("@/app/(app)/daily-summary/bundle");

describe("document names against real stored names", { skip: dbSkip }, () => {
  let usernameOnly: { id: string; username: string };
  let staffUser: { id: string };
  let staffUser2: { id: string };
  let adminUser2: { id: string };

  before(async () => {
    handle = await openTestDatabase();
    freezeClock("2026-10-20T06:00:00Z");
    ({ db } = await import("@/lib/db"));
    bundle = await import("@/app/(app)/daily-summary/bundle");
    w = await seedWorld(db);
    const st = (name: string) => db.staff.create({ data: { name } });
    await db.user.update({ where: { id: w.admin.id }, data: { username: "adm", staffId: (await st(STORED.admin)).id } });
    await db.user.update({ where: { id: w.staff.id }, data: { username: "stf", staffId: (await st(STORED.staff)).id } });
    staffUser = w.staff;
    adminUser2 = await db.user.create({ data: { username: "adm2", passwordHash: "x", role: "ADMIN", staffId: (await st(STORED.admin2)).id } });
    staffUser2 = await db.user.create({ data: { username: "stf2", passwordHash: "x", role: "STAFF", staffId: (await st(STORED.staff2)).id } });
    usernameOnly = await db.user.create({ data: { username: "login.only", passwordHash: "x", role: "STAFF" } }); // no Staff record: the username is the name
    const person = await st(STORED.staffPerson);
    const teacher = await makeTeacher(db, STORED.teacher);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "1000", name: "Names Course" });
    await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } });
    const xenon = await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } });
    const adv = await db.expenseType.findFirstOrThrow({ where: { code: "TEACHER_ADVANCE" } });
    const exp = (o: Record<string, unknown>) => db.expense.create({ data: { amount: "100.00", reason: "r", date: new Date("2026-10-14T00:00:00Z"), recordedById: w.admin.id, ...o } as never });
    await exp({ expenseTypeId: adv.id, teacherId: teacher.id, authorizedById: adminUser2.id }); // person = teacher; authorised by a user whose Staff name has a bracket
    await exp({ expenseTypeId: xenon.id, isStaffAdvance: true, staffId: person.id, authorizedById: usernameOnly.id }); // person = staff; authorised by a username-only login
    await exp({ expenseTypeId: xenon.id, authorizedById: staffUser2.id });
    const pay = async (by: string, at: string) => {
      const s = await makeStudent(db, { admissionPaid: true });
      await enrol(db, { studentId: s.id, courseId: course.id, tierId: w.tiers.FULL.id, since: "2026-08-05T06:00:00Z" });
      await db.payment.create({ data: { kind: "CLASS", studentId: s.id, amount: "1000.00", paidAt: new Date(at), takenById: by, courseId: course.id, billingYear: 2026, billingMonth: 10, feeTierId: w.tiers.FULL.id, transactionRef: `R-${at}-${by}` } });
    };
    await pay(staffUser.id, "2026-10-14T04:00:00Z");
    await pay(staffUser2.id, "2026-10-14T05:00:00Z");
    await pay(usernameOnly.id, "2026-10-14T06:00:00Z");
    await pay(adminUser2.id, "2026-10-14T07:00:00Z");
    unfreezeClock();
    freezeClock("2026-11-01T15:48:00Z");
  });
  after(async () => {
    unfreezeClock();
    await db.$disconnect();
    await handle.drop();
  });

  const modelFor = async (sessionUserId: string, role: "ADMIN" | "STAFF", prep: string, chk: string) => {
    setSession(role, sessionUserId);
    const b = await bundle.loadDayBundle("2026-10-14");
    const typed = parseTypedState({ prep, chk }, b.signers);
    assert.ok(typed.prepared && typed.checked, "both signers resolve");
    const model = buildDocModel({
      report: b.report, cancelled: b.cancelled, generated: { date: "2026-11-01", time: "21:18" }, generatedBy: b.generatedBy,
      day: { staff: b.staff, bringForwardCents: 0, bank: [], preparedBy: typed.prepared!.name, checkedBy: typed.checked!.name },
    });
    return { b, model };
  };

  test("EVERY name source on the document prints exactly what is stored (signers, generated-by, deduction person and authoriser, staff table)", async () => {
    const { model } = await modelFor(staffUser.id, "STAFF", staffUser2.id, adminUser2.id);
    assert.equal(model.preparedBy, STORED.staff2, "Prepared by: the stored Sinhala name");
    assert.equal(model.checkedBy, STORED.admin2, "Checked by: the stored name WITH its bracket, untouched");
    assert.equal(model.generatedBy, STORED.staff, "Generated by: the signed-in person's stored name");
    const byKind = Object.fromEntries(model.deductions.map((d) => [d.kind, d]));
    assert.equal(byKind["Teacher advance"].person, STORED.teacher, "a teacher's stored name, bracket and Sinhala included");
    assert.equal(byKind["Teacher advance"].authorizedBy, STORED.admin2, "authorised by: a stored Staff name with a bracket");
    assert.equal(byKind["Staff advance"].person, STORED.staffPerson, "a staff person's stored name, bracket included");
    assert.equal(byKind["Staff advance"].authorizedBy, "login.only", "authorised by a login with no Staff record: the username");
    assert.equal(byKind["Xenon"].authorizedBy, STORED.staff2);
    assert.deepEqual(model.staff.map((r) => r.name).sort(), [STORED.admin2, STORED.staff, STORED.staff2, "login.only"].sort(), "the collected-by-staff table: stored names and a username");
  });

  test("an admin who has no Staff record and signs in: Generated by is the username, as stored", async () => {
    // (the seed admin has a Staff record; use the username-only STAFF login as the signed-in person)
    const { model } = await modelFor(usernameOnly.id, "STAFF", staffUser.id, w.admin.id);
    assert.equal(model.generatedBy, "login.only");
    assert.equal(model.preparedBy, STORED.staff);
    assert.equal(model.checkedBy, STORED.admin);
  });

  test("no code in the document's name pipeline appends a role hint of its own (the screen's Prepared-by option text is the only place)", () => {
    const root = path.join(process.cwd(), "src", "app", "(app)", "daily-summary");
    const files = ["bundle.ts", "signer-lists.ts", "document/model.ts", "document/blocks.tsx", "document/document-view.tsx", "document/page.tsx"].map((f) => [f, readFileSync(path.join(root, f), "utf8")] as const);
    for (const [f, src] of files) {
      assert.ok(!/\((?:Admin|Staff|Administrator)\)/.test(src), `${f} has no role-hint text`);
      assert.ok(!/plainName/.test(src), `${f} no longer trims names`);
    }
    for (const f of ["src/lib/reports.ts", "src/lib/daily-summary-extras.ts"]) {
      const src = readFileSync(path.join(process.cwd(), f), "utf8");
      assert.ok(!/\((?:Admin|Staff|Administrator)\)/.test(src), `${f} adds no role hint to a name`);
    }
  });
});
