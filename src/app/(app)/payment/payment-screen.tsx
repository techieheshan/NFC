"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  Nfc,
  QrCode,
  UserRound,
  XCircle,
} from "lucide-react";

import { QrScanner } from "@/components/scan/qr-scanner";
import { StudentSearch } from "@/components/scan/student-search";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { StudentBrief } from "@/lib/students";

import type {
  ApplicableCombo,
  ChargeResult,
  ComboDecision,
  PanelResult,
  PaymentPanel,
  Receipt,
} from "./actions";
import { ComboPrompt } from "./combo-prompt";
import { ReceiptView } from "./receipt";

type Props = {
  loadPanel: (input: {
    cardUid?: string;
    cardNumber?: string;
    studentId?: number;
  }) => Promise<PanelResult>;
  takePayment: (input: {
    comboDecisions: ComboDecision[];
    studentId: number;
    admission: boolean;
    smartCard: boolean;
    classMonths: { courseId: number; year: number; month: number }[];
  }) => Promise<ChargeResult>;
  searchStudents: (query: string) => Promise<StudentBrief[]>;
  /**
   * Open straight onto this student instead of the identify step.
   *
   * The attendance counter opens this whole screen inside a dialog for a
   * student it has already identified from their tap — reusing the payment
   * engine rather than growing a second one. Everything below (months, combo
   * prompt, fraud check, receipt, server recomputation) is untouched.
   */
  initialStudentId?: number;
  /** Hides the identify UI and the "Change student" affordance. */
  embedded?: boolean;
  /** Called after a receipt is closed, so the host can dismiss the dialog. */
  onFinished?: () => void;
};

const monthKey = (courseId: number, year: number, month: number) =>
  `${courseId}:${year}:${month}`;

export function PaymentScreen({
  loadPanel,
  takePayment,
  searchStudents,
  initialStudentId,
  embedded = false,
  onFinished,
}: Props) {
  const [panel, setPanel] = useState<PaymentPanel | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [admission, setAdmission] = useState(false);
  const [smartCard, setSmartCard] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Combos still awaiting a Yes/No this transaction; answered ones drop off. */
  const [pendingCombos, setPendingCombos] = useState<ApplicableCombo[]>([]);
  const [decisions, setDecisions] = useState<ComboDecision[]>([]);

  const identify = useCallback(
    (input: { cardUid?: string; cardNumber?: string; studentId?: number }) => {
      setError(null);
      setNotFound(false);
      startTransition(async () => {
        const result = await loadPanel(input);
        if (result.status === "unknown") {
          setNotFound(true);
          return;
        }
        setPanel(result.panel);
        // Admission is pre-ticked when owed, and the current month per course —
        // the two things the counter charges most often.
        setAdmission(result.panel.admission.chargeable);
        setSmartCard(false);
        const preset = new Set<string>();
        for (const c of result.panel.courses) {
          if (c.free) continue;
          const current = c.months[0];
          if (current && !current.paid) {
            preset.add(monthKey(c.courseId, current.year, current.month));
          }
        }
        setSelected(preset);
      });
    },
    [loadPanel],
  );

  const nfc = useNfcScan((cardUid) => identify({ cardUid }));

  // Embedded: load the student the counter already identified, once, on mount.
  // `initialStudentId` is a mount-time input, never synced back in — a
  // different student means a different dialog instance (keyed by the host).
  const openedFor = useRef<number | null>(null);
  useEffect(() => {
    if (initialStudentId === undefined) return;
    if (openedFor.current === initialStudentId) return;
    openedFor.current = initialStudentId;
    identify({ studentId: initialStudentId });
  }, [initialStudentId, identify]);

  const reset = useCallback(() => {
    setPanel(null);
    setReceipt(null);
    setNotFound(false);
    setError(null);
    setSelected(new Set());
    setAdmission(false);
    setSmartCard(false);
  }, []);

  const toggleMonth = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const total = useMemo(() => {
    if (!panel) return 0;
    let sum = 0;
    if (admission) sum += Number(panel.admission.amount);
    if (smartCard) sum += Number(panel.smartCard.amount);
    for (const c of panel.courses) {
      if (c.free || !c.monthly) continue;
      // Before the fraud check is answered this shows the normal rate; once a
      // combo is accepted the running total switches to the combo rate. The
      // server recomputes it either way — this is display only.
      const applied =
        c.comboId !== null &&
        decisions.some((d) => d.comboId === c.comboId && d.apply);
      const unit = Number(applied && c.comboMonthly ? c.comboMonthly : c.monthly);
      for (const m of c.months) {
        if (selected.has(monthKey(c.courseId, m.year, m.month))) sum += unit;
      }
    }
    return sum;
  }, [panel, admission, smartCard, selected, decisions]);

  const selectedClassMonths = useCallback(
    (p: PaymentPanel) =>
      p.courses.flatMap((c) =>
        c.free
          ? []
          : c.months
              .filter((m) => selected.has(monthKey(c.courseId, m.year, m.month)))
              .map((m) => ({ courseId: c.courseId, year: m.year, month: m.month })),
      ),
    [selected],
  );

  const submit = useCallback(
    (finalDecisions: ComboDecision[]) => {
      if (!panel) return;
      setError(null);
      startTransition(async () => {
        const res = await takePayment({
          studentId: panel.student.id,
          admission,
          smartCard,
          classMonths: selectedClassMonths(panel),
          comboDecisions: finalDecisions,
        });
        if (res.ok) setReceipt(res.receipt);
        else setError(res.error);
      });
    },
    [panel, admission, smartCard, selectedClassMonths, takePayment],
  );

  const confirm = useCallback(() => {
    if (!panel) return;
    setError(null);

    // Which qualifying combos does this selection actually touch? Each gets one
    // pop-up, and the answer covers every month of that combo in this
    // transaction. Nothing is remembered for next time.
    const touched = new Set(
      selectedClassMonths(panel)
        .map((m) => panel.courses.find((c) => c.courseId === m.courseId)?.comboId)
        .filter((v): v is number => v !== null && v !== undefined),
    );
    const queue = panel.combos.filter((c) => touched.has(c.comboId));

    if (queue.length === 0) {
      submit([]);
      return;
    }
    setDecisions([]);
    setPendingCombos(queue);
  }, [panel, selectedClassMonths, submit]);

  /** Records one combo answer, then either asks the next or charges. */
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

  if (receipt) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <p className="flex items-center justify-center gap-2 text-lg font-semibold text-emerald-700">
          <CheckCircle2 className="size-6" aria-hidden />
          Payment taken
        </p>
        <ReceiptView
          receipt={receipt}
          doneLabel={embedded ? "Back to the counter" : "Next student"}
          onDone={embedded ? () => onFinished?.() : reset}
        />
      </div>
    );
  }

  if (!panel && embedded) {
    return (
      <p className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {notFound ? "That student could not be loaded." : "Loading fees…"}
      </p>
    );
  }

  if (panel) {
    const nothingSelected = total === 0;
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <div className="flex items-center gap-4">
          <span className="bg-muted size-16 shrink-0 overflow-hidden rounded-xl border">
            {panel.student.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={panel.student.photoUrl} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-muted-foreground grid size-full place-items-center">
                <UserRound className="size-7" aria-hidden />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold">{panel.student.name}</p>
            <p className="text-muted-foreground truncate text-sm">
              {panel.student.cardNumber ?? "no card number"}
            </p>
          </div>
          {!embedded && (
            <Button variant="ghost" size="sm" onClick={reset}>
              Change
            </Button>
          )}
        </div>

        {/* Admission */}
        <div className="rounded-xl border p-4">
          {panel.admission.chargeable ? (
            <label className="flex cursor-pointer items-center gap-3">
              <Checkbox
                checked={admission}
                onCheckedChange={(c) => setAdmission(c === true)}
              />
              <span className="flex-1 font-medium">Admission fee</span>
              <span className="tabular-nums">{panel.admission.amount}</span>
            </label>
          ) : (
            <div className="text-muted-foreground flex items-center gap-3">
              <CheckCircle2 className="size-5 text-emerald-600" aria-hidden />
              <span className="flex-1 font-medium">Admission fee</span>
              <Badge variant="secondary">Already paid</Badge>
            </div>
          )}
        </div>

        {/* Smart card — stays chargeable; a reissue is a legitimate re-charge. */}
        <div className="rounded-xl border p-4">
          <label className="flex cursor-pointer items-center gap-3">
            <Checkbox
              checked={smartCard}
              onCheckedChange={(c) => setSmartCard(c === true)}
            />
            <span className="flex-1">
              <span className="block font-medium">Smart card</span>
              <span className="text-muted-foreground block text-xs">
                {panel.smartCard.count === 0
                  ? "never charged"
                  : `charged ${panel.smartCard.count}× · last ${panel.smartCard.lastAt}`}
              </span>
            </span>
            <span className="tabular-nums">{panel.smartCard.amount}</span>
          </label>
        </div>

        {/* Class fees */}
        <div className="space-y-3">
          {panel.courses.length === 0 && (
            <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
              No active enrolments.
            </p>
          )}

          {panel.courses.map((c) => (
            <div key={c.courseId} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.course}</p>
                  <p className="text-muted-foreground truncate text-xs">{c.teacher}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge variant="outline">{c.tierLabel}</Badge>
                  {/* A qualifying course shows the combo rate struck through
                      against the normal one. It is only an offer until the
                      fraud check is answered at confirm time. */}
                  <p className="mt-1 text-sm tabular-nums">
                    {c.free ? (
                      "—"
                    ) : c.comboMonthly ? (
                      <>
                        <span className="text-muted-foreground mr-1.5 line-through">
                          {c.monthly}
                        </span>
                        {c.comboMonthly}/mo
                      </>
                    ) : (
                      `${c.monthly}/mo`
                    )}
                  </p>
                  {c.comboMonthly && (
                    <Badge variant="secondary" className="mt-1">
                      Combo offer
                    </Badge>
                  )}
                </div>
              </div>

              {c.free ? (
                <p className="mt-3 text-sm font-medium text-emerald-700">
                  Free — no charge
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {c.months.map((m) => {
                    const key = monthKey(c.courseId, m.year, m.month);
                    const on = selected.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={m.paid || pending}
                        onClick={() => toggleMonth(key)}
                        className={[
                          "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                          m.paid
                            ? "bg-muted text-muted-foreground cursor-not-allowed"
                            : on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "hover:bg-accent",
                        ].join(" ")}
                      >
                        {m.label}
                        {m.paid && " ✓"}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="bg-background sticky bottom-0 space-y-3 border-t pt-4">
          <div className="flex items-center justify-between text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{total.toFixed(2)}</span>
          </div>
          <Button
            className="h-12 w-full text-base"
            disabled={pending || nothingSelected}
            onClick={confirm}
          >
            {pending ? "Taking payment…" : "Take payment"}
          </Button>
        </div>

        {/* One pop-up at a time; answering pops the queue and the last answer
            fires the charge. */}
        {pendingCombos.length > 0 && (
          <ComboPrompt
            key={pendingCombos[0].comboId}
            combo={pendingCombos[0]}
            studentName={panel.student.name}
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

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="text-center">
        <span className="bg-primary/10 text-primary mx-auto grid size-16 place-items-center rounded-full">
          <CreditCard className="size-8" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Payment</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tap a card, scan its QR, or search to open the student&apos;s fees.
        </p>
      </div>

      {notFound && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-center gap-2 rounded-lg border px-4 py-3 text-sm"
        >
          <XCircle className="size-4 shrink-0" aria-hidden />
          Card not recognised. Register it first, or search by name.
        </p>
      )}

      <div className="space-y-3">
        {nfc.support !== "unsupported" &&
          (nfc.scanning ? (
            <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
              <Loader2 className="text-primary mx-auto size-6 animate-spin" aria-hidden />
              <p className="text-sm font-medium">Hold the card against the phone…</p>
              <Button variant="outline" size="sm" onClick={nfc.stop}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => void nfc.start()}
              className="h-16 w-full gap-2 text-base"
              disabled={pending || nfc.support === "unknown"}
            >
              <Nfc className="size-5" aria-hidden />
              Tap card (NFC)
            </Button>
          ))}

        <Button
          onClick={() => setQrOpen(true)}
          variant={nfc.support === "unsupported" ? "default" : "secondary"}
          className="h-16 w-full gap-2 text-base"
          disabled={pending}
        >
          <QrCode className="size-5" aria-hidden />
          Scan QR code
        </Button>
      </div>

      {nfc.support === "unsupported" && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          This browser can&apos;t read NFC. Use the QR scan or search below.
        </p>
      )}

      {nfc.error && (
        <p role="alert" className="text-destructive text-sm">
          {nfc.error}
        </p>
      )}

      <div className="rounded-xl border p-4">
        <StudentSearch
          search={searchStudents}
          busy={pending}
          onPick={(s) => identify({ studentId: s.id })}
        />
      </div>

      {pending && (
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Loading fees…
        </p>
      )}

      <QrScanner
        open={qrOpen}
        onOpenChange={setQrOpen}
        onDecode={(value) => identify({ cardNumber: value })}
      />
    </div>
  );
}
