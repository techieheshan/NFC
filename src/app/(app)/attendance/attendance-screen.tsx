"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Nfc,
  QrCode,
  Undo2,
  UserRound,
  XCircle,
} from "lucide-react";

import { QrScanner } from "@/components/scan/qr-scanner";
import { useNfcScan } from "@/components/scan/use-nfc-scan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";

import type { Candidate, Method, ScanResult, StudentBrief } from "./actions";
import { playAlreadyMarked, playReject, playSuccess, primeAudio } from "./sounds";
import { StudentSearch } from "./student-search";

type RecentMark = {
  attendanceId: number;
  student: string;
  course: string;
  at: string;
};

type Props = {
  resolveScan: (input: {
    cardUid?: string;
    cardNumber?: string;
    studentId?: number;
    method: Method;
    clientRef: string;
  }) => Promise<ScanResult>;
  markCandidate: (input: {
    studentId: number;
    courseId: number;
    additionalClassId: number | null;
    method: Method;
    clientRef: string;
  }) => Promise<ScanResult>;
  undoMark: (attendanceId: number) => Promise<{ ok: boolean; error?: string }>;
  searchStudents: (query: string) => Promise<StudentBrief[]>;
};

/**
 * The whole screen is one result at a time: identify → matcher → outcome.
 *
 * Marks are written by the server actions; this only decides which cue to play
 * and what to show. `clientRef` is generated here even though we're online —
 * Tag B's outbox dedupes on it, so the shape must already be right.
 */
export function AttendanceScreen({
  resolveScan,
  markCandidate,
  undoMark,
  searchStudents,
}: Props) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [recent, setRecent] = useState<RecentMark[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The method that produced the current result, so a confirm/pick keeps it.
  const methodRef = useRef<Method>("SEARCH");

  const announce = useCallback((r: ScanResult) => {
    setResult(r);
    setUndoError(null);
    if (r.status === "marked") {
      playSuccess();
      setRecent((prev) =>
        [
          {
            attendanceId: r.mark.attendanceId,
            student: r.student.name,
            course: r.mark.candidate.course,
            at: r.mark.at,
          },
          ...prev,
        ].slice(0, 10),
      );
    } else if (r.status === "already") {
      playAlreadyMarked();
    } else if (r.status === "unknown" || r.status === "no-class" || r.status === "outside") {
      playReject();
    }
    // "confirm" and "choose" are silent — they're questions, not outcomes.
  }, []);

  const scan = useCallback(
    (input: { cardUid?: string; cardNumber?: string; studentId?: number }, method: Method) => {
      primeAudio();
      methodRef.current = method;
      startTransition(async () => {
        announce(await resolveScan({ ...input, method, clientRef: crypto.randomUUID() }));
      });
    },
    [announce, resolveScan],
  );

  const choose = useCallback(
    (student: StudentBrief, candidate: Candidate) => {
      startTransition(async () => {
        announce(
          await markCandidate({
            studentId: student.id,
            courseId: candidate.courseId,
            additionalClassId: candidate.additionalClassId,
            method: methodRef.current,
            clientRef: crypto.randomUUID(),
          }),
        );
      });
    },
    [announce, markCandidate],
  );

  const nfc = useNfcScan((cardUid) => scan({ cardUid }, "NFC"));

  const undoLast = useCallback(() => {
    const last = recent[0];
    if (!last) return;
    startTransition(async () => {
      const res = await undoMark(last.attendanceId);
      if (res.ok) {
        setRecent((prev) => prev.slice(1));
        setResult(null);
      } else {
        setUndoError(res.error ?? "Couldn't undo that mark.");
      }
    });
  }, [recent, undoMark]);

  const reset = useCallback(() => {
    setResult(null);
    setUndoError(null);
  }, []);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Tap a card, scan its QR, or search. The class open right now is marked
          automatically.
        </p>
      </div>

      {result ? (
        <ResultPanel
          result={result}
          pending={pending}
          canUndo={recent.length > 0}
          undoError={undoError}
          onUndo={undoLast}
          onChoose={choose}
          onDone={reset}
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {nfc.support !== "unsupported" &&
              (nfc.scanning ? (
                <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
                  <Loader2 className="text-primary mx-auto size-6 animate-spin" aria-hidden />
                  <p className="text-sm font-medium">Hold the card against the phone…</p>
                  <Button variant="outline" size="sm" onClick={nfc.stop}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => {
                    primeAudio();
                    void nfc.start();
                  }}
                  className="h-16 w-full gap-2 text-base"
                  disabled={pending || nfc.support === "unknown"}
                >
                  <Nfc className="size-5" aria-hidden />
                  Tap card (NFC)
                </Button>
              ))}

            <Button
              onClick={() => {
                primeAudio();
                setQrOpen(true);
              }}
              variant={nfc.support === "unsupported" ? "default" : "secondary"}
              className="h-16 w-full gap-2 text-base"
              disabled={pending}
            >
              <QrCode className="size-5" aria-hidden />
              Scan QR code
            </Button>
          </div>

          {nfc.support === "unsupported" && (
            <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
              This browser can&apos;t read NFC. Use the QR scan or search below.
            </p>
          )}

          {nfc.error && (
            <p role="alert" className="text-destructive text-sm">
              {nfc.error}
            </p>
          )}

          <div className="rounded-xl border p-4">
            <StudentSearch
              search={searchStudents}
              busy={pending}
              onPick={(s) => scan({ studentId: s.id }, "SEARCH")}
            />
          </div>

          {pending && (
            <p className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Checking the timetable…
            </p>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="rounded-xl border p-4">
          <p className="mb-2 text-sm font-medium">Recent marks</p>
          <ul className="divide-y text-sm">
            {recent.map((m) => (
              <li key={m.attendanceId} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.student}</span>
                  <span className="text-muted-foreground block truncate text-xs">{m.course}</span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {to12Hour(m.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <QrScanner
        open={qrOpen}
        onOpenChange={setQrOpen}
        onDecode={(value) => scan({ cardNumber: value }, "QR")}
      />
    </div>
  );
}

function StudentHeader({ student }: { student: StudentBrief }) {
  return (
    <div className="flex items-center gap-4">
      <span className="bg-muted size-20 shrink-0 overflow-hidden rounded-xl border">
        {student.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={student.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-muted-foreground grid size-full place-items-center">
            <UserRound className="size-8" aria-hidden />
          </span>
        )}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xl font-semibold">{student.name}</p>
        <p className="text-muted-foreground truncate text-sm">
          {student.cardNumber ?? "no card number"}
        </p>
      </div>
    </div>
  );
}

function CandidateLine({ c }: { c: Candidate }) {
  return (
    <span className="min-w-0 text-left">
      <span className="block truncate font-medium">{c.course}</span>
      <span className="text-muted-foreground block truncate text-xs">
        {c.teacher} · {to12Hour(c.startTime)}–{to12Hour(c.endTime)}
      </span>
    </span>
  );
}

function ResultPanel({
  result,
  pending,
  canUndo,
  undoError,
  onUndo,
  onChoose,
  onDone,
}: {
  result: ScanResult;
  pending: boolean;
  canUndo: boolean;
  undoError: string | null;
  onUndo: () => void;
  onChoose: (student: StudentBrief, candidate: Candidate) => void;
  onDone: () => void;
}) {
  const Next = (
    <Button onClick={onDone} className="w-full" variant="outline" disabled={pending}>
      Next student
    </Button>
  );

  if (result.status === "unknown") {
    return (
      <Banner tone="error" icon={XCircle} title="Card not recognised">
        <p className="text-sm">Register this card first, or search by name.</p>
        {Next}
      </Banner>
    );
  }

  if (result.status === "no-class") {
    return (
      <Banner tone="error" icon={XCircle} title="No class open right now">
        <StudentHeader student={result.student} />
        {Next}
      </Banner>
    );
  }

  if (result.status === "outside") {
    return (
      <Banner tone="warn" icon={Clock} title="Not open yet / already closed">
        <StudentHeader student={result.student} />
        <p className="text-sm font-medium">{result.message}</p>
        {Next}
      </Banner>
    );
  }

  if (result.status === "already") {
    return (
      <Banner
        tone="warn"
        icon={AlertTriangle}
        title={`Already marked at ${to12Hour(result.at)}`}
      >
        <StudentHeader student={result.student} />
        <p className="text-muted-foreground text-sm">{result.candidate.course}</p>
        {Next}
      </Banner>
    );
  }

  if (result.status === "marked") {
    return (
      <Banner tone="success" icon={CheckCircle2} title="Marked present">
        <StudentHeader student={result.student} />
        <div className="bg-background/60 rounded-lg border p-3">
          <CandidateLine c={result.mark.candidate} />
          <p className="mt-1 text-sm font-medium tabular-nums">
            {to12Hour(result.mark.at)}
          </p>
        </div>
        {undoError && (
          <p role="alert" className="text-destructive text-sm">
            {undoError}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 gap-1.5"
            onClick={onUndo}
            disabled={pending || !canUndo}
          >
            <Undo2 className="size-4" aria-hidden />
            Undo
          </Button>
          <Button onClick={onDone} className="flex-1" disabled={pending}>
            Next student
          </Button>
        </div>
      </Banner>
    );
  }

  if (result.status === "confirm") {
    return (
      <Banner tone="warn" icon={AlertTriangle} title="Additional class">
        <StudentHeader student={result.student} />
        <div className="bg-background/60 rounded-lg border p-3">
          <CandidateLine c={result.candidate} />
        </div>
        <p className="text-sm">
          Mark <span className="font-medium">{result.student.name}</span> present
          for this one-off class?
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onDone} disabled={pending}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={pending}
            onClick={() => onChoose(result.student, result.candidate)}
          >
            {pending ? "Marking…" : "Mark present"}
          </Button>
        </div>
      </Banner>
    );
  }

  return (
    <Banner tone="warn" icon={Clock} title="Which class?">
      <StudentHeader student={result.student} />
      <ul className="space-y-2">
        {result.candidates.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              disabled={pending || Boolean(c.markedAt)}
              onClick={() => onChoose(result.student, c)}
              className="hover:bg-accent bg-background/60 flex w-full items-center justify-between gap-3 rounded-lg border p-3 transition-colors disabled:opacity-60"
            >
              <CandidateLine c={c} />
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={c.kind === "additional" ? "default" : "secondary"}>
                  {c.kind === "additional" ? "Additional" : "Regular"}
                </Badge>
                {c.markedAt && <Badge variant="outline">Marked</Badge>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {Next}
    </Banner>
  );
}

const TONES = {
  success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  error: "border-destructive/40 bg-destructive/5 text-destructive",
} as const;

function Banner({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  icon: typeof CheckCircle2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-4 rounded-xl border p-5 ${TONES[tone]}`} role="status">
      <p className="flex items-center gap-2 text-lg font-semibold">
        <Icon className="size-6 shrink-0" aria-hidden />
        {title}
      </p>
      {children}
    </div>
  );
}
