"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, UserRound } from "lucide-react";

import type { ChargeResult, ComboDecision, PaymentMode, Receipt } from "@/app/(app)/payment/actions";
import { AutoPrintReceipt } from "@/app/(app)/payment/payment-screen";
import {
  chargeCoursesFrom,
  chargeInput,
  chargeTotal,
  comboOffDecisions,
  comboQuestionIds,
  courseComboApplied,
  lineAmountText,
  monthKey,
  needsBackConfirm,
  setMonthMode,
  toggleCard,
  toggleMonth,
  zeroDayNotice,
  type ChargeCourse,
  type Selection,
} from "@/lib/payment-charge";
import { friendlyDate } from "@/lib/friendly-date";
import type { MonthDetail, PaymentView } from "@/lib/payment-view";
import { setVoiceEnabled, VOICE } from "@/lib/voice";

import { ComboSheet } from "./combo-sheet";
import { CourseCard, type PickedMonth } from "./course-card";
import { MonthDetailSheet } from "./month-detail";
import { BackMonthConfirm } from "./back-month-confirm";
import { MonthSheet } from "./month-sheet";
import { RecordedNoCharge } from "./recorded-no-charge";

type Props = {
  view: PaymentView;
  /** The existing action, called with exactly the input it has always taken (plus the optional `mode` and `off`). */
  takePayment: (input: {
    comboDecisions: ComboDecision[];
    studentId: number;
    admission: boolean;
    smartCard: boolean;
    classMonths: { courseId: number; year: number; month: number; mode?: PaymentMode }[];
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

/** The server's own words; the screen reloads the card when the combo question changed under it. */
const DECISION_MISSING = "A combined-rate decision is missing.";

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
  const [recorded, setRecorded] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [admission, setAdmission] = useState(false);
  const [smartCard, setSmartCard] = useState(false);
  // NOTHING is pre-selected: a ticked card is a charge nobody chose.
  const [selected, setSelected] = useState<Selection>(new Map());
  /** Combos staff switched off (the switch is theirs; the state it sits on is the server's). */
  const [comboOff, setComboOff] = useState<ReadonlySet<number>>(new Set());
  const [pendingCombos, setPendingCombos] = useState<PaymentView["combos"]>([]);
  const [decisions, setDecisions] = useState<ComboDecision[]>([]);
  const [calendarFor, setCalendarFor] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ courseId: number; year: number; month: number } | null>(null);
  // An earlier month (before registration) staff tapped and have not confirmed yet.
  const [backAsk, setBackAsk] = useState<{ courseId: number; year: number; month: number } | null>(null);

  const charge: ChargeCourse[] = useMemo(() => chargeCoursesFrom(view.courses), [view.courses]);
  const chargeOf = useMemo(() => new Map(charge.map((c) => [c.courseId, c])), [charge]);

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
        comboOff,
      }),
    [admission, smartCard, view.admission.amount, view.smartCard.amount, charge, selected, decisions, comboOff],
  );

  // `pending` only turns true on the next render, so two taps in the same tick could both
  // get through. This ref closes that gap: one request in flight, ever.
  const inFlight = useRef(false);

  const submit = useCallback(
    (answers: ComboDecision[]) => {
      if (inFlight.current) return;
      inFlight.current = true;
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
              // The switched-off combos (no reason) plus whatever staff answered in the pop-up.
              comboDecisions: [...comboOffDecisions(charge, selected, comboOff), ...answers],
            }),
          );
          if (res.ok) {
            // Feedback fires the instant the money is recorded, as on the old screen.
            VOICE.paymentComplete();
            // A checkout of only no-charge months: nothing to print.
            if (res.receipt.noCharge) setRecorded(res.receipt);
            else setReceipt(res.receipt);
          } else {
            setError(res.error);
            // The combo question is the server's and can change between the page loading and the
            // tap (midnight, a class marked): reload the cards so the screen shows what it now asks.
            if (res.error === DECISION_MISSING) router.refresh();
          }
        } catch {
          // Payment is online-only and there is no queue. The request may or may not
          // have arrived, so say so rather than invite a second charge.
          setError(
            "Couldn't reach the server, so this payment may not have gone through. Check Receipts before trying again, so nobody is charged twice.",
          );
        } finally {
          inFlight.current = false;
        }
      });
    },
    [takePayment, view.student.id, admission, smartCard, charge, selected, comboOff, router],
  );

  /** One pop-up per combo that is switched ON and that the server says needs a person. Nothing is remembered. */
  const confirm = useCallback(() => {
    if (inFlight.current) return;
    setError(null);
    const ids = new Set(comboQuestionIds(charge, selected, comboOff));
    const queue = view.combos.filter((c) => ids.has(c.comboId));
    if (queue.length === 0) {
      submit([]);
      return;
    }
    setDecisions([]);
    setPendingCombos(queue);
  }, [charge, selected, comboOff, view.combos, submit]);

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
  if (recorded) return <RecordedNoCharge receipt={recorded} onDone={finish} />;

  const pickedFor = (c: PaymentView["courses"][number]): PickedMonth[] =>
    c.months.flatMap((m) => {
      const mode = m.state === "paid" ? undefined : selected.get(monthKey(c.courseId, m.year, m.month));
      return mode === undefined ? [] : [{ month: m, mode }];
    });

  const calendarCourse = view.courses.find((c) => c.courseId === calendarFor) ?? null;
  const detailCourse = detail ? view.courses.find((c) => c.courseId === detail.courseId) : null;
  const detailCharge = detail ? chargeOf.get(detail.courseId) : undefined;
  const detailMonth = detail
    ? detailCourse?.months.find((m) => m.year === detail.year && m.month === detail.month)
    : null;
  const detailKey = detail ? monthKey(detail.courseId, detail.year, detail.month) : "";
  const detailApplied = detailCharge ? courseComboApplied(detailCharge, comboOff, decisions) : false;

  const nothingChosen = !admission && !smartCard && selected.size === 0;

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

        {view.courses.map((c) => {
          const picked = pickedFor(c);
          const cc = chargeOf.get(c.courseId)!;
          const notice = zeroDayNotice(c, picked); // see payment-charge.ts
          return (
            <CourseCard
              key={c.courseId}
              course={c}
              picked={picked}
              comboOn={c.comboId === null || !comboOff.has(c.comboId)}
              comboApplied={courseComboApplied(cc, comboOff, decisions)}
              notice={notice}
              disabled={pending}
              onToggle={() => setSelected((prev) => toggleCard(c.courseId, c.cardMonth, prev))}
              onOpenCalendar={() => setCalendarFor(c.courseId)}
              onSwitch={() => {
                const id = c.comboId;
                if (id === null) return;
                setComboOff((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onIgnore={() => setSelected((prev) => toggleCard(c.courseId, c.cardMonth, prev, "NO_CHARGE"))}
              onCharge={() => setSelected((prev) => toggleCard(c.courseId, c.cardMonth, prev, "FULL"))}
            />
          );
        })}

        {/* Always at the bottom, below the course cards, unchecked by default. When the card's
            CURRENT UID was already charged the row is shown disabled with the reason, instead of
            letting staff walk into the server's refusal. */}
        {view.smartCard.chargedOn ? (
          <div aria-disabled="true" className={`${ROW} border-[#E6E1F2] bg-[#F4F2F8]`}>
            <span aria-hidden className="grid size-[26px] shrink-0 place-items-center rounded-md border-2 border-[#C9C4D6] bg-[#ECE9F3]" />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-[#5B5670]">Smart card</span>
              <span className="block text-[13px] leading-snug text-[#6B3200]">
                Already charged for this card on {friendlyDate(view.smartCard.chargedOn)}. If it is a replacement card, change the card number and UID in Registration first.
              </span>
            </span>
            <span className="text-base font-bold text-[#8A849C] tabular-nums">{view.smartCard.amount}</span>
          </div>
        ) : (
          <button type="button" onClick={() => setSmartCard((v) => !v)} aria-pressed={smartCard} className={ROW}>
            <CheckBox checked={smartCard} />
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold">Smart card</span>
              <span className="block text-[13px] text-[#5B5670]">
                {view.smartCard.count === 0
                  ? "never charged"
                  : `charged ${view.smartCard.count}× · last ${friendlyDate(view.smartCard.lastAt ?? "")}`}
              </span>
            </span>
            <span className="text-base font-bold tabular-nums">{view.smartCard.amount}</span>
          </button>
        )}

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
          {/* Enabled whenever anything is chosen — a checkout of only No-charge months totals 0.00 and is still a real one. */}
          <button
            type="button"
            onClick={confirm}
            disabled={pending || nothingChosen}
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
          selected={selected}
          onToggle={(m) => {
            if (m.state === "paid") return;
            const key = monthKey(calendarCourse.courseId, m.year, m.month);
            // An earlier month is never picked without the confirm; un-picking one needs none.
            if (needsBackConfirm(selected, key, m.beforeStart)) {
              setBackAsk({ courseId: calendarCourse.courseId, year: m.year, month: m.month });
              return;
            }
            setSelected((prev) => toggleMonth(prev, key));
          }}
          onAskBack={(m) => setBackAsk({ courseId: calendarCourse.courseId, year: m.year, month: m.month })}
          onInfo={(m) => setDetail({ courseId: calendarCourse.courseId, year: m.year, month: m.month })}
          onClose={() => setCalendarFor(null)}
        />
      )}

      {backAsk && (
        <BackMonthConfirm
          key={monthKey(backAsk.courseId, backAsk.year, backAsk.month)}
          year={backAsk.year}
          month={backAsk.month}
          onYes={() => {
            setSelected((prev) => setMonthMode(prev, monthKey(backAsk.courseId, backAsk.year, backAsk.month), "FULL"));
            setBackAsk(null);
          }}
          onCancel={() => setBackAsk(null)}
        />
      )}

      {detail && detailCourse && detailMonth && detailCharge && (
        <MonthDetailSheet
          key={detailKey}
          studentId={view.student.id}
          courseId={detail.courseId}
          year={detail.year}
          month={detail.month}
          fullAmount={lineAmountText(detailCharge, "FULL", detailApplied)}
          halfAmount={lineAmountText(detailCharge, "HALF", detailApplied)}
          state={detailMonth.state}
          paidMode={detailMonth.paidMode}
          currentMode={selected.get(detailKey) ?? null}
          load={loadMonthDetail}
          onUse={(mode) => {
            if (detailMonth.state === "paid") return;
            // Defence: an unconfirmed earlier month can only be picked through its confirm.
            if (needsBackConfirm(selected, detailKey, detailMonth.beforeStart)) return;
            setSelected((prev) => setMonthMode(prev, detailKey, mode));
          }}
          onRemove={() =>
            setSelected((prev) => {
              const next = new Map(prev);
              next.delete(detailKey);
              return next;
            })
          }
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
