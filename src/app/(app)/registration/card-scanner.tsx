"use client";

import { useState } from "react";
import { Loader2, Nfc, QrCode, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { Identifier } from "./actions";
import { QrScanner } from "@/components/scan/qr-scanner";
import { useNfcScan } from "@/components/scan/use-nfc-scan";

/**
 * Identify step. A card carries two identifiers and this offers all three ways
 * to capture one:
 *   NFC tap  -> cardUid      (Chrome/Android over HTTPS)
 *   QR scan  -> cardNumber   (any device with a camera — the non-NFC phones)
 *   typing   -> either       (two labelled fields, so staff know which is which)
 */
export function CardScanner({
  onIdentify,
  busy,
}: {
  onIdentify: (identifier: Identifier) => void;
  busy: boolean;
}) {
  const {
    support: nfcSupport,
    scanning,
    error: nfcError,
    start: startScan,
    stop: stopScan,
  } = useNfcScan((uid) => onIdentify({ cardUid: uid }));

  const [qrOpen, setQrOpen] = useState(false);
  const [manualUid, setManualUid] = useState("");
  const [manualNumber, setManualNumber] = useState("");

  const canSubmitManual = manualUid.trim() !== "" || manualNumber.trim() !== "";

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center">
        <span className="bg-primary/10 text-primary mx-auto grid size-16 place-items-center rounded-full">
          <Nfc className="size-8" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Registration</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tap the card, scan its QR, or type an identifier. New cards start a
          registration; known cards open the student.
        </p>
      </div>

      <div className="space-y-3">
        {nfcSupport !== "unsupported" &&
          (scanning ? (
            <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
              <Loader2 className="text-primary mx-auto size-6 animate-spin" aria-hidden />
              <p className="text-sm font-medium">Hold the card against the phone…</p>
              <Button variant="outline" size="sm" onClick={stopScan}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={startScan}
              className="h-14 w-full gap-2 text-base"
              disabled={busy || nfcSupport === "unknown"}
            >
              <Nfc className="size-5" aria-hidden />
              Tap card (NFC)
            </Button>
          ))}

        <Button
          onClick={() => setQrOpen(true)}
          variant={nfcSupport === "unsupported" ? "default" : "secondary"}
          className="h-14 w-full gap-2 text-base"
          disabled={busy}
        >
          <QrCode className="size-5" aria-hidden />
          Scan QR code
        </Button>
      </div>

      {nfcSupport === "unsupported" && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          This browser can&apos;t read NFC (that needs Chrome on Android over
          HTTPS). Use the QR scan or type an identifier below.
        </p>
      )}

      {nfcError && (
        <p role="alert" className="text-destructive text-sm">
          {nfcError}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmitManual) return;
          onIdentify({
            cardUid: manualUid.trim() || undefined,
            cardNumber: manualNumber.trim() || undefined,
          });
        }}
        className="space-y-3 rounded-xl border p-4"
      >
        <p className="text-sm font-medium">Or enter manually</p>

        {/* Two labelled fields rather than one guess-the-format box: the two
            identifiers look nothing alike and are normalised differently. */}
        <div className="space-y-2">
          <Label htmlFor="manual-number">Card number</Label>
          <Input
            id="manual-number"
            value={manualNumber}
            onChange={(e) => setManualNumber(e.target.value)}
            placeholder="0186-0001-2000"
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
          />
          <p className="text-muted-foreground text-xs">Printed on the card.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="manual-uid">Card UID</Label>
          <Input
            id="manual-uid"
            value={manualUid}
            onChange={(e) => setManualUid(e.target.value)}
            placeholder="04:A2:2B:9C"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            The NFC chip serial, for cards already tapped elsewhere.
          </p>
        </div>

        <Button type="submit" variant="secondary" className="w-full gap-2" disabled={busy || !canSubmitManual}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Search className="size-4" aria-hidden />
          )}
          Look up
        </Button>
      </form>

      <QrScanner
        open={qrOpen}
        onOpenChange={setQrOpen}
        onDecode={(value) => onIdentify({ cardNumber: value })}
      />
    </div>
  );
}
