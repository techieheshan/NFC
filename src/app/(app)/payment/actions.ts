"use server";

import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { requireOperationalAccess } from "@/lib/authz";
import { applicableCombos, comboStates, type ApplicableCombo } from "@/lib/combos";
import { colomboNow } from "@/lib/colombo-time";
import { courseDisplayName } from "@/lib/course-name";
import { db } from "@/lib/db";
import { friendlyDate } from "@/lib/friendly-date";
import { BACK_MONTHS } from "@/lib/payment-months";
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

/**
 * Namespace for the per-student advisory lock taken inside the charge transaction
 * (`pg_advisory_xact_lock(namespace, studentId)`). Any fixed number nothing else uses; it
 * only keeps this lock from ever colliding with another feature's.
 */
const PAYMENT_LOCK_NAMESPACE = 7301;

/**
 * Limits for the charge transaction. No `maxDuration` is set anywhere in this repo, so the
 * platform's own function limit applies (10 s on a plan without Fluid compute, 300 s with it).
 * The transaction's own limits add up to 8 s; with a cold start or a waking database the margin
 * under 10 s is thin, so the plan is an open release item (see AGENTS.md).
 *   - maxWait   how long to wait for a pooled connection to start the transaction
 *   - timeout   how long the transaction may run once started
 *   - lock wait how long to wait for ANOTHER checkout of the same student to finish. It is
 *               shorter than `timeout` on purpose: Prisma cannot roll a transaction back while
 *               its connection is still blocked inside the lock statement, so without this the
 *               waiter would only be answered when the other checkout finally ended.
 */
const TX_MAX_WAIT_MS = 2000;
const TX_TIMEOUT_MS = 6000;
const LOCK_WAIT_MS = 4000;

/**
 * Deliberately says what happened (not in time, nothing charged), not WHY: the cause may be
 * another checkout of the same student, an exhausted pool, a slow database or a long catch-up.
 */
const BUSY_MESSAGE = "The payment didn't go through in time and nothing was charged. Check Receipts, then try again.";

/**
 * True when the charge transaction could not run in time: it expired or could not start
 * (P2028), or the per-student lock was not free within LOCK_WAIT_MS (Postgres lock_not_available,
 * SQLSTATE 55P03). Nothing was written either way — the transaction rolled back.
 */
function isBusyError(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2028") return true;
  let detail = e.message;
  try {
    detail += ` ${JSON.stringify(e.meta ?? {})}`;
  } catch {
    // meta that cannot be serialised (a BigInt, a cycle) must not replace the real error — the
    // message alone decides.
  }
  return /55P03|lock timeout/i.test(detail);
}

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

/**
 * `client` is `db` by default. Inside the charge transaction pass `tx`: the transaction already
 * holds one pooled connection, and a read through `db` there would need a SECOND one while the
 * per-student lock is held — with enough overlapping requests the pool runs dry and the lock
 * holder waits for a connection that the waiters (blocked on its lock) never give back.
 */
async function settingAmount(
  key: string,
  fallback: string,
  client: { setting: typeof db.setting } = db,
): Promise<string> {
  const row = await client.setting.findUnique({ where: { key } });
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
        // Optional: absent means today's behaviour. Set only when staff confirmed a month BEFORE
        // the enrolment start (see the check below). It never carries an amount or a price.
        backMonth: z.boolean().optional(),
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
  classMonths: { courseId: number; year: number; month: number; mode?: PaymentMode; backMonth?: boolean }[];
  comboDecisions: ComboDecision[];
}): Promise<ChargeResult> {
  const user = await requireOperationalAccess();

  const parsed = chargeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid payment request." };
  const { studentId, admission, smartCard, classMonths, comboDecisions } = parsed.data;

  if (!admission && !smartCard && classMonths.length === 0) {
    return { ok: false, error: "Nothing selected to charge." };
  }

  // ONE instant for the whole request: the month limits, the "before enrolment" check, the
  // combo state and `paidAt` are all judged at it, so a request that straddles midnight (or
  // the 1st) cannot be judged against two different months.
  const paidAt = new Date();
  const now = colomboNow(paidAt);
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
      // A month before the enrolment is refused unless the request says staff confirmed it
      // (`backMonth`) — and even then only back to BACK_MONTHS before the current month, which is
      // also the floor that refuses a year typo. A request without the flag gets today's refusal,
      // word for word. `backMonth` on a month that is NOT before the enrolment never reaches here.
      if (row.backMonth !== true) {
        return { ok: false, error: "That month is before the student was enrolled." };
      }
      if (asked < here - BACK_MONTHS) {
        return { ok: false, error: `Cannot charge more than ${BACK_MONTHS} months back.` };
      }
    }
  }

  // The same course and month listed twice in one request would be charged twice (the stored
  // rows are checked, the request itself was not), and two entries may even disagree on the
  // mode. Nothing sensible can be assumed, so refuse and write nothing.
  const listed = new Set<string>();
  for (const row of classMonths) {
    const key = `${row.courseId}:${row.year}:${row.month}`;
    if (listed.has(key)) {
      const enrolled = byCourse.get(row.courseId);
      const name = enrolled ? courseDisplayName(enrolled.course) : "That course";
      return { ok: false, error: `${name} — ${monthLabel(row.year, row.month)} is listed twice in this payment.` };
    }
    listed.add(key);
  }

  /*
   * Eligibility AND whether anyone must answer are recomputed here, never taken from the
   * client — the combo rate is a discount, so the client may say WHICH combo was decided,
   * but not whether the student qualifies, what the price is, or whether a question was due.
   * `comboStates` is the one rule (see combos.ts).
   */
  const switchedOff = new Set(comboDecisions.filter((d) => d.off).map((d) => d.comboId));
  const combos = await comboStates(studentId, { switchedOff, at: paidAt });
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

  const lines: ReceiptLine[] = [];
  const modes: PaymentMode[] = [];
  let total = 0;

  const result = await db.$transaction(async (tx): Promise<{ refused: string } | { ids: number[] }> => {
    /*
     * One charge per student at a time. The checks below ("already paid?", "admission taken?",
     * "card already charged?") read rows and then write, and nothing in the database stops two
     * overlapping requests both reading "no" first. A transaction-scoped advisory lock makes the
     * second request WAIT for the first to commit, so its checks see the first one's rows and
     * it is refused with the normal message instead of creating a duplicate. It is released by
     * COMMIT or ROLLBACK, so it is safe through a transaction-pooling endpoint; different
     * students never wait for each other.
     */
    await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${LOCK_WAIT_MS}ms`}, true)`; // this transaction only
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYMENT_LOCK_NAMESPACE}::int, ${studentId}::int)`;

    // Authoritative state, read under the lock. (The earlier admission check only keeps the
    // order in which refusals are reported; this one is the one that cannot race.)
    const fresh = await tx.student.findUnique({
      where: { id: studentId },
      select: { admissionPaid: true, cardUid: true },
    });
    if (!fresh) return { refused: "Student not found." };
    if (admission && fresh.admissionPaid) return { refused: "Admission has already been paid." };

    // Idempotency: a stale tab, or a second request, must not double-charge a month already settled.
    if (classMonths.length > 0) {
      const clashes = await tx.payment.findMany({
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
        select: { courseId: true, billingYear: true, billingMonth: true, chargeMode: true },
        // Deterministic: the earliest clashing month is the one named.
        orderBy: [{ billingYear: "asc" }, { billingMonth: "asc" }, { id: "asc" }],
      });
      if (clashes.length > 0) {
        // "Recorded as no charge" only when EVERY clashing month is a no-charge record; if any
        // month was actually paid, the earliest such month is named as "already paid".
        const paid = clashes.find((x) => x.chargeMode !== "NO_CHARGE");
        const c = paid ?? clashes[0];
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
        // A month recorded as No charge is settled, but nobody paid for it: say so, and who can
        // undo it (only an administrator can cancel a payment record).
        if (!paid && when) {
          return { refused: `${name}${when} was recorded as no charge. Ask an administrator to cancel that record if it should be charged.` };
        }
        return { refused: `${name}${when} is already paid.` };
      }
    }

    // A card is charged once. A REPLACEMENT card has a new UID (it is changed by hand in
    // Registration), so it is chargeable again. Rows with no `cardUidIssued` (old data) never
    // match a UID, so they never block; a student with no UID at all cannot be guarded.
    if (smartCard && fresh.cardUid) {
      const prior = await tx.payment.findFirst({
        where: { studentId, kind: "SMART_CARD", cancelled: false, cardUidIssued: fresh.cardUid },
        orderBy: { paidAt: "desc" },
        select: { paidAt: true },
      });
      if (prior) {
        return {
          refused: `This card was already charged on ${friendlyDate(colomboNow(prior.paidAt).date)}. If it is a replacement card, change the card number and UID in Registration first.`,
        };
      }
    }

    const ids: number[] = [];

    if (admission) {
      const amount = await settingAmount("admission_fee", "0", tx);
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
      const amount = await settingAmount("smart_card_fee", "0", tx);
      const row = await tx.payment.create({
        data: {
          kind: "SMART_CARD",
          studentId,
          transactionRef,
          amount,
          // Records which card this charge issued — matters for reissues.
          cardUidIssued: fresh.cardUid,
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

    return { ids };
  }, { maxWait: TX_MAX_WAIT_MS, timeout: TX_TIMEOUT_MS }).catch((e: unknown) => {
    // Waiting on another checkout of this student for too long: a plain answer, never a throw
    // (the old screen has no catch, and the cashier would see the browser's crash page).
    if (isBusyError(e)) return { busy: true as const };
    throw e;
  });
  if ("busy" in result) return { ok: false, error: BUSY_MESSAGE };
  if ("refused" in result) return { ok: false, error: result.refused };
  const created = result.ids;

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
