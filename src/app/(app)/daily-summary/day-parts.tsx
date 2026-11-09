import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import type { BankLine } from "@/lib/cash-flow";
import { decimalToCents, formatCents, formatMoney } from "@/lib/cents";
import { to12Hour } from "@/lib/colombo-time";
import type { CancelledSummary, StaffCollected } from "@/lib/daily-summary-extras";
import type { DailySummary } from "@/lib/reports";

import { cancelledLine, deductionKind } from "./document/model";
import { ADMISSION_NOTE, ofWhichLines, smartCardLabel } from "./extra-lines";

/**
 * The pieces the draft screen and the saved screen share: the money flow (R1's timeline, unchanged in look and wording), the detail
 * expanders, the chips. Presentational only: no state, no actions. The money in `report` is the data object's own text (live for a
 * draft, frozen for a saved day); the cash flow is integer cents.
 */

export const SELECT = "border-input bg-background h-11 w-full rounded-md border px-3 text-base shadow-xs";

export type FlowNumbers = { shouldBe: number; bankTotal: number; left: number; overdrawn: boolean };
export type BankLineView = BankLine & { recordedBy?: string };

export function Chip({ tone, children, label }: { tone: "green" | "amber" | "grey" | "red"; children: ReactNode; label?: string }) {
  const cls =
    tone === "green" ? "bg-green-100 text-green-800" : tone === "amber" ? "bg-amber-100 text-amber-900" : tone === "red" ? "bg-red-100 text-red-800" : "bg-muted text-foreground";
  return <span aria-label={label} className={`inline-block max-w-full break-words rounded-2xl px-3 py-1 text-sm font-medium ${cls}`}>{children}</span>;
}

export function Banner({ tone, children, role }: { tone: "amber" | "red"; children: ReactNode; role?: "alert" | "status" }) {
  const cls = tone === "red" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900";
  return <div role={role} className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}

export function Step({ dot, children }: { dot: "open" | "plus" | "minus"; children: ReactNode }) {
  const color = dot === "plus" ? "border-green-600" : dot === "minus" ? "border-red-600" : "border-primary";
  return (
    <li className="relative">
      <span aria-hidden className={`bg-background absolute top-3.5 left-[-28px] size-[18px] rounded-full border-2 ${color}`} />
      {children}
    </li>
  );
}

export function Expander({ label, value, sub, children, row }: { label: string; value?: string; sub?: string; children: ReactNode; row?: boolean }) {
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

export function Detail({ label, value, sub, strong }: { label: string; value: string; sub?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${sub ? "text-muted-foreground pl-4" : ""} ${strong ? "border-t pt-1 font-semibold" : ""}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** The R1 money timeline: Bring-forward + Collected − Deductions = Should be in the drawer; − Taken to bank = Left in drawer. */
export function MoneyFlow({
  report, cancelled, flow, bank, bringForward, onRemoveBank,
}: {
  report: DailySummary;
  cancelled: CancelledSummary;
  flow: FlowNumbers;
  bank: readonly BankLineView[];
  /** The Bring-forward step: a button that opens the field (draft, edit) or a plain row (saved). */
  bringForward: ReactNode;
  onRemoveBank?: (index: number) => void;
}) {
  const lines = ofWhichLines(report);
  const cancelledText = cancelledLine(cancelled);
  const lastBankTime = bank.length > 0 ? bank.map((b) => b.time).sort().at(-1)! : null;
  return (
    <section aria-label="Money flow" className="rounded-xl border p-4">
      <div className="relative">
        <span aria-hidden className="bg-border absolute top-3 bottom-3 left-[9px] w-0.5" />
        <ol className="space-y-1 pl-7">
          <Step dot="open">{bringForward}</Step>

          <Step dot="plus">
            <Expander label="+ Collected" value={formatMoney(report.totalCollected)}>
              <Detail label="Class fees" value={formatMoney(report.classTotal)} />
              {lines.map((l) => <Detail key={l.key} sub label={l.label} value={l.total} />)}
              <Detail label={`Admission (${report.admission.count})`} value={formatMoney(report.admission.total)} />
              <p className="text-muted-foreground pl-4 text-xs">{ADMISSION_NOTE}</p>
              <Detail label={smartCardLabel(report.smartCard.count)} value={formatMoney(report.smartCard.total)} />
              <Detail strong label="Total collected" value={formatMoney(report.totalCollected)} />
              {cancelledText && <p className="text-muted-foreground pt-1 text-xs">{cancelledText}</p>}
            </Expander>
          </Step>

          <Step dot="minus">
            <Expander label="− Deductions" value={formatMoney(report.deductions.total)}>
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
      </div>

      <div className="bg-secondary my-2 flex items-center justify-between gap-3 rounded-lg px-3 py-3">
        <span className="min-w-0 break-words text-sm font-medium">Should be in the drawer</span>
        <span className="shrink-0 text-lg font-semibold tabular-nums">{formatCents(flow.shouldBe)}</span>
      </div>

      <div className="relative">
        <span aria-hidden className="bg-border absolute top-3 bottom-3 left-[9px] w-0.5" />
        <ol className="space-y-1 pl-7">
          <Step dot="minus">
            <Expander
              label="− Taken to bank"
              sub={bank.length === 0 ? "Nothing banked yet" : `${bank.length} line${bank.length === 1 ? "" : "s"} · last ${to12Hour(lastBankTime!)}`}
              value={formatCents(flow.bankTotal)}
            >
              {bank.length === 0 && <p className="text-muted-foreground py-1 text-sm">No money taken to the bank yet.</p>}
              <ul className="space-y-2">
                {bank.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block tabular-nums">{to12Hour(l.time)}{l.slip ? ` · slip ${l.slip}` : ""}</span>
                      {l.note && <span className="text-muted-foreground block break-words text-xs">{l.note}</span>}
                      {l.recordedBy && <span className="text-muted-foreground block break-words text-xs">Recorded by {l.recordedBy}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums">{formatCents(l.cents)}</span>
                      {onRemoveBank && (
                        <button type="button" aria-label={`Remove the ${to12Hour(l.time)} bank line`} onClick={() => onRemoveBank(i)} className="text-muted-foreground grid size-11 place-items-center rounded">
                          <X className="size-4" aria-hidden />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Expander>
          </Step>
        </ol>
      </div>

      <div className={`mt-2 flex items-center justify-between gap-3 rounded-lg px-3 py-4 text-white ${flow.left < 0 ? "bg-red-700" : "bg-primary"}`}>
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium">Left in drawer</span>
          <span className="block break-words text-xs opacity-90">Suggested as tomorrow&rsquo;s bring-forward</span>
        </span>
        <span className="shrink-0 text-2xl font-semibold tabular-nums">{formatCents(flow.left)}</span>
      </div>
    </section>
  );
}

/** "By course", "Admission and smart card replacement", "Collected by staff". */
export function DetailSections({ report, staff }: { report: DailySummary; staff: readonly StaffCollected[] }) {
  const withPayments = report.courses.filter((c) => c.paidFull + c.paidHalf + c.paidQuarter > 0 || decimalToCents(c.amount) > 0);
  const noPayments = report.courses.filter((c) => !withPayments.includes(c));
  return (
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
      <Expander label="Admission and smart card replacement" row>
        <Detail label={`Admission (${report.admission.count})`} value={formatMoney(report.admission.total)} />
        <p className="text-muted-foreground pl-4 text-xs">{ADMISSION_NOTE}</p>
        <Detail label={smartCardLabel(report.smartCard.count)} value={formatMoney(report.smartCard.total)} />
      </Expander>
      <Expander label="Collected by staff" row>
        {staff.length === 0 && <p className="text-muted-foreground py-1 text-sm">No receipts.</p>}
        {staff.map((r) => (
          <Detail key={r.userId} label={`${r.name} · ${r.receipts} receipt${r.receipts === 1 ? "" : "s"}`} value={formatMoney(r.collected)} />
        ))}
        {staff.length > 0 && <Detail strong label={`Total · ${staff.reduce((s, r) => s + r.receipts, 0)} receipts`} value={formatMoney(report.totalCollected)} />}
      </Expander>
    </section>
  );
}
