"use client";

import { useRef, useState, useTransition } from "react";
import { Minus, Plus, UserRound, X } from "lucide-react";

import { searchStudents, type StudentBrief } from "@/app/(app)/attendance/actions";
import { StudentSearch } from "@/components/scan/student-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Picker } from "@/components/ui/picker";
import { amountErrorText, formatCents, parseTypedAmount } from "@/lib/cents";
import { LABEL_MAX, MAX_LINES, MAX_QUANTITY, NOTE_MAX } from "@/lib/extra-payments";

import { takeExtraPayment, type ClassOption, type ExtraReceipt } from "./actions";
import { ExtraReceiptView } from "./extra-receipt";

type Item = { id: number; label: string; price: string };
type OneOff = { key: number; label: string; price: string; quantity: number };

const cents = (price: string) => {
  const p = parseTypedAmount(price);
  return p.ok ? p.cents : 0;
};
const newRef = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `r${Date.now()}${Math.random().toString(16).slice(2)}`);

/**
 * The counter sale. Everything priced here is DISPLAY: the server prices the bill again from the admin's list and only reads the item ids
 * and quantities (and a one-off line's typed label and price). One `clientRef` per sale, so a double tap or a retry returns the same bill.
 * Inputs are controlled, so a refusal never wipes what staff typed (AGENTS 14).
 */
export function SaleScreen({ items, classes, oneOffMaxCents }: { items: Item[]; classes: ClassOption[]; oneOffMaxCents: number }) {
  const [sale, setSale] = useState(0); // a new sale remounts the form: nothing carried over
  const [receipt, setReceipt] = useState<ExtraReceipt | null>(null);

  if (receipt) {
    return (
      <ExtraReceiptView
        receipt={receipt}
        autoPrint
        onDone={() => {
          setReceipt(null);
          setSale((n) => n + 1);
        }}
      />
    );
  }
  return <SaleForm key={sale} items={items} classes={classes} oneOffMaxCents={oneOffMaxCents} onSold={setReceipt} />;
}

function SaleForm({ items, classes, oneOffMaxCents, onSold }: { items: Item[]; classes: ClassOption[]; oneOffMaxCents: number; onSold: (r: ExtraReceipt) => void }) {
  const clientRef = useRef(newRef());
  const nextKey = useRef(1);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [oneOffs, setOneOffs] = useState<OneOff[]>([]);
  const [student, setStudent] = useState<StudentBrief | null>(null);
  const [findStudent, setFindStudent] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const lines = items.filter((i) => (qty[i.id] ?? 0) > 0);
  const total =
    lines.reduce((s, i) => s + cents(i.price) * (qty[i.id] ?? 0), 0) + oneOffs.reduce((s, o) => s + cents(o.price) * o.quantity, 0);
  const lineCount = lines.length + oneOffs.length;
  const oneOffBad = oneOffs.some((o) => o.label.trim().length < 2 || !parseTypedAmount(o.price).ok || cents(o.price) <= 0);

  const step = (id: number, d: number) => setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(MAX_QUANTITY, (q[id] ?? 0) + d)) }));

  const send = () => {
    setError(null);
    start(async () => {
      const r = await takeExtraPayment({
        clientRef: clientRef.current,
        studentId: student?.id ?? null,
        courseId: courseId === "" ? null : Number(courseId),
        note,
        lines: [
          ...lines.map((i) => ({ itemId: i.id, quantity: qty[i.id] })),
          ...oneOffs.map((o) => ({ label: o.label, price: o.price, quantity: o.quantity })),
        ],
      });
      if (r.ok) onSold(r.receipt);
      else setError(r.error);
    });
  };

  return (
    <div className="space-y-4 pb-28">
      {items.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm">No items yet. An admin adds them on the item list.</p>}
      <ul className="space-y-2">
        {items.map((i) => {
          const q = qty[i.id] ?? 0;
          return (
            <li key={i.id} className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${q > 0 ? "border-primary border-2" : ""}`}>
              <div className="min-w-0">
                <p className="break-words font-medium">{i.label}</p>
                <p className="text-muted-foreground text-sm tabular-nums">{formatCents(cents(i.price))}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" aria-label={`One less ${i.label}`} disabled={q === 0 || pending} onClick={() => step(i.id, -1)} className="border-input grid size-12 place-items-center rounded-md border disabled:opacity-40"><Minus className="size-5" aria-hidden /></button>
                <span aria-live="polite" className="w-8 text-center text-lg font-semibold tabular-nums">{q}</span>
                <button type="button" aria-label={`One more ${i.label}`} disabled={q >= MAX_QUANTITY || pending} onClick={() => step(i.id, 1)} className="bg-primary text-primary-foreground grid size-12 place-items-center rounded-md disabled:opacity-40"><Plus className="size-5" aria-hidden /></button>
              </div>
            </li>
          );
        })}
      </ul>

      {oneOffs.map((o) => (
        <div key={o.key} className="space-y-2 rounded-xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">One-off item</p>
            <button type="button" aria-label="Remove this one-off item" onClick={() => setOneOffs((l) => l.filter((x) => x.key !== o.key))} className="grid size-11 place-items-center rounded-md"><X className="size-5" aria-hidden /></button>
          </div>
          <Label htmlFor={`oo-l-${o.key}`}>Name</Label>
          <Input id={`oo-l-${o.key}`} value={o.label} maxLength={LABEL_MAX} autoComplete="off" className="h-11" onChange={(e) => setOneOffs((l) => l.map((x) => (x.key === o.key ? { ...x, label: e.target.value } : x)))} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`oo-p-${o.key}`}>Price</Label>
              <Input id={`oo-p-${o.key}`} value={o.price} inputMode="decimal" autoComplete="off" className="h-11" aria-invalid={o.price !== "" && !parseTypedAmount(o.price).ok} onChange={(e) => setOneOffs((l) => l.map((x) => (x.key === o.key ? { ...x, price: e.target.value } : x)))} />
            </div>
            <div>
              <Label htmlFor={`oo-q-${o.key}`}>Quantity</Label>
              <Input id={`oo-q-${o.key}`} value={String(o.quantity)} inputMode="numeric" autoComplete="off" className="h-11" onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, "")); setOneOffs((l) => l.map((x) => (x.key === o.key ? { ...x, quantity: Math.max(1, Math.min(MAX_QUANTITY, n || 1)) } : x))); }} />
            </div>
          </div>
          {o.price !== "" && !parseTypedAmount(o.price).ok && (() => { const p = parseTypedAmount(o.price); return !p.ok ? <p role="alert" className="text-destructive text-sm">{amountErrorText(p.reason)}</p> : null; })()}
        </div>
      ))}
      {oneOffMaxCents > 0 ? (
        <Button type="button" variant="outline" className="min-h-11 w-full gap-2" disabled={lineCount >= MAX_LINES || pending} onClick={() => setOneOffs((l) => [...l, { key: nextKey.current++, label: "", price: "", quantity: 1 }])}>
          <Plus className="size-4" aria-hidden /> Add a one-off item
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">One-off items are off. An admin can allow them in Settings.</p>
      )}

      <section className="space-y-3 rounded-xl border p-3">
        <p className="text-sm font-medium">Student (optional)</p>
        {student ? (
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2"><UserRound className="size-5 shrink-0" aria-hidden /><span className="min-w-0 break-words">{student.name}<span className="text-muted-foreground block text-xs">{student.cardNumber ?? "no card number"}</span></span></p>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setStudent(null)}>Remove</Button>
          </div>
        ) : findStudent ? (
          <StudentSearch search={searchStudents} busy={pending} onPick={(s) => { setStudent(s); setFindStudent(false); }} />
        ) : (
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => setFindStudent(true)}>Find a student</Button>
        )}
        <div className="space-y-2">
          <Label>Class (optional)</Label>
          <Picker name="courseId" value={courseId} onChange={setCourseId} title="Class" placeholder="No class" options={[{ value: "", label: "No class" }, ...classes.map((c) => ({ value: String(c.id), label: c.label }))]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="extra-note">Note (optional)</Label>
          <Input id="extra-note" value={note} maxLength={NOTE_MAX} autoComplete="off" className="h-11" onChange={(e) => setNote(e.target.value)} />
        </div>
      </section>

      {error && <p role="alert" className="text-destructive rounded-md border border-red-300 bg-red-50 p-3 text-sm">{error}</p>}

      <div className="bg-background fixed inset-x-0 bottom-0 z-30 border-t px-4 py-3 lg:left-64">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs">Total</p>
            <p className="text-xl font-semibold tabular-nums">{formatCents(total)}</p>
          </div>
          <Button type="button" className="h-12 flex-1 text-base" disabled={pending || total <= 0 || oneOffBad} onClick={send}>
            {pending ? "Taking payment…" : "Take payment"}
          </Button>
        </div>
      </div>
    </div>
  );
}
