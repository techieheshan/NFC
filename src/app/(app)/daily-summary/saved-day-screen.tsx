"use client";

import Link from "next/link";
import { useReducer, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, History, Landmark, Pencil, Printer, ShieldCheck } from "lucide-react";

import { amountErrorText, formatCents, parseTypedAmount } from "@/lib/cents";
import { MAX_BANK_LINES, computeCashFlow, type BankLine } from "@/lib/cash-flow";
import { shiftDay } from "@/lib/daily-summary-dates";
import type { FigureDiff } from "@/lib/saved-day/diff";
import { changeLogNewestFirst, formatClock, formatWhen } from "@/lib/saved-day/log-rows";
import { overBankedBanner } from "@/lib/saved-day/over-bank";
import type { SavedDayView, SaveOutcome } from "@/lib/saved-day/store";
import {
  checkClearedChip, checkedChip, conflictText, editedChip, LIVE_DIFFERS, NOT_CHECKED_CHIP, NOTHING_CHANGED, savedChip,
} from "@/lib/saved-day/texts";

import { BankSheet } from "./bank-sheet";
import { CheckSheet } from "./check-sheet";
import { Action, DateStrip } from "./day-screen";
import { Banner, Chip, DetailSections, Expander, MoneyFlow, SELECT, type BankLineView } from "./day-parts";
import { reconcileWarning } from "./extra-lines";
import { LiveDiffSheet } from "./live-diff-sheet";
import { ReconcileNotice } from "./reconcile-notice";
import { SaveSheet } from "./save-sheet";
import { saveDay } from "./saved-actions";
import type { Signer } from "./signer-lists";
import { initialTypedState, typedReducer } from "./typed-reducer";

/**
 * The day screen for a SAVED day. Everything on it is the FROZEN version (numbers, deposits, who and when); the live data is only used to
 * tell whether it moved (`liveDiffs`) and what a re-save would give. Any signed-in ADMIN or STAFF may edit (bring-forward, bank lines) or
 * mark it checked; every save is a new version that records its own Done by. The page keys this component on date + version, so a new
 * version remounts it (rule 17): nothing here syncs props into state.
 */
export function SavedDayScreen({
  date, today, dateText, saved, liveDiffs, liveUnreadable, live, doners, admins,
}: {
  date: string;
  today: string;
  dateText: string;
  saved: SavedDayView;
  liveDiffs: FigureDiff[];
  liveUnreadable: boolean;
  /** The live collected and deductions in cents, from the data the page already loaded. */
  live: { collected: number; deductions: number };
  doners: Signer[];
  admins: Signer[];
}) {
  const router = useRouter();
  const report = saved.snapshot.report;
  const cash = saved.cash;
  const bankLines: BankLineView[] = saved.bank.map((b) => ({ cents: b.cents, time: b.time, slip: b.slip, note: b.note, recordedBy: b.recordedByName }));

  // edit mode: bring-forward and bank lines in the same pure state machine the draft uses; Done by is required
  const [typed, dispatch] = useReducer(typedReducer, undefined, () =>
    initialTypedState({ bf: cash.bringForward > 0 ? (cash.bringForward / 100).toFixed(2) : "", bank: bankLines.map((b) => ({ cents: b.cents, time: b.time, slip: b.slip, note: b.note })), preparedId: "", checkedId: "" }, []),
  );
  const [editing, setEditing] = useState(false);
  const [editingBf, setEditingBf] = useState(false);
  const [doneById, setDoneById] = useState("");
  const [refusal, setRefusal] = useState<Extract<SaveOutcome, { ok: false }> | null>(null);
  const [pending, start] = useTransition();
  const [sheet, setSheet] = useState<null | "check" | "diff" | "resave" | "bank">(null);

  const bfText = typed.bfText;
  const bfParsed = bfText.trim() === "" ? ({ ok: true, cents: 0 } as const) : parseTypedAmount(bfText);
  const bfCents = bfParsed.ok ? bfParsed.cents : 0;
  const collected = cash.collected;
  const deductions = cash.deductions;
  const editFlow = computeCashFlow({ bringForward: bfCents, collected, deductions, bank: typed.bank });
  const viewFlow = { shouldBe: cash.shouldBeInDrawer, bankTotal: cash.bankTotal, left: cash.leftInDrawer, overdrawn: saved.overBankedBy !== null };
  const flow = editing ? { shouldBe: editFlow.shouldBe, bankTotal: editFlow.bankTotal, left: editFlow.left, overdrawn: editFlow.overdrawn } : viewFlow;
  const shownBank: BankLineView[] = editing ? typed.bank : bankLines;

  const send = () => {
    start(async () => {
      const r = await saveDay({
        date, mode: "edit", baseVersion: saved.version, doneById,
        bringForward: bfText,
        bank: typed.bank.map((l) => ({ time: l.time, amount: (l.cents / 100).toFixed(2), slip: l.slip, note: l.note })),
      });
      if (r.ok) {
        router.refresh();
      } else {
        setRefusal(r);
        setDoneById(r.values.doneById); // controlled: a refusal keeps the choice (rule 14)
      }
    });
  };

  const liveLeft = cash.bringForward + live.collected - live.deductions - cash.bankTotal;
  const savedTime = formatClock(saved.savedAt);
  const log = changeLogNewestFirst(saved.log);
  const unreconciled = reconcileWarning(report);
  const docHref = (auto: "print" | "pdf") => `/daily-summary/document?date=${date}&auto=${auto}`;
  const differs = liveDiffs.length > 0;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-48">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Daily Summary</h1>
        <Link href="/daily-summary/history" className="text-primary flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium underline-offset-4 hover:underline">
          <History className="size-4" aria-hidden /> History
        </Link>
      </div>

      <DateStrip date={date} today={today} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/daily-summary/range?from=${shiftDay(date, -6)}&to=${date}`} className="text-primary flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline">
          Several days
        </Link>
        <div className="flex flex-wrap justify-end gap-2">
          <Chip tone="grey">{savedChip(saved.version, saved.doneBy.name, savedTime)}</Chip>
          {saved.version >= 2 && <Chip tone="grey">{editedChip(saved.version)}</Chip>}
        </div>
      </div>

      {/* the check */}
      <div className="space-y-1">
        {saved.check ? (
          <>
            <Chip tone="green">{checkedChip(saved.check.checkedByName, saved.check.markedByName)}</Chip>
            <p className="text-muted-foreground text-xs">{formatWhen(saved.check.checkedAt)}</p>
          </>
        ) : saved.checkCleared ? (
          <Chip tone="amber">{checkClearedChip(saved.checkCleared.by)}</Chip>
        ) : (
          <Chip tone="amber">{NOT_CHECKED_CHIP}</Chip>
        )}
      </div>

      {saved.overBankedBy !== null && <Banner tone="red" role="alert">{overBankedBanner(saved.overBankedBy)}</Banner>}
      {differs && (
        <Banner tone="amber" role="status">
          <p className="font-medium">{LIVE_DIFFERS}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSheet("diff")} className="border-input bg-background h-11 rounded-md border text-sm font-medium text-foreground">See what changed</button>
            <button type="button" onClick={() => setSheet("resave")} className="bg-primary text-primary-foreground h-11 rounded-md text-sm font-medium">Re-save with live numbers</button>
          </div>
        </Banner>
      )}
      {liveUnreadable && <Banner tone="amber" role="status">The live numbers could not be read, so this saved day cannot be compared with them.</Banner>}

      <MoneyFlow
        report={report}
        cancelled={saved.snapshot.cancelled}
        flow={flow}
        bank={shownBank}
        onRemoveBank={editing ? (i) => dispatch({ type: "bankRemove", index: i }) : undefined}
        bringForward={
          editing ? (
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
                    <span className="text-muted-foreground block text-xs">Opening cash · tap to change</span>
                  </span>
                  <span className="text-lg font-semibold tabular-nums">{formatCents(bfCents)}</span>
                </button>
              )}
              {!bfParsed.ok && <p role="alert" className="text-destructive text-sm">{amountErrorText(bfParsed.reason)}</p>}
            </>
          ) : (
            <div className="flex min-h-11 w-full items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">Bring-forward</span>
                <span className="text-muted-foreground block text-xs">Opening cash</span>
              </span>
              <span className="text-lg font-semibold tabular-nums">{formatCents(cash.bringForward)}</span>
            </div>
          )
        }
      />

      {editing && (
        <section className="space-y-3 rounded-xl border p-4">
          <button
            type="button" onClick={() => setSheet("bank")} disabled={typed.bank.length >= MAX_BANK_LINES}
            className="border-primary text-primary flex h-12 w-full items-center justify-center gap-2 rounded-md border-2 text-base font-medium disabled:opacity-50"
          >
            <Landmark className="size-5" aria-hidden /> Take money to bank
          </button>
          <div>
            <label htmlFor="edit-done-by" className="block text-sm font-medium">Done by <span className="text-destructive">*</span></label>
            <select id="edit-done-by" className={`${SELECT} mt-1`} value={doneById} onChange={(e) => setDoneById(e.target.value)}>
              <option value="" disabled>Select who did this…</option>
              {doners.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role === "ADMIN" ? "Admin" : "Staff"})</option>)}
            </select>
          </div>
          {flow.overdrawn && <p role="alert" className="text-destructive text-sm">The bank lines add up to more than the drawer should hold. Remove or correct a line.</p>}
          {refusal && refusal.reason === "conflict" && refusal.current && (
            <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>{conflictText(refusal.current.doneByName, formatClock(refusal.current.savedAt), refusal.current.version)}</p>
              <button type="button" onClick={() => router.refresh()} className="bg-primary text-primary-foreground mt-2 h-11 w-full rounded-md text-base font-medium">Show the day as saved</button>
            </div>
          )}
          {refusal && refusal.reason === "nothing-changed" && <p role="status" className="text-muted-foreground text-sm">{NOTHING_CHANGED}</p>}
          {refusal && refusal.reason !== "nothing-changed" && !(refusal.reason === "conflict" && refusal.current) && <p role="alert" className="text-destructive text-sm">{refusal.message}</p>}
        </section>
      )}

      {saved.version >= 2 && (
        <section className="rounded-xl border px-4">
          <Expander label="Change log" sub={`${log.length} entr${log.length === 1 ? "y" : "ies"}, newest first`}>
            <ul className="space-y-3 pt-1">
              {log.map((r, i) => (
                <li key={i} className="text-sm">
                  <span className="block break-words font-medium">Version {r.version} · {r.by}</span>
                  <span className="text-muted-foreground block text-xs">{r.when}</span>
                  <span className="block break-words">{r.what}</span>
                </li>
              ))}
            </ul>
          </Expander>
        </section>
      )}

      <ReconcileNotice text={unreconciled} />
      <DetailSections report={report} staff={saved.snapshot.staff} />

      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto max-w-[720px] space-y-2">
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { setEditing(false); setRefusal(null); }} className="border-input bg-background h-12 rounded-md border text-base font-medium">Cancel</button>
              <button
                type="button" onClick={send} disabled={pending || doneById === "" || !bfParsed.ok || flow.overdrawn}
                className="bg-primary text-primary-foreground h-12 rounded-md text-base font-medium disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setEditing(true)} className="bg-primary text-primary-foreground flex h-12 items-center justify-center gap-2 rounded-md text-base font-medium">
                  <Pencil className="size-5" aria-hidden /> Edit
                </button>
                <button
                  type="button" onClick={() => setSheet("check")} disabled={saved.check !== null}
                  className="border-input bg-background flex h-12 items-center justify-center gap-2 rounded-md border text-base font-medium disabled:opacity-50"
                >
                  <ShieldCheck className="size-5" aria-hidden /> {saved.check ? "Checked" : "Admin check"}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Action href={docHref("print")} icon={<Printer className="size-5" aria-hidden />} label="Print" variant="outline" />
                <Action href={docHref("pdf")} icon={<Download className="size-5" aria-hidden />} label="Download PDF" variant="outline" />
              </div>
            </>
          )}
        </div>
      </div>

      {sheet === "bank" && (
        <BankSheet
          inDrawerCents={editFlow.shouldBe - editFlow.bankTotal}
          onClose={() => setSheet(null)}
          onAdd={(line: BankLine) => {
            dispatch({ type: "bankAdd", line });
            setSheet(null);
          }}
        />
      )}
      {sheet === "check" && (
        <CheckSheet date={date} version={saved.version} shouldBe={cash.shouldBeInDrawer} bankTotal={cash.bankTotal} left={cash.leftInDrawer} admins={admins} onClose={() => setSheet(null)} />
      )}
      {sheet === "diff" && <LiveDiffSheet diffs={liveDiffs} savedLeft={cash.leftInDrawer} liveLeft={liveLeft} onClose={() => setSheet(null)} />}
      {sheet === "resave" && (
        <SaveSheet
          mode="resave" date={date} dateText={dateText} baseVersion={saved.version}
          numbers={{ collected: live.collected, deductions: live.deductions, shouldBe: cash.bringForward + live.collected - live.deductions, bankTotal: cash.bankTotal, left: liveLeft }}
          bankCount={saved.bank.length} doners={doners}
          bringForward={cash.bringForward > 0 ? (cash.bringForward / 100).toFixed(2) : ""}
          bank={saved.bank.map((b) => ({ cents: b.cents, time: b.time, slip: b.slip, note: b.note }))}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
