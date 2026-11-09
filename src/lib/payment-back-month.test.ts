import { dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import type { PrismaClient } from "@prisma/client";

import { BACK_MONTHS } from "@/lib/payment-months";
import {
  chargeCoursesFrom,
  chargeInput,
  chargeTotal,
  monthKey,
  needsBackConfirm,
  selectedClassMonths,
  setMonthMode,
  toggleMonth,
} from "@/lib/payment-charge";

/*
 * Back-month payment: a month BEFORE the enrolment start may be charged, once staff confirmed it,
 * up to BACK_MONTHS (12) before the current month. The request says so with `backMonth: true`; a
 * request without it is refused exactly as before. Everything else about the month — amount, tier,
 * combo, Half / No charge, share, receipt, duplicate guard — is the ordinary code path.
 *
 * Clock frozen at 15 Oct 2026 (Colombo). The student under test is enrolled THIS month (Oct 2026),
 * so Sep 2026 is 1 month back, Oct 2025 exactly 12, Sep 2025 is 13.
 */

const NOW = "2026-10-15T06:00:00Z";
const ENROLLED = "2026-10-02T06:00:00Z";
const LONG_AGO = "2024-01-10T06:00:00Z";
const OCT = { year: 2026, month: 10 };
const SEP = { year: 2026, month: 9 };
const OCT_25 = { year: 2025, month: 10 }; // exactly 12 months back
const SEP_25 = { year: 2025, month: 9 }; // 13 months back

type Row = { courseId: number; year: number; month: number; mode?: "FULL" | "HALF" | "NO_CHARGE"; backMonth?: boolean };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let pay: typeof import("@/app/(app)/payment/actions");
let rec: typeof import("@/app/(app)/receipts/actions");
let view: typeof import("@/lib/payment-view");
let payslips: typeof import("@/lib/payslips");
let profile: typeof import("@/lib/student-profile");

describe("back-month payment against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    pay = await import("@/app/(app)/payment/actions");
    rec = await import("@/app/(app)/receipts/actions");
    view = await import("@/lib/payment-view");
    payslips = await import("@/lib/payslips");
    profile = await import("@/lib/student-profile");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const as = (role: "ADMIN" | "STAFF" = "ADMIN") => setSession(role, (role === "ADMIN" ? w.admin : w.staff).id);
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });
  const dec = (d: { toFixed: (n: number) => string } | null) => d?.toFixed(2);

  async function setup(o: { fee?: string; share?: string; tier?: "FULL" | "HALF"; since?: string; teacherId?: number } = {}) {
    const teacherId = o.teacherId ?? (await makeTeacher(db)).id;
    const course = await makeCourse(db, w, { teacherId, fee: o.fee ?? "2500", share: o.share ?? "20.00" });
    const student = await makeStudent(db, { cardUid: `UID${Math.random().toString(16).slice(2, 10)}` });
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: w.tiers[o.tier ?? "FULL"].id, since: o.since ?? ENROLLED });
    return { teacherId, course, student };
  }
  const take = (studentId: number, classMonths: Row[], role: "ADMIN" | "STAFF" = "ADMIN") => {
    as(role);
    return pay.takePayment({ studentId, admission: false, smartCard: false, classMonths, comboDecisions: [] });
  };
  const ok = (res: Awaited<ReturnType<typeof take>>) => {
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  };
  const refused = async (studentId: number, classMonths: Row[], error: string, role: "ADMIN" | "STAFF" = "ADMIN") => {
    const before = (await rows(studentId)).length;
    assert.deepEqual(await take(studentId, classMonths, role), { ok: false, error });
    assert.equal((await rows(studentId)).length, before, "a refusal must write nothing");
  };
  async function loadView(studentId: number) {
    as();
    const res = await pay.loadPanel({ studentId });
    assert.equal(res.status, "ok");
    return view.buildPaymentView((res as Extract<typeof res, { status: "ok" }>).panel);
  }

  // ---- the limit ------------------------------------------------------------------

  test("the shared constant is 12", () => {
    assert.equal(BACK_MONTHS, 12);
  });

  test("accepted with the flag at 1 month back and at exactly 12 months back — for ADMIN and STAFF alike", async () => {
    const a = await setup();
    const rcpt = ok(await take(a.student.id, [{ courseId: a.course.id, ...SEP, backMonth: true }]));
    assert.equal(rcpt.total, "2500.00");
    const b = await setup();
    ok(await take(b.student.id, [{ courseId: b.course.id, ...OCT_25, backMonth: true }], "STAFF"));
    const [p] = await rows(b.student.id);
    assert.deepEqual([p.billingYear, p.billingMonth, p.kind, p.cancelled], [2025, 10, "CLASS", false]);
    assert.equal(p.paidAt.toISOString(), "2026-10-15T06:00:00.000Z"); // paidAt stays the day the cash arrived
  });

  test("refused at 13 months back, and for a year typo, whatever the flag — and nothing is written", async () => {
    const { course, student } = await setup();
    await refused(student.id, [{ courseId: course.id, ...SEP_25, backMonth: true }], "Cannot charge more than 12 months back.");
    await refused(student.id, [{ courseId: course.id, year: 1999, month: 3, backMonth: true }], "Cannot charge more than 12 months back.");
    await refused(student.id, [{ courseId: course.id, year: 1, month: 1, backMonth: true }], "Cannot charge more than 12 months back.");
  });

  test("no flag: refused exactly as before, at 1 month back too (old phones keep working)", async () => {
    const { course, student } = await setup();
    await refused(student.id, [{ courseId: course.id, ...SEP }], "That month is before the student was enrolled.");
    await refused(student.id, [{ courseId: course.id, ...OCT_25 }], "That month is before the student was enrolled.");
    await refused(student.id, [{ courseId: course.id, ...SEP, backMonth: false }], "That month is before the student was enrolled.");
  });

  test("backMonth on a month that is not before the enrolment is ignored: same result with or without it", async () => {
    const plain = await setup();
    const flagged = await setup();
    ok(await take(plain.student.id, [{ courseId: plain.course.id, ...OCT }]));
    ok(await take(flagged.student.id, [{ courseId: flagged.course.id, ...OCT, backMonth: true }]));
    const [x] = await rows(plain.student.id);
    const [y] = await rows(flagged.student.id);
    for (const k of ["amount", "billingYear", "billingMonth", "chargeMode", "comboId", "instituteSharePercentApplied"] as const) {
      assert.equal(String(x[k]), String(y[k]), k);
    }
    // ...and it does NOT widen the old window for a student who has been enrolled for years: that
    // month is not before the enrolment, so it is judged as it always was (no lower limit there).
    const old = await setup({ since: LONG_AGO });
    ok(await take(old.student.id, [{ courseId: old.course.id, year: 2025, month: 1, backMonth: true }]));
    await refused(old.student.id, [{ courseId: old.course.id, year: 2023, month: 12 }], "That month is before the student was enrolled.");
    await refused(old.student.id, [{ courseId: old.course.id, year: 2023, month: 12, backMonth: true }], "Cannot charge more than 12 months back.");
  });

  // ---- duplicates -------------------------------------------------------------------

  test("an earlier month cannot be charged twice; cancelled, it can be charged again", async () => {
    const { course, student } = await setup();
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    const again = await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]);
    assert.equal(again.ok, false);
    assert.equal((await rows(student.id)).length, 1);

    as();
    const ref = `ref:${(await rows(student.id))[0].transactionRef}`;
    const f = new FormData();
    f.set("key", ref);
    f.set("reason", "wrong month");
    assert.deepEqual(await rec.cancelTransaction({ ok: false }, f), { ok: true });
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    assert.equal((await rows(student.id)).filter((p) => !p.cancelled).length, 1);
  });

  // ---- priced like any other month ----------------------------------------------------------

  test("amount, tier, mode and share equal a normal month's — Full, Half, No charge", async () => {
    for (const mode of [undefined, "HALF", "NO_CHARGE"] as const) {
      const normal = await setup({ fee: "2500", share: "25.00" });
      const back = await setup({ fee: "2500", share: "25.00" });
      ok(await take(normal.student.id, [{ courseId: normal.course.id, ...OCT, ...(mode ? { mode } : {}) }]));
      ok(await take(back.student.id, [{ courseId: back.course.id, ...SEP, ...(mode ? { mode } : {}), backMonth: true }]));
      const [n] = await rows(normal.student.id);
      const [b] = await rows(back.student.id);
      assert.equal(dec(b.amount), dec(n.amount), `amount ${mode}`);
      assert.equal(b.feeTierId, n.feeTierId);
      assert.equal(b.chargeMode, n.chargeMode);
      assert.equal(dec(b.instituteSharePercentApplied), dec(n.instituteSharePercentApplied));
      assert.equal(b.comboId, n.comboId);
      assert.equal(b.kind, "CLASS");
      assert.deepEqual([b.billingYear, b.billingMonth], [2026, 9]);
    }
  });

  test("a Half-TIER student is charged the tier price for an earlier month", async () => {
    const { course, student } = await setup({ fee: "2500", tier: "HALF" });
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    const [p] = await rows(student.id);
    assert.equal(dec(p.amount), "1250.00");
    assert.equal(p.feeTierId, w.tiers.HALF.id);
  });

  test("the combo follows an earlier month exactly as it follows a normal one", async () => {
    async function pair() {
      const teacher = await makeTeacher(db);
      const a = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", share: "20.00" });
      const b = await makeCourse(db, w, { teacherId: teacher.id, fee: "1800", share: "30.00" });
      const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: a.id, fee: "2000" }, { courseId: b.id, fee: "1500" }] });
      const student = await makeStudent(db);
      for (const c of [a, b]) await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers.FULL.id, since: ENROLLED });
      return { a, b, combo, student };
    }
    const normal = await pair();
    const back = await pair();
    const decisions = (comboId: number) => [{ comboId, apply: true }];
    as();
    const n = await pay.takePayment({ studentId: normal.student.id, admission: false, smartCard: false, classMonths: [{ courseId: normal.a.id, ...OCT }, { courseId: normal.b.id, ...OCT }], comboDecisions: decisions(normal.combo.id) });
    const b = await pay.takePayment({ studentId: back.student.id, admission: false, smartCard: false, classMonths: [{ courseId: back.a.id, ...SEP, backMonth: true }, { courseId: back.b.id, ...SEP, backMonth: true }], comboDecisions: decisions(back.combo.id) });
    assert.equal(ok(b).total, ok(n).total);
    assert.deepEqual((await rows(back.student.id)).map((p) => [dec(p.amount), p.comboId === null]), (await rows(normal.student.id)).map((p) => [dec(p.amount), p.comboId === null]));
  });

  test("the share is frozen on the payment: a later change to the course does not move it", async () => {
    const { course, student } = await setup({ share: "20.00" });
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    await db.course.update({ where: { id: course.id }, data: { instituteSharePercent: "50.00" } });
    const [p] = await rows(student.id);
    assert.equal(dec(p.instituteSharePercentApplied), "20.00");
  });

  // ---- the screen ---------------------------------------------------------------------------

  test("the view: earlier months are flagged, never owed, and absent from everyone else's months", async () => {
    const { course, student } = await setup();
    const v = await loadView(student.id);
    const months = v.courses[0].months;
    assert.equal(months[0].label, "Oct 2025", "starts exactly BACK_MONTHS before the current month");
    const early = months.filter((m) => m.beforeStart);
    assert.equal(early.length, 12);
    assert.deepEqual(early.map((m) => m.label).slice(-1), ["Sep 2026"]);
    for (const m of early) {
      assert.equal(m.beforeStart, true);
      assert.equal(m.owed, false, "arrears count from the enrolment start only");
      assert.equal(m.state, "unpaid");
    }
    for (const m of months.filter((x) => !x.beforeStart)) assert.equal("beforeStart" in m, false, `${m.label} must not carry the key`);
    assert.equal(v.courses[0].cardMonth?.label, "Oct 2026"); // the card still starts at the enrolment month
    assert.equal(course.id, v.courses[0].courseId);
  });

  test("a student enrolled more than 12 months ago is unchanged: no earlier months at all", async () => {
    const { student } = await setup({ since: LONG_AGO });
    const v = await loadView(student.id);
    const months = v.courses[0].months;
    assert.equal(months[0].label, "Jan 2024");
    assert.equal(months.some((m) => "beforeStart" in m), false);
  });

  test("a PAID earlier month shows green (paid, with its day) and is left out of the request", async () => {
    const { course, student } = await setup();
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    const v = await loadView(student.id);
    const sep = v.courses[0].months.find((m) => m.label === "Sep 2026")!;
    assert.equal(sep.state, "paid");
    assert.equal(sep.paidDay, 15);
    assert.equal(sep.beforeStart, true);
    const charge = chargeCoursesFrom(v.courses);
    assert.equal(charge[0].months.some((m) => m.month === 9 && m.year === 2026), false);
  });

  test("the receipt total equals the screen's Total, and only the earlier row carries backMonth", async () => {
    const { course, student } = await setup({ fee: "2500" });
    const v = await loadView(student.id);
    const charge = chargeCoursesFrom(v.courses);
    const selected = new Map([
      [monthKey(course.id, 2026, 9), "FULL" as const],
      [monthKey(course.id, 2026, 10), "HALF" as const],
      [monthKey(course.id, 2025, 11), "FULL" as const],
    ]);
    const total = chargeTotal({ admission: false, smartCard: false, admissionAmount: "0", smartCardAmount: "0", courses: charge, selected, decisions: [] });
    const input = chargeInput({ studentId: student.id, admission: false, smartCard: false, courses: charge, selected, comboDecisions: [] });
    assert.deepEqual(input.classMonths, [
      { courseId: course.id, year: 2025, month: 11, backMonth: true },
      { courseId: course.id, year: 2026, month: 9, backMonth: true },
      { courseId: course.id, year: 2026, month: 10, mode: "HALF" },
    ]);
    const rcpt = ok(await take(student.id, input.classMonths as Row[]));
    assert.equal(Number(rcpt.total), total);
    assert.equal(rcpt.total, "6250.00");
  });

  // ---- the reports --------------------------------------------------------------------------

  test("the payslip counts it on the PAYMENT month (October) under the old month's label", async () => {
    const { teacherId, course, student } = await setup({ fee: "2000", share: "20.00" });
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    const oct = (await payslips.buildPayslips({ year: 2026, month: 10, teacherIds: [teacherId], includeInstitute: false })).slips[0];
    assert.deepEqual(oct.lines.map((l) => [l.billingLabel, l.cards, l.gross]), [["Sep 2026", 1, "2000.00"]]);
    assert.equal(oct.totalCollected, "2000.00");
    const sep = (await payslips.buildPayslips({ year: 2026, month: 9, teacherIds: [teacherId], includeInstitute: false })).slips[0];
    assert.equal(sep?.totalCollected ?? "0.00", "0.00", "a past month's payslip must not change");
  });

  test("display only: the profile grid shows an earlier PAID month as paid, an unpaid one stays dashed", async () => {
    const { course, student } = await setup();
    ok(await take(student.id, [{ courseId: course.id, ...SEP, backMonth: true }]));
    const p = (await profile.loadStudentProfile(student.id))!;
    const row = p.history[0];
    const cells = row.cells;
    const nOct = cells.length - 1; // the grid ends at the current month (Oct 2026)
    assert.equal(cells[nOct - 1], "paid"); // Sep 2026, paid before the enrolment month
    assert.equal(cells[nOct - 2], "before"); // Aug 2026, nothing paid
    assert.equal(cells[nOct], "owed"); // Oct 2026, the enrolment month, unpaid
  });
});

describe("the earlier-month rule on the screen (no database)", () => {
  const key = monthKey(7, 2026, 9);

  test("a tap on an earlier month that is not selected asks; Yes selects it as Full; Cancel changes nothing", () => {
    const selected = new Map<string, "FULL" | "HALF" | "NO_CHARGE">();
    assert.equal(needsBackConfirm(selected, key, true), true);
    const afterYes = setMonthMode(selected, key, "FULL");
    assert.equal(afterYes.get(key), "FULL");
    assert.equal(selected.size, 0, "Cancel is the absence of a call: the selection is untouched");
  });

  test("un-picking a selected earlier month needs no confirm; other months never ask", () => {
    const selected = new Map([[key, "FULL" as const]]);
    assert.equal(needsBackConfirm(selected, key, true), false);
    assert.equal(toggleMonth(selected, key).has(key), false);
    assert.equal(needsBackConfirm(new Map(), key, false), false);
    assert.equal(needsBackConfirm(new Map(), key, undefined), false);
    // Half and No charge picked from the month pop-up count as selected too.
    assert.equal(needsBackConfirm(new Map([[key, "HALF" as const]]), key, true), false);
  });

  test("a request with no earlier month is byte-identical to the old one", () => {
    const courses = chargeCoursesFrom([
      { courseId: 7, free: false, monthly: "2500.00", comboMonthly: null, halfMonthly: "1250.00", halfComboMonthly: null, comboId: null,
        months: [{ year: 2026, month: 9, state: "unpaid" }, { year: 2026, month: 10, state: "unpaid" }] },
    ]);
    const selected = new Map([[monthKey(7, 2026, 9), "FULL" as const], [monthKey(7, 2026, 10), "HALF" as const]]);
    assert.equal(
      JSON.stringify(selectedClassMonths(courses, selected)),
      JSON.stringify([{ courseId: 7, year: 2026, month: 9 }, { courseId: 7, year: 2026, month: 10, mode: "HALF" }]),
    );
  });

  test("the month sheet routes an unconfirmed earlier tile to onAskBack and gives it no info button", () => {
    const src = readFileSync("src/app/(app)/payment-new/month-sheet.tsx", "utf8");
    assert.match(src, /m\.beforeStart && !picked/);
    assert.match(src, /onClick=\{\(\) => onAskBack\(m\)\}/);
    assert.match(src, /info=\{null\}/);
    const screen = readFileSync("src/app/(app)/payment-new/student-screen.tsx", "utf8");
    assert.match(screen, /<BackMonthConfirm/);
    assert.match(screen, /needsBackConfirm\(selected, detailKey/); // the pop-up cannot pick an unconfirmed month
  });

  test("the confirm box says what the brief says, with two 48 px stacked buttons", () => {
    const src = readFileSync("src/app/(app)/payment-new/back-month-confirm.tsx", "utf8");
    assert.match(src, /Earlier month/);
    assert.match(src, /This month is before registration\. Take payment for \{MONTH_NAMES\[month - 1\]\} \{year\}\?/);
    assert.equal((src.match(/h-12 w-full/g) ?? []).length, 2);
    assert.match(src, /flex flex-col gap-2/);
  });
});
