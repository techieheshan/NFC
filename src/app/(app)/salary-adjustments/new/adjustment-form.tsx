"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";
import { amountErrorText, formatCents, parseTypedAmount } from "@/lib/cents";
import { friendlyDate } from "@/lib/friendly-date";
import { buildLines, CONSENT_MAX, MONTHS_AHEAD, TITLE_MAX, parsePersonKey } from "@/lib/salary-adjustments";

import { createSalaryAdjustment, type PersonOption, type SourceOption } from "../actions";

const cents = (t: string) => {
  const p = parseTypedAmount(t);
  return p.ok ? p.cents : null;
};

/**
 * Everything computed here is DISPLAY (the live "Xenon bears" figure): the server reads the total from the expense or income itself and
 * recomputes every amount in cents. The pickers and fields are controlled, so a refusal never wipes what was typed (AGENTS 14).
 */
export function AdjustmentForm({ expenses, incomes, people, today }: { expenses: SourceOption[]; incomes: SourceOption[]; people: PersonOption[]; today: string }) {
  const [kind, setKind] = useState<"SHARED_EXPENSE" | "BONUS">("SHARED_EXPENSE");
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<"EQUAL" | "CUSTOM">("EQUAL");
  const [shared, setShared] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // key -> custom amount text ("" when equal)
  const [consentNote, setConsentNote] = useState("");
  const [consentOn, setConsentOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const sources = kind === "SHARED_EXPENSE" ? expenses : incomes;
  const source = sources.find((s) => String(s.id) === sourceId);
  const totalCents = source ? (cents(source.total) ?? 0) : 0;
  const keys = Object.keys(picked);

  const preview = (() => {
    if (!source || keys.length === 0) return null;
    const list = keys.flatMap((k) => { const person = parsePersonKey(k); return person ? [{ person, cents: mode === "CUSTOM" ? cents(picked[k]) : null }] : []; });
    if (mode === "CUSTOM" && list.some((l) => l.cents === null)) return null;
    const sharedCents = cents(shared);
    if (mode === "EQUAL" && sharedCents === null) return null;
    const r = buildLines(totalCents, { splitMode: mode, sharedCents: sharedCents, people: list });
    return r.ok ? r : null;
  })();

  const toggle = (key: string) => setPicked((p) => { const n = { ...p }; if (key in n) delete n[key]; else n[key] = ""; return n; });

  const send = () => {
    setError(null);
    start(async () => {
      const r = await createSalaryAdjustment({
        kind, sourceId, title, month, splitMode: mode, shared: mode === "EQUAL" ? shared : undefined,
        people: keys.map((k) => ({ key: k, amount: mode === "CUSTOM" ? picked[k] : undefined })),
        consentNote, consentOn,
      });
      if (r.ok) router.push(`/salary-adjustments/${r.id}/notice`);
      else setError(r.error);
    });
  };

  const sharedBad = mode === "EQUAL" && shared !== "" && !parseTypedAmount(shared).ok;
  const maxMonth = (() => { const [y, m] = today.split("-").map(Number); const i = y * 12 + (m - 1) + MONTHS_AHEAD; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; })();

  return (
    <div className="space-y-4 pb-24">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What is it?</legend>
        <div className="grid grid-cols-2 gap-2">
          {([["SHARED_EXPENSE", "Share an expense"], ["BONUS", "Bonus from an income"]] as const).map(([k, label]) => (
            <label key={k} className={`flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm ${kind === k ? "border-primary border-2 font-medium" : ""}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => { setKind(k); setSourceId(""); }} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label>{kind === "SHARED_EXPENSE" ? "The expense" : "The income"}</Label>
        <Picker name="sourceId" value={sourceId} onChange={setSourceId} title={kind === "SHARED_EXPENSE" ? "Expense" : "Income"} placeholder="Pick one…"
          options={sources.map((s) => ({ value: String(s.id), label: s.label, hint: `${friendlyDate(s.date)} · ${formatCents(cents(s.total) ?? 0)}${s.taken ? " · already shared" : ""}`, disabled: s.taken }))} />
        {source && <p className="text-sm">Total: <span className="font-semibold tabular-nums">{formatCents(totalCents)}</span></p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="title">Title (printed on the payslip)</Label>
        <Input id="title" value={title} maxLength={TITLE_MAX} autoComplete="off" className="h-11" onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="month">Payroll month (this month or later)</Label>
        <Input id="month" type="month" value={month} min={today.slice(0, 7)} max={maxMonth} className="h-11" onChange={(e) => setMonth(e.target.value)} />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Split</legend>
        <div className="grid grid-cols-2 gap-2">
          {([["EQUAL", "Equal"], ["CUSTOM", "Custom amounts"]] as const).map(([k, label]) => (
            <label key={k} className={`flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm ${mode === k ? "border-primary border-2 font-medium" : ""}`}>
              <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        {mode === "EQUAL" && (
          <div className="space-y-1">
            <Label htmlFor="shared">Amount to share among the people picked</Label>
            <Input id="shared" value={shared} inputMode="decimal" autoComplete="off" className="h-11" aria-invalid={sharedBad} onChange={(e) => setShared(e.target.value)} />
            {sharedBad && (() => { const p = parseTypedAmount(shared); return !p.ok ? <p role="alert" className="text-destructive text-sm">{amountErrorText(p.reason)}</p> : null; })()}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Who ({keys.length} picked)</legend>
        <ul className="divide-y rounded-xl border">
          {people.map((p) => {
            const on = p.key in picked;
            const line = preview?.lines.find((l) => `${l.person.kind === "teacher" ? "t" : "s"}${l.person.id}` === p.key);
            return (
              <li key={p.key} className="space-y-2 px-3 py-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={on} onChange={() => toggle(p.key)} className="size-5" />
                  <span className="min-w-0 flex-1 break-words">{p.name} <span className="text-muted-foreground text-xs">{p.kind === "teacher" ? "teacher" : "staff"}</span></span>
                  {on && mode === "EQUAL" && line && <span className="tabular-nums">{formatCents(line.cents)}</span>}
                </label>
                {on && mode === "CUSTOM" && (
                  <Input aria-label={`Amount for ${p.name}`} value={picked[p.key]} inputMode="decimal" autoComplete="off" placeholder="Amount" className="h-11" onChange={(e) => setPicked((x) => ({ ...x, [p.key]: e.target.value }))} />
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {source && (
        <div className="bg-secondary rounded-lg px-3 py-3 text-sm" aria-live="polite">
          <div className="flex justify-between"><span>{kind === "SHARED_EXPENSE" ? "People pay" : "People get"}</span><span className="tabular-nums">{preview ? formatCents(preview.sharedCents) : "—"}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Xenon {kind === "SHARED_EXPENSE" ? "bears" : "keeps"}</span><span className="tabular-nums">{preview ? formatCents(preview.instituteCents) : "—"}</span></div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="consent">Who agreed, and how (required)</Label>
        <Input id="consent" value={consentNote} maxLength={CONSENT_MAX} autoComplete="off" placeholder="e.g. Both teachers agreed in the staff meeting" className="h-11" onChange={(e) => setConsentNote(e.target.value)} />
        <Label htmlFor="consent-on">Date they agreed</Label>
        <Input id="consent-on" type="date" value={consentOn} max={today} className="h-11" onChange={(e) => setConsentOn(e.target.value)} />
      </div>

      {error && <p role="alert" className="text-destructive rounded-md border border-red-300 bg-red-50 p-3 text-sm">{error}</p>}

      <div className="bg-background fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 lg:left-64">
        <div className="mx-auto flex max-w-xl gap-3">
          <Button asChild variant="outline" className="h-12 flex-1"><Link href="/salary-adjustments">Cancel</Link></Button>
          <Button type="button" className="h-12 flex-1 text-base" disabled={pending || !source || keys.length === 0} onClick={send}>{pending ? "Saving…" : "Save adjustment"}</Button>
        </div>
      </div>
    </div>
  );
}
