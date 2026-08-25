"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Nfc, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Minimal Web NFC typings — `NDEFReader` is Chrome/Android only and isn't in
 * lib.dom, so we declare just the surface we use rather than pulling in a
 * polyfill's types.
 */
type NDEFReadingEvent = Event & { serialNumber?: string };
type NDEFReaderLike = {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
  onreading: ((event: NDEFReadingEvent) => void) | null;
  onreadingerror: (() => void) | null;
};
type NDEFReaderCtor = new () => NDEFReaderLike;

/**
 * Web NFC availability is browser state, so it's read through
 * `useSyncExternalStore` rather than an effect. The server snapshot is
 * "unknown", which is what the hydration pass renders — that keeps the markup
 * identical on both sides and avoids briefly claiming NFC is missing on a
 * phone that has it.
 */
type NfcSupport = "unknown" | "supported" | "unsupported";

const subscribeToNothing = () => () => {};
const readNfcSupport = (): NfcSupport =>
  "NDEFReader" in window ? "supported" : "unsupported";
const nfcSupportOnServer = (): NfcSupport => "unknown";

export function CardScanner({
  onUid,
  busy,
}: {
  onUid: (uid: string) => void;
  busy: boolean;
}) {
  const nfcSupport = useSyncExternalStore(
    subscribeToNothing,
    readNfcSupport,
    nfcSupportOnServer,
  );
  const [scanning, setScanning] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // Stop an in-flight scan if the screen goes away mid-read.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function startScan() {
    setNfcError(null);

    const Ctor = (window as unknown as { NDEFReader?: NDEFReaderCtor }).NDEFReader;
    if (!Ctor) return;

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const reader = new Ctor();
      reader.onreading = (event) => {
        const uid = event.serialNumber;
        if (uid) {
          controller.abort();
          setScanning(false);
          onUid(uid);
        }
      };
      reader.onreadingerror = () => {
        setNfcError("Couldn't read that card. Try again.");
      };

      await reader.scan({ signal: controller.signal });
      setScanning(true);
    } catch (error) {
      setScanning(false);
      const name = (error as { name?: string })?.name;
      setNfcError(
        name === "NotAllowedError"
          ? "NFC permission was denied. Allow it in the browser, or type the UID below."
          : "Couldn't start the NFC scan. Type the UID below instead.",
      );
    }
  }

  function stopScan() {
    abortRef.current?.abort();
    abortRef.current = null;
    setScanning(false);
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center">
        <span className="bg-primary/10 text-primary mx-auto grid size-16 place-items-center rounded-full">
          <Nfc className="size-8" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Registration</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Scan a card to begin. New cards start a registration; known cards open
          the student.
        </p>
      </div>

      {nfcSupport !== "unsupported" && (
        <div className="space-y-3">
          {scanning ? (
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
              Scan card
            </Button>
          )}
        </div>
      )}

      {nfcSupport === "unsupported" && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
          This browser can&apos;t read NFC. Web NFC needs Chrome on Android over
          HTTPS. Type or paste the card UID below instead.
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
          if (manual.trim()) onUid(manual);
        }}
        className="space-y-2"
      >
        <Label htmlFor="manual-uid">
          {nfcSupport === "unsupported" ? "Card UID" : "…or enter the UID manually"}
        </Label>
        <div className="flex gap-2">
          <Input
            id="manual-uid"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="04:A2:2B:9C"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary" disabled={busy || !manual.trim()}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Search className="size-4" aria-hidden />
            )}
            <span className="sr-only">Look up card</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
