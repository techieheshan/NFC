"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReceiptText, ScanLine, Search, X } from "lucide-react";

import { QrScanner } from "@/components/scan/qr-scanner";
import { StudentSearch } from "@/components/scan/student-search";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StudentBrief } from "@/lib/students";

/**
 * Board 1 — Start. Three things: the card reader, a QR scan, a search.
 *
 * The reader is the same `useNfcScan` the Attendance counter and the old Payment
 * screen use (one permission flow, one set of messages, one abort path), armed on
 * arrival; the rings are the whole "it is listening" signal, as on Attendance,
 * and `xenon-ring` already stops moving under prefers-reduced-motion. The only
 * extra control is the receipt icon, which opens the existing Receipts page.
 */
export function StartScreen({
  identify,
  searchStudents,
}: {
  identify: (input: { cardUid?: string; cardNumber?: string }) => Promise<{ studentId: number } | null>;
  searchStudents: (query: string) => Promise<StudentBrief[]>;
}) {
  const router = useRouter();
  const [qrOpen, setQrOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);
  // A second tap while the first is being looked up must not start a second lookup.
  const busy = useRef(false);

  const open = useCallback(
    async (input: { cardUid?: string; cardNumber?: string }) => {
      if (busy.current) return;
      busy.current = true;
      setNotFound(false);
      setFailed(false);
      setOpening(true);
      try {
        const found = await identify(input);
        if (found) {
          // Stay "busy" while the next screen loads: a stray tap must not open it twice.
          router.push(`/payment-new/${found.studentId}`);
          return;
        }
        setNotFound(true);
      } catch {
        setFailed(true);
      }
      busy.current = false;
      setOpening(false);
    },
    [identify, router],
  );

  const openStudent = useCallback(
    (studentId: number) => {
      if (busy.current) return;
      busy.current = true;
      setOpening(true);
      router.push(`/payment-new/${studentId}`);
    },
    [router],
  );

  const nfc = useNfcScan((cardUid) => void open({ cardUid }), { autoStart: true });

  const live = nfc.scanning && nfc.support === "supported";
  const hint =
    nfc.support === "unsupported" ? "No NFC here" : nfc.error ? "NFC off — tap" : "Starting…";

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3">
      {(notFound || failed) && (
        <p
          role="alert"
          className="rounded-2xl border border-[#E8851C] bg-[#FFF4E5] px-4 py-3 text-sm font-medium text-[#4A2600]"
        >
          {failed
            ? "Couldn't reach the server. Check the connection and try again."
            : "Card not recognised. Register it first, or search by name."}
        </p>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => void nfc.start()}
          aria-label={live ? "Reader listening for cards" : "Turn the card reader on"}
          className={`relative isolate flex h-[min(22rem,46vh)] w-full items-center justify-center overflow-hidden rounded-3xl transition-colors ${
            live
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground border-2 border-dashed"
          }`}
        >
          {live && (
            <span className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 grid place-items-center">
              <span className="xenon-ring absolute size-44 rounded-full bg-white/35" aria-hidden />
              <span className="xenon-ring xenon-ring-2 absolute size-44 rounded-full bg-white/35" aria-hidden />
            </span>
          )}
          <svg viewBox="0 0 200 200" className="relative size-52" aria-hidden>
            <circle cx="100" cy="100" r="98" fill="none" stroke="currentColor" strokeWidth="4" />
            <circle cx="100" cy="100" r="55" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" />
            <rect x="66" y="78" width="68" height="46" rx="8" fill="currentColor" />
            <rect x="66" y="90" width="68" height="7" className="fill-primary" />
            <rect x="74" y="108" width="20" height="5" rx="2.5" fill="#CDB8F3" />
          </svg>
          {opening && <span className="absolute bottom-5 text-sm font-medium">Opening…</span>}
          {!live && !opening && <span className="absolute bottom-5 text-sm font-medium">{hint}</span>}
        </button>

        {/* A corner of the panel, but not part of the reader button. */}
        <Link
          href="/receipts"
          aria-label="Receipts"
          className="absolute right-4 bottom-4 z-10 grid size-14 place-items-center rounded-full bg-white text-primary shadow-sm"
        >
          <ReceiptText className="size-7" aria-hidden />
        </Link>
      </div>

      <button
        type="button"
        onClick={() => setQrOpen(true)}
        aria-label="Scan a QR code"
        className="flex h-[4.75rem] w-full items-center justify-center rounded-3xl bg-[#EDE3FF] text-[#3B1A8F] transition-colors hover:bg-[#E4D6FF]"
      >
        <ScanLine className="size-9" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Find a student by name or card number"
        className="flex h-[4.75rem] w-full items-center justify-center rounded-3xl bg-[#EDE3FF] text-[#3B1A8F] transition-colors hover:bg-[#E4D6FF]"
      >
        <Search className="size-9" aria-hidden />
      </button>

      <QrScanner
        open={qrOpen}
        onOpenChange={setQrOpen}
        onDecode={(value) => void open({ cardNumber: value })}
      />

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent showCloseButton={false}>
          <div className="flex items-start gap-2.5">
            <DialogHeader className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-bold">Find a student</DialogTitle>
              <DialogDescription>Type part of a card number, a name or a school.</DialogDescription>
            </DialogHeader>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              aria-label="Close"
              className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E1DAF0] bg-white"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <StudentSearch
            search={searchStudents}
            busy={opening}
            onPick={(s) => {
              setSearchOpen(false);
              openStudent(s.id);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
