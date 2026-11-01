import type { PrismaClient } from "@prisma/client";

import { setSession } from "@/test-support/server-stubs";
import { attend, enrol, makeCombo, makeCourse, makeStudent, makeTeacher, type World } from "@/test-support/test-db";

/**
 * The golden-master scenarios: what `takePayment` does for OLD-STYLE input — the input
 * shape that phones and terminals running the old cached app keep sending (no `mode`, no
 * `off`). `src/test-support/fixtures/payment-golden.json` was produced by running exactly
 * this file against the code BEFORE the money-rules change (branch feat/payment-screens),
 * on a database that already had the new column, so a green comparison means the new
 * server answers old input with the same amounts, rows, receipts and messages.
 *
 * Deliberately NOT here, because they are meant to differ: charging the same card twice,
 * and listing one month twice in a request. Those have their own tests.
 *
 * Run with the clock frozen at 2026-11-10T06:00:00Z and a fresh database, so every id and
 * every timestamp is the same on every run. Ids are made relative to the start of each
 * step and transaction refs are replaced by an index, so nothing random is compared.
 */

type Take = typeof import("@/app/(app)/payment/actions").takePayment;
type Input = Parameters<Take>[0];

const SINCE = "2026-08-05T06:00:00Z";

export async function runGoldenScenarios(db: PrismaClient, w: World, takePayment: Take) {
  const out: Record<string, unknown> = {};
  const courseName = new Map<number, string>();
  const comboName = new Map<number, string>();

  async function course(teacherId: number, name: string, fee: string, share = "20.00") {
    const c = await makeCourse(db, w, { teacherId, name, fee, share });
    courseName.set(c.id, name);
    return c;
  }
  async function student(label: string, enrolments: { course: { id: number }; tier?: "FULL" | "HALF" | "FREE"; since?: string; status?: "ACTIVE" | "DROPPED" }[], uid?: string) {
    const s = await makeStudent(db, { cardUid: uid });
    for (const e of enrolments) await enrol(db, { studentId: s.id, courseId: e.course.id, tierId: w.tiers[e.tier ?? "FULL"].id, since: e.since ?? SINCE, status: e.status });
    void label;
    return s;
  }

  /** Runs one request and records exactly what came back and what was written. */
  async function step(label: string, input: Input) {
    const baseline = (await db.payment.aggregate({ _max: { id: true } }))._max.id ?? 0;
    setSession("ADMIN", w.admin.id);
    const res = await takePayment(input);
    const rows = await db.payment.findMany({
      where: { id: { gt: baseline } },
      orderBy: { id: "asc" },
      select: {
        id: true, kind: true, amount: true, courseId: true, billingYear: true, billingMonth: true,
        feeTier: { select: { code: true } }, instituteSharePercentApplied: true, comboId: true,
        comboApplied: true, comboRefusedReason: true, cardUidIssued: true, cancelled: true,
        paidAt: true, transactionRef: true,
      },
    });
    const refs = new Map<string, number>();
    const refIndex = (r: string | null) => (r === null ? null : (refs.set(r, refs.get(r) ?? refs.size), refs.get(r)));

    const result =
      res.ok === true
        ? {
            ok: true,
            receiptKeys: Object.keys(res.receipt).sort(),
            receipt: {
              reference: `XN-${Number(res.receipt.reference.slice(3)) - baseline}`,
              at: res.receipt.at,
              date: res.receipt.date,
              student: res.receipt.student,
              takenBy: res.receipt.takenBy,
              lines: res.receipt.lines,
              total: res.receipt.total,
            },
          }
        : res;

    out[label] = {
      result,
      rows: rows.map((r) => ({
        id: r.id - baseline,
        kind: r.kind,
        amount: r.amount.toFixed(2),
        course: r.courseId === null ? null : courseName.get(r.courseId),
        billing: r.billingYear === null ? null : `${r.billingYear}-${r.billingMonth}`,
        tier: r.feeTier?.code ?? null,
        share: r.instituteSharePercentApplied?.toFixed(2) ?? null,
        combo: r.comboId === null ? null : comboName.get(r.comboId),
        comboApplied: r.comboApplied,
        comboRefusedReason: r.comboRefusedReason,
        cardUidIssued: r.cardUidIssued,
        cancelled: r.cancelled,
        paidAt: r.paidAt.toISOString(),
        ref: refIndex(r.transactionRef),
      })),
    };
  }

  const NOV = { year: 2026, month: 11 };
  const none = { admission: false, smartCard: false, comboDecisions: [] as { comboId: number; apply: boolean; reason?: string }[] };
  const teacher = await makeTeacher(db, "Golden Teacher");

  // ---- the paying paths ----------------------------------------------------------------------------------
  const a = await course(teacher.id, "GA", "2500", "20.00");
  const b = await course(teacher.id, "GB", "1800", "30.00");
  const s1 = await student("one class", [{ course: a }]);
  await step("01 one class, one month", { ...none, studentId: s1.id, classMonths: [{ courseId: a.id, ...NOV }] });

  const s2 = await student("two classes", [{ course: a }, { course: b, tier: "HALF" }]);
  await step("02 two classes in one checkout (FULL + HALF tier)", { ...none, studentId: s2.id, classMonths: [{ courseId: a.id, ...NOV }, { courseId: b.id, ...NOV }] });

  const ca = await course(teacher.id, "CA", "2500", "20.00");
  const cb = await course(teacher.id, "CB", "1700", "25.00");
  const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: ca.id, fee: "2000" }, { courseId: cb.id, fee: "1300" }] });
  comboName.set(combo.id, "COMBO");
  const s3 = await student("combo accepted", [{ course: ca }, { course: cb }]);
  await step("03 combo accepted", { ...none, studentId: s3.id, classMonths: [{ courseId: ca.id, ...NOV }, { courseId: cb.id, ...NOV }], comboDecisions: [{ comboId: combo.id, apply: true }] });
  const s4 = await student("combo refused", [{ course: ca }, { course: cb }]);
  await step("04 combo refused with a reason", { ...none, studentId: s4.id, classMonths: [{ courseId: ca.id, ...NOV }, { courseId: cb.id, ...NOV }], comboDecisions: [{ comboId: combo.id, apply: false, reason: "did not attend" }] });

  const s3b = await student("combo accepted, attended", [{ course: ca }, { course: cb }]);
  for (const c of [ca, cb]) await attend(db, { studentId: s3b.id, courseId: c.id, date: "2026-10-12", markedById: w.admin.id });
  await step("05 combo accepted, student attended both classes last month (old client still sends the answer)", { ...none, studentId: s3b.id, classMonths: [{ courseId: ca.id, ...NOV }, { courseId: cb.id, ...NOV }], comboDecisions: [{ comboId: combo.id, apply: true }] });
  const s4b = await student("combo refused, attended", [{ course: ca }, { course: cb }]);
  for (const c of [ca, cb]) await attend(db, { studentId: s4b.id, courseId: c.id, date: "2026-10-12", markedById: w.admin.id });
  await step("06 combo refused with a reason, student attended both classes (the refusal is honoured)", { ...none, studentId: s4b.id, classMonths: [{ courseId: ca.id, ...NOV }, { courseId: cb.id, ...NOV }], comboDecisions: [{ comboId: combo.id, apply: false, reason: "parent asked" }] });
  const s3h = await student("half-tier combo", [{ course: ca, tier: "HALF" }, { course: cb, tier: "HALF" }]);
  await step("07 half-tier student, combo accepted", { ...none, studentId: s3h.id, classMonths: [{ courseId: ca.id, ...NOV }, { courseId: cb.id, ...NOV }], comboDecisions: [{ comboId: combo.id, apply: true }] });

  const s5 = await student("admission", []);
  await step("08 admission alone", { ...none, studentId: s5.id, admission: true, classMonths: [] });
  const s6 = await student("smart card", [], "04AABB11");
  await step("09 first smart-card charge", { ...none, studentId: s6.id, smartCard: true, classMonths: [] });
  const s7 = await student("all three", [{ course: a }], "04AABB22");
  await step("10 admission + smart card + a class together", { ...none, studentId: s7.id, admission: true, smartCard: true, classMonths: [{ courseId: a.id, ...NOV }] });
  const s8 = await student("advance", [{ course: a }]);
  await step("11 advance month (three ahead, across the year end)", { ...none, studentId: s8.id, classMonths: [{ courseId: a.id, year: 2027, month: 2 }] });
  const s9 = await student("old month", [{ course: a }]);
  await step("12 old month (the enrolment's first month)", { ...none, studentId: s9.id, classMonths: [{ courseId: a.id, year: 2026, month: 8 }] });
  const s10 = await student("catch-up", [{ course: a }]);
  await step("13 catch-up: four months in one checkout", { ...none, studentId: s10.id, classMonths: [8, 9, 10, 11].map((month) => ({ courseId: a.id, year: 2026, month })) });
  const odd = await course(teacher.id, "GODD", "1333.33", "20.00");
  const s11 = await student("rounding", [{ course: odd, tier: "HALF" }]);
  await step("14 half-tier rounding example (1333.33 x 0.5)", { ...none, studentId: s11.id, classMonths: [{ courseId: odd.id, ...NOV }] });

  // ---- the refusals: every message stays as it was --------------------------------------------------------
  const freeCourse = await course(teacher.id, "GFREE", "1200");
  const sFree = await student("free", [{ course: freeCourse, tier: "FREE" }]);
  await step("r01 free tier", { ...none, studentId: sFree.id, classMonths: [{ courseId: freeCourse.id, ...NOV }] });
  const sStranger = await student("stranger", []);
  await step("r02 not enrolled", { ...none, studentId: sStranger.id, classMonths: [{ courseId: a.id, ...NOV }] });
  const sDropped = await student("dropped", [{ course: a, status: "DROPPED" }]);
  await step("r03 dropped enrolment", { ...none, studentId: sDropped.id, classMonths: [{ courseId: a.id, ...NOV }] });
  const sLate = await student("late", [{ course: a, since: "2026-09-10T06:00:00Z" }]);
  await step("r04 before the enrolment month", { ...none, studentId: sLate.id, classMonths: [{ courseId: a.id, year: 2026, month: 8 }] });
  const sAhead = await student("ahead", [{ course: a }]);
  await step("r05 four months ahead", { ...none, studentId: sAhead.id, classMonths: [{ courseId: a.id, year: 2027, month: 3 }] });
  await step("r06 a month already paid", { ...none, studentId: s1.id, classMonths: [{ courseId: a.id, ...NOV }] });
  await step("r07 admission already paid", { ...none, studentId: s5.id, admission: true, classMonths: [] });
  const sDec = await student("decision missing", [{ course: ca }, { course: cb }]);
  await step("r08 combined-rate decision missing", { ...none, studentId: sDec.id, classMonths: [{ courseId: ca.id, ...NOV }] });
  await step("r09 combo refused without a reason", { ...none, studentId: sDec.id, classMonths: [{ courseId: ca.id, ...NOV }], comboDecisions: [{ comboId: combo.id, apply: false, reason: "   " }] });
  await step("r10 student not found", { ...none, studentId: 987654, classMonths: [{ courseId: a.id, ...NOV }] });
  await step("r11 malformed request", { ...none, studentId: 0, classMonths: [] });
  await step("r12 nothing selected", { ...none, studentId: s1.id, classMonths: [] });

  return out;
}
