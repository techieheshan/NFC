"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CloudOff,
  Loader2,
  Nfc,
  QrCode,
  Pause,
  RefreshCw,
  UploadCloud,
} from "lucide-react";

import { PaymentScreen } from "@/app/(app)/payment/payment-screen";
import type {
  ChargeResult,
  ComboDecision,
  PanelResult,
} from "@/app/(app)/payment/actions";
import { QrScanner } from "@/components/scan/qr-scanner";
import { StudentSearch } from "@/components/scan/student-search";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { colomboNow } from "@/lib/colombo-time";
import type { Candidate } from "@/lib/attendance-match";
import type { StudentBrief } from "@/lib/students";

import type {
  Method,
  QueuedMark,
  ScanResult,
  SyncOutcome,
  WorkingSet,
} from "./actions";
import { ChoiceCard, CounterCard } from "./counter-card";
import {
  playAlreadyMarked,
  playMarkedButOwes,
  playNeedsChoice,
  playPaymentSuccess,
  playReject,
  playSuccess,
  primeAudio,
} from "./sounds";
import { useOfflineAttendance } from "./use-offline-attendance";
import { setVoiceEnabled, VOICE } from "@/lib/voice";

type Tap = { input: { cardUid?: string; cardNumber?: string; studentId?: number }; method: Method };

type StreamCard = { id: string; result: ScanResult };

/**
 * Which outcomes are QUESTIONS rather than results.
 *
 * A confirmation reports something that already happened, so the next tap
 * simply replaces it and the line keeps moving. A question — which class? whose
 * card is this? — has no answer yet, so the reader holds until staff give one.
 * That is the whole "click only when ambiguous" rule.
 */
const BLOCKS = new Set<ScanResult["status"]>(["choose", "confirm", "unknown"]);

/**
 * What the reader is doing, as staff sees it.
 *
 *   off      — not armed yet
 *   on       — armed and listening; students tap one after another
 *   waiting  — armed, but a choice is on screen, so taps are IGNORED
 */
type ReaderState = "off" | "on" | "waiting";

type Props = {
  resolveScan: (input: {
    cardUid?: string; cardNumber?: string; studentId?: number;
    method: Method; clientRef: string;
  }) => Promise<ScanResult>;
  markCandidate: (input: {
    studentId: number; courseId: number; additionalClassId: number | null;
    method: Method; clientRef: string;
  }) => Promise<ScanResult>;
  undoMark: (attendanceId: number) => Promise<{ ok: boolean; error?: string }>;
  searchStudents: (query: string) => Promise<StudentBrief[]>;
  loadWorkingSet: () => Promise<WorkingSet>;
  syncMarks: (items: QueuedMark[]) => Promise<SyncOutcome[]>;
  // Payment engine, passed straight through to the embedded payment screen.
  loadPanel: (input: { cardUid?: string; cardNumber?: string; studentId?: number }) => Promise<PanelResult>;
  takePayment: (input: {
    comboDecisions: ComboDecision[]; studentId: number; admission: boolean;
    smartCard: boolean; classMonths: { courseId: number; year: number; month: number }[];
  }) => Promise<ChargeResult>;
  paymentSearch: (query: string) => Promise<StudentBrief[]>;
  /** From the Settings voice toggle. Tones play either way. */
  voiceEnabled: boolean;
};

/**
 * The streaming counter.
 *
 * The reader never stops. Every tap joins a SERIAL queue — a burst processes in
 * order, none dropped, none raced — and each outcome stacks a confirmation card
 * that needs no click to clear. The only thing that halts the stream is a
 * genuine ambiguity (two classes open, or a one-off extra class): those need a
 * decision, and taps that arrive meanwhile buffer rather than being lost.
 *
 * Nothing here decides anything on its own. The class comes from
 * `attendance-match.ts`, the colour from `studentArrears`, the money from the
 * existing `takePayment` — this file is sequencing and presentation.
 */
export function AttendanceScreen({
  resolveScan,
  markCandidate,
  searchStudents,
  loadWorkingSet,
  syncMarks,
  loadPanel,
  takePayment,
  paymentSearch,
  voiceEnabled,
}: Props) {
  // ONE popup. The device screen is small and must not scroll, so nothing
  // accumulates: each outcome replaces the last.
  const [popup, setPopup] = useState<StreamCard | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState<{ studentId: number; name: string } | null>(null);

  const offline = useOfflineAttendance({ loadWorkingSet, syncMarks });
  setVoiceEnabled(voiceEnabled);

  // --- the serial queue ----------------------------------------------------
  // Refs, not state: the drain loop must see the live values, and a re-render
  // in the middle of a burst must not restart it.
  const queue = useRef<Tap[]>([]);
  const running = useRef(false);
  const blocked = useRef(false);
  const method = useRef<Method>("SEARCH");

  const push = useCallback((result: ScanResult) => {
    const card = { id: crypto.randomUUID(), result };

    // Sound first: staff run this counter by ear.
    const owing = "arrears" in result && (result.arrears.status === "amber" || result.arrears.status === "red");
    switch (result.status) {
      case "marked":
      case "queued":
        (owing ? playMarkedButOwes : playSuccess)();
        (owing ? VOICE.markedOwing : VOICE.marked)();
        break;
      case "already":
        playAlreadyMarked();
        VOICE.alreadyMarked();
        break;
      case "choose":
      case "confirm":
        playNeedsChoice();
        break;
      case "unknown":
        playReject();
        VOICE.unknownCard();
        break;
      case "no-class":
      case "outside":
        playReject();
        VOICE.noClass();
        break;
      default:
        playReject();
    }

    // Questions hold the line; results just replace whatever was showing.
    if (BLOCKS.has(result.status)) blocked.current = true;
    setPopup(card);
  }, []);

  /** One tap, online-first with the offline path as the fallback. */
  const process = useCallback(
    async (tap: Tap) => {
      const clientRef = crypto.randomUUID();
      try {
        if (!navigator.onLine) throw new Error("offline");
        const r = await resolveScan({ ...tap.input, method: tap.method, clientRef });
        offline.setReachable(true);
        return r;
      } catch {
        offline.setReachable(false);
        return offline.resolveOffline(tap.input, tap.method, clientRef);
      }
    },
    [resolveScan, offline],
  );

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      while (queue.current.length > 0 && !blocked.current) {
        const tap = queue.current.shift()!;
        push(await process(tap));
      }
      // A choice just opened: anything still queued behind it is dropped, not
      // banked, so nobody is marked without staff seeing their popup.
      if (blocked.current) queue.current.length = 0;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, [process, push]);

  /**
   * Every entry point lands here.
   *
   * While a choice is on screen the reader is OFF and a tap does NOTHING — it
   * is not queued for later. Staff are looking at a question; silently banking
   * taps behind it would mark students they never verified.
   */
  const tap = useCallback(
    (input: Tap["input"], m: Method) => {
      if (blocked.current) return;
      primeAudio();
      method.current = m;
      // The queue still exists, but only to keep a BURST in order — never to
      // hold taps across a choice.
      queue.current.push({ input, method: m });
      void drain();
    },
    [drain],
  );

  // Armed once, then continuous: a queue of students taps one after another
  // with no further button press.
  const nfc = useNfcScan((cardUid) => tap({ cardUid }, "NFC"), { continuous: true });

  const reader: ReaderState = !nfc.scanning ? "off" : popup && BLOCKS.has(popup.result.status) ? "waiting" : "on";

  /** Answering or dismissing a question releases the stream. */
  const release = useCallback(() => {
    blocked.current = false;
    setPopup(null);
    void drain();
  }, [drain]);

  const choose = useCallback(
    (student: StudentBrief, candidate: Candidate) => {
      setBusy(true);
      void (async () => {
        const clientRef = crypto.randomUUID();
        let result: ScanResult;
        try {
          if (!navigator.onLine) throw new Error("offline");
          result = await markCandidate({
            studentId: student.id,
            courseId: candidate.courseId,
            additionalClassId: candidate.additionalClassId,
            method: method.current,
            clientRef,
          });
          offline.setReachable(true);
        } catch {
          offline.setReachable(false);
          result = await offline.queueOffline(
            { ...student, photoUrl: student.photoUrl ?? null },
            candidate,
            method.current,
            clientRef,
            colomboNow().date,
            colomboNow().time,
            offline.cache?.arrears?.[student.id] ?? { status: "grey", label: "Unknown offline" },
          );
        }
        setBusy(false);
        // Never re-block on the question we just answered.
        blocked.current = false;
        setPopup({ id: crypto.randomUUID(), result });
        if (result.status === "marked" || result.status === "queued") {
          const owes = result.arrears.status === "amber" || result.arrears.status === "red";
          (owes ? playMarkedButOwes : playSuccess)();
          (owes ? VOICE.markedOwing : VOICE.marked)();
        }
        void drain();
      })();
    },
    [markCandidate, offline, drain],
  );

  /** Search falls back to the cached roster when the server can't answer. */
  const search = useCallback(
    async (query: string) => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const hits = await searchStudents(query);
        offline.setReachable(true);
        return hits;
      } catch {
        offline.setReachable(false);
        return offline.searchOffline(query);
      }
    },
    [searchStudents, offline],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ConnectionBar
        online={offline.connected}
        stale={offline.stale}
        cacheDate={offline.cache?.date ?? null}
        queued={offline.queued}
        syncing={offline.syncing}
        message={offline.lastSyncMessage}
        onSync={() => void offline.flush()}
      />

      {/* --- the reader: always live, never replaced by a result --- */}
      <div className="grid gap-3 sm:grid-cols-2">
        {nfc.support !== "unsupported" &&
          (nfc.scanning ? (
            <div
              className={`space-y-2 rounded-xl border-2 p-4 text-center sm:col-span-2 ${
                reader === "waiting" ? "border-amber-400 bg-amber-50" : "border-emerald-400 bg-emerald-50"
              }`}
            >
              {reader === "waiting" ? (
                <>
                  <Pause className="mx-auto size-6 text-amber-700" aria-hidden />
                  <p className="text-sm font-medium text-amber-900">
                    Reader OFF — answer the question first. Taps are ignored.
                  </p>
                </>
              ) : (
                <>
                  <Loader2 className="mx-auto size-6 animate-spin text-emerald-700" aria-hidden />
                  <p className="text-sm font-medium text-emerald-900">
                    Reader ON — tap cards one after another
                  </p>
                </>
              )}
              <Button variant="outline" size="sm" onClick={nfc.stop}>Stop reader</Button>
            </div>
          ) : (
            <Button
              onClick={() => { primeAudio(); void nfc.start(); }}
              className="h-16 gap-2 text-base sm:col-span-2"
              disabled={nfc.support === "unknown"}
            >
              <Nfc className="size-5" aria-hidden />
              Start reader (NFC)
            </Button>
          ))}

        <Button
          onClick={() => { primeAudio(); setQrOpen(true); }}
          variant={nfc.support === "unsupported" ? "default" : "secondary"}
          className="h-14 gap-2"
        >
          <QrCode className="size-5" aria-hidden />
          Scan QR
        </Button>

        <ReaderLamp state={reader} busy={busy} />
      </div>

      <div className="rounded-xl border p-3">
        <StudentSearch search={search} busy={false} onPick={(s) => tap({ studentId: s.id }, "SEARCH")} />
      </div>

      {/*
        One popup, replaced by the next tap. A pick-list is a question and holds
        the line; everything else is a result and does not.
      */}
      {popup &&
        (popup.result.status === "choose" || popup.result.status === "confirm" ? (
          <ChoiceCard
            result={popup.result}
            pending={busy}
            onChoose={(c) =>
              choose(
                (popup.result as Extract<ScanResult, { status: "choose" }>).student,
                c,
              )
            }
            onCancel={release}
          />
        ) : (
          <CounterCard
            key={popup.id}
            result={popup.result}
            canPay={offline.connected}
            onDismiss={popup.result.status === "unknown" ? release : undefined}
            onPay={(studentId, name) => {
              // The pay decision is a question too: it holds the line until the
              // till closes. Taps keep queueing behind it.
              blocked.current = true;
              setPaying({ studentId, name });
            }}
          />
        ))}

      <QrScanner open={qrOpen} onOpenChange={setQrOpen} onDecode={(v) => tap({ cardNumber: v }, "QR")} />

      {/*
        Pay without leaving the counter. This is the EXISTING payment screen —
        month picker, catch-up, combo prompt with the fraud check, receipt, and
        server-side recomputation of every amount — opened on a student the
        counter already identified. Keyed so each student gets a fresh instance.
      */}
      <Dialog
        open={paying !== null}
        onOpenChange={(o) => {
          if (o) return;
          setPaying(null);
          release();
        }}
      >
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="size-4" aria-hidden />
              Take payment — {paying?.name}
            </DialogTitle>
            <DialogDescription>
              Taps keep queuing behind this and are marked when it closes.
            </DialogDescription>
          </DialogHeader>
          {paying && (
            <PaymentScreen
              key={paying.studentId}
              embedded
              initialStudentId={paying.studentId}
              loadPanel={loadPanel}
              takePayment={takePayment}
              searchStudents={paymentSearch}
              onFinished={() => {
                playPaymentSuccess();
                VOICE.paymentComplete();
                setPaying(null);
                release();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Connection and sync state — it changes what a mark MEANS, so it stays visible. */
function ConnectionBar({
  online, stale, cacheDate, queued, syncing, message, onSync,
}: {
  online: boolean; stale: boolean; cacheDate: string | null;
  queued: number; syncing: boolean; message: string | null; onSync: () => void;
}) {
  if (online && queued === 0 && !stale && !message) return null;

  return (
    <div className="space-y-2">
      {!online && (
        <p className="border-primary/30 bg-primary/5 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <CloudOff className="size-4 shrink-0" aria-hidden />
          <span>
            Offline — attendance still works from this device&apos;s cached
            timetable. Payments and everything else need a connection.
          </span>
        </p>
      )}

      {stale && (
        <p role="alert" className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>Offline data is from {cacheDate}, not today. Reconnect to refresh before relying on it.</span>
        </p>
      )}

      {queued > 0 && (
        <div className="bg-secondary text-secondary-foreground flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <UploadCloud className="size-4 shrink-0" aria-hidden />
            {queued} mark{queued === 1 ? "" : "s"} waiting to sync
          </span>
          <Button size="sm" variant="outline" onClick={onSync} disabled={syncing || !online}>
            {syncing ? (<><RefreshCw className="size-3.5 animate-spin" aria-hidden />Syncing…</>) : "Sync now"}
          </Button>
        </div>
      )}

      {message && queued === 0 && <p className="text-muted-foreground text-sm">{message}</p>}
    </div>
  );
}

/** The reader's state, always visible — it decides whether a tap does anything. */
function ReaderLamp({ state, busy }: { state: ReaderState; busy: boolean }) {
  const look =
    state === "on"
      ? { dot: "bg-emerald-500", text: "text-emerald-900", box: "border-emerald-300 bg-emerald-50", label: "Reader ON" }
      : state === "waiting"
        ? { dot: "bg-amber-500", text: "text-amber-900", box: "border-amber-300 bg-amber-50", label: "Reader OFF — taps ignored" }
        : { dot: "bg-muted-foreground", text: "text-muted-foreground", box: "border-border bg-card", label: "Reader off" };

  return (
    <div className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 ${look.box}`}>
      <span className={`size-2.5 rounded-full ${look.dot} ${state === "on" ? "animate-pulse" : ""}`} />
      <p className={`text-xs font-medium ${look.text}`}>
        {look.label}
        {busy && state === "on" ? " · reading…" : ""}
      </p>
    </div>
  );
}
