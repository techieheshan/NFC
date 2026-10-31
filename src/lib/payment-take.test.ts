import { dbSkip, enrol, freezeClock, makeCombo, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { PrismaClient } from "@prisma/client";

/*
 * Safety net for the Payment redesign (job 1): the REAL takePayment / loadPanel
 * against a throw-away Postgres, locking what they do TODAY.
 *
 * Tests named `CURRENT BEHAVIOUR (...)` lock something we already plan to change.
 * When that job lands, the failing test points at the sentence to update.
 *
 * The clock is frozen at 15 Oct 2026, 11:30 in Colombo, so "this month" is always
 * October 2026 — no flakiness on the 1st, the last day, or across midnight.
 */

const NOW = "2026-10-15T06:00:00Z";
const SINCE = "2026-04-01T06:00:00Z"; // enrolled from April 2026 (Colombo)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OCT = { year: 2026, month: 10 };

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let actions: typeof import("@/app/(app)/payment/actions");

describe("takePayment / loadPanel against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    actions = await import("@/app/(app)/payment/actions");
    w = await seedWorld(db);
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  const as = (role: "admin" | "staff" = "admin") => setSession(role === "admin" ? "ADMIN" : "STAFF", (role === "admin" ? w.admin : w.staff).id);
  const rows = (studentId: number) => db.payment.findMany({ where: { studentId }, orderBy: { id: "asc" } });
  const dec = (d: { toFixed: (n: number) => string } | null) => d?.toFixed(2);

  async function setup(o: { fee?: string; share?: string; tier?: "FULL" | "HALF" | "FREE"; since?: string } = {}) {
    const teacher = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: o.fee ?? "2500", share: o.share });
    const student = await makeStudent(db, { cardUid: `UID${Math.random().toString(16).slice(2, 10)}` });
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: w.tiers[o.tier ?? "FULL"].id, since: o.since ?? SINCE });
    return { teacher, course, student };
  }

  /** Two courses of one teacher in a combo (normal 2500 + 1800, combo 2000 + 1500). */
  async function comboSetup(tier: "FULL" | "HALF" = "FULL") {
    const teacher = await makeTeacher(db);
    const a = await makeCourse(db, w, { teacherId: teacher.id, fee: "2500", share: "20.00" });
    const b = await makeCourse(db, w, { teacherId: teacher.id, fee: "1800", share: "30.00" });
    const combo = await makeCombo(db, { teacherId: teacher.id, items: [{ courseId: a.id, fee: "2000" }, { courseId: b.id, fee: "1500" }] });
    const student = await makeStudent(db);
    for (const c of [a, b]) await enrol(db, { studentId: student.id, courseId: c.id, tierId: w.tiers[tier].id, since: SINCE });
    return { a, b, combo, student };
  }

  async function charge(studentId: number, classMonths: { courseId: number; year: number; month: number }[], extra: Partial<{ admission: boolean; smartCard: boolean; comboDecisions: { comboId: number; apply: boolean; reason?: string }[] }> = {}) {
    as();
    return actions.takePayment({ studentId, admission: false, smartCard: false, classMonths, comboDecisions: [], ...extra });
  }
  const receiptOf = (res: Awaited<ReturnType<typeof charge>>) => {
    assert.equal(res.ok, true, JSON.stringify(res));
    return (res as Extract<typeof res, { ok: true }>).receipt;
  };
  const refused = async (res: Promise<Awaited<ReturnType<typeof charge>>>, studentId: number, error: string) => {
    const before = (await rows(studentId)).length;
    assert.deepEqual(await res, { ok: false, error });
    assert.equal((await rows(studentId)).length, before, "a refusal must write nothing");
  };

  // ---- one class, one month ------------------------------------------------------

  test("one class, one month: amount, billing month, frozen share, transactionRef, receipt number", async () => {
    const { course, student } = await setup({ fee: "2500", share: "20.00" });
    const receipt = receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }]));

    const [p] = await rows(student.id);
    assert.equal(p.kind, "CLASS");
    assert.equal(dec(p.amount), "2500.00");
    assert.equal(p.billingYear, 2026);
    assert.equal(p.billingMonth, 10);
    assert.equal(p.courseId, course.id);
    assert.equal(p.feeTierId, w.tiers.FULL.id);
    assert.equal(dec(p.instituteSharePercentApplied), "20.00");
    assert.match(p.transactionRef ?? "", UUID);
    assert.equal(p.takenById, w.admin.id);
    assert.equal(p.paidAt.toISOString(), "2026-10-15T06:00:00.000Z");
    assert.equal(p.cancelled, false);
    assert.equal(p.comboApplied, false);
    assert.equal(p.comboId, null);

    assert.equal(receipt.reference, `XN-${p.id}`);
    assert.equal(receipt.total, "2500.00");
    assert.equal(receipt.date, "2026-10-15");
    assert.equal(receipt.at, "11:30");
    assert.equal(receipt.lines.length, 1);
    assert.equal(receipt.lines[0].amount, "2500.00");
    assert.ok(receipt.lines[0].label.endsWith("— Oct 2026"), receipt.lines[0].label);
  });

  test("STAFF can take a payment too, and is recorded as the taker", async () => {
    const { course, student } = await setup();
    as("staff");
    const res = await actions.takePayment({ studentId: student.id, admission: false, smartCard: false, classMonths: [{ courseId: course.id, ...OCT }], comboDecisions: [] });
    assert.equal(res.ok, true);
    assert.equal((await rows(student.id))[0].takenById, w.staff.id);
  });

  test("the HALF tier charges base × 0.5 (2500 → 1250.00)", async () => {
    const { course, student } = await setup({ fee: "2500", tier: "HALF" });
    receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }]));
    const [p] = await rows(student.id);
    assert.equal(dec(p.amount), "1250.00");
    assert.equal(p.feeTierId, w.tiers.HALF.id);
  });

  for (const [fee, expected, note] of [
    ["1333.33", "666.66", "666.665"],
    ["1250.05", "625.02", "625.025"],
    ["10.15", "5.08", "5.075"],
  ] as const) {
    test(`CURRENT BEHAVIOUR (float rounding, see report 9.2): ${fee} × 0.5 (${note}) is stored as ${expected}`, async () => {
      // Money is computed in a JS float then toFixed(2): half-cent results round on the
      // binary value, so they can go either way. Not triggered by today's whole-rupee fees.
      const { course, student } = await setup({ fee, tier: "HALF" });
      const receipt = receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }]));
      assert.equal(dec((await rows(student.id))[0].amount), expected);
      assert.equal(receipt.total, expected);
    });
  }

  test("a past payment is a snapshot: later fee and share edits never change it", async () => {
    const { course, student } = await setup({ fee: "2500", share: "20.00" });
    receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }]));
    await db.course.update({ where: { id: course.id }, data: { defaultFee: "9999", instituteSharePercent: "50.00" } });
    const [p] = await rows(student.id);
    assert.equal(dec(p.amount), "2500.00");
    assert.equal(dec(p.instituteSharePercentApplied), "20.00");
  });

  // ---- one checkout, several lines -------------------------------------------------

  test("two classes in one checkout: ONE transactionRef, one receipt, the lowest id as reference, correct total", async () => {
    const t = await makeTeacher(db);
    const a = await makeCourse(db, w, { teacherId: t.id, fee: "2500" });
    const b = await makeCourse(db, w, { teacherId: t.id, fee: "1800" });
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: a.id, tierId: w.tiers.FULL.id, since: SINCE });
    await enrol(db, { studentId: student.id, courseId: b.id, tierId: w.tiers.HALF.id, since: SINCE });

    const receipt = receiptOf(await charge(student.id, [{ courseId: a.id, ...OCT }, { courseId: b.id, ...OCT }]));
    const ps = await rows(student.id);
    assert.equal(ps.length, 2);
    assert.equal(new Set(ps.map((p) => p.transactionRef)).size, 1);
    assert.match(ps[0].transactionRef ?? "", UUID);
    assert.deepEqual(ps.map((p) => dec(p.amount)), ["2500.00", "900.00"]);
    assert.equal(receipt.total, "3400.00");
    assert.equal(receipt.reference, `XN-${ps[0].id}`);
    assert.deepEqual(receipt.lines.map((l) => l.amount), ["2500.00", "900.00"]);
  });

  test("a multi-month catch-up for one course is also a single transaction", async () => {
    const { course, student } = await setup();
    const receipt = receiptOf(await charge(student.id, [{ courseId: course.id, year: 2026, month: 8 }, { courseId: course.id, year: 2026, month: 9 }, { courseId: course.id, ...OCT }]));
    const ps = await rows(student.id);
    assert.deepEqual(ps.map((p) => p.billingMonth), [8, 9, 10]);
    assert.equal(new Set(ps.map((p) => p.transactionRef)).size, 1);
    assert.equal(receipt.total, "7500.00");
  });

  test("two separate checkouts get two different transactionRefs", async () => {
    const { course, student } = await setup();
    receiptOf(await charge(student.id, [{ courseId: course.id, year: 2026, month: 9 }]));
    receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }]));
    const ps = await rows(student.id);
    assert.notEqual(ps[0].transactionRef, ps[1].transactionRef);
  });

  // ---- combos ------------------------------------------------------------------------

  test("combo applied: each course is charged its combo fee, and the decision is recorded", async () => {
    const { a, b, combo, student } = await comboSetup();
    const receipt = receiptOf(await charge(student.id, [{ courseId: a.id, ...OCT }, { courseId: b.id, ...OCT }], { comboDecisions: [{ comboId: combo.id, apply: true }] }));
    const ps = await rows(student.id);
    assert.deepEqual(ps.map((p) => dec(p.amount)), ["2000.00", "1500.00"]);
    for (const p of ps) {
      assert.equal(p.comboId, combo.id);
      assert.equal(p.comboApplied, true);
      assert.equal(p.comboRefusedReason, null);
    }
    assert.deepEqual(ps.map((p) => dec(p.instituteSharePercentApplied)), ["20.00", "30.00"]);
    assert.equal(receipt.total, "3500.00");
  });

  test("combo fee × tier: a HALF-tier student pays half of the combo fee", async () => {
    const { a, b, combo, student } = await comboSetup("HALF");
    receiptOf(await charge(student.id, [{ courseId: a.id, ...OCT }, { courseId: b.id, ...OCT }], { comboDecisions: [{ comboId: combo.id, apply: true }] }));
    assert.deepEqual((await rows(student.id)).map((p) => dec(p.amount)), ["1000.00", "750.00"]);
  });

  test("combo declined with a reason: normal fees, the offered combo and the trimmed reason are recorded", async () => {
    const { a, b, combo, student } = await comboSetup();
    receiptOf(await charge(student.id, [{ courseId: a.id, ...OCT }, { courseId: b.id, ...OCT }], { comboDecisions: [{ comboId: combo.id, apply: false, reason: "  parent asked to pay full  " }] }));
    const ps = await rows(student.id);
    assert.deepEqual(ps.map((p) => dec(p.amount)), ["2500.00", "1800.00"]);
    for (const p of ps) {
      assert.equal(p.comboId, combo.id);
      assert.equal(p.comboApplied, false);
      assert.equal(p.comboRefusedReason, "parent asked to pay full");
    }
  });

  test("a combo decision is required for every combo the checkout touches", async () => {
    const { a, student } = await comboSetup();
    await refused(charge(student.id, [{ courseId: a.id, ...OCT }]), student.id, "A combined-rate decision is missing.");
  });

  test("refusing a combo needs a reason — empty, blank and missing are all refused", async () => {
    const { a, b, combo, student } = await comboSetup();
    for (const reason of [undefined, "", "   "]) {
      await refused(charge(student.id, [{ courseId: a.id, ...OCT }, { courseId: b.id, ...OCT }], { comboDecisions: [{ comboId: combo.id, apply: false, reason }] }), student.id, "A reason is required when the combined rate is refused.");
    }
  });

  test("a decision for a combo the checkout does not touch is ignored, not trusted", async () => {
    const { course, student } = await setup();
    const other = await comboSetup();
    receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }], { comboDecisions: [{ comboId: other.combo.id, apply: true }] }));
    const [p] = await rows(student.id);
    assert.equal(dec(p.amount), "2500.00");
    assert.equal(p.comboId, null);
  });

  test("the client cannot claim a combo it does not qualify for (rule 16)", async () => {
    // Enrolled in only ONE of the combo's two courses → not eligible, whatever the client says.
    const { a, combo } = await comboSetup();
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: a.id, tierId: w.tiers.FULL.id, since: SINCE });
    receiptOf(await charge(student.id, [{ courseId: a.id, ...OCT }], { comboDecisions: [{ comboId: combo.id, apply: true }] }));
    const [p] = await rows(student.id);
    assert.equal(dec(p.amount), "2500.00");
    assert.equal(p.comboApplied, false);
    assert.equal(p.comboId, null);
  });

  test("CURRENT BEHAVIOUR (will change in job 3: combo rules): paying ONE course of a combo still needs a decision, and 'apply' gives that course its combo fee", async () => {
    // Eligibility is 'all courses enrolled', not 'all courses paid this checkout'.
    const { a, combo, student } = await comboSetup();
    receiptOf(await charge(student.id, [{ courseId: a.id, ...OCT }], { comboDecisions: [{ comboId: combo.id, apply: true }] }));
    const [p] = await rows(student.id);
    assert.equal(dec(p.amount), "2000.00");
    assert.equal(p.comboApplied, true);
  });

  // ---- admission and smart card ------------------------------------------------------

  test("admission is charged once, from the setting, and flips Student.admissionPaid in the same transaction", async () => {
    const student = await makeStudent(db);
    const receipt = receiptOf(await charge(student.id, [], { admission: true }));
    const [p] = await rows(student.id);
    assert.equal(p.kind, "ADMISSION");
    assert.equal(dec(p.amount), "1500.00");
    assert.equal(p.courseId, null);
    assert.equal(p.billingMonth, null);
    assert.equal(p.instituteSharePercentApplied, null);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, true);
    assert.equal(receipt.lines[0].label, "Admission fee");
    assert.equal(receipt.total, "1500.00");
  });

  test("a second admission charge is refused, and nothing is written", async () => {
    const student = await makeStudent(db);
    receiptOf(await charge(student.id, [], { admission: true }));
    await refused(charge(student.id, [], { admission: true }), student.id, "Admission has already been paid.");
  });

  test("admission + smart card + a class in one checkout share one transaction", async () => {
    const { course, student } = await setup();
    const receipt = receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }], { admission: true, smartCard: true }));
    const ps = await rows(student.id);
    assert.deepEqual(ps.map((p) => p.kind), ["ADMISSION", "SMART_CARD", "CLASS"]);
    assert.equal(new Set(ps.map((p) => p.transactionRef)).size, 1);
    assert.equal(receipt.total, "4500.00"); // 1500 + 500 + 2500
  });

  test("smart card: charged from the setting and records which card it issued", async () => {
    const { student } = await setup();
    const card = (await db.student.findUniqueOrThrow({ where: { id: student.id } })).cardUid;
    receiptOf(await charge(student.id, [], { smartCard: true }));
    const [p] = await rows(student.id);
    assert.equal(p.kind, "SMART_CARD");
    assert.equal(dec(p.amount), "500.00");
    assert.equal(p.cardUidIssued, card);
  });

  test("smart card is GUARDED (job 3A — was 'unguarded'): the same card is charged once; a second charge is refused in plain words and writes nothing", async () => {
    const student = await makeStudent(db, { cardUid: "UIDREPEAT01" });
    receiptOf(await charge(student.id, [], { smartCard: true }));
    const again = await charge(student.id, [], { smartCard: true });
    assert.deepEqual(again, {
      ok: false,
      error: "This card was already charged on 2026-10-15. If it is a replacement card, change the card number and UID in Registration first.",
    });
    assert.equal((await rows(student.id)).filter((p) => p.kind === "SMART_CARD" && !p.cancelled).length, 1);
  });

  test("the fee settings are read live, to 2dp", async () => {
    await db.setting.update({ where: { key: "admission_fee" }, data: { value: "1250.5" } });
    try {
      const student = await makeStudent(db);
      receiptOf(await charge(student.id, [], { admission: true }));
      assert.equal(dec((await rows(student.id))[0].amount), "1250.50");
    } finally {
      await db.setting.update({ where: { key: "admission_fee" }, data: { value: "1500" } });
    }
  });

  test("CURRENT BEHAVIOUR (silent zero fee): a missing or empty fee setting charges 0.00 instead of failing", async () => {
    const saved = await db.setting.findUniqueOrThrow({ where: { key: "smart_card_fee" } });
    try {
      await db.setting.delete({ where: { key: "smart_card_fee" } });
      const a = await makeStudent(db);
      const missing = receiptOf(await charge(a.id, [], { smartCard: true }));
      assert.equal(dec((await rows(a.id))[0].amount), "0.00");
      assert.equal(missing.total, "0.00");

      await db.setting.create({ data: { key: "smart_card_fee", value: "" } });
      const b = await makeStudent(db);
      receiptOf(await charge(b.id, [], { smartCard: true }));
      assert.equal(dec((await rows(b.id))[0].amount), "0.00");

      await db.setting.update({ where: { key: "smart_card_fee" }, data: { value: "0" } });
      const c = await makeStudent(db);
      receiptOf(await charge(c.id, [], { admission: false, smartCard: true }));
      assert.equal(dec((await rows(c.id))[0].amount), "0.00");
    } finally {
      await db.setting.upsert({ where: { key: "smart_card_fee" }, create: { key: "smart_card_fee", value: saved.value }, update: { value: saved.value } });
    }
  });

  // ---- refusals ----------------------------------------------------------------------

  test("a FREE-tier course is refused, and nothing is written", async () => {
    const { course, student } = await setup({ tier: "FREE" });
    await refused(charge(student.id, [{ courseId: course.id, ...OCT }]), student.id, "Free-tier courses are not charged.");
  });

  test("a course the student is not enrolled in is refused", async () => {
    const { course } = await setup();
    const stranger = await makeStudent(db);
    await refused(charge(stranger.id, [{ courseId: course.id, ...OCT }]), stranger.id, "That course is no longer an active enrolment.");
  });

  test("a DROPPED enrolment is refused like a missing one", async () => {
    const t = await makeTeacher(db);
    const course = await makeCourse(db, w, { teacherId: t.id, fee: "2500" });
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: course.id, tierId: w.tiers.FULL.id, since: SINCE, status: "DROPPED" });
    await refused(charge(student.id, [{ courseId: course.id, ...OCT }]), student.id, "That course is no longer an active enrolment.");
  });

  test("an unknown student is refused", async () => {
    assert.deepEqual(await charge(987654, [{ courseId: 1, ...OCT }]), { ok: false, error: "Student not found." });
  });

  test("a month before the enrolment month is refused; the enrolment month itself is allowed", async () => {
    const { course, student } = await setup({ since: "2026-08-10T06:00:00Z" });
    await refused(charge(student.id, [{ courseId: course.id, year: 2026, month: 7 }]), student.id, "That month is before the student was enrolled.");
    receiptOf(await charge(student.id, [{ courseId: course.id, year: 2026, month: 8 }]));
  });

  test("up to 3 months ahead may be paid (across the year end); the 4th is refused", async () => {
    const { course, student } = await setup();
    receiptOf(await charge(student.id, [{ courseId: course.id, year: 2027, month: 1 }]));
    await refused(charge(student.id, [{ courseId: course.id, year: 2027, month: 2 }]), student.id, "Cannot charge more than 3 months ahead.");
  });

  test("nothing is written when ONE line of a multi-line checkout is refused", async () => {
    const { course, student } = await setup();
    await refused(charge(student.id, [{ courseId: course.id, ...OCT }, { courseId: course.id, year: 2027, month: 6 }]), student.id, "Cannot charge more than 3 months ahead.");
  });

  // ---- atomicity ------------------------------------------------------------------------

  test("a failure part-way through a checkout rolls back EVERYTHING it had already written", async () => {
    // A 2.0x tier on a huge fee overflows Decimal(10,2) on the LAST line, after the
    // admission row, the smart-card row and a good class row have all been written.
    const double = await db.feeTier.create({ data: { code: "DOUBLE", label: "Double", multiplier: "2.000" } });
    const t = await makeTeacher(db);
    const good = await makeCourse(db, w, { teacherId: t.id, fee: "2500" });
    const huge = await makeCourse(db, w, { teacherId: t.id, fee: "99999999.00" });
    const student = await makeStudent(db);
    await enrol(db, { studentId: student.id, courseId: good.id, tierId: w.tiers.FULL.id, since: SINCE });
    await enrol(db, { studentId: student.id, courseId: huge.id, tierId: double.id, since: SINCE });

    await assert.rejects(() => charge(student.id, [{ courseId: good.id, ...OCT }, { courseId: huge.id, ...OCT }], { admission: true, smartCard: true }));

    assert.equal((await rows(student.id)).length, 0, "no payment row may survive");
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: student.id } })).admissionPaid, false, "the admission flag must roll back too");
  });

  // ---- paying the same month twice -----------------------------------------------------

  test("paying a settled month again is refused, naming the course and month", async () => {
    const { course, student } = await setup({});
    receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }]));
    const label = (await db.course.findUniqueOrThrow({ where: { id: course.id } })).name;
    const res = await charge(student.id, [{ courseId: course.id, ...OCT }]);
    assert.equal(res.ok, false);
    assert.ok((res as { error: string }).error.endsWith(" — Oct 2026 is already paid."), JSON.stringify(res));
    assert.ok((res as { error: string }).error.includes(String(label)), JSON.stringify(res));
    assert.equal((await rows(student.id)).length, 1);
  });

  test("the same course+month listed twice in ONE request is refused and writes nothing (job 3A — it used to be charged twice)", async () => {
    // The stored rows were checked; the request itself was not. Now it is, before any write.
    const { course, student } = await setup();
    const res = await charge(student.id, [{ courseId: course.id, ...OCT }, { courseId: course.id, ...OCT }]);
    assert.equal(res.ok, false);
    assert.match((res as { error: string }).error, / — Oct 2026 is listed twice in this payment\.$/);
    assert.equal((await rows(student.id)).length, 0);
    // the same month in two different months of the SAME course is, of course, fine
    receiptOf(await charge(student.id, [{ courseId: course.id, ...OCT }, { courseId: course.id, year: 2026, month: 9 }]));
    assert.equal((await rows(student.id)).length, 2);
  });

  // ---- the server accepts months the panel never offers ----------------------------------

  test("CURRENT BEHAVIOUR (will change in job 3: any past month will be payable): the server accepts a past month older than the panel's window", async () => {
    // The panel offers 5 past months; takePayment only requires 'not before enrolment'.
    const { course, student } = await setup({ since: SINCE }); // April
    receiptOf(await charge(student.id, [{ courseId: course.id, year: 2026, month: 4 }]));
    assert.equal((await rows(student.id))[0].billingMonth, 4);
  });

  // ---- the panel (loadPanel) ------------------------------------------------------------

  test("CURRENT BEHAVIOUR (will change in job 3: any past month will be payable): the panel offers 5 past months + the current one + 3 ahead, oldest first", async () => {
    // MONTH_WINDOW = 6 → 'back' months INCLUDING the current one, i.e. 5 past (report 9.3).
    const { student } = await setup({ since: SINCE });
    as();
    const res = await actions.loadPanel({ studentId: student.id });
    assert.equal(res.status, "ok");
    const { months } = (res as Extract<typeof res, { status: "ok" }>).panel.courses[0];
    assert.deepEqual(months.map((m) => `${m.year}-${m.month}:${m.kind}`), [
      "2026-5:past", "2026-6:past", "2026-7:past", "2026-8:past", "2026-9:past",
      "2026-10:current",
      "2026-11:future", "2026-12:future", "2027-1:future",
    ]);
    assert.deepEqual(months.map((m) => m.label).slice(4, 7), ["Sep 2026", "Oct 2026", "Nov 2026"]);
  });

  test("the panel never offers a month before the enrolment started", async () => {
    const { student } = await setup({ since: "2026-08-10T06:00:00Z" });
    as();
    const res = await actions.loadPanel({ studentId: student.id });
    const { months } = (res as Extract<typeof res, { status: "ok" }>).panel.courses[0];
    assert.equal(`${months[0].year}-${months[0].month}`, "2026-8");
    assert.equal(months.length, 6); // Aug, Sep, Oct, Nov, Dec, Jan
  });

  test("the panel shows prices (fee × tier), the live fee settings, the card count and which months are paid", async () => {
    const { course, student } = await setup({ fee: "2500", tier: "HALF" });
    receiptOf(await charge(student.id, [{ courseId: course.id, year: 2026, month: 9 }], { smartCard: true }));
    as();
    const res = await actions.loadPanel({ studentId: student.id });
    const { panel } = res as Extract<typeof res, { status: "ok" }>;
    const line = panel.courses[0];
    assert.equal(line.monthly, "1250.00");
    assert.equal(line.free, false);
    assert.equal(line.tierCode, "HALF");
    assert.equal(line.months.find((m) => m.month === 9)?.paid, true);
    assert.equal(line.months.find((m) => m.month === 10)?.paid, false);
    assert.deepEqual(panel.admission, { chargeable: true, amount: "1500.00" });
    assert.equal(panel.smartCard.amount, "500.00");
    assert.equal(panel.smartCard.count, 1);
    assert.equal(panel.smartCard.lastAt, "2026-10-15");
  });

  test("a FREE-tier course shows no monthly price in the panel", async () => {
    const { student } = await setup({ tier: "FREE" });
    as();
    const res = await actions.loadPanel({ studentId: student.id });
    const line = (res as Extract<typeof res, { status: "ok" }>).panel.courses[0];
    assert.equal(line.free, true);
    assert.equal(line.monthly, null);
  });

  test("an unknown student gives status 'unknown'", async () => {
    as();
    assert.deepEqual(await actions.loadPanel({ studentId: 987654 }), { status: "unknown" });
  });

  // ---- the Colombo midnight and the month rollover ---------------------------------------

  test("the month rolls at midnight COLOMBO, not UTC: 23:59:59 on 31 Oct is still October, 00:00 on 1 Nov is November", async () => {
    const { course, student } = await setup({ since: SINCE });
    try {
      freezeClock("2026-10-31T18:29:59Z"); // 23:59:59 in Colombo
      as();
      let res = await actions.loadPanel({ studentId: student.id });
      let months = (res as Extract<typeof res, { status: "ok" }>).panel.courses[0].months;
      assert.equal(months.find((m) => m.kind === "current")?.month, 10);
      // Oct + 3 ahead = Jan is the last month; Feb is one too many.
      receiptOf(await charge(student.id, [{ courseId: course.id, year: 2027, month: 1 }]));
      await refused(charge(student.id, [{ courseId: course.id, year: 2027, month: 2 }]), student.id, "Cannot charge more than 3 months ahead.");

      freezeClock("2026-10-31T18:30:00Z"); // 00:00 on 1 Nov in Colombo
      res = await actions.loadPanel({ studentId: student.id });
      months = (res as Extract<typeof res, { status: "ok" }>).panel.courses[0].months;
      assert.equal(months.find((m) => m.kind === "current")?.month, 11);
      receiptOf(await charge(student.id, [{ courseId: course.id, year: 2027, month: 2 }])); // now only 3 ahead
    } finally {
      freezeClock(NOW);
    }
  });

  test("a payment taken just after Colombo midnight is stamped with the Colombo date, and billed to the month the cashier chose", async () => {
    const { course, student } = await setup({ since: SINCE });
    try {
      freezeClock("2026-10-31T19:30:00Z"); // 01:00 on 1 Nov in Colombo
      const receipt = receiptOf(await charge(student.id, [{ courseId: course.id, year: 2026, month: 10 }]));
      assert.equal(receipt.date, "2026-11-01");
      assert.equal(receipt.at, "01:00");
      const [p] = await rows(student.id);
      assert.equal(p.billingMonth, 10); // billed to October...
      assert.equal(p.paidAt.toISOString(), "2026-10-31T19:30:00.000Z"); // ...paid on 1 Nov (Colombo)
    } finally {
      freezeClock(NOW);
    }
  });
});
