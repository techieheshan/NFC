"use client";

import { useCallback, useState } from "react";
import { Loader2, Nfc, QrCode } from "lucide-react";

import { QrScanner } from "@/components/scan/qr-scanner";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeCardNumber, normalizeCardUid } from "@/lib/card-uid";

/**
 * The card number / card UID pair, shared by the new-student form and the
 * edit-student dialog so both offer the same three ways in:
 *
 *   type it   -> either       (staff read the number printed on the card)
 *   scan QR   -> cardNumber   (the QR encodes the printed number, nothing else)
 *   tap card  -> cardUid      (Chrome/Android over HTTPS)
 *
 * Both inputs are controlled, which is what lets a scan fill them: the value
 * lives in React state, so the scanner can write into it. That also survives
 * React 19's post-action form reset — the state is not part of the form's DOM,
 * so a rejected submission leaves what staff typed exactly where it was, with
 * no echoed-values plumbing needed here.
 *
 * Values are normalised at capture with the SAME helpers the server uses, so a
 * scanned card and a typed one land on identical strings against the unique
 * columns (AGENTS.md rule 12). The server normalises again regardless — this is
 * for the staff member's eyes, not for trust.
 */
export function CardFields({
  idPrefix,
  defaultCardNumber = "",
  defaultCardUid = "",
}: {
  /** Distinguishes the create form's inputs from the edit dialog's. */
  idPrefix: string;
  defaultCardNumber?: string;
  defaultCardUid?: string;
}) {
  const [cardNumber, setCardNumber] = useState(defaultCardNumber);
  const [cardUid, setCardUid] = useState(defaultCardUid);
  const [qrOpen, setQrOpen] = useState(false);

  // Stable: QrScanner keys its camera loop on this, and a new identity every
  // keystroke would tear the stream down and start it again.
  const onDecode = useCallback(
    (value: string) => setCardNumber(normalizeCardNumber(value)),
    [],
  );

  const {
    support: nfcSupport,
    scanning,
    error: nfcError,
    start: startScan,
    stop: stopScan,
  } = useNfcScan((uid) => setCardUid(normalizeCardUid(uid)));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-cardNumber`}>Card number</Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-cardNumber`}
            name="cardNumber"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            placeholder="0186-0001-2000"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0 gap-1.5"
            onClick={() => setQrOpen(true)}
          >
            <QrCode className="size-4" aria-hidden />
            Scan
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">Printed on the card, or scan its QR.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-cardUid`}>Card UID</Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-cardUid`}
            name="cardUid"
            value={cardUid}
            onChange={(e) => setCardUid(e.target.value)}
            placeholder="04A22B9C"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          {/* Hidden rather than disabled where NFC doesn't exist: a dead button
              on every office desktop is just noise. */}
          {nfcSupport !== "unsupported" &&
            (scanning ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0 gap-1.5"
                onClick={stopScan}
              >
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Tap now
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 gap-1.5"
                onClick={startScan}
                disabled={nfcSupport === "unknown"}
              >
                <Nfc className="size-4" aria-hidden />
                Tap
              </Button>
            ))}
        </div>
        <p className="text-muted-foreground text-xs">
          {scanning ? "Hold the card against the phone…" : "The NFC chip serial."}
        </p>
      </div>

      {nfcError && (
        <p role="alert" className="text-destructive text-xs sm:col-span-2">
          {nfcError}
        </p>
      )}

      <p className="text-muted-foreground -mt-2 text-xs sm:col-span-2">
        At least one is required. Capture both when the card allows it.
      </p>

      <QrScanner
        open={qrOpen}
        onOpenChange={setQrOpen}
        onDecode={onDecode}
      />
    </div>
  );
}
