"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Ban, Nfc, Printer, QrCode } from "lucide-react";

import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { to12Hour } from "@/lib/colombo-time";

import {
  createStaffQr, enrollNfcCard, renameTerminal, revokeStaffCredential, revokeTerminal,
  type ActionState, type CardRow, type QrResult, type StaffCardsView, type StaffCardUser, type TerminalRow,
} from "./staff-card-actions";

const EMPTY: ActionState = { ok: false };
const when = (isoText: string | null) => {
  if (!isoText) return "never";
  const d = new Date(isoText);
  const colombo = new Date(d.getTime() + 5.5 * 3_600_000).toISOString();
  return `${colombo.slice(0, 10)} ${to12Hour(colombo.slice(11, 16))}`;
};

export function StaffCardsScreen({ view }: { view: StaffCardsView }) {
  const [adding, setAdding] = useState<StaffCardUser | null>(null);
  const [revoking, setRevoking] = useState<{ card: CardRow; who: string } | null>(null);
  const [qr, setQr] = useState<{ who: string; result: Extract<QrResult, { ok: true }> } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [terminalAction, setTerminalAction] = useState<{ kind: "rename" | "revoke"; row: TerminalRow } | null>(null);

  const makeQr = (u: StaffCardUser) => {
    setQrError(null);
    start(async () => {
      const r = await createStaffQr(u.userId, "");
      if (r.ok) setQr({ who: u.name, result: r });
      else setQrError(r.error);
    });
  };

  return (
    <div className="space-y-6">
      <section aria-label="Staff cards" className="space-y-3">
        <h2 className="text-lg font-semibold">Staff cards and QR codes</h2>
        <p className="text-muted-foreground text-sm">A STAFF login can sign in by tapping its card or scanning its QR on a terminal that has been signed in with a password once. Cards of students are refused. ADMIN and TEACHER logins never use cards.</p>
        {qrError && <p role="alert" className="text-destructive text-sm">{qrError}</p>}
        {view.users.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm">There are no STAFF logins yet.</p>}
        <ul className="space-y-3">
          {view.users.map((u) => (
            <li key={u.userId} className={`rounded-xl border p-3 ${u.active ? "" : "bg-muted"}`}>
              <p className="font-medium">{u.name} <span className="text-muted-foreground text-xs">{u.username}{u.active ? "" : " · inactive"}</span></p>
              {u.cards.length === 0 && <p className="text-muted-foreground text-sm">No card yet.</p>}
              <ul className="mt-1 divide-y">
                {u.cards.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      {c.kind === "NFC" ? <Nfc className="size-4 shrink-0" aria-hidden /> : <QrCode className="size-4 shrink-0" aria-hidden />}
                      <span className="min-w-0 break-words">{c.kind === "NFC" ? "Card" : "QR"}{c.label ? ` · ${c.label}` : ""}<span className="text-muted-foreground block text-xs">Last used {when(c.lastUsedAt)}</span></span>
                    </span>
                    {c.revokedAt ? (
                      <Badge variant="secondary" className="gap-1"><Ban className="size-3.5" aria-hidden />Revoked: {c.revokeReason}</Badge>
                    ) : (
                      <Button variant="outline" className="min-h-11" onClick={() => setRevoking({ card: c, who: u.name })}>Revoke</Button>
                    )}
                  </li>
                ))}
              </ul>
              {u.active && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" className="min-h-11 gap-1.5" onClick={() => setAdding(u)}><Nfc className="size-4" aria-hidden />Add card</Button>
                  <Button variant="outline" className="min-h-11 gap-1.5" disabled={pending} onClick={() => makeQr(u)}><QrCode className="size-4" aria-hidden />Add QR</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Registered terminals" className="space-y-3">
        <h2 className="text-lg font-semibold">Registered terminals</h2>
        <p className="text-muted-foreground text-sm">A device becomes a terminal when someone signs in on it with a password (while Staff quick login is on in Settings). Revoking one stops card sign-in there at once and ends the sessions that came from it.</p>
        {view.terminals.length === 0 && <p className="rounded-xl border border-dashed p-4 text-center text-sm">No terminal yet.</p>}
        <ul className="space-y-2">
          {view.terminals.map((t) => (
            <li key={t.id} className={`rounded-xl border p-3 text-sm ${t.revokedAt ? "bg-muted" : ""}`}>
              <p className="font-medium">{t.label ?? `Terminal #${t.id}`} {t.revokedAt && <Badge variant="secondary" className="ml-1 gap-1"><Ban className="size-3.5" aria-hidden />Revoked</Badge>}</p>
              <p className="text-muted-foreground text-xs">Last seen {when(t.lastSeenAt)} · {t.consecutiveQuick} quick sign-in{t.consecutiveQuick === 1 ? "" : "s"} since the last password{t.lockedUntil && new Date(t.lockedUntil) > new Date() ? ` · paused until ${when(t.lockedUntil)}` : ""}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11" onClick={() => setTerminalAction({ kind: "rename", row: t })}>Name it</Button>
                {!t.revokedAt && <Button variant="outline" className="min-h-11" onClick={() => setTerminalAction({ kind: "revoke", row: t })}>Revoke</Button>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Recent card sign-ins" className="space-y-2">
        <h2 className="text-lg font-semibold">Recent sign-in attempts</h2>
        <p className="text-muted-foreground text-xs">The last 25. The card number or QR text is never kept.</p>
        <ul className="divide-y rounded-xl border text-sm">
          {view.events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>{when(e.at)} · {e.method.toLowerCase()} · {e.outcome.toLowerCase().replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">{e.who ?? ""} {e.terminal ?? ""}</span>
            </li>
          ))}
          {view.events.length === 0 && <li className="px-3 py-3 text-center">Nothing yet.</li>}
        </ul>
      </section>

      {adding && <AddCardDialog user={adding} onClose={() => setAdding(null)} />}
      {revoking && <RevokeDialog card={revoking.card} who={revoking.who} onClose={() => setRevoking(null)} />}
      {terminalAction && <TerminalDialog action={terminalAction} onClose={() => setTerminalAction(null)} />}
      {qr && (
        <Dialog open onOpenChange={(o) => !o && setQr(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>QR for {qr.who}</DialogTitle>
              <DialogDescription>Print it now. It is shown only once: after you close this, make a new one if it is lost.</DialogDescription>
            </DialogHeader>
            <div id="staff-qr" className="mx-auto w-56 bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: qr.result.svg }} />
            <DialogFooter className="gap-2">
              <Button variant="outline" className="min-h-11 gap-2" onClick={() => window.print()}><Printer className="size-4" aria-hidden />Print</Button>
              <Button className="min-h-11" onClick={() => setQr(null)}>Done</Button>
            </DialogFooter>
            <style>{`@media print { body * { visibility: hidden !important; } #staff-qr, #staff-qr * { visibility: visible !important; } #staff-qr { position: absolute; left: 0; top: 0; width: 60mm; } }`}</style>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AddCardDialog({ user, onClose }: { user: StaffCardUser; onClose: () => void }) {
  const [state, action, pending] = useActionState(enrollNfcCard, EMPTY);
  const [uid, setUid] = useState("");
  const [label, setLabel] = useState(state.values?.label ?? "");
  const nfc = useNfcScan((read) => setUid(read));
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <input type="hidden" name="userId" value={user.userId} />
          <DialogHeader>
            <DialogTitle>Add a card for {user.name}</DialogTitle>
            <DialogDescription>Tap the card on this device, or type its UID. A student&apos;s card is refused.</DialogDescription>
          </DialogHeader>
          <Button type="button" variant="outline" className="min-h-11 w-full gap-2" disabled={nfc.support === "unsupported"} onClick={() => nfc.start()}><Nfc className="size-4" aria-hidden />{nfc.scanning ? "Tap the card now…" : "Tap the card"}</Button>
          {nfc.error && <p role="alert" className="text-destructive text-sm">{nfc.error}</p>}
          <div className="space-y-2">
            <Label htmlFor="uid">Card UID</Label>
            <Input id="uid" name="uid" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" autoCapitalize="characters" className="h-11 font-mono" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="label">Label (optional)</Label>
            <Input id="label" name="label" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" className="h-11" />
          </div>
          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
            <Button type="submit" className="min-h-11" disabled={pending || uid.trim() === ""}>Save card</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ card, who, onClose }: { card: CardRow; who: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(revokeStaffCredential, EMPTY);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={card.id} />
          <DialogHeader>
            <DialogTitle>Revoke this {card.kind === "NFC" ? "card" : "QR"} of {who}?</DialogTitle>
            <DialogDescription>It stops working at once, and any session started with it ends. Later taps are logged as revoked.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Input id="reason" name="reason" defaultValue={state.values?.reason ?? ""} autoComplete="off" required className="h-11" />
          </div>
          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Keep it</Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={pending}>Revoke</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TerminalDialog({ action: a, onClose }: { action: { kind: "rename" | "revoke"; row: TerminalRow }; onClose: () => void }) {
  const [state, action, pending] = useActionState(a.kind === "rename" ? renameTerminal : revokeTerminal, EMPTY);
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={a.row.id} />
          <DialogHeader>
            <DialogTitle>{a.kind === "rename" ? "Name this terminal" : `Revoke ${a.row.label ?? `terminal #${a.row.id}`}?`}</DialogTitle>
            <DialogDescription>{a.kind === "rename" ? "A name helps you recognise it, for example Front desk." : "Card sign-in stops there at once. A password sign-in on that device makes it a terminal again."}</DialogDescription>
          </DialogHeader>
          {a.kind === "rename" && <Input name="label" aria-label="Terminal name" defaultValue={state.values?.label ?? a.row.label ?? ""} autoComplete="off" className="h-11" />}
          {state.error && <p role="alert" className="text-destructive text-sm">{state.error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>Close</Button>
            <Button type="submit" variant={a.kind === "revoke" ? "destructive" : "default"} className="min-h-11" disabled={pending}>{a.kind === "rename" ? "Save" : "Revoke"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
