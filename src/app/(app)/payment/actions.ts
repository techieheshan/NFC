"use server";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { applicableCombos, comboStates, type ApplicableCombo } from "@/lib/combos";
import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import {
  chargeModeSuffix,
  monthLabel,
  receiptReference,
  type Receipt,
  type ReceiptLine,
} from "@/lib/receipts";
import {
  findStudentByIdentifier,
  searchStudentsQuery,
  type StudentBrief,
} from "@/lib/students";

export type { StudentBrief };

/** How many months back the catch-up selector will ever offer. */
const MONTH_WINDOW = 6;
/**
 * How many months AHEAD may be paid.
 *
 * A student who was registered late still has to settle the months before they
 * had a card, and a parent settling a term in one visit pays ahead — so the
 * picker offers both directions. Bounded on purpose: an unbounded list is
 * unusable at a counter, and a typo'd year must not become a payment stamped
 * for 2031.
 */
const MONTH_AHEAD = 3;

export type MonthOption = {
  year: number;
  month: number;
  /** "Sep 2026" */
  label: string;
  paid: boolean;
  /** Which side of today this month is — the chips label the two ends. */
  kind: "past" | "current" | "future";
};

export type CourseLine = {
  courseId: number;
  course: string;
  teacher: string;
  tierCode: string;
  tierLabel: string;
  /** `defaultFee × multiplier`, 2dp. null when the tier is FREE. */
  monthly: string | null;
  /** `comboFee × multiplier` when this course belongs to a qualifying combo. */
  comboMonthly: string | null;
  comboId: number | null;
  free: boolean;
  months: MonthOption[];
};

export type { ApplicableCombo };

/**
 * How much of a month's fee one line charges. FULL (or absent) is today's behaviour;
 * HALF is 50% of what would otherwise be charged; NO_CHARGE records the month as settled
 * with no money. A client sends only the mode — the server computes every amount.
 */
export type PaymentMode = "FULL" | "HALF" | "NO_CHARGE";

/** One staff decision per combo, for THIS transaction only — never remembered. */
export type ComboDecision = {
  comboId: number;
  apply: boolean;
  reason?: string;
  /**
   * Optional. Staff switched this combo OFF: the normal rate is charged and no reason is
   * needed (a teacher may simply say a student does not get it). Absent = today's rules:
   * a refusal needs a reason. It wins over `apply`, and the row records "not applied"
   * with no reason text.
   */
  off?: boolean;
};

export type PaymentPanel = {
  student: StudentBrief;
  admission: { chargeable: boolean; amount: string };
  smartCard: {
    amount: string;
    /** How many times this student has already been charged for a card. */
    count: number;
    lastAt: string | null;
    currentUid: string | null;
  };
  courses: CourseLine[];
  /**
   * Combos this student qualifies for — at most one per teacher. The panel
   * shows the combo rate on the affected courses, but nothing is discounted
   * until staff answer the fraud check at confirm time.
   */
  combos: ApplicableCombo[];
};

// The receipt shape lives in src/lib/receipts.ts, because the Receipts screen
// reprints the very same document. Re-exported so the print component keeps
// importing it from the screen it belongs to.
export type { Receipt, ReceiptLine };

export type PanelResult =
  | { status: "unknown" }
  | { status: "ok"; panel: PaymentPanel };

export type ChargeResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------

const id = z.coerce.number().int().positive();

/** Money always leaves the DB as a fixed 2dp string; never a float in the UI. */
const money = (n: number) => n.toFixed(2);

/**
 * The monthly charge for one enrolment: `Course.defaultFee × FeeTier.multiplier`.
 * Both operands come from the database — nothing about pricing is inlined.
 */
function classFee(defaultFee: unknown, multiplier: unknown): number {
  return Number(String(defaultFee)) * Number(String(multiplier));
}

async function settingAmount(key: string, fallback: string): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } });
  return money(Number(row?.value ?? fallback));
}

/** Month arithmetic on a plain ordinal — no Date, no timezone to get wrong. */
const ordinal = (year: number, month: number) => year * 12 + (month - 1);
const fromOrdinal = (o: number) => ({ year: Math.floor(o / 12), month: (o % 12) + 1 });

/**
 * The billing months on offer: `back` months of catch-up, the current month,
 * and `ahead` months of paying forward — oldest first, so the arrears a student
 * owes are the first thing staff see.
 */
function monthWindow(year: number, month: number, back: number, ahead: number) {
  const here = ordinal(year, month);
  const out: { year: number; month: number; kind: MonthOption["kind"] }[] = [];
  for (let o = here - (back - 1); o <= here + ahead; o++) {
    out.push({
      ...fromOrdinal(o),
      kind: o < here ? "past" : o === here ? "current" : "future",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reads — guarded like the writes; the panel exposes a student's whole fee
// history, which must not be readable by a role that can't take payments.
// ---------------------------------------------------------------------------

export async function searchStudents(query: string): Promise<StudentBrief[]> {
  await requireOperationalAccess();
  return searchStudentsQuery(query);
}

export async function loadPanel(input: {
  cardUid?: string;
  cardNumber?: string;
  studentId?: number;
}): Promise<PanelResult> {
  await requireOperationalAccess();

  const brief = await findStudentByIdentifier(input);
  if (!brief) return { status: "unknown" };

  const now = colomboNow();
  const [y, m] = now.date.split("-").map(Number);

  const [student, enrolments, smartCards, classPayments] = await Promise.all([
    db.student.findUniqueOrThrow({
      where: { id: brief.id },
      select: { admissionPaid: true, cardUid: true },
    }),
    db.enrollment.findMany({
      where: { studentId: brief.id, status: "ACTIVE" },
      include: {
        feeTier: { select: { code: true, label: true, multiplier: true } },
        course: {
          select: {
            id: true,
            name: true,
            defaultFee: true,
            teacher: { select: { name: true } },
            subject: { select: { label: true } },
            grade: { select: { label: true } },
            classType: { select: { label: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    }),
    db.payment.findMany({
      where: { studentId: brief.id, kind: "SMART_CARD", cancelled: false },
      select: { paidAt: true },
      orderBy: { paidAt: "desc" },
    }),
    db.payment.findMany({
      where: { studentId: brief.id, kind: "CLASS", cancelled: false },
      select: { courseId: true, billingYear: true, billingMonth: true },
    }),
  ]);

  // Cancelled payments are excluded above, so a cancelled month is payable again.
  const paidKey = new Set(
    classPayments.map((p) => `${p.courseId}:${p.billingYear}:${p.billingMonth}`),
  );

  // Eligibility comes from enrolment, so it is computed once for the student
  // rather than per selected course.
  const combos = await applicableCombos(brief.id);
  const comboByCourse = new Map<number, { comboId: number; comboFee: string }>();
  for (const combo of combos) {
    for (const item of combo.items) {
      comboByCourse.set(item.courseId, {
        comboId: combo.comboId,
        comboFee: item.comboFee,
      });
    }
  }

  const window = monthWindow(y, m, MONTH_WINDOW, MONTH_AHEAD);

  const courses: CourseLine[] = enrolments.map((e) => {
    const free = Number(String(e.feeTier.multiplier)) === 0;
    const enrolledFrom = colomboNow(e.createdAt);
    const [ey, em] = enrolledFrom.date.split("-").map(Number);

    // Offer months from the enrolment's own start month up to now, capped at
    // MONTH_WINDOW — charging a month before the student was enrolled is never
    // right, and an unbounded list is unusable at the counter.
    const months = window
      .filter((w) => ordinal(w.year, w.month) >= ordinal(ey, em))
      .map((w) => ({
        year: w.year,
        month: w.month,
        label: monthLabel(w.year, w.month),
        paid: paidKey.has(`${e.course.id}:${w.year}:${w.month}`),
        kind: w.kind,
      }));

    // The combo rate is shown for information; it only becomes the charged
    // price once staff answer the fraud check at confirm time.
    const inCombo = comboByCourse.get(e.course.id);

    return {
      courseId: e.course.id,
      course: courseDisplayName(e.course),
      teacher: e.course.teacher.name,
      tierCode: e.feeTier.code,
      tierLabel: e.feeTier.label,
      monthly: free ? null : money(classFee(e.course.defaultFee, e.feeTier.multiplier)),
      comboMonthly:
        free || !inCombo
          ? null
          : money(classFee(inCombo.comboFee, e.feeTier.multiplier)),
      comboId: inCombo?.comboId ?? null,
      free,
      months,
    };
  });

  return {
    status: "ok",
    panel: {
      student: brief,
      admission: {
        chargeable: !student.admissionPaid,
        amount: await settingAmount("admission_fee", "0"),
      },
      smartCard: {
        amount: await settingAmount("smart_card_fee", "0"),
        count: smartCards.length,
        lastAt: smartCards[0] ? colomboNow(smartCards[0].paidAt).date : null,
        currentUid: student.cardUid,
      },
      courses,
      combos,
    },
  };
}

// ---------------------------------------------------------------------------
// The charge
// ---------------------------------------------------------------------------

const chargeSchema = z.object({
  studentId: id,
  admission: z.boolean(),
  smartCard: z.boolean(),
  classMonths: z
    .array(
      z.object({
        courseId: id,
        year: id,
        month: z.coerce.number().int().min(1).max(12),
        // Optional: absent means FULL, exactly as before. The client says WHICH mode,
        // never an amount.
        mode: z.enum(["FULL", "HALF", "NO_CHARGE"]).optional(),
      }),
    )
    .max(100),
  comboDecisions: z
    .array(
      z.object({
        comboId: id,
        apply: z.boolean(),
        reason: z.string().trim().max(300).optional(),
        off: z.boolean().optional(),
      }),
    )
    .max(20),
});

/**
 * Takes the payment. Amounts are recomputed from the database here — the client
 * sends only *what* to charge, never *how much*.
 */
export async function takePayment(input: {
  studentId: number;
  admission: boolean;
  smartCard: boolean;
  classMonths: { courseId: number; year: number; month: number; mode?: PaymentMode }[];
  comboDecisions: ComboDecision[];
}): Promise<ChargeResult> {
  const user = await requireOperationalAccess();

  const parsed = chargeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid payment request." };
  const { studentId, admission, smartCard, classMonths, comboDecisions } = parsed.data;

  if (!admission && !smartCard && classMonths.length === 0) {
    return { ok: false, error: "Nothing selected to charge." };
  }

  const now = colomboNow();
  const paidAt = new Date();
  /**
   * One reference for everything this checkout writes. A combo across three
   * courses, or a three-month catch-up, is a single receipt — this is what lets
   * it be reprinted as that document and cancelled as a unit.
   */
  const transactionRef = randomUUID();

  const student = await db.student.findUnique({
    where: { id: studentId },
    select: { id: true, name: true, cardNumber: true, cardUid: true, admissionPaid: true },
  });
  if (!student) return { ok: false, error: "Student not found." };

  if (admission && student.admissionPaid) {
    return { ok: false, error: "Admission has already been paid." };
  }

  // Every selected month must belong to an ACTIVE, non-FREE enrolment.
  const enrolments = await db.enrollment.findMany({
    where: {
      studentId,
      status: "ACTIVE",
      courseId: { in: [...new Set(classMonths.map((c) => c.courseId))] },
    },
    include: {
      feeTier: { select: { id: true, multiplier: true } },
      course: {
        select: {
          id: true,
          name: true,
          defaultFee: true,
          // Frozen onto each CLASS payment at creation.
          instituteSharePercent: true,
          teacher: { select: { name: true } },
          subject: { select: { label: true } },
          grade: { select: { label: true } },
          classType: { select: { label: true } },
        },
      },
    },
  });
  const byCourse = new Map(enrolments.map((e) => [e.course.id, e]));

  for (const row of classMonths) {
    const e = byCourse.get(row.courseId);
    if (!e) return { ok: false, error: "That course is no longer an active enrolment." };
    if (Number(String(e.feeTier.multiplier)) === 0) {
      return { ok: false, error: "Free-tier courses are not charged." };
    }
    // The month is the client's to choose, but only inside the same window the
    // panel offered: paying ahead is legitimate, paying for 2031 is a typo, and
    // billing a month before the student was even enrolled never is.
    const [cy, cm] = now.date.split("-").map(Number);
    const asked = ordinal(row.year, row.month);
    const here = ordinal(cy, cm);
    if (asked > here + MONTH_AHEAD) {
      return { ok: false, error: `Cannot charge more than ${MONTH_AHEAD} months ahead.` };
    }
    const enrolled = colomboNow(e.createdAt).date.split("-").map(Number);
    if (asked < ordinal(enrolled[0], enrolled[1])) {
      return { ok: false, error: "That month is before the student was enrolled." };
    }
  }

  /*
   * Eligibility AND whether anyone must answer are recomputed here, never taken from the
   * client — the combo rate is a discount, so the client may say WHICH combo was decided,
   * but not whether the student qualifies, what the price is, or whether a question was due.
   * `comboStates` is the one rule (see combos.ts).
   */
  const switchedOff = new Set(comboDecisions.filter((d) => d.off).map((d) => d.comboId));
  const combos = await comboStates(studentId, { switchedOff });
  const comboByCourse = new Map<number, { comboId: number; comboFee: string }>();
  for (const combo of combos) {
    for (const item of combo.items) {
      comboByCourse.set(item.courseId, { comboId: combo.comboId, comboFee: item.comboFee });
    }
  }
  const stateByCombo = new Map(combos.map((c) => [c.comboId, c.state]));

  // Which combos this transaction actually touches. Decisions for anything else are
  // ignored rather than trusted.
  const involved = new Set(
    classMonths
      // A month recorded with no charge is 0.00 with or without the combo, so it
      // never needs a decision.
      .filter((c) => c.mode !== "NO_CHARGE")
      .map((c) => comboByCourse.get(c.courseId)?.comboId)
      .filter((v): v is number => v !== undefined),
  );

  const decisionByCombo = new Map<number, ComboDecision>();
  for (const d of comboDecisions) {
    if (involved.has(d.comboId)) decisionByCombo.set(d.comboId, d);
  }

  /**
   * What happens to each touched combo, once the rules have been applied:
   *   switched off          → normal rate, recorded as not applied, NO reason text
   *   a refusal             → honoured in every state, and it needs a reason, as always
   *   an acceptance         → applied
   *   no answer             → applied on its own, UNLESS the state is needs-confirmation
   *                           (a class with 0 days last month), which still needs a person
   * So an old client that answers every combo keeps working: an answer for a combo that
   * no longer needs one is honoured if it is a refusal and otherwise changes nothing.
   */
  const outcome = new Map<number, { apply: boolean; reason: string | null }>();
  for (const comboId of involved) {
    const state = stateByCombo.get(comboId);
    const decision = decisionByCombo.get(comboId);

    if (state === "off") {
      outcome.set(comboId, { apply: false, reason: null });
      continue;
    }
    if (decision && !decision.apply) {
      if (!decision.reason?.trim()) {
        return {
          ok: false,
          error: "A reason is required when the combined rate is refused.",
        };
      }
      outcome.set(comboId, { apply: false, reason: decision.reason.trim() });
      continue;
    }
    if (decision?.apply) {
      outcome.set(comboId, { apply: true, reason: null });
      continue;
    }
    if (state === "needs-confirmation") {
      return { ok: false, error: "A combined-rate decision is missing." };
    }
    outcome.set(comboId, { apply: true, reason: null });
  }

  // Idempotency: a stale tab must not double-charge a month already settled.
  const clashes = await db.payment.findMany({
    where: {
      studentId,
      kind: "CLASS",
      cancelled: false,
      OR: classMonths.map((c) => ({
        courseId: c.courseId,
        billingYear: c.year,
        billingMonth: c.month,
      })),
    },
    select: { courseId: true, billingYear: true, billingMonth: true },
  });
  if (classMonths.length > 0 && clashes.length > 0) {
    const c = clashes[0];
    // courseId is nullable on Payment for the same reason as the billing
    // columns — only CLASS rows carry one.
    const enrolled = c.courseId !== null ? byCourse.get(c.courseId) : undefined;
    const name = enrolled ? courseDisplayName(enrolled.course) : "That course";
    // billingYear/Month are nullable on Payment (ADMISSION/SMART_CARD have
    // none), but a CLASS row always carries them.
    const when =
      c.billingYear !== null && c.billingMonth !== null
        ? ` — ${monthLabel(c.billingYear, c.billingMonth)}`
        : "";
    return { ok: false, error: `${name}${when} is already paid.` };
  }

  const lines: ReceiptLine[] = [];
  const modes: PaymentMode[] = [];
  let total = 0;

  const created = await db.$transaction(async (tx) => {
    const ids: number[] = [];

    if (admission) {
      const amount = await settingAmount("admission_fee", "0");
      const row = await tx.payment.create({
        data: {
          kind: "ADMISSION",
          studentId,
          transactionRef,
          amount,
          takenById: user.id,
          paidAt,
        },
        select: { id: true },
      });
      // The one-time flag moves with the payment, inside the same transaction.
      await tx.student.update({ where: { id: studentId }, data: { admissionPaid: true } });
      ids.push(row.id);
      lines.push({ label: "Admission fee", amount });
      total += Number(amount);
    }

    if (smartCard) {
      const amount = await settingAmount("smart_card_fee", "0");
      const row = await tx.payment.create({
        data: {
          kind: "SMART_CARD",
          studentId,
          transactionRef,
          amount,
          // Records which card this charge issued — matters for reissues.
          cardUidIssued: student.cardUid,
          takenById: user.id,
          paidAt,
        },
        select: { id: true },
      });
      ids.push(row.id);
      lines.push({ label: "Smart card", amount });
      total += Number(amount);
    }

    for (const row of classMonths) {
      const e = byCourse.get(row.courseId)!;
      const mode: PaymentMode = row.mode ?? "FULL";
      // A NO_CHARGE month is outside the combo entirely: nothing is charged either way.
      const inCombo = mode === "NO_CHARGE" ? undefined : comboByCourse.get(row.courseId);
      const decided = inCombo ? outcome.get(inCombo.comboId) : undefined;
      const applyCombo = Boolean(inCombo && decided?.apply);

      // Combo rate or normal rate — the tier multiplier applies either way. HALF is half of
      // exactly that amount (as the receipt would have shown it); NO_CHARGE is nothing.
      const base = applyCombo ? inCombo!.comboFee : e.course.defaultFee;
      const full = money(classFee(base, e.feeTier.multiplier));
      const amount = mode === "HALF" ? money(Number(full) * 0.5) : mode === "NO_CHARGE" ? money(0) : full;

      const created = await tx.payment.create({
        data: {
          kind: "CLASS",
          studentId,
          transactionRef,
          courseId: row.courseId,
          feeTierId: e.feeTier.id,
          billingYear: row.year,
          billingMonth: row.month,
          amount,
          // NULL = the full fee (what every existing row and every old client means).
          chargeMode: mode === "FULL" ? null : mode,
          takenById: user.id,
          paidAt,
          // Freeze the institute's cut as it stands right now. Editing the
          // course's % later must not rewrite this already-paid slip.
          instituteSharePercentApplied: e.course.instituteSharePercent,
          // A refusal still records the combo that was offered, so staff can
          // later justify why the discount was withheld.
          comboId: inCombo?.comboId ?? null,
          comboApplied: applyCombo,
          comboRefusedReason: inCombo && decided && !decided.apply ? decided.reason : null,
        },
        select: { id: true },
      });
      ids.push(created.id);
      modes.push(mode);
      lines.push({
        label: `${courseDisplayName(e.course)} — ${monthLabel(row.year, row.month)}${chargeModeSuffix(mode === "FULL" ? null : mode)}`,
        amount,
      });
      total += Number(amount);
    }

    return ids;
  });

  return {
    ok: true,
    receipt: {
      // Human-facing reference: the lowest row id in the transaction. Short
      // enough for 58mm paper and stable, so a reprint prints the same string.
      // The grouping itself lives in transactionRef.
      reference: receiptReference(created),
      at: colomboNow(paidAt).time,
      date: colomboNow(paidAt).date,
      student: { name: student.name, cardNumber: student.cardNumber },
      takenBy: user.username,
      lines,
      total: money(total),
      // Only when EVERY line of this checkout is a month recorded with no charge (and
      // nothing else was taken). Absent otherwise — the old shape.
      ...(!admission && !smartCard && modes.length > 0 && modes.every((m) => m === "NO_CHARGE")
        ? { noCharge: true as const }
        : {}),
    },
  };
}
