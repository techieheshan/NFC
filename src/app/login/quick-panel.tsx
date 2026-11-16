"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Nfc, QrCode } from "lucide-react";

import { QrScanner } from "@/components/scan/qr-scanner";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Button } from "@/components/ui/button";
import { PUBLIC_TEXT } from "@/lib/quick-login-rules";

import { quickLogin } from "./quick-actions";

/**
 * Card and QR sign-in for STAFF, above the password form (which stays as the fallback). One tap on "Tap card" starts the reader (Chrome needs a
 * gesture for the first scan); the result is a coarse message that never says why a card was refused. When a password is needed the person
 * is sent to the same page with their username filled in.
 */
export function QuickLoginPanel() {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [pending, start] = useTransition();

  const send = (kind: "NFC" | "QR", value: string) => {
    setMessage(null);
    start(async () => {
      const r = await quickLogin(kind, value);
      if (r.ok) {
        router.replace("/");
        return;
      }
      if (r.code.startsWith("password:")) {
        router.replace(`/login?pw=1&u=${encodeURIComponent(r.code.slice("password:".length))}`);
        router.refresh();
        return;
      }
      setMessage(PUBLIC_TEXT[(r.code in PUBLIC_TEXT ? r.code : "unknown") as keyof typeof PUBLIC_TEXT]);
    });
  };

  const nfc = useNfcScan((uid) => send("NFC", uid));

  return (
    <section aria-label="Staff card sign-in" className="bg-card mb-4 space-y-3 rounded-xl border p-4 shadow-sm">
      <p className="text-sm font-medium">Staff: tap your card or scan your QR</p>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" className="h-14 flex-col gap-1" disabled={pending || nfc.support === "unsupported"} onClick={() => { setMessage(null); nfc.start(); }}>
          <Nfc className="size-5" aria-hidden />
          {nfc.scanning ? "Tap now…" : "Tap card"}
        </Button>
        <Button type="button" variant="outline" className="h-14 flex-col gap-1" disabled={pending} onClick={() => { setMessage(null); setQrOpen(true); }}>
          <QrCode className="size-5" aria-hidden />
          Scan QR
        </Button>
      </div>
      {nfc.support === "unsupported" && <p className="text-muted-foreground text-xs">This device cannot read cards. Scan your QR or use your password.</p>}
      {(message ?? nfc.error) && <p role="alert" className="border-destructive bg-destructive-soft text-destructive rounded-md border px-3 py-2 text-sm">{message ?? nfc.error}</p>}
      <QrScanner open={qrOpen} onOpenChange={setQrOpen} onDecode={(v) => send("QR", v)} />
    </section>
  );
}

