import type { PrismaClient } from "@prisma/client";

import { setSession } from "@/test-support/server-stubs";
import { attend, enrol, freezeClock, makeCombo, makeCourse, makeTeacher, type World } from "@/test-support/test-db";

/**
 * The report golden-master data (job 5): ONE month-and-a-half of an institute that has only ever
 * taken FULL-fee payments — every row has a NULL `chargeMode`, which is exactly what production
 * holds today. It has several tiers and teachers, a combo, an admission and a smart card, a
 * catch-up, a payment across Colombo midnight, cancelled receipts, legacy rows with no ref and no
 * frozen share, teacher advances, a Xenon cost and a staff advance.
 *
 * `src/test-support/fixtures/reports-golden.json` was produced by running exactly this file
 * against the code BEFORE job 5 changed any report (branch feat/payment-last10 tip), so a green
 * comparison means every report, payslip, roll-up, search row and student profile is byte for byte
 * what it was for today's data. Refresh the fixture only for a change someone chose, in its own
 * commit — never to make a failing comparison pass.
 *
 * Run with a fresh database and a frozen clock, so every id and timestamp is the same on every
 * run. Random transaction refs are replaced by an index; nothing random is compared.
 */

type Take = typeof import("@/app/(app)/payment/actions").takePayment;
type Cancel = typeof import("@/app/(app)/receipts/actions").cancelTransaction;
type Reports = {
  dailySummary: typeof import("@/lib/reports").dailySummary;
  buildPayslips: typeof import("@/lib/payslips").buildPayslips;
  buildMonthlyIncome: typeof import("@/lib/report-monthly-income").buildMonthlyIncome;
  searchPayments: typeof import("@/lib/search").searchPayments;
  loadStudentProfile: typeof import("@/lib/student-profile").loadStudentProfile;
};

export const REPORT_NOW = "2026-11-10T06:00:00Z";
const SINCE = "2026-07-05T06:00:00Z";

export async function runReportScenarios(
  db: PrismaClient,
  w: World,
  deps: { takePayment: Take; cancelTransaction: Cancel } & Reports,
) {
  const { takePayment, cancelTransaction, dailySummary, buildPayslips, buildMonthlyIncome, searchPayments, loadStudentProfile } = deps;

  // ---- reference data -----------------------------------------------------------------------------
  const quarter = await db.feeTier.create({ data: { code: "QUARTER", label: "25%", multiplier: "0.250" } });
  const advanceType = await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } });
  const xenonType = await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } });
  const staffMember = await db.staff.create({ data: { name: "Sadun Staff" } });
  const tier = { FULL: w.tiers.FULL, HALF: w.tiers.HALF, QUARTER: quarter, FREE: w.tiers.FREE };

  const t1 = await makeTeacher(db, "Mr. A. Gunawardena");
  const t2 = await makeTeacher(db, "Ms. R. Wickramasinghe");
  const t3 = await makeTeacher(db, "Mr. S. Rathnayake");
  const ict = await makeCourse(db, w, { teacherId: t1.id, name: "ICT", fee: "2500", share: "20.00" });
  const chem = await makeCourse(db, w, { teacherId: t1.id, name: "Chemistry", fee: "3400", share: "25.00" });
  const maths = await makeCourse(db, w, { teacherId: t2.id, name: "Maths", fee: "1500", share: "30.00" });
  const phys = await makeCourse(db, w, { teacherId: t2.id, name: "Physics", fee: "2200", share: "20.00" });
  const eng = await makeCourse(db, w, { teacherId: t3.id, name: "English", fee: "2100", share: "20.00" });
  await makeCombo(db, { teacherId: t1.id, items: [{ courseId: ict.id, fee: "2000" }, { courseId: chem.id, fee: "2600" }] });

  async function student(name: string, cardNumber: string, enrolments: { course: { id: number }; tier: keyof typeof tier }[]) {
    const s = await db.student.create({ data: { name, cardNumber, cardUid: `UID-${cardNumber}` } });
    for (const e of enrolments) await enrol(db, { studentId: s.id, courseId: e.course.id, tierId: tier[e.tier].id, since: SINCE });
    return s;
  }
  const nimal = await student("Nimal Perera", "R-0001", [{ course: ict, tier: "FULL" }, { course: chem, tier: "FULL" }]);
  const heshan = await student("Heshan Silva", "R-0002", [{ course: ict, tier: "HALF" }]);
  const qasim = await student("Qasim Ali", "R-0003", [{ course: ict, tier: "QUARTER" }]);
  const freya = await student("Freya Free", "R-0004", [{ course: ict, tier: "FREE" }]);
  const mark = await student("Mark Marks", "R-0005", [{ course: maths, tier: "FULL" }, { course: phys, tier: "FULL" }]);
  const dilan = await student("Dilan Dias", "R-0006", [{ course: phys, tier: "HALF" }]);
  const ruwan = await student("Ruwan Rajapaksa", "R-0007", [{ course: eng, tier: "FULL" }]);
  const late = await student("Late Payer", "R-0008", [{ course: ict, tier: "FULL" }]);
  const cancelKid = await student("Cancel Kid", "R-0009", [{ course: maths, tier: "FULL" }]);
  const legacy = await student("Legacy Lee", "R-0010", [{ course: maths, tier: "FULL" }, { course: phys, tier: "FULL" }]);
  void freya;

  // The combo is "auto" when both classes were attended in the last completed month.
  for (const [month, days] of [["08", [8, 15]], ["09", [5, 12]], ["10", [3, 10]]] as const) {
    for (const d of days) for (const c of [ict, chem]) await attend(db, { studentId: nimal.id, courseId: c.id, date: `2026-${month}-${String(d).padStart(2, "0")}`, markedById: w.admin.id });
  }

  // ---- the payments (real takePayment; the clock is stepped, so every row has its own day) ----------
  const SEP = { year: 2026, month: 9 }, OCT = { year: 2026, month: 10 }, NOV = { year: 2026, month: 11 };
  async function take(at: string, who: "ADMIN" | "STAFF", studentId: number, o: { admission?: boolean; smartCard?: boolean; months?: { c: { id: number }; m: { year: number; month: number } }[] }) {
    freezeClock(at);
    setSession(who, who === "ADMIN" ? w.admin.id : w.staff.id);
    const res = await takePayment({
      studentId, admission: o.admission ?? false, smartCard: o.smartCard ?? false, comboDecisions: [],
      classMonths: (o.months ?? []).map((x) => ({ courseId: x.c.id, ...x.m })),
    });
    if (!res.ok) throw new Error(`scenario payment failed: ${res.error}`);
    return res.receipt;
  }
  await take("2026-09-10T06:00:00Z", "ADMIN", nimal.id, { admission: true, smartCard: true, months: [{ c: ict, m: SEP }, { c: chem, m: SEP }] });
  await take("2026-09-12T06:00:00Z", "STAFF", heshan.id, { admission: true, months: [{ c: ict, m: SEP }] });
  await take("2026-09-15T06:00:00Z", "ADMIN", mark.id, { months: [{ c: maths, m: SEP }, { c: phys, m: SEP }] });
  await take("2026-09-15T07:00:00Z", "ADMIN", dilan.id, { months: [{ c: phys, m: SEP }] });
  await take("2026-10-02T06:00:00Z", "STAFF", qasim.id, { months: [{ c: ict, m: OCT }] });
  await take("2026-10-02T07:00:00Z", "STAFF", ruwan.id, { months: [{ c: eng, m: OCT }] });
  await take("2026-10-10T06:00:00Z", "ADMIN", nimal.id, { months: [{ c: ict, m: OCT }, { c: chem, m: OCT }] });
  await take("2026-10-10T06:30:00Z", "ADMIN", heshan.id, { months: [{ c: ict, m: OCT }] });
  await take("2026-10-10T07:00:00Z", "ADMIN", mark.id, { months: [{ c: maths, m: OCT }, { c: phys, m: OCT }] });
  await take("2026-10-10T08:00:00Z", "ADMIN", cancelKid.id, { admission: true, months: [{ c: maths, m: OCT }] });
  await take("2026-10-31T19:00:00Z", "STAFF", dilan.id, { months: [{ c: phys, m: OCT }] }); // 00:30 on 1 Nov in Colombo
  await take("2026-11-03T06:00:00Z", "ADMIN", late.id, { months: [{ c: ict, m: SEP }, { c: ict, m: OCT }, { c: ict, m: NOV }] }); // a catch-up
  await take("2026-11-03T06:30:00Z", "ADMIN", nimal.id, { months: [{ c: ict, m: NOV }, { c: chem, m: NOV }] });
  await take("2026-11-03T07:00:00Z", "STAFF", ruwan.id, { months: [{ c: eng, m: NOV }] });
  await take("2026-11-03T07:30:00Z", "STAFF", mark.id, { months: [{ c: maths, m: NOV }] });

  // A cancelled receipt: it must not count anywhere.
  freezeClock("2026-11-04T06:00:00Z");
  setSession("ADMIN", w.admin.id);
  const form = new FormData();
  form.set("key", `ref:${(await db.payment.findFirstOrThrow({ where: { studentId: cancelKid.id, kind: "ADMISSION" } })).transactionRef}`);
  form.set("reason", "collected twice");
  const cancelRes = await cancelTransaction({ ok: false }, form);
  if (!cancelRes.ok) throw new Error(`scenario cancel failed: ${cancelRes.error}`);

  // Legacy rows: no transactionRef, and (for one) no frozen institute share.
  const legacyRow = (courseId: number, billingMonth: number, amount: string, paidAt: string, share: string | null, cancelledRow = false) =>
    db.payment.create({
      data: {
        kind: "CLASS", studentId: legacy.id, courseId, billingYear: 2026, billingMonth, feeTierId: tier.FULL.id, amount,
        instituteSharePercentApplied: share, takenById: w.admin.id, paidAt: new Date(paidAt), transactionRef: null, cancelled: cancelledRow,
        ...(cancelledRow ? { cancelledById: w.admin.id, cancelledAt: new Date(paidAt), cancelReason: "legacy void" } : {}),
      },
    });
  await legacyRow(maths.id, 8, "1500.00", "2026-08-20T06:00:00Z", "30.00");
  await legacyRow(phys.id, 9, "2200.00", "2026-09-20T06:00:00Z", null); // the course's CURRENT percent applies
  await legacyRow(maths.id, 10, "1500.00", "2026-10-20T06:00:00Z", null, true); // a legacy void

  // Money the teachers and the institute do not split.
  const expense = (typeId: number, amount: string, date: string, reason: string, o: { teacherId?: number; staffId?: number; staffAdvance?: boolean } = {}) =>
    db.expense.create({
      data: {
        expenseTypeId: typeId, amount, reason, date: new Date(`${date}T00:00:00Z`), teacherId: o.teacherId, staffId: o.staffId,
        isStaffAdvance: o.staffAdvance ?? false, recordedById: w.admin.id, authorizedById: w.admin.id,
      },
    });
  await expense(advanceType.id, "1000.00", "2026-10-12", "advance", { teacherId: t1.id });
  await expense(advanceType.id, "500.00", "2026-10-20", "advance", { teacherId: t2.id });
  await expense(xenonType.id, "300.00", "2026-10-13", "printer paper");
  await expense(xenonType.id, "800.00", "2026-09-14", "salary advance", { staffId: staffMember.id, staffAdvance: true });
  await expense(xenonType.id, "200.00", "2026-11-05", "electricity");

  // ---- read everything back, at one fixed instant --------------------------------------------------
  freezeClock(REPORT_NOW);
  const out: Record<string, unknown> = {};
  for (const [label, from, to] of [
    ["one day (a busy one)", "2026-10-10", "2026-10-10"],
    ["a week", "2026-11-01", "2026-11-07"],
    ["the Colombo midnight day", "2026-11-01", "2026-11-01"],
    ["October", "2026-10-01", "2026-10-31"],
    ["September to November", "2026-09-01", "2026-11-30"],
    ["a day with nothing", "2026-12-24", "2026-12-24"],
  ] as const) out[`Daily Summary: ${label}`] = await dailySummary(from, to);

  for (const [year, month] of [[2026, 8], [2026, 9], [2026, 10], [2026, 11], [2026, 12]] as const) {
    out[`payslips ${year}-${month}: every teacher, with the institute roll-up`] = await buildPayslips({ year, month, includeInstitute: true });
    for (const [name, t] of [["first teacher", t1], ["second teacher", t2], ["third teacher", t3]] as const) {
      out[`payslips ${year}-${month}: ${name} only, no institute block`] = await buildPayslips({ year, month, teacherIds: [t.id], includeInstitute: false });
    }
    out[`month-end roll-up ${year}-${month}`] = await buildMonthlyIncome(year, month);
  }

  for (const [label, filters] of [
    ["by student name", { student: "Nimal" }],
    ["by card number", { student: "R-0005" }],
    ["by date range", { from: "2026-10-01", to: "2026-10-31" }],
    ["admissions only", { kind: "ADMISSION" as const }],
    ["smart cards only", { kind: "SMART_CARD" as const }],
    ["one course", { courseId: maths.id }],
    ["one student with cancelled shown", { student: "Cancel", includeCancelled: true }],
    ["one student with cancelled hidden", { student: "Cancel" }],
    ["legacy rows", { student: "Legacy", includeCancelled: true }],
    ["everything in a long range, cancelled shown", { from: "2026-08-01", to: "2026-11-30", includeCancelled: true }],
  ] as const) out[`Search payments: ${label}`] = await searchPayments(filters);

  for (const [label, s] of [["with a combo, admission and smart card", nimal], ["a catch-up payer", late], ["with a cancelled receipt", cancelKid], ["legacy rows", legacy], ["a half-tier student", heshan], ["no payments", freya]] as const) {
    out[`student profile: ${label}`] = await loadStudentProfile(s.id);
  }

  // Random refs are never compared: each distinct one becomes ref:#n in order of appearance.
  const seen = new Map<string, number>();
  const text = JSON.stringify(out).replace(/ref:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (m) => {
    if (!seen.has(m)) seen.set(m, seen.size);
    return `ref:#${seen.get(m)}`;
  });
  return JSON.parse(text) as Record<string, unknown>;
}
