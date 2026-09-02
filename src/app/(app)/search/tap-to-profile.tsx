"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Nfc, QrCode, XCircle } from "lucide-react";

import { QrScanner } from "@/components/scan/qr-scanner";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Button } from "@/components/ui/button";

import type { StudentBrief } from "@/lib/students";

/**
 * The front door to the Student Profile.
 *
 * The profile has existed since the arrears work but was only reachable by
 * typing; the counter identifies people by card. This arms the SAME continuous
 * reader the attendance counter uses — pressed once, it stays on — and a tap
 * opens that student's profile. Look someone up, look up the next one, without
 * touching the screen in between.
 *
 * Read-only and staff-facing: nobody logs in as a student, this is ADMIN/STAFF
 * looking a person up.
 */
export function TapToProfile({
  resolveCard,
}: {
  resolveCard: (input: { cardUid?: string; cardNumber?: string }) => Promise<StudentBrief | null>;
}) {
  const router = useRouter();
  const [qrOpen, setQrOpen] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback(
    (input: { cardUid?: string; cardNumber?: string }, shown: string) => {
      setBusy(true);
      setMissing(null);
      void (async () => {
        try {
          const student = await resolveCard(input);
          if (student) {
            router.push(`/students/${student.id}`);
            return;
          }
          // Not an error state to recover from — the reader stays on, so the
          // next card can simply be tapped.
          setMissing(shown);
        } finally {
          setBusy(false);
        }
      })();
    },
    [resolveCard, router],
  );

  // Continuous: armed once, then a queue of cards can be looked up in turn.
  const nfc = useNfcScan((cardUid) => open({ cardUid }, cardUid), { continuous: true });

  /**
   * Opening a profile is a real navigation, so this component unmounts and the
   * scan necessarily stops — a reader cannot outlive the page holding it. So
   * the armed state is remembered and re-armed on the way back, which is what
   * makes "tap, read, back, tap the next one" feel continuous. Session-scoped:
   * closing the terminal's tab disarms it.
   */
  const armedOnce = useRef(false);
  useEffect(() => {
    if (armedOnce.current) return;
    armedOnce.current = true;
    try {
      if (sessionStorage.getItem("xenon-lookup-reader") === "on") void nfc.start();
    } catch {
      // Private mode or a locked-down WebView: staff press the button instead.
    }
  }, [nfc]);

  const remember = useCallback((on: boolean) => {
    try {
      sessionStorage.setItem("xenon-lookup-reader", on ? "on" : "off");
    } catch {
      // Not remembering is a small inconvenience, never an error.
    }
  }, []);

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <p className="text-sm font-medium">Look up by card</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {nfc.support !== "unsupported" &&
          (nfc.scanning ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border-2 border-emerald-400 bg-emerald-50 px-3 py-2 sm:col-span-2">
              <span className="size-2.5 animate-pulse rounded-full bg-emerald-500" />
              <p className="text-sm font-medium text-emerald-900">
                Reader ON — tap a card to open their profile
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  remember(false);
                  nfc.stop();
                }}
              >
                Stop
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => {
                remember(true);
                void nfc.start();
              }}
              className="h-12 gap-2 sm:col-span-2"
              disabled={nfc.support === "unknown"}
            >
              <Nfc className="size-4" aria-hidden />
              Start reader (NFC)
            </Button>
          ))}

        <Button variant="secondary" className="h-11 gap-2" onClick={() => setQrOpen(true)}>
          <QrCode className="size-4" aria-hidden />
          Scan QR
        </Button>

        <div className="text-muted-foreground flex items-center justify-center rounded-lg border px-3 text-xs">
          {busy ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Opening…
            </span>
          ) : (
            "Or search by name, school or card below"
          )}
        </div>
      </div>

      {nfc.support === "unsupported" && (
        <p className="bg-secondary text-secondary-foreground rounded-lg px-3 py-2 text-sm">
          This browser can&apos;t read NFC. Use the QR scan or the filters below.
        </p>
      )}

      {nfc.error && (
        <p role="alert" className="text-destructive text-sm">
          {nfc.error}
        </p>
      )}

      {missing && (
        <p
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
        >
          <XCircle className="size-4 shrink-0" aria-hidden />
          No student for card <span className="font-mono">{missing}</span> — register
          it first. The reader is still on.
        </p>
      )}

      <QrScanner
        open={qrOpen}
        onOpenChange={setQrOpen}
        onDecode={(value) => open({ cardNumber: value }, value)}
      />
    </div>
  );
}
