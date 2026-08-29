"use server";

import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { applicableCombos, type ApplicableCombo } from "@/lib/combos";
import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import {
  findStudentByIdentifier,
  searchStudentsQuery,
  type StudentBrief,
} from "@/lib/students";

export type { StudentBrief };

/** How many months back the catch-up selector will ever offer. */
const MONTH_WINDOW = 6;

export type MonthOption = {
  year: number;
  month: number;
  /** "Sep 2026" */
  label: string;
  paid: boolean;
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

/** One staff decision per combo, for THIS transaction only — never remembered. */
export type ComboDecision = {
  comboId: number;
  apply: boolean;
  reason?: string;
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

export type ReceiptLine = { label: string; amount: string };

export type Receipt = {
  reference: string;
  at: string;
  date: string;
  student: { name: string; cardNumber: string | null };
  takenBy: string;
  lines: ReceiptLine[];
  total: string;
};

export type PanelResult =
  | { status: "unknown" }
  | { status: "ok"; panel: PaymentPanel };

export type ChargeResult =
  | { ok: true; receipt: Receipt }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------

const id = z.coerce.number().int().positive();

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const monthLabel = (y: number, m: number) => `${MONTH_NAMES[m - 1]} ${y}`;

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

/** Walk back from the current Colombo month, newest first. */
function monthsBackFrom(year: number, month: number, count: number) {
  const out: { year: number; month: number }[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < count; i++) {
    out.push({ year: y, month: m });
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
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

  const window = monthsBackFrom(y, m, MONTH_WINDOW);

  const courses: CourseLine[] = enrolments.map((e) => {
    const free = Number(String(e.feeTier.multiplier)) === 0;
    const enrolledFrom = colomboNow(e.createdAt);
    const [ey, em] = enrolledFrom.date.split("-").map(Number);

    // Offer months from the enrolment's own start month up to now, capped at
    // MONTH_WINDOW — charging a month before the student was enrolled is never
    // right, and an unbounded list is unusable at the counter.
    const months = window
      .filter((w) => w.year * 12 + w.month >= ey * 12 + em)
      .map((w) => ({
        year: w.year,
        month: w.month,
        label: monthLabel(w.year, w.month),
        paid: paidKey.has(`${e.course.id}:${w.year}:${w.month}`),
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
    .array(z.object({ courseId: id, year: id, month: z.coerce.number().int().min(1).max(12) }))
    .max(100),
  comboDecisions: z
    .array(
      z.object({
        comboId: id,
        apply: z.boolean(),
        reason: z.string().trim().max(300).optional(),
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
  classMonths: { courseId: number; year: number; month: number }[];
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
    // Never bill ahead of the current Colombo month.
    const [cy, cm] = now.date.split("-").map(Number);
    if (row.year * 12 + row.month > cy * 12 + cm) {
      return { ok: false, error: "Cannot charge a future month." };
    }
  }

  /*
   * Eligibility is recomputed here, never taken from the client — the combo
   * rate is a discount, so the client may say WHICH combo was decided, but not
   * whether the student qualifies or what the price is.
   */
  const combos = await applicableCombos(studentId);
  const comboByCourse = new Map<number, { comboId: number; comboFee: string }>();
  for (const combo of combos) {
    for (const item of combo.items) {
      comboByCourse.set(item.courseId, { comboId: combo.comboId, comboFee: item.comboFee });
    }
  }

  // Which combos this transaction actually touches — a decision is required for
  // each, and decisions for anything else are ignored rather than trusted.
  const involved = new Set(
    classMonths
      .map((c) => comboByCourse.get(c.courseId)?.comboId)
      .filter((v): v is number => v !== undefined),
  );

  const decisionByCombo = new Map<number, ComboDecision>();
  for (const d of comboDecisions) {
    if (involved.has(d.comboId)) decisionByCombo.set(d.comboId, d);
  }

  for (const comboId of involved) {
    const decision = decisionByCombo.get(comboId);
    if (!decision) {
      return { ok: false, error: "A combined-rate decision is missing." };
    }
    if (!decision.apply && !decision.reason?.trim()) {
      return {
        ok: false,
        error: "A reason is required when the combined rate is refused.",
      };
    }
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
  let total = 0;

  const created = await db.$transaction(async (tx) => {
    const ids: number[] = [];

    if (admission) {
      const amount = await settingAmount("admission_fee", "0");
      const row = await tx.payment.create({
        data: {
          kind: "ADMISSION",
          studentId,
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
      const inCombo = comboByCourse.get(row.courseId);
      const decision = inCombo ? decisionByCombo.get(inCombo.comboId) : undefined;
      const applyCombo = Boolean(inCombo && decision?.apply);

      // Combo rate or normal rate — the tier multiplier applies either way.
      const base = applyCombo ? inCombo!.comboFee : e.course.defaultFee;
      const amount = money(classFee(base, e.feeTier.multiplier));

      const created = await tx.payment.create({
        data: {
          kind: "CLASS",
          studentId,
          courseId: row.courseId,
          feeTierId: e.feeTier.id,
          billingYear: row.year,
          billingMonth: row.month,
          amount,
          takenById: user.id,
          paidAt,
          // Freeze the institute's cut as it stands right now. Editing the
          // course's % later must not rewrite this already-paid slip.
          instituteSharePercentApplied: e.course.instituteSharePercent,
          // A refusal still records the combo that was offered, so staff can
          // later justify why the discount was withheld.
          comboId: inCombo?.comboId ?? null,
          comboApplied: applyCombo,
          comboRefusedReason:
            inCombo && decision && !decision.apply ? decision.reason!.trim() : null,
        },
        select: { id: true },
      });
      ids.push(created.id);
      lines.push({
        label: `${courseDisplayName(e.course)} — ${monthLabel(row.year, row.month)}`,
        amount,
      });
      total += Number(amount);
    }

    return ids;
  });

  return {
    ok: true,
    receipt: {
      // No grouping column in the schema, so the reference is built from the
      // rows just written. Deliberately not persisted.
      reference: `XN-${created[0]}${created.length > 1 ? `-${created[created.length - 1]}` : ""}`,
      at: colomboNow(paidAt).time,
      date: colomboNow(paidAt).date,
      student: { name: student.name, cardNumber: student.cardNumber },
      takenBy: user.username,
      lines,
      total: money(total),
    },
  };
}
