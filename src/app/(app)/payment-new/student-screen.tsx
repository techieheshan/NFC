"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, UserRound } from "lucide-react";

import type { ChargeResult, ComboDecision, Receipt } from "@/app/(app)/payment/actions";
import { AutoPrintReceipt } from "@/app/(app)/payment/payment-screen";
import {
  chargeInput,
  chargeTotal,
  monthKey,
  toggleCard,
  toggleMonth,
  touchedComboIds,
  type ChargeCourse,
} from "@/lib/payment-charge";
import type { MonthDetail, PaymentView } from "@/lib/payment-view";
import { setVoiceEnabled, VOICE } from "@/lib/voice";

import { ComboSheet } from "./combo-sheet";
import { CourseCard } from "./course-card";
import { MonthDetailSheet } from "./month-detail";
import { MonthSheet } from "./month-sheet";

type Props = {
  view: PaymentView;
  /** The existing action, called with exactly the input it has always taken. */
  takePayment: (input: {
    comboDecisions: ComboDecision[];
    studentId: number;
    admission: boolean;
    smartCard: boolean;
    classMonths: { courseId: number; year: number; month: number }[];
  }) => Promise<ChargeResult>;
  loadMonthDetail: (input: {
    studentId: number;
    courseId: number;
    year: number;
    month: number;
  }) => Promise<MonthDetail | null>;
  voiceEnabled?: boolean;
};

const ROW = "flex min-h-14 w-full items-center gap-3 rounded-2xl border border-[#E1DAF0] bg-white p-3.5 text-left";

function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-[26px] shrink-0 place-items-center rounded-md border-2 ${
        checked ? "border-primary bg-primary text-primary-foreground" : "border-[#6B6680] bg-white"
      }`}
    >
      {checked && <Check className="size-4" strokeWidth={3.2} />}
    </span>
  );
}

export function StudentScreen({ view, takePayment, loadMonthDetail, voiceEnabled }: Props) {
  if (voiceEnabled !== undefined) setVoiceEnabled(voiceEnabled);

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [admission, setAdmission] = useState(false);
  const [smartCard, setSmartCard] = useState(false);
  // NOTHING is pre-selected: a ticked card is a charge nobody chose.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pendingCombos, setPendingCombos] = useState<PaymentView["combos"]>([]);
  const [decisions, setDecisions] = useState<ComboDecision[]>([]);
  const [calendarFor, setCalendarFor] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ courseId: number; year: number; month: number } | null>(null);

  const charge: ChargeCourse[] = useMemo(
    () =>
      view.courses.map((c) => ({
        courseId: c.courseId,
        free: c.free,
        monthly: c.monthly,
        comboMonthly: c.comboMonthly,
        comboId: c.comboId,
        months: c.months.map((m) => ({ year: m.year, month: m.month })),
      })),
    [view.courses],
  );

  const total = useMemo(
    () =>
      chargeTotal({
        admission,
        smartCard,
        admissionAmount: view.admission.amount,
        smartCardAmount: view.smartCard.amount,
        courses: charge,
        selected,
        decisions,
      }),
    [admission, smartCard, view.admission.amount, view.smartCard.amount, charge, selected, decisions],
  );

  const submit = useCallback(
    (finalDecisions: ComboDecision[]) => {
      setError(null);
      startTransition(async () => {
        try {
          const res = await takePayment(
            chargeInput({
              studentId: view.student.id,
              admission,
              smartCard,
              courses: charge,
              selected,
              comboDecisions: finalDecisions,
            }),
          );
          if (res.ok) {
            // Feedback fires the instant the money is recorded, as on the old screen.
            VOICE.paymentComplete();
            setReceipt(res.receipt);
          } else setError(res.error);
        } catch {
          // Payment is online-only and there is no queue. The request may or may not
          // have arrived, so say so rather than invite a second charge.
          setError(
            "Couldn't reach the server, so this payment may not have gone through. Check Receipts before trying again, so nobody is charged twice.",
          );
        }
      });
    },
    [takePayment, view.student.id, admission, smartCard, charge, selected],
  );

  /** One pop-up per combo this selection touches; the last answer charges. Nothing is remembered. */
  const confirm = useCallback(() => {
    setError(null);
    const touched = new Set(touchedComboIds(charge, selected));
    const queue = view.combos.filter((c) => touched.has(c.comboId));
    if (queue.length === 0) {
      submit([]);
      return;
    }
    setDecisions([]);
    setPendingCombos(queue);
  }, [charge, selected, view.combos, submit]);

  const answerCombo = useCallback(
    (decision: ComboDecision) => {
      const next = [...decisions, decision];
      const remaining = pendingCombos.slice(1);
      setDecisions(next);
      setPendingCombos(remaining);
      if (remaining.length === 0) submit(next);
    },
    [decisions, pendingCombos, submit],
  );

  const finish = useCallback(() => router.push("/payment-new"), [router]);

  if (receipt) return <AutoPrintReceipt receipt={receipt} onDone={finish} />;

  const calendarCourse = view.courses.find((c) => c.courseId === calendarFor) ?? null;
  const detailCourse = detail ? view.courses.find((c) => c.courseId === detail.courseId) : null;
  const detailMonth = detail
    ? detailCourse?.months.find((m) => m.year === detail.year && m.month === detail.month)
    : null;

  const admissionRow = view.admission.chargeable ? (
    <button type="button" onClick={() => setAdmission((v) => !v)} aria-pressed={admission} className={ROW}>
      <CheckBox checked={admission} />
      <span className="flex-1 text-base font-semibold">Admission</span>
      <span className="text-base font-bold tabular-nums">{view.admission.amount}</span>
    </button>
  ) : null;

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-4rem)] flex-col bg-[#F8F6FD] lg:-mx-8 lg:-my-8">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 px-4 py-4">
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[#EDE3FF] text-primary">
            {view.student.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={view.student.photoUrl} alt="" className="size-full object-cover" />
            ) : (
              <UserRound className="size-8" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[22px] leading-tight font-bold break-words">{view.student.name}</p>
            <p className="text-sm break-words text-[#5B5670]">{view.student.cardNumber ?? "no card number"}</p>
          </div>
          <Link
            href="/payment-new"
            className="grid h-11 shrink-0 place-items-center rounded-xl px-2 text-base font-semibold text-primary"
          >
            Change
          </Link>
        </div>

        {/* Unpaid admission sits right under the header; once paid it moves to the bottom. */}
        {admissionRow}

        {view.courses.length === 0 && (
          <p className="rounded-2xl border border-dashed border-[#D8D2E6] p-6 text-center text-sm text-[#5B5670]">
            No active enrolments.
          </p>
        )}

        {view.courses.map((c) => (
          <CourseCard
            key={c.courseId}
            course={c}
            selectedMonths={c.months.filter((m) => selected.has(monthKey(c.courseId, m.year, m.month)))}
            disabled={pending}
            onToggle={() => setSelected((prev) => toggleCard(c.courseId, c.cardMonth, prev))}
            onOpenCalendar={() => setCalendarFor(c.courseId)}
          />
        ))}

        {/* Always at the bottom, below the course cards, unchecked by default. */}
        <button type="button" onClick={() => setSmartCard((v) => !v)} aria-pressed={smartCard} className={ROW}>
          <CheckBox checked={smartCard} />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">Smart card</span>
            <span className="block text-[13px] text-[#5B5670]">
              {view.smartCard.count === 0
                ? "never charged"
                : `charged ${view.smartCard.count}× · last ${view.smartCard.lastAt}`}
            </span>
          </span>
          <span className="text-base font-bold tabular-nums">{view.smartCard.amount}</span>
        </button>

        {!view.admission.chargeable && (
          <div className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#E6E1F2] bg-[#F4F2F8] p-3.5 text-[#5B5670]">
            <CheckCircle2 className="size-[26px] shrink-0 text-[#1F8A4C]" aria-hidden />
            <span className="flex-1 text-base font-semibold">Admission</span>
            <span className="rounded-full border border-[#2E9E5B] bg-[#E8F7EE] px-3 py-1 text-[13px] font-semibold text-[#0B4A24]">
              Already paid
            </span>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-2xl border border-[#D64545] bg-[#FDE0E0] px-4 py-3 text-sm font-medium text-[#8A1C1C]">
            {error}
          </p>
        )}
      </div>

      {/* The bar is the last thing in the page, so the last card always ends above it. */}
      <div className="sticky bottom-0 z-10 border-t border-[#E1DAF0] bg-background px-4 py-3 lg:px-8">
        <div className="mx-auto flex w-full max-w-lg items-center gap-4">
          <div className="min-w-0">
            <p className="text-sm text-[#5B5670]">Total</p>
            <p className="text-[28px] leading-tight font-bold tabular-nums">{total.toFixed(2)}</p>
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={pending || total === 0}
            className="h-14 min-w-0 flex-1 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground disabled:opacity-50"
          >
            {pending ? "Taking payment…" : "Take payment"}
          </button>
        </div>
      </div>

      {calendarCourse && (
        <MonthSheet
          course={calendarCourse}
          today={view.today}
          selectedKeys={selected}
          onToggle={(m) => setSelected((prev) => toggleMonth(prev, monthKey(calendarCourse.courseId, m.year, m.month)))}
          onInfo={(m) => setDetail({ courseId: calendarCourse.courseId, year: m.year, month: m.month })}
          onClose={() => setCalendarFor(null)}
        />
      )}

      {detail && detailCourse && detailMonth && (
        <MonthDetailSheet
          key={`${detail.courseId}:${detail.year}:${detail.month}`}
          studentId={view.student.id}
          courseId={detail.courseId}
          year={detail.year}
          month={detail.month}
          fee={detailCourse.monthly}
          state={detailMonth.state}
          selected={selected.has(monthKey(detail.courseId, detail.year, detail.month))}
          load={loadMonthDetail}
          onUse={() => setSelected((prev) => toggleMonth(prev, monthKey(detail.courseId, detail.year, detail.month)))}
          onClose={() => setDetail(null)}
        />
      )}

      {pendingCombos.length > 0 && (
        <ComboSheet
          key={pendingCombos[0].comboId}
          combo={pendingCombos[0]}
          studentName={view.student.name}
          lastAttended={view.lastAttended}
          pending={pending}
          onAnswer={answerCombo}
          onCancel={() => {
            setPendingCombos([]);
            setDecisions([]);
          }}
        />
      )}
    </div>
  );
}
