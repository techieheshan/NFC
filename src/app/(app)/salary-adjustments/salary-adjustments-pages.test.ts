import { dbSkip, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrismaClient } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";

/*
 * The salary-adjustment screens and the payslip surfaces they feed, RENDERED against a real (throw-away) database with made-up data.
 * A refusal is proven by what comes back (AGENTS 30): the page throws NEXT_NOT_FOUND and the data is simply absent.
 * A teacher sees only their own lines, and only for the last completed month.
 */

const NOW = "2026-11-16T06:00:00Z";
type Q = Record<string, string | string[] | undefined>;
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let listPage: unknown;
let newPage: unknown;
let noticePage: unknown;
let staffPage: unknown;
let voucherPage: unknown;
let payslipsPage: unknown;
let A: typeof import("./actions");
let t1: number;
let t2: number;
let teacherUserId: string;
let adjustmentId: number;

const plain = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<!-- -->/g, "");
const render = async (P: unknown, props: Record<string, unknown> = {}) => plain(renderToStaticMarkup((await (P as (a: Record<string, unknown>) => Promise<React.ReactElement>)({ searchParams: Promise.resolve({}), ...props })) as React.ReactElement));
const q = (o: Q) => ({ searchParams: Promise.resolve(o) });

describe("salary adjustment screens (rendered)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("./actions");
    ({ default: listPage } = await import("./page"));
    ({ default: newPage } = await import("./new/page"));
    ({ default: noticePage } = await import("./[id]/notice/page"));
    ({ default: staffPage } = await import("./staff/page"));
    ({ default: voucherPage } = await import("@/app/(app)/payslips/voucher/page"));
    ({ default: payslipsPage } = await import("@/app/(app)/payslips/page"));
    w = await seedWorld(db);
    const xenon = await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } });
    const a = await makeTeacher(db, "Teacher One");
    const b = await makeTeacher(db, "Teacher Two");
    t1 = a.id;
    t2 = b.id;
    teacherUserId = (await db.user.create({ data: { username: "t-one", passwordHash: "x", role: "TEACHER", teacherId: a.id } })).id;
    const staff = await db.staff.create({ data: { name: "Staff A" } });
    for (const t of [a, b]) {
      const course = await makeCourse(db, w, { teacherId: t.id, fee: "10000.00", share: "20.00" });
      const student = await makeStudent(db);
      await db.payment.create({ data: { kind: "CLASS", studentId: student.id, courseId: course.id, amount: "10000.00", billingYear: 2026, billingMonth: 11, takenById: w.staff.id, paidAt: new Date("2026-11-05T05:00:00Z"), instituteSharePercentApplied: "20.00" } });
    }
    const e = await db.expense.create({ data: { expenseTypeId: xenon.id, amount: "100000.00", reason: "Class t-shirts", date: colomboDateValue("2026-11-10"), recordedById: w.staff.id, authorizedById: w.admin.id } });
    setSession("ADMIN", w.admin.id);
    const r = await A.createSalaryAdjustment({
      kind: "SHARED_EXPENSE", sourceId: e.id, title: "T-shirts", month: "2026-11", splitMode: "CUSTOM",
      people: [{ key: `t${t1}`, amount: "25000" }, { key: `t${t2}`, amount: "15000" }, { key: `s${staff.id}`, amount: "10000" }],
      consentNote: "Agreed in the staff meeting", consentOn: "2026-11-10",
    });
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) adjustmentId = r.id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  test("STAFF, TEACHER and a visitor get not-found on every salary-adjustment screen, and none of the pay data", async () => {
    for (const [role, id] of [["STAFF", w.staff.id], ["TEACHER", teacherUserId], [null, "nobody"]] as const) {
      setSession(role, id);
      await assert.rejects(() => render(listPage), /NEXT_NOT_FOUND/);
      await assert.rejects(() => render(newPage), /NEXT_NOT_FOUND/);
      await assert.rejects(() => render(noticePage, { params: Promise.resolve({ id: String(adjustmentId) }) }), /NEXT_NOT_FOUND/);
      await assert.rejects(() => render(staffPage), /NEXT_NOT_FOUND/);
    }
  });

  test("ADMIN sees the list with what people pay and what Xenon bears; junk months fall back to this month", async () => {
    setSession("ADMIN", w.admin.id);
    const h = await render(listPage);
    for (const t of ["T-shirts", "Shared expense", "Teacher One", "Teacher Two", "Staff A", "Agreed in the staff meeting", "100,000.00", "50,000.00"]) assert.ok(h.includes(t), t);
    assert.ok((await render(listPage, q({ month: "banana" }))).includes("T-shirts"), "junk month = this month");
    assert.ok((await render(listPage, q({ month: "2026-10" }))).includes("No salary adjustments in Oct 2026"));
  });

  test("the notice names every person, what they pay and the consent; a junk id is not-found", async () => {
    setSession("ADMIN", w.admin.id);
    const h = await render(noticePage, { params: Promise.resolve({ id: String(adjustmentId) }) });
    for (const t of ["Notice of salary adjustment", "Teacher One", "25,000.00", "Teacher Two", "15,000.00", "Staff A", "10,000.00", "Xenon bears 50,000.00", "Signature"]) assert.ok(h.includes(t), t);
    for (const bad of ["0", "abc", "-1", "99999"]) await assert.rejects(() => render(noticePage, { params: Promise.resolve({ id: bad }) }), /NEXT_NOT_FOUND/, bad);
  });

  test("the staff list: staff lines and the net, and no teacher on it", async () => {
    setSession("ADMIN", w.admin.id);
    const h = await render(staffPage, q({ month: "2026-11" }));
    assert.ok(h.includes("Staff A") && h.includes("-10,000.00") && h.includes("net for the month"));
    assert.ok(!h.includes("Teacher One"));
    assert.ok((await render(staffPage, q({ month: "2026-10" }))).includes("No staff deductions or bonuses"));
  });

  test("the payslip screen and the printed voucher show the adjustment line; a negative slip says 'Owes Xenon'", async () => {
    setSession("ADMIN", w.admin.id);
    const screen = await render(payslipsPage, q({ month: "2026-11" }));
    assert.ok(screen.includes("Adjustment: T-shirts"));
    assert.ok(screen.includes("Owes Xenon 17000.00"), "8,000.00 - 25,000.00 = -17,000.00");
    assert.ok(screen.includes("Recovered from teachers and staff (salary adjustments)"));
    const v = await render(voucherPage, q({ month: "2026-11", teacherId: String(t1) }));
    assert.ok(v.includes("Salary adjustments") && v.includes("agreed 2026-11-10") && v.includes("Owes Xenon 17000.00"));
    // the all-teachers voucher run includes a teacher whose only line is an adjustment
    assert.ok((await render(voucherPage, q({ month: "2026-11" }))).includes("Teacher Two"));
  });

  test("a TEACHER sees only their own adjustment line, and only once the month is completed", async () => {
    setSession("TEACHER", teacherUserId);
    freezeClock("2026-12-02T06:00:00Z");
    try {
      const h = await render(payslipsPage);
      assert.ok(h.includes("Adjustment: T-shirts") && h.includes("Owes Xenon"));
      assert.ok(!h.includes("Teacher Two") && !h.includes("Staff A") && !h.includes("Recovered from teachers"), "no other person and no institute figure");
    } finally {
      freezeClock(NOW);
    }
  });
});
