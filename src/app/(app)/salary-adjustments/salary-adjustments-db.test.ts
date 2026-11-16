import { dbSkip, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";

/*
 * Salary adjustments against a real (throw-away) database, made-up data only. The rules under test:
 *  - ADMIN only, reads included (replayed with STAFF, TEACHER and no session, next to an ADMIN control: AGENTS 10 and 29);
 *  - the money: 100,000 expense, 50,000 shared by two teachers -> each payslip -25,000, the roll-up's profit change is -(expense)+(recovered),
 *    the Daily Summary still shows the 100,000 once; a bonus is PLUS on the pay and reduces profit;
 *  - past months are locked (create refused, cancel refused once the month is over); cancel keeps the row and removes the pay line;
 *  - a month with no adjustment has exactly the keys it always had; staff shares live in the monthly list and never touch a teacher's slip.
 */

const NOW = "2026-11-16T06:00:00Z"; // 11:30 Colombo, 16 Nov 2026
const TODAY = "2026-11-16";
type Actions = typeof import("./actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let teacherUserId: string;
let t1: number;
let t2: number;
let staffA: number;
let staffB: number;
let xenonTypeId: number;
let advanceTypeId: number;
let donationId: number;
let n = 0;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const none = { ok: false } as const;
const admin = () => setSession("ADMIN", w.admin.id);

describe("salary adjustments (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("./actions");
    w = await seedWorld(db);
    teacherUserId = (await db.user.create({ data: { username: "teacher-sa", passwordHash: "x", role: "TEACHER" } })).id;
    xenonTypeId = (await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } })).id;
    advanceTypeId = (await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } })).id;
    donationId = (await db.incomeCategory.findFirstOrThrow({ where: { code: "DONATION" } })).id;
    const a = await makeTeacher(db, "Teacher One");
    const b = await makeTeacher(db, "Teacher Two");
    t1 = a.id;
    t2 = b.id;
    staffA = (await db.staff.create({ data: { name: "Staff A" } })).id;
    staffB = (await db.staff.create({ data: { name: "Staff B" } })).id;
    // each teacher has 10,000.00 of class fees in November at 20% institute share -> teacher share 8,000.00
    for (const t of [a, b]) {
      const course = await makeCourse(db, w, { teacherId: t.id, fee: "10000.00", share: "20.00" });
      const student = await makeStudent(db);
      await db.payment.create({ data: { kind: "CLASS", studentId: student.id, courseId: course.id, amount: "10000.00", billingYear: 2026, billingMonth: 11, takenById: w.staff.id, paidAt: new Date("2026-11-05T05:00:00Z"), instituteSharePercentApplied: "20.00" } });
    }
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const expense = (amount: string, o: Record<string, unknown> = {}) =>
    db.expense.create({ data: { expenseTypeId: xenonTypeId, amount, reason: `T-shirts ${++n}`, date: colomboDateValue("2026-11-10"), recordedById: w.staff.id, authorizedById: w.admin.id, ...o } });
  const income = (amount: string) => db.otherIncome.create({ data: { categoryId: donationId, amount, date: colomboDateValue("2026-11-12"), receivedById: w.staff.id, recordedById: w.staff.id, source: `donor ${++n}` } });
  const input = (o: Record<string, unknown>) => ({
    kind: "SHARED_EXPENSE", title: "Class t-shirts", month: "2026-11", splitMode: "EQUAL", shared: "50000.00", people: [{ key: `t${t1}` }, { key: `t${t2}` }],
    consentNote: "Both teachers agreed at the staff meeting", consentOn: "2026-11-10", ...o,
  });
  const slips = async () => {
    const { buildPayslips } = await import("@/lib/payslips");
    return buildPayslips({ year: 2026, month: 11, includeInstitute: true });
  };
  const slipOf = (r: Awaited<ReturnType<typeof slips>>, id: number) => r.slips.find((s) => s.teacherId === id)!;
  const counts = async () => ({ adjustments: await db.salaryAdjustment.count(), lines: await db.salaryAdjustmentLine.count() });

  test("a month with no adjustment: slips have exactly the old keys, no adjustments in the roll-up", async () => {
    const r = await slips();
    const s = slipOf(r, t1);
    assert.equal("adjustmentLines" in s, false);
    assert.equal("adjustmentsNet" in s, false);
    assert.equal(s.finalSalary, "8000.00");
    assert.equal("adjustments" in r.institute!, false);
  });

  test("ADMIN only, reads included: STAFF, TEACHER and no session are refused and nothing is written", async () => {
    const e = await expense("100000.00");
    for (const [role, id] of [["STAFF", w.staff.id], ["TEACHER", teacherUserId], [null, "nobody"]] as const) {
      setSession(role, id);
      const before = await counts();
      await assert.rejects(() => A.createSalaryAdjustment({ ...input({}), sourceId: e.id }), (x: Error) => x.message === "Not authorised");
      await assert.rejects(() => A.cancelSalaryAdjustment(none, form({ id: "1", reason: "mistake" })), (x: Error) => x.message === "Not authorised");
      for (const fn of [() => A.listAdjustments(2026, 11), () => A.getAdjustment(1), () => A.listShareableExpenses(), () => A.listShareableIncomes(), () => A.listPeople(), () => A.staffMonthList(2026, 11)]) await assert.rejects(fn, /Not authorised/);
      assert.deepEqual(await counts(), before);
    }
    admin();
    assert.equal((await A.listPeople()).length, 4);
  });

  test("100,000 expense, 50,000 shared by two teachers: each slip -25,000, Xenon bears 50,000, profit change = -(expense) + recovered, Daily Summary shows 100,000 once", async () => {
    admin();
    const before = await slips();
    const e = await expense("100000.00", { date: colomboDateValue("2026-11-09") });
    const afterExpense = await slips();
    assert.equal(Number(afterExpense.institute!.instituteProfit) - Number(before.institute!.instituteProfit), -100000, "the expense alone costs Xenon 100,000");

    const r = await A.createSalaryAdjustment({ ...input({}), sourceId: e.id });
    assert.ok(r.ok, JSON.stringify(r));
    const row = await db.salaryAdjustment.findFirstOrThrow({ include: { lines: true }, orderBy: { id: "desc" } });
    assert.equal(row.totalAmount.toFixed(2), "100000.00");
    assert.equal(row.instituteAmount.toFixed(2), "50000.00");
    assert.deepEqual(row.lines.map((l) => l.amount.toFixed(2)), ["25000.00", "25000.00"]);

    const afterAdj = await slips();
    for (const id of [t1, t2]) {
      const s = slipOf(afterAdj, id);
      assert.equal(s.finalSalary, "-17000.00", "8,000.00 - 25,000.00: it goes negative and says so");
      assert.equal(s.adjustmentsNet, "-25000.00");
      assert.deepEqual(s.adjustmentLines?.map((l) => [l.title, l.amount, l.sign]), [["Class t-shirts", "25000.00", "-"]]);
      assert.equal(s.totalTeacherShare, "8000.00", "the teacher's SHARE of fees is untouched");
    }
    assert.equal(Number(afterAdj.institute!.instituteProfit) - Number(before.institute!.instituteProfit), -50000, "profit change = -100,000 + 50,000 recovered");
    assert.deepEqual(afterAdj.institute!.adjustments, { recovered: "50000.00", bonuses: "0.00" });

    const { dailySummary } = await import("@/lib/reports");
    const day = await dailySummary("2026-11-09", "2026-11-09");
    assert.equal(day.deductions.xenonExpenses, "100000.00", "the Daily Summary still shows the full 100,000, once");
    assert.equal(day.deductions.total, "100000.00");
  });

  test("the same expense cannot be shared twice (a race writes one); a cancelled share frees it", async () => {
    admin();
    const e = await expense("40000.00");
    const results = await Promise.all([1, 2, 3].map(() => A.createSalaryAdjustment({ ...input({ shared: "10000.00" }), sourceId: e.id })));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.equal(await db.salaryAdjustment.count({ where: { expenseId: e.id } }), 1);
    const ok = results.find((r) => r.ok);
    assert.ok(ok && ok.ok);
    if (!ok || !ok.ok) return;
    assert.equal((await A.cancelSalaryAdjustment(none, form({ id: String(ok.id), reason: "wrong teachers" }))).ok, true);
    assert.ok((await A.createSalaryAdjustment({ ...input({ shared: "10000.00" }), sourceId: e.id })).ok, "after a cancel the expense can be shared again (a correction is a new adjustment)");
  });

  test("an odd cent goes to the first teacher, deterministically; the lines plus Xenon's share equal the total to the cent", async () => {
    admin();
    const e = await expense("100.01");
    const r = await A.createSalaryAdjustment({ ...input({ shared: "100.01", people: [{ key: `t${t2}` }, { key: `t${t1}` }] }), sourceId: e.id });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    const lines = await db.salaryAdjustmentLine.findMany({ where: { adjustmentId: r.id }, orderBy: { id: "asc" } });
    assert.deepEqual(lines.map((l) => [l.teacherId, l.amount.toFixed(2)]), [[t1, "50.01"], [t2, "50.00"]], "the lower id gets the extra cent, whatever order the browser sent");
    const adj = await db.salaryAdjustment.findUniqueOrThrow({ where: { id: r.id } });
    assert.equal(adj.instituteAmount.toFixed(2), "0.00");
    assert.equal(lines.reduce((s, l) => s + Number(l.amount) * 100, 0) + Number(adj.instituteAmount) * 100, 10001);
  });

  test("custom amounts; staff and teachers together; Xenon's share is what is left; more than the total is refused", async () => {
    admin();
    const e = await expense("60000.00");
    const bad = await A.createSalaryAdjustment({ ...input({ splitMode: "CUSTOM", shared: undefined, people: [{ key: `t${t1}`, amount: "40000" }, { key: `s${staffA}`, amount: "20000.01" }] }), sourceId: e.id });
    assert.equal(bad.ok, false);
    const r = await A.createSalaryAdjustment({ ...input({ splitMode: "CUSTOM", shared: undefined, people: [{ key: `t${t1}`, amount: "30000" }, { key: `s${staffA}`, amount: "10000.50" }, { key: `s${staffB}`, amount: "5000" }] }), sourceId: e.id });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    const a = await A.getAdjustment(r.id);
    assert.equal(a?.institute, "14999.50");
    assert.deepEqual(a?.people.map((p) => [p.kind, p.amount]), [["teacher", "30000.00"], ["staff", "10000.50"], ["staff", "5000.00"]]);
  });

  test("staff shares are a monthly list; they never touch a teacher's slip; they do count in the roll-up", async () => {
    admin();
    const list = await A.staffMonthList(2026, 11);
    assert.deepEqual(list.map((s) => [s.name, s.net]), [["Staff A", "-10000.50"], ["Staff B", "-5000.00"]]);
    assert.deepEqual(list[0].lines.map((l) => [l.title, l.amount, l.sign]), [["Class t-shirts", "10000.50", "-"]]);
    const r = await slips();
    assert.ok(r.slips.every((s) => !s.adjustmentLines?.some((l) => l.amount === "10000.50")), "no staff line on a teacher's slip");
    assert.equal(await A.staffMonthList(2026, 10).then((x) => x.length), 0);
    assert.equal((await A.staffMonthList(2026, 13)).length, 0, "a junk month is an empty list, not an error");
  });

  test("a bonus from an income: PLUS on the pay, reduces profit; an income can carry one bonus", async () => {
    admin();
    const before = await slips();
    const i = await income("20000.00");
    const r = await A.createSalaryAdjustment({ kind: "BONUS", sourceId: i.id, title: "Seminar bonus", month: "2026-11", splitMode: "CUSTOM", people: [{ key: `t${t1}`, amount: "5000" }], consentNote: "Approved by the owner", consentOn: TODAY });
    assert.ok(r.ok, JSON.stringify(r));
    const after = await slips();
    assert.equal(Number(slipOf(after, t1).finalSalary) - Number(slipOf(before, t1).finalSalary), 5000);
    assert.equal(slipOf(after, t1).adjustmentLines?.at(-1)?.sign, "+");
    // The 20,000.00 income itself is now profit (other income counts in the roll-up); the bonus paid out of it takes 5,000.00 back.
    assert.equal(Number(after.institute!.instituteProfit) - Number(before.institute!.instituteProfit), 20000 - 5000);
    assert.equal(after.institute!.otherIncome, "20000.00");
    assert.equal(after.institute!.adjustments!.bonuses, "5000.00");
    assert.equal((await A.createSalaryAdjustment({ kind: "BONUS", sourceId: i.id, title: "Again", month: "2026-11", splitMode: "CUSTOM", people: [{ key: `t${t2}`, amount: "1000" }], consentNote: "Approved", consentOn: TODAY })).ok, false);
  });

  test("what cannot be shared: a teacher advance, a staff advance, a cancelled income, a missing source; an inactive person; nothing is written", async () => {
    admin();
    const before = await counts();
    const adv = await db.expense.create({ data: { expenseTypeId: advanceTypeId, teacherId: t1, amount: "5000.00", reason: "advance", date: colomboDateValue("2026-11-03"), recordedById: w.staff.id, authorizedById: w.admin.id } });
    const sadv = await expense("3000.00", { isStaffAdvance: true, staffId: staffA });
    const dead = await income("1000.00");
    await db.otherIncome.update({ where: { id: dead.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "typed twice" } });
    for (const [kind, sourceId] of [["SHARED_EXPENSE", adv.id], ["SHARED_EXPENSE", sadv.id], ["BONUS", dead.id], ["SHARED_EXPENSE", 999999], ["BONUS", 999999]] as const) {
      const r = await A.createSalaryAdjustment({ ...input({ kind, sourceId }) });
      assert.equal(r.ok, false, `${kind} ${sourceId}`);
    }
    const gone = await db.teacher.create({ data: { name: "Left", active: false } });
    const e = await expense("1000.00");
    assert.equal((await A.createSalaryAdjustment({ ...input({ shared: "100", people: [{ key: `t${gone.id}` }] }), sourceId: e.id })).ok, false);
    assert.equal((await A.createSalaryAdjustment({ ...input({ shared: "100", people: [{ key: "t999999" }] }), sourceId: e.id })).ok, false);
    assert.deepEqual(await counts(), before);
  });

  test("past months are locked: creating in a past month is refused; a later month is fine; cancel works only until the month is over", async () => {
    admin();
    const e = await expense("10000.00");
    const past = await A.createSalaryAdjustment({ ...input({ month: "2026-10", shared: "100" }), sourceId: e.id });
    assert.equal(past.ok, false);
    assert.ok(!past.ok && past.error.startsWith("That month is already closed"));
    assert.equal((await A.createSalaryAdjustment({ ...input({ month: "2027-12", shared: "100" }), sourceId: e.id })).ok, false, "more than 12 months ahead");
    const later = await A.createSalaryAdjustment({ ...input({ month: "2026-12", shared: "100" }), sourceId: e.id });
    assert.ok(later.ok, JSON.stringify(later));
    if (!later.ok) return;
    assert.equal((await slips()).slips.every((s) => !s.adjustmentLines?.some((l) => l.adjustmentId === later.id)), true, "November's slips do not show December's adjustment");

    // the month rolls over: November's adjustments are now locked; December's is current
    const november = await db.salaryAdjustment.findFirstOrThrow({ where: { applyMonth: 11, cancelled: false } });
    freezeClock("2026-12-03T06:00:00Z");
    try {
      const refused = await A.cancelSalaryAdjustment(none, form({ id: String(november.id), reason: "too late now" }));
      assert.equal(refused.ok, false);
      assert.match(refused.error ?? "", /can no longer be cancelled/);
      assert.equal((await db.salaryAdjustment.findUniqueOrThrow({ where: { id: november.id } })).cancelled, false);
      assert.equal((await A.listAdjustments(2026, 11)).every((x) => x.locked), true);
      assert.equal((await A.cancelSalaryAdjustment(none, form({ id: String(later.id), reason: "changed my mind" }))).ok, true);
    } finally {
      freezeClock(NOW);
    }
  });

  test("cancel: the row stays, the pay line goes; twice or unknown says so; a reason is needed", async () => {
    admin();
    const e = await expense("20000.00");
    const r = await A.createSalaryAdjustment({ ...input({ shared: "2000.00" }), sourceId: e.id });
    assert.ok(r.ok);
    if (!r.ok) return;
    const withLine = slipOf(await slips(), t1).adjustmentLines?.length ?? 0;
    assert.equal((await A.cancelSalaryAdjustment(none, form({ id: String(r.id), reason: "ab" }))).ok, false);
    assert.equal((await A.cancelSalaryAdjustment(none, form({ id: String(r.id), reason: "not agreed" }))).ok, true);
    const row = await db.salaryAdjustment.findUniqueOrThrow({ where: { id: r.id }, include: { lines: true } });
    assert.deepEqual([row.cancelled, row.cancelledById, row.cancelReason, row.lines.length], [true, w.admin.id, "not agreed", 2]);
    assert.equal(slipOf(await slips(), t1).adjustmentLines?.length ?? 0, withLine - 1);
    assert.equal((await A.cancelSalaryAdjustment(none, form({ id: String(r.id), reason: "not agreed" }))).error, "That adjustment is already cancelled.");
    assert.equal((await A.cancelSalaryAdjustment(none, form({ id: "999999", reason: "not agreed" }))).error, "That adjustment could not be found.");
  });

  test("the database refuses what the application would never write (CHECK constraints)", async () => {
    const e = await expense("500.00");
    const base = { kind: "SHARED_EXPENSE" as const, title: "x", applyYear: 2026, applyMonth: 11, totalAmount: "500.00", instituteAmount: "0.00", splitMode: "CUSTOM" as const, consentNote: "ok", consentOn: colomboDateValue(TODAY), createdById: w.admin.id };
    await assert.rejects(() => db.salaryAdjustment.create({ data: { ...base, expenseId: e.id, applyMonth: 13 } }), "month 13");
    await assert.rejects(() => db.salaryAdjustment.create({ data: { ...base, kind: "BONUS", expenseId: e.id } }), "a bonus with an expense and no income");
    await assert.rejects(() => db.salaryAdjustment.create({ data: { ...base, instituteAmount: "501.00", expenseId: e.id } }), "Xenon's share above the total");
    const ok = await db.salaryAdjustment.create({ data: { ...base, expenseId: e.id } });
    await assert.rejects(() => db.salaryAdjustmentLine.create({ data: { adjustmentId: ok.id, teacherId: t1, staffId: staffA, amount: "1.00" } }), "a line for two people");
    await assert.rejects(() => db.salaryAdjustmentLine.create({ data: { adjustmentId: ok.id, amount: "1.00" } }), "a line for nobody");
    await assert.rejects(() => db.salaryAdjustmentLine.create({ data: { adjustmentId: ok.id, teacherId: t1, amount: "0.00" } }), "a zero amount");
    await db.salaryAdjustment.update({ where: { id: ok.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "test row" } });
  });
});
