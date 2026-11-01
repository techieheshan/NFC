"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Landmark, Printer, X } from "lucide-react";

import { amountErrorText, decimalToCents, formatCents, formatDeduction, formatMoney, parseTypedAmount } from "@/lib/cents";
import { MAX_BANK_LINES, computeCashFlow, type BankLine } from "@/lib/cash-flow";
import { dayLabelShort, shiftDay } from "@/lib/daily-summary-dates";
import { to12Hour } from "@/lib/colombo-time";
import type { CancelledSummary, StaffCollected } from "@/lib/daily-summary-extras";
import type { DailySummary } from "@/lib/reports";

import { BankSheet } from "./bank-sheet";
import { cancelledLine, deductionKind } from "./document/model";
import { ofWhichLines } from "./extra-lines";
import type { Signer } from "./signer-lists";
import { typedQuery } from "./typed-state";

const SELECT = "border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs";

/**
 * The day screen. The money flow reads top to bottom as a timeline —
 *
 *   Bring-forward + Collected − Deductions = Should be in the drawer;  − Taken to bank = Left in drawer
 *
 * — in integer cents (`lib/cash-flow`), with the data object's own strings only displayed (thousands separators
 * added), never recomputed. Bring-forward, the bank lines and both signers are typed here and are NOT stored: they
 * are mirrored into the URL (`history.replaceState`), which is what carries them to the A4 document and back and
 * through a reload. Release 2 will store them; this release does not.
 */
export function DayScreen({
  date, today, report, cancelled, staff, signers, initial,
}: {
  date: string;
  today: string;
  report: DailySummary;
  cancelled: CancelledSummary;
  staff: StaffCollected[];
  signers: { prepared: Signer[]; checked: Signer[] };
  initial: { bf: string; bank: BankLine[]; preparedId: string; checkedId: string };
}) {
  const [bfText, setBfText] = useState(initial.bf);
  const [editingBf, setEditingBf] = useState(false);
  const [bank, setBank] = useState<BankLine[]>(initial.bank);
  const [preparedId, setPreparedId] = useState(initial.preparedId);
  const [checkedId, setCheckedId] = useState(initial.checkedId);
  const [sheet, setSheet] = useState(false);

  const bfParsed = bfText.trim() === "" ? ({ ok: true, cents: 0 } as const) : parseTypedAmount(bfText);
  const bfCents = bfParsed.ok ? bfParsed.cents : 0;
  const prepared = signers.prepared.find((s) => s.id === preparedId) ?? null;
  const checked = signers.checked.find((s) => s.id === checkedId) ?? null;

  const flow = computeCashFlow({ bringForward: bfCents, collected: decimalToCents(report.totalCollected), deductions: decimalToCents(report.deductions.total), bank });

  // Mirror what is typed into the address, so it survives the document and a reload.
  const query = typedQuery({ bringForwardCents: bfCents, bank, preparedId: prepared?.id, checkedId: checked?.id });
  query.set("date", date);
  const queryText = query.toString();
  useEffect(() => {
    try {
      window.history.replaceState(null, "", `${window.location.pathname}?${queryText}`);
    } catch {
      /* the address bar is cosmetic */
    }
  }, [queryText]);

  const reason = !bfParsed.ok
    ? "Fix the bring-forward amount first."
    : !prepared || !checked
      ? "Choose Prepared by and Checked by first."
      : flow.overdrawn
        ? "Money taken to the bank is more than the drawer holds."
        : null;
  const docHref = (auto: "print" | "pdf") => {
    const p = new URLSearchParams(query);
    p.set("auto", auto);
    return `/daily-summary/document?${p.toString()}`;
  };

  const lines = ofWhichLines(report);
  const cancelledText = cancelledLine(cancelled);
  const withPayments = report.courses.filter((c) => c.paidFull + c.paidHalf + c.paidQuarter > 0 || decimalToCents(c.amount) > 0);
  const noPayments = report.courses.filter((c) => !withPayments.includes(c));
  const lastBankTime = bank.length > 0 ? bank.map((b) => b.time).sort().at(-1)! : null;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-24">
      <h1 className="text-xl font-semibold tracking-tight">Daily Summary</h1>

      {/* date strip */}
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/daily-summary/range?from=${shiftDay(date, -6)}&to=${date}`} className="text-primary text-sm font-medium underline-offset-4 hover:underline">
          Several days
        </Link>
        {checked ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">Checked by {checked.name}</span>
        ) : (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">Not checked</span>
        )}
      </div>

      {/* money flow */}
      <section aria-label="Money flow" className="rounded-xl border p-4">
        <ol className="relative space-y-1 pl-7">
          <span aria-hidden className="bg-border absolute top-3 bottom-3 left-[9px] w-0.5" />

          <Step dot="open">
            {editingBf ? (
              <div className="py-1">
                <label htmlFor="bf" className="text-muted-foreground block text-sm">Bring-forward</label>
                <input
                  id="bf" autoFocus inputMode="decimal" autoComplete="off" placeholder="0.00" value={bfText}
                  onChange={(e) => setBfText(e.target.value)}
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
          </Step>

          <Step dot="plus">
            <Expander label="+ Collected" value={formatMoney(report.totalCollected)}>
              <Detail label="Class fees" value={formatMoney(report.classTotal)} />
              {lines.map((l) => <Detail key={l.key} sub label={l.label} value={l.total} />)}
              <Detail label={`Admission (${report.admission.count})`} value={formatMoney(report.admission.total)} />
              <Detail label={`Smart card (${report.smartCard.count})`} value={formatMoney(report.smartCard.total)} />
              <Detail strong label="Total collected" value={formatMoney(report.totalCollected)} />
              {cancelledText && <p className="text-muted-foreground pt-1 text-xs">{cancelledText}</p>}
            </Expander>
          </Step>

          <Step dot="minus">
            <Expander label="− Deductions" value={formatDeduction(report.deductions.total)}>
              {report.deductionLines.length === 0 && <p className="text-muted-foreground py-1 text-sm">No deductions.</p>}
              <ul className="space-y-2">
                {report.deductionLines.map((d, i) => (
                  <li key={i} className="text-sm">
                    <span className="flex justify-between gap-3">
                      <span className="min-w-0 break-words">{d.person ? `${d.person} — ` : ""}{d.reason}</span>
                      <span className="shrink-0 tabular-nums">{formatMoney(d.amount)}</span>
                    </span>
                    <span className="text-muted-foreground block text-xs">{deductionKind(d)} · Authorised by {d.authorizedBy}</span>
                  </li>
                ))}
              </ul>
            </Expander>
          </Step>
        </ol>

        <div className="bg-primary/10 my-2 flex items-center justify-between gap-3 rounded-lg px-3 py-3">
          <span className="text-sm font-medium">Should be in the drawer</span>
          <span className="text-lg font-semibold tabular-nums">{formatCents(flow.shouldBe)}</span>
        </div>

        <ol className="relative space-y-1 pl-7">
          <span aria-hidden className="bg-border absolute top-3 bottom-3 left-[9px] w-0.5" />
          <Step dot="minus">
            <Expander
              label="− Taken to bank"
              sub={bank.length === 0 ? "Nothing banked yet" : `${bank.length} line${bank.length === 1 ? "" : "s"} · last ${to12Hour(lastBankTime!)}`}
              value={formatCents(-flow.bankTotal)}
            >
              {bank.length === 0 && <p className="text-muted-foreground py-1 text-sm">No money taken to the bank yet.</p>}
              <ul className="space-y-2">
                {bank.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block tabular-nums">{to12Hour(l.time)}{l.slip ? ` · slip ${l.slip}` : ""}</span>
                      {l.note && <span className="text-muted-foreground block break-words text-xs">{l.note}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{formatCents(l.cents)}</span>
                      <button type="button" aria-label={`Remove the ${to12Hour(l.time)} bank line`} onClick={() => setBank((b) => b.filter((_, j) => j !== i))} className="text-muted-foreground grid size-9 place-items-center rounded-md border">
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Expander>
          </Step>
        </ol>

        <div className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-4 text-white ${flow.left < 0 ? "bg-red-700" : "bg-primary"}`}>
          <span>
            <span className="block text-sm font-medium">Left in drawer</span>
            <span className="block text-xs opacity-90">Suggested as tomorrow&rsquo;s bring-forward</span>
          </span>
          <span className="text-2xl font-semibold tabular-nums">{formatCents(flow.left)}</span>
        </div>
        {flow.overdrawn && <p role="alert" className="text-destructive mt-2 text-sm">The bank lines add up to more than the drawer should hold. Remove or correct a line.</p>}
      </section>

      <button
        type="button" onClick={() => setSheet(true)} disabled={bank.length >= MAX_BANK_LINES}
        className="border-primary text-primary flex h-12 w-full items-center justify-center gap-2 rounded-md border-2 text-base font-medium disabled:opacity-50"
      >
        <Landmark className="size-5" aria-hidden /> Take money to bank
      </button>
      {bank.length >= MAX_BANK_LINES && <p className="text-muted-foreground text-center text-xs">The list holds up to {MAX_BANK_LINES} bank lines.</p>}

      {/* who signs */}
      <section className="space-y-3 rounded-xl border p-4">
        <div>
          <label htmlFor="prepared" className="block text-sm font-medium">Prepared by <span className="text-destructive">*</span></label>
          <select id="prepared" className={`${SELECT} mt-1`} value={prepared?.id ?? ""} onChange={(e) => setPreparedId(e.target.value)}>
            <option value="">Select staff…</option>
            {signers.prepared.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="checked" className="block text-sm font-medium">Checked by (admin) <span className="text-destructive">*</span></label>
          <select id="checked" className={`${SELECT} mt-1`} value={checked?.id ?? ""} onChange={(e) => setCheckedId(e.target.value)}>
            <option value="">Select an admin…</option>
            {signers.checked.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {signers.checked.length === 0 && <p role="alert" className="text-destructive mt-1 text-xs">No active admin account can check this.</p>}
        </div>
      </section>

      {/* detail rows */}
      <section className="divide-y rounded-xl border">
        <Expander label="By course" row>
          <ul className="space-y-3 pt-1">
            {withPayments.map((c) => (
              <li key={c.courseId} className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium">{c.course}</span>
                  <span className="text-muted-foreground block break-words text-xs">{c.teacher}</span>
                  <span className="text-muted-foreground block text-xs">
                    {c.paidFull + c.paidHalf + c.paidQuarter} paid · Full {c.paidFull}
                    {c.paidHalf > 0 ? ` · Half ${c.paidHalf}` : ""} · 25% {c.paidQuarter} · {c.free} free
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums">{formatMoney(c.amount)}</span>
              </li>
            ))}
            {withPayments.length === 0 && <li className="text-muted-foreground text-sm">No course took a payment.</li>}
            {noPayments.length > 0 && <li className="text-muted-foreground break-words text-xs">No payments: {noPayments.map((c) => c.course).join(", ")}</li>}
          </ul>
        </Expander>
        <Expander label="Admission and smart card" row>
          <Detail label={`Admission (${report.admission.count})`} value={formatMoney(report.admission.total)} />
          <Detail label={`Smart card (${report.smartCard.count})`} value={formatMoney(report.smartCard.total)} />
        </Expander>
        <Expander label="Collected by staff" row>
          {staff.length === 0 && <p className="text-muted-foreground py-1 text-sm">No receipts.</p>}
          {staff.map((r) => (
            <Detail key={r.userId} label={`${r.name} · ${r.receipts} receipt${r.receipts === 1 ? "" : "s"}`} value={formatMoney(r.collected)} />
          ))}
          {staff.length > 0 && <Detail strong label={`Total · ${staff.reduce((s, r) => s + r.receipts, 0)} receipts`} value={formatMoney(report.totalCollected)} />}
        </Expander>
      </section>

      {/* sticky bottom bar */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto max-w-[720px]">
          {reason && <p className="text-muted-foreground mb-2 text-center text-xs">{reason}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Action href={reason ? null : docHref("print")} icon={<Printer className="size-5" aria-hidden />} label="Print" variant="outline" />
            <Action href={reason ? null : docHref("pdf")} icon={<Download className="size-5" aria-hidden />} label="Download PDF" variant="solid" />
          </div>
        </div>
      </div>

      {sheet && (
        <BankSheet
          inDrawerCents={flow.shouldBe - flow.bankTotal}
          onClose={() => setSheet(false)}
          onAdd={(line) => {
            setBank((b) => [...b, line].slice(0, MAX_BANK_LINES));
            setSheet(false);
          }}
        />
      )}
    </div>
  );
}

function Action({ href, icon, label, variant }: { href: string | null; icon: ReactNode; label: string; variant: "outline" | "solid" }) {
  const cls = `flex h-12 items-center justify-center gap-2 rounded-md text-base font-medium ${variant === "solid" ? "bg-primary text-primary-foreground" : "border-input bg-background border"}`;
  return href ? (
    <Link href={href} className={cls}>{icon}{label}</Link>
  ) : (
    <button type="button" disabled className={`${cls} opacity-50`}>{icon}{label}</button>
  );
}

function Step({ dot, children }: { dot: "open" | "plus" | "minus"; children: ReactNode }) {
  const color = dot === "plus" ? "border-green-600" : dot === "minus" ? "border-red-600" : "border-primary";
  return (
    <li className="relative">
      <span aria-hidden className={`bg-background absolute top-3.5 left-[-28px] size-[18px] rounded-full border-2 ${color}`} />
      {children}
    </li>
  );
}

function Expander({ label, value, sub, children, row }: { label: string; value?: string; sub?: string; children: ReactNode; row?: boolean }) {
  return (
    <details className={`group ${row ? "px-4" : ""}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-1 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          {sub && <span className="text-muted-foreground block text-xs">{sub}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {value !== undefined && <span className="text-lg font-semibold tabular-nums">{value}</span>}
          <ChevronDown className="text-muted-foreground size-4 group-open:hidden" aria-hidden />
          <ChevronUp className="text-muted-foreground hidden size-4 group-open:block" aria-hidden />
        </span>
      </summary>
      <div className="space-y-1 pb-3">{children}</div>
    </details>
  );
}

function Detail({ label, value, sub, strong }: { label: string; value: string; sub?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${sub ? "text-muted-foreground pl-4" : ""} ${strong ? "border-t pt-1 font-semibold" : ""}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
