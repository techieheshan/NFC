"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  CloudOff,
  Nfc,
  QrCode,
  RefreshCw,
  Search,
  UploadCloud,
} from "lucide-react";

import { PaymentScreen } from "@/app/(app)/payment/payment-screen";
import type {
  ChargeResult,
  ComboDecision,
  PanelResult,
} from "@/app/(app)/payment/actions";
import { QrScanner } from "@/components/scan/qr-scanner";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AttenderHit,
  ClassAttendance,
  Method,
  QueuedMark,
  ScanResult,
  SyncOutcome,
  WorkingSet,
} from "./actions";
import { ChoiceCard } from "./counter-card";
import {
  OfflineBlockedPanel,
  PendingPanel,
  ResultPanel,
  UnknownCardPanel,
} from "./result-panel";
import { SearchScreen } from "./search-screen";
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

/**
 * Who a tap is about, when we already know before the server answers. A search
 * pick does; a card tap does not (the card has to be looked up first).
 */
type Preview = Pick<AttenderHit, "name" | "photoUrl" | "cardNumber" | "school">;

type Tap = {
  input: { cardUid?: string; cardNumber?: string; studentId?: number };
  method: Method;
  who?: Preview;
};

type StreamCard = { id: string; result: ScanResult };

/** How long a RESULT stays up before the screen goes back to the buttons. */
const RESULT_MS = 5000;

/**
 * Which outcomes are QUESTIONS rather than results.
 *
 * A result reports something that already happened, so it clears itself and the
 * next tap simply replaces it. A question — WHICH class? is the till open? —
 * has no answer yet, so the reader holds until staff give one, and taps that
 * arrive meanwhile are IGNORED, never queued: banking taps behind a question
 * would mark students nobody verified.
 *
 * An unrecognised card used to be in here. It is not any more: it writes
 * nothing, there is nothing to answer, and one stranger's card was stopping the
 * whole queue. It gets the reject tone and five red seconds instead.
 */
const BLOCKS = new Set<ScanResult["status"]>(["choose", "confirm"]);

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
  searchAttender: (query: string) => Promise<AttenderHit[]>;
  loadClassAttendance: (input: { studentId: number; courseId: number }) => Promise<ClassAttendance>;
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
 * The attender's screen.
 *
 * Three buttons and one panel. The reader arms itself on arrival and stays on —
 * no toggle, no "Reader ON" line, nothing to press per student — and the rings
 * around the NFC button are the whole "it is listening" signal. Every tap joins
 * a SERIAL queue, so a burst processes in order with none dropped and none
 * raced, and each outcome REPLACES the last: one panel, no trail, no scrolling
 * terminal.
 *
 * Nothing here decides anything. The class comes from `attendance-match.ts`,
 * the arrears colour from `studentArrears`, every amount from `takePayment` —
 * this file is sequencing and presentation.
 */
export function AttendanceScreen({
  resolveScan,
  markCandidate,
  undoMark,
  searchAttender,
  loadClassAttendance,
  loadWorkingSet,
  syncMarks,
  loadPanel,
  takePayment,
  paymentSearch,
  voiceEnabled,
}: Props) {
  const [popup, setPopup] = useState<StreamCard | null>(null);
  const [view, setView] = useState<"reader" | "search">("reader");
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * The tap the server is answering RIGHT NOW. On a slow connection that can
   * take seconds, and a screen that does not change in that time reads as "the
   * tap did nothing" — so staff tap again, or walk away. It is shown at once,
   * with the student's face and name when a search pick already gave us them.
   */
  const [pending, setPending] = useState<{ id: string; who: Preview | null } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
    const owing =
      "arrears" in result &&
      (result.arrears.status === "red" || result.arrears.status === "darkred");
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
    setNotice(null);
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
        setPending({ id: crypto.randomUUID(), who: tap.who ?? null });
        const result = await process(tap);
        setPending(null);
        push(result);
      }
      // A question just opened: anything still queued behind it is dropped, not
      // banked, so nobody is marked without staff seeing their panel.
      if (blocked.current) queue.current.length = 0;
    } finally {
      running.current = false;
      setPending(null);
      setBusy(false);
    }
  }, [process, push]);

  /**
   * Every entry point lands here.
   *
   * While a question is on screen the reader is OFF and a tap does NOTHING — it
   * is not queued for later.
   */
  const tap = useCallback(
    (input: Tap["input"], m: Method, who?: Preview) => {
      if (blocked.current) return;
      method.current = m;
      queue.current.push({ input, method: m, who });
      void drain();
    },
    [drain],
  );

  // Armed on arrival and continuous: students tap one after another with no
  // button press, ever.
  const nfc = useNfcScan((cardUid) => tap({ cardUid }, "NFC"), {
    continuous: true,
    autoStart: true,
  });

  /**
   * Re-arm, without re-arming on every render.
   *
   * `start` is a fresh function each render, so it is reached through a ref —
   * putting it in a dependency list would restart the reader mid-queue.
   */
  const startRef = useRef(nfc.start);
  const stopRef = useRef(nfc.stop);
  const scanningRef = useRef(nfc.scanning);
  // No dependency list: this runs after every render, and it is declared FIRST
  // so the effects below always read the current values.
  useEffect(() => {
    startRef.current = nfc.start;
    stopRef.current = nfc.stop;
    scanningRef.current = nfc.scanning;
  });

  /**
   * Arming, exactly once at a time.
   *
   * Two overlapping `scan()` calls means two `onreading` handlers, so every
   * card gets processed TWICE — a mark and then an "already marked" for the
   * same tap. The hook arms itself on arrival; everything here re-arms only on
   * a real transition, and never while a scan is already up or in flight.
   */
  const arming = useRef(false);
  const rearm = useCallback(async () => {
    if (arming.current || scanningRef.current) return;
    arming.current = true;
    try {
      await startRef.current();
    } finally {
      arming.current = false;
    }
  }, []);

  /**
   * Android backgrounds the tab when the screen locks or staff look at
   * something else, and the scan dies with it. Returning is not a user gesture
   * we can rely on, so the reader is re-armed on the way back — but only after
   * a real hide, never on the stray focus event a page gets while loading.
   */
  useEffect(() => {
    if (nfc.support !== "supported") return;

    let wasHidden = false;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      void rearm();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [nfc.support, rearm]);

  /**
   * The reader is paused while the search screen is up — staff are typing, not
   * tapping — and armed again on the way back. It must not arm on the first
   * run: the hook already did that, and arming again is the double-reader bug.
   */
  const lastView = useRef(view);
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    if (nfc.support !== "supported") return;
    if (view === "search") stopRef.current();
    else void rearm();
  }, [view, nfc.support, rearm]);

  /**
   * Unlock the audio context on the first touch ANYWHERE on the page.
   *
   * A card `reading` event is not a user gesture, so a context created from one
   * starts `suspended` and every tone is silently dropped. The listener is on
   * the document rather than this screen's box, because the first thing staff
   * touch is often the menu or the header.
   */
  useEffect(() => {
    const prime = () => primeAudio();
    document.addEventListener("pointerdown", prime, { passive: true });
    document.addEventListener("touchstart", prime, { passive: true });
    document.addEventListener("keydown", prime);
    return () => {
      document.removeEventListener("pointerdown", prime);
      document.removeEventListener("touchstart", prime);
      document.removeEventListener("keydown", prime);
    };
  }, []);

  /**
   * A result clears itself after five seconds. A question does not: it has no
   * answer yet. The timer is keyed on the panel's id, so the next tap replaces
   * the panel AND restarts the clock.
   */
  const isQuestion = popup !== null && BLOCKS.has(popup.result.status);
  useEffect(() => {
    if (popup === null || isQuestion) return;
    const timer = setTimeout(() => setPopup(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [popup, isQuestion]);

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
          const owes = result.arrears.status === "red" || result.arrears.status === "darkred";
          (owes ? playMarkedButOwes : playSuccess)();
          (owes ? VOICE.markedOwing : VOICE.marked)();
        }
        void drain();
      })();
    },
    [markCandidate, offline, drain],
  );

  /** Undo, while the mark is still on screen. Never reaches past today. */
  const undo = useCallback(
    (attendanceId: number) => {
      setUndoing(true);
      void undoMark(attendanceId)
        .then((r) => {
          setPopup(null);
          setNotice(r.ok ? "Mark removed." : (r.error ?? "Couldn't undo that."));
        })
        .catch(() => setNotice("Couldn't undo that — check the connection."))
        .finally(() => setUndoing(false));
    },
    [undoMark],
  );

  /** Search falls back to the cached roster when the server can't answer. */
  const search = useCallback(
    async (query: string): Promise<AttenderHit[]> => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const hits = await searchAttender(query);
        offline.setReachable(true);
        return hits;
      } catch {
        offline.setReachable(false);
        // Offline the cached roster has no payment verdict to give: say so
        // rather than guess a colour.
        const rows = await offline.searchOffline(query);
        return rows.map((r) => ({
          ...r,
          arrears: offline.cache?.arrears?.[r.id] ?? { status: "grey", label: "Unknown offline" },
          classes: [],
        }));
      }
    },
    [searchAttender, offline],
  );

  /**
   * A STABLE handle on the search.
   *
   * `search` closes over the offline hook, whose object is new on every render,
   * so passing it straight down would change identity constantly — and the
   * search screen debounces on it, so every parent render would restart the
   * 250ms timer and a steady typist could out-run the query forever.
   */
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  const searchStable = useCallback((query: string) => searchRef.current(query), []);

  const pick = useCallback(
    (hit: AttenderHit) => {
      setView("reader");
      tap({ studentId: hit.id }, "SEARCH", {
        name: hit.name,
        photoUrl: hit.photoUrl,
        cardNumber: hit.cardNumber,
        school: hit.school,
      });
    },
    [tap],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ConnectionBar
        online={offline.connected}
        stale={offline.stale}
        cacheDate={offline.cache?.date ?? null}
        queued={offline.queued}
        syncing={offline.syncing}
        message={offline.lastSyncMessage}
        onSync={() => void offline.flush()}
      />

      {view === "search" ? (
        <SearchScreen search={searchStable} onPick={pick} onBack={() => setView("reader")} />
      ) : (
        <>
          {/*
            ONE thing on screen at a time: the buttons, a result panel, or a
            question. A result takes the buttons' place because the reader is
            still listening behind it; a question takes their place because the
            reader is OFF until it is answered, and showing a "listening"
            button then would be a lie. Either way the terminal never scrolls
            and staff's eyes never move.
          */}
          {pending && !isQuestion ? (
            <PendingPanel key={pending.id} who={pending.who} />
          ) : popup === null ? (
            <Buttons
              support={nfc.support}
              scanning={nfc.scanning}
              working={busy}
              failed={nfc.error !== null}
              onRetryNfc={() => {
                primeAudio();
                void nfc.start();
              }}
              onQr={() => {
                primeAudio();
                setQrOpen(true);
              }}
              onSearch={() => {
                primeAudio();
                setView("search");
              }}
            />
          ) : isQuestion ? null : (
            <Panel
              popup={popup}
              canPay={offline.connected}
              onPay={(studentId, name) => {
                // The till is a question: it holds the line until it closes.
                blocked.current = true;
                setPaying({ studentId, name });
              }}
              onClose={() => setPopup(null)}
              onUndo={undo}
              undoing={undoing}
              loadClassAttendance={loadClassAttendance}
            />
          )}

          {notice && <p className="text-muted-foreground text-center text-sm">{notice}</p>}

          {/*
            A pick-list is a question with its own buttons, so it renders as its
            own card rather than inside the panel area.
          */}
          {popup && isQuestion && (
            <ChoiceCard
              result={popup.result as Extract<ScanResult, { status: "choose" | "confirm" }>}
              pending={busy}
              onChoose={(c) =>
                choose((popup.result as Extract<ScanResult, { status: "choose" }>).student, c)
              }
              onCancel={release}
            />
          )}

          {/* Desktop only: there is no card reader on a laptop. */}
          <ManualEntry onSubmit={(value) => tap({ cardNumber: value }, "SEARCH")} />
        </>
      )}

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
              Taps are ignored until this closes.
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
              // The tone and the spoken confirmation both fire from
              // `onCharged`, i.e. when the money is recorded. `onFinished`
              // only runs once the print dialog is dismissed, which is far too
              // late to be feedback for the person at the counter.
              onCharged={playPaymentSuccess}
              onFinished={() => {
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

/** One panel, whatever the outcome. */
function Panel({
  popup,
  canPay,
  onPay,
  onClose,
  onUndo,
  undoing,
  loadClassAttendance,
}: {
  popup: StreamCard;
  canPay: boolean;
  onPay: (studentId: number, name: string) => void;
  onClose: () => void;
  onUndo: (attendanceId: number) => void;
  undoing: boolean;
  loadClassAttendance: (input: { studentId: number; courseId: number }) => Promise<ClassAttendance>;
}) {
  const r = popup.result;

  if (r.status === "unknown") return <UnknownCardPanel key={popup.id} durationMs={RESULT_MS} />;
  if (r.status === "offline-blocked")
    return <OfflineBlockedPanel key={popup.id} message={r.message} durationMs={RESULT_MS} />;
  if (r.status === "choose" || r.status === "confirm") return null;

  return (
    <ResultPanel
      key={popup.id}
      result={r}
      canPay={canPay}
      durationMs={RESULT_MS}
      onPay={onPay}
      onClose={onClose}
      onUndo={onUndo}
      undoing={undoing}
      loadClassAttendance={loadClassAttendance}
    />
  );
}

/**
 * A. The three ways in — icon only, thumb sized, in one column.
 *
 * NFC is solid purple and always listening; QR and Search are light purple
 * because they are the exceptions. There is no reader toggle and no status
 * line: the rings say "listening", and their absence says "it is not".
 */
function Buttons({
  support,
  scanning,
  working,
  failed,
  onRetryNfc,
  onQr,
  onSearch,
}: {
  support: "unknown" | "supported" | "unsupported";
  scanning: boolean;
  /** A tap has been read and the server has not answered yet. */
  working: boolean;
  failed: boolean;
  onRetryNfc: () => void;
  onQr: () => void;
  onSearch: () => void;
}) {
  const live = scanning && support === "supported";
  /**
   * Arming takes a moment, and on the very first visit it needs a tap to get
   * the permission prompt. "Starting…" covers the former; the hint only says
   * "tap" once the attempt has actually failed, so staff are never told to
   * press something that is about to work by itself.
   */
  const hint =
    support === "unsupported"
      ? "No NFC here"
      : failed
        ? "NFC off — tap"
        : "Starting…";

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onRetryNfc}
        aria-label={live ? "Reader listening for cards" : "Turn the card reader on"}
        className={`relative isolate flex h-28 w-full items-center justify-center overflow-hidden rounded-2xl transition-colors ${
          live
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground border-2 border-dashed"
        }`}
      >
        {live && (
          <span className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 grid place-items-center">
            <span className="xenon-ring absolute size-16 rounded-full bg-white/35" aria-hidden />
            <span className="xenon-ring xenon-ring-2 absolute size-16 rounded-full bg-white/35" aria-hidden />
          </span>
        )}
        <Nfc className="relative size-14" aria-hidden />
        {/*
          A card that has been read but not yet answered. Without this the
          screen is identical to "nothing happened", and staff tap again — which
          is exactly what a slow answer must not provoke.
        */}
        {live && working && (
          <span className="absolute bottom-2 text-xs font-medium">Reading…</span>
        )}
        {/* Two or three words, only when there is nothing to listen with. */}
        {!live && (
          <span className="absolute bottom-2 text-xs font-medium">{hint}</span>
        )}
      </button>

      {/* Stacked, full width: one column of targets a thumb cannot miss. */}
      <button
        type="button"
        onClick={onQr}
        aria-label="Scan a QR code"
        className="bg-primary/10 text-primary hover:bg-primary/15 flex h-24 w-full items-center justify-center rounded-2xl transition-colors"
      >
        <QrCode className="size-11" aria-hidden />
      </button>
      <button
        type="button"
        onClick={onSearch}
        aria-label="Find a student by name or card number"
        className="bg-primary/10 text-primary hover:bg-primary/15 flex h-24 w-full items-center justify-center rounded-2xl transition-colors"
      >
        <Search className="size-11" aria-hidden />
      </button>
    </div>
  );
}

/**
 * The desktop fallback.
 *
 * Hidden on the terminals, which have a reader and a camera. On a laptop there
 * is no other way to put a card number in.
 */
function ManualEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <form
      className="hidden gap-2 sm:flex"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v === "") return;
        setValue("");
        onSubmit(v);
      }}
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Card number (desktop fallback)"
        autoComplete="off"
        aria-label="Card number"
      />
      <Button type="submit" variant="outline">
        Mark
      </Button>
    </form>
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
    <div className="space-y-2 print:hidden">
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
