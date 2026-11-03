"use client";

import Link from "next/link";
import { useEffect, useReducer, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, History, Landmark, Printer, Save } from "lucide-react";

import { amountErrorText, decimalToCents, formatCents, parseTypedAmount } from "@/lib/cents";
import { MAX_BANK_LINES, computeCashFlow, type BankLine } from "@/lib/cash-flow";
import { dayLabelShort, shiftDay } from "@/lib/daily-summary-dates";
import type { CancelledSummary, StaffCollected } from "@/lib/daily-summary-extras";
import type { Hint } from "@/lib/saved-day/hint";
import { hintLabel, NOT_SAVED_CHIP, UNREADABLE_DAY } from "@/lib/saved-day/texts";
import type { DailySummary } from "@/lib/reports";

import { BankSheet } from "./bank-sheet";
import { Banner, Chip, DetailSections, MoneyFlow } from "./day-parts";
import { ReconcileNotice } from "./reconcile-notice";
import { reconcileWarning } from "./extra-lines";
import { SaveSheet } from "./save-sheet";
import type { Signer } from "./signer-lists";
import { initialTypedState, typedReducer } from "./typed-reducer";
import { typedQuery } from "./typed-state";

/**
 * The day screen for a day that is NOT saved (Release 2: the saved day is `saved-day-screen.tsx`). The money flow reads top to bottom as
 * a timeline — Bring-forward + Collected − Deductions = Should be in the drawer; − Taken to bank = Left in drawer — in integer cents
 * (`lib/cash-flow`), with the data object's own strings only displayed.
 *
 * What is typed here (bring-forward, bank lines) is still a DRAFT: it is mirrored into the address (`history.replaceState`), which carries
 * it to the A4 document and back and through a reload. It is stored only when someone taps "Save day". There are no Prepared by /
 * Checked by selects any more: Done by is chosen in the Save sheet and the admin check is its own step on the saved day.
 */
export function DayScreen({
  date, today, dateText, report, cancelled, staff, doners, initial, notices, hint, unreadable,
}: {
  date: string;
  today: string;
  /** "Wed 14 Oct 2026", for the Save sheet's title. */
  dateText: string;
  report: DailySummary;
  cancelled: CancelledSummary;
  staff: StaffCollected[];
  /** Active ADMIN and STAFF accounts: the Done by choices. */
  doners: Signer[];
  initial: { bf: string; bank: BankLine[] };
  notices: { key: string; text: string }[];
  hint: Hint | null;
  /** A saved day exists but could not be read: this live view stands in for it. */
  unreadable: boolean;
}) {
  // What is typed (bring-forward, bank lines) and which notices are open: ONE pure state machine (typed-reducer.ts). Initial value only,
  // never synced from props (rule 17); the signer fields of that state are unused here.
  const [typed, dispatch] = useReducer(typedReducer, undefined, () => initialTypedState({ ...initial, preparedId: "", checkedId: "" }, notices.map((n) => n.key)));
  const { bfText, bank, openNotices } = typed;
  const [editingBf, setEditingBf] = useState(false);
  const [bankSheet, setBankSheet] = useState(false);
  const [saveSheet, setSaveSheet] = useState(false);

  const bfParsed = bfText.trim() === "" ? ({ ok: true, cents: 0 } as const) : parseTypedAmount(bfText);
  const bfCents = bfParsed.ok ? bfParsed.cents : 0;
  const collected = decimalToCents(report.totalCollected);
  const deductions = decimalToCents(report.deductions.total);
  const flow = computeCashFlow({ bringForward: bfCents, collected, deductions, bank });

  // Mirror what is typed into the address, so it survives the document and a reload.
  const query = typedQuery({ bringForwardCents: bfCents, bank });
  query.set("date", date);
  const queryText = query.toString();
  useEffect(() => {
    try {
      window.history.replaceState(null, "", `${window.location.pathname}?${queryText}`);
    } catch {
      /* the address bar is cosmetic */
    }
  }, [queryText]);

  const blockReason = !bfParsed.ok ? "Fix the bring-forward amount first." : flow.overdrawn ? "Money taken to the bank is more than the drawer holds." : null;
  const docHref = (auto: "print" | "pdf") => {
    const p = new URLSearchParams(query);
    p.set("auto", auto);
    return `/daily-summary/document?${p.toString()}`;
  };
  const unreconciled = reconcileWarning(report);
  const showHint = hint !== null && bfCents === 0;
  const hintWhen = hint ? (hint.daysAgo === 1 ? "Yesterday" : dayLabelShort(hint.date).replace(/ \d{4}$/, "")) : "";

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-44">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Daily Summary</h1>
        <Link href="/daily-summary/history" className="text-primary flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium underline-offset-4 hover:underline">
          <History className="size-4" aria-hidden /> History
        </Link>
      </div>
      {unreadable && <Banner tone="amber" role="alert">{UNREADABLE_DAY}</Banner>}
      {notices.filter((n) => openNotices.includes(n.key)).map((n) => (
        <p key={n.key} role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{n.text}</p>
      ))}

      <DateStrip date={date} today={today} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/daily-summary/range?from=${shiftDay(date, -6)}&to=${date}`} className="text-primary flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">
          Several days
        </Link>
        <Chip tone="grey">{NOT_SAVED_CHIP}</Chip>
      </div>

      <MoneyFlow
        report={report}
        cancelled={cancelled}
        flow={flow}
        bank={bank}
        onRemoveBank={(i) => dispatch({ type: "bankRemove", index: i })}
        bringForward={
          <>
            {editingBf ? (
              <div className="py-1">
                <label htmlFor="bf" className="text-muted-foreground block text-sm">Bring-forward</label>
                <input
                  id="bf" autoFocus inputMode="decimal" autoComplete="off" placeholder="0.00" value={bfText}
                  onChange={(e) => dispatch({ type: "bf", text: e.target.value })}
                  onBlur={() => setEditingBf(false)}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="border-input bg-background mt-1 h-12 w-full rounded-md border px-3 text-xl font-semibold tabular-nums"
                  aria-invalid={!bfParsed.ok}
                />
              </div>
            ) : (
              <button type="button" onClick={() => setEditingBf(true)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
                <span>
                  <span className="block text-sm font-medium">Bring-forward</span>
                  <span className="text-muted-foreground block text-xs">Opening cash · tap to type</span>
                </span>
                <span className="text-lg font-semibold tabular-nums">{formatCents(bfCents)}</span>
              </button>
            )}
            {!bfParsed.ok && <p role="alert" className="text-destructive text-sm">{amountErrorText(bfParsed.reason)}</p>}
            {showHint && hint && (
              <p className="text-muted-foreground pb-1 text-sm">
                {hint.leftCents > 0 ? (
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "bf", text: (hint.leftCents / 100).toFixed(2) })}
                    className="text-primary min-h-11 text-left font-medium underline underline-offset-4"
                  >
                    {hintLabel(hintWhen, formatCents(hint.leftCents), hint.checked)}
                  </button>
                ) : (
                  <span>{hintWhen} closed with {formatCents(hint.leftCents)}{hint.checked ? "" : " (not checked yet)"}.</span>
                )}
              </p>
            )}
          </>
        }
      />
      {flow.overdrawn && <p role="alert" className="text-destructive text-sm">The bank lines add up to more than the drawer should hold. Remove or correct a line.</p>}

      <button
        type="button" onClick={() => setBankSheet(true)} disabled={bank.length >= MAX_BANK_LINES}
        className="border-primary text-primary flex h-12 w-full items-center justify-center gap-2 rounded-md border-2 text-base font-medium disabled:opacity-50"
      >
        <Landmark className="size-5" aria-hidden /> Take money to bank
      </button>
      {bank.length >= MAX_BANK_LINES && <p className="text-muted-foreground text-center text-xs">The list holds up to {MAX_BANK_LINES} bank lines.</p>}

      <ReconcileNotice text={unreconciled} />
      <DetailSections report={report} staff={staff} />

      {/* sticky bottom bar: Save day, then Print and Download PDF (a draft) */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto max-w-[720px] space-y-2">
          {blockReason && <p className="text-muted-foreground text-center text-xs">{blockReason}</p>}
          <button
            type="button" disabled={blockReason !== null} onClick={() => setSaveSheet(true)}
            className="bg-primary text-primary-foreground flex h-12 w-full items-center justify-center gap-2 rounded-md text-base font-medium disabled:opacity-50"
          >
            <Save className="size-5" aria-hidden /> Save day
          </button>
          <div className="grid grid-cols-2 gap-3">
            <Action href={blockReason ? null : docHref("print")} icon={<Printer className="size-5" aria-hidden />} label="Print" variant="outline" />
            <Action href={blockReason ? null : docHref("pdf")} icon={<Download className="size-5" aria-hidden />} label="Download PDF" variant="outline" />
          </div>
        </div>
      </div>

      {bankSheet && (
        <BankSheet
          inDrawerCents={flow.shouldBe - flow.bankTotal}
          onClose={() => setBankSheet(false)}
          onAdd={(line) => {
            dispatch({ type: "bankAdd", line });
            setBankSheet(false);
          }}
        />
      )}
      {saveSheet && (
        <SaveSheet
          mode="save" date={date} dateText={dateText} baseVersion={0}
          numbers={{ collected, deductions, shouldBe: flow.shouldBe, bankTotal: flow.bankTotal, left: flow.left }}
          bankCount={bank.length} doners={doners}
          bringForward={bfCents > 0 ? (bfCents / 100).toFixed(2) : ""} bank={bank}
          onClose={() => setSaveSheet(false)}
        />
      )}
    </div>
  );
}

export function DateStrip({ date, today }: { date: string; today: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Link href={`/daily-summary?date=${shiftDay(date, -1)}`} aria-label="Previous day" className="border-input grid size-11 shrink-0 place-items-center rounded-md border">
        <ChevronLeft className="size-5" aria-hidden />
      </Link>
      <p className="min-w-0 flex-1 text-center text-base font-semibold">{dayLabelShort(date)}</p>
      {date < today ? (
        <Link href={`/daily-summary?date=${shiftDay(date, 1)}`} aria-label="Next day" className="border-input grid size-11 shrink-0 place-items-center rounded-md border">
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      ) : (
        <span aria-disabled="true" className="border-input text-muted-foreground/40 grid size-11 shrink-0 place-items-center rounded-md border">
          <ChevronRight className="size-5" aria-hidden />
        </span>
      )}
    </div>
  );
}

export function Action({ href, icon, label, variant }: { href: string | null; icon: ReactNode; label: string; variant: "outline" | "solid" }) {
  const cls = `flex h-12 items-center justify-center gap-2 rounded-md text-base font-medium ${variant === "solid" ? "bg-primary text-primary-foreground" : "border-input bg-background border"}`;
  return href ? (
    <Link href={href} className={cls}>{icon}{label}</Link>
  ) : (
    <button type="button" disabled className={`${cls} opacity-50`}>{icon}{label}</button>
  );
}
