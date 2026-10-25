"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  CreditCard,
  Info,
  Undo2,
  UserRound,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";
import type { ArrearsBadge, Candidate } from "@/lib/attendance-match";

import type { ClassAttendance, ScanResult } from "./actions";

/**
 * What one tap shows.
 *
 * ONE panel, in one place, replaced by the next tap — never a list, never a
 * trail, and it must not make the terminal scroll. It takes the place of the
 * three big buttons while it is up; the reader strip at its top keeps saying
 * "listening", so staff can see the reader is still live without looking
 * anywhere else.
 *
 * Nothing here decides anything. The class comes from `attendance-match.ts`,
 * the payment verdict from `studentArrears` (passed through untouched as
 * `arrears`), the money from `takePayment`. This file is presentation.
 */

/* --------------------------------------------------------------------------
   C. The payment chip — one chip, three states, from the existing verdict.

   `studentArrears` already answers "owed up to and including this billing
   month?" and returns green / red / darkred / grey. That verdict is reused
   verbatim: no second rule, no recount here. Each state carries an ICON and a
   WORD as well as the colour, so it is never colour alone.
   -------------------------------------------------------------------------- */
const PAYMENT: Record<
  ArrearsBadge["status"],
  { chip: string; word: string; icon: typeof CheckCircle2 }
> = {
  green: { chip: "bg-emerald-600 text-white", word: "Paid", icon: CheckCircle2 },
  red: { chip: "bg-orange-500 text-white", word: "Not paid", icon: CreditCard },
  darkred: { chip: "bg-red-900 text-white", word: "Overdue", icon: AlertTriangle },
  grey: { chip: "bg-neutral-500 text-white", word: "Free tier", icon: CheckCircle2 },
};

export function PaymentChip({
  arrears,
  size = "md",
}: {
  arrears: ArrearsBadge;
  size?: "md" | "sm";
}) {
  const p = PAYMENT[arrears.status];
  const owes = arrears.status === "red" || arrears.status === "darkred";
  const Icon = p.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md font-bold tracking-wide ${p.chip} ${
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs"
      }`}
    >
      <Icon className={size === "sm" ? "size-3" : "size-3.5"} aria-hidden />
      {p.word}
      {owes ? ` · ${arrears.label}` : ""}
    </span>
  );
}

export function StudentFace({
  photoUrl,
  name,
  cardNumber,
  size = "md",
}: {
  photoUrl: string | null;
  name: string;
  cardNumber: string | null;
  size?: "md" | "lg" | "verify";
}) {
  // "verify" is the size a mark uses. The system cannot detect a sibling
  // tapping their brother's card — only a person looking at the face can — so
  // on the panel that reports a mark the photo is the biggest thing in the box.
  const box = size === "verify" ? "size-20" : size === "lg" ? "size-16" : "size-12";
  return (
    <span className={`bg-muted ${box} shrink-0 overflow-hidden rounded-xl border`}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        /* Photos are never cached offline, so this fallback is the normal
           offline appearance, not an error state. */
        <span className="text-muted-foreground grid size-full place-items-center text-center leading-none">
          <span className="max-w-full">
            <UserRound className={`mx-auto ${size === "verify" ? "size-7" : "size-5"}`} aria-hidden />
            {/*
              The last 4 digits, not the full "0186-0009-0009" — a 14-character
              number has nowhere to go in a ~48px circle but onto three cramped
              lines. `whitespace-nowrap` + `truncate` is the backstop; the real
              fix is showing less, which also matches how staff already read a
              card number elsewhere (the last few digits are the only part that
              changes).
            */}
            <span className="mt-0.5 block max-w-full truncate px-0.5 text-[9px] whitespace-nowrap">
              {cardNumber ? cardNumber.slice(-4) : name.slice(0, 8)}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

type Outcome = {
  icon: typeof CheckCircle2;
  title: string;
  tone: string;
  tint: string;
};

function outcomeOf(result: ScanResult): Outcome {
  switch (result.status) {
    case "marked":
      return { icon: CheckCircle2, title: "Marked present", tone: "text-emerald-900", tint: "border-emerald-400 bg-emerald-50" };
    case "queued":
      return { icon: CloudOff, title: "Marked — queued", tone: "text-emerald-900", tint: "border-emerald-400 bg-emerald-50" };
    case "already":
      return { icon: AlertTriangle, title: "Already marked", tone: "text-amber-900", tint: "border-amber-400 bg-amber-50" };
    case "outside":
      return { icon: Clock, title: "Not open yet / already closed", tone: "text-amber-900", tint: "border-amber-400 bg-amber-50" };
    case "no-class":
      return { icon: XCircle, title: "No class open right now", tone: "text-red-900", tint: "border-red-300 bg-red-50" };
    default:
      return { icon: XCircle, title: "Can't mark this", tone: "text-red-900", tint: "border-red-300 bg-red-50" };
  }
}

/**
 * D. An unrecognised card.
 *
 * Short, red-tinted, no button: it auto-hides like any other result and the
 * reader keeps running, so one stranger's card does not stop the queue. The
 * reject tone is what makes staff look up — see `playReject`.
 */
export function UnknownCardPanel({ durationMs }: { durationMs: number }) {
  return (
    <div
      data-counter-popup
      className="space-y-2 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-left print:hidden"
    >
      <p className="flex items-center gap-2 font-semibold text-red-900">
        <XCircle className="size-6 shrink-0" aria-hidden />
        Card not registered
      </p>
      <p className="text-sm text-red-900/80">Register it, or use Search.</p>
      <Countdown durationMs={durationMs} />
    </div>
  );
}

export function OfflineBlockedPanel({
  message,
  durationMs,
}: {
  message: string;
  durationMs: number;
}) {
  return (
    <div
      data-counter-popup
      className="space-y-2 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-left print:hidden"
    >
      <p className="flex items-center gap-2 font-semibold text-red-900">
        <CloudOff className="size-6 shrink-0" aria-hidden />
        Can&apos;t mark offline yet
      </p>
      <p className="text-sm text-red-900/80">{message}</p>
      <Countdown durationMs={durationMs} />
    </div>
  );
}

/** A thin bar, not a number: it says "this is about to go" without being read. */
function Countdown({ durationMs }: { durationMs: number }) {
  return (
    <div className="bg-foreground/10 h-1 overflow-hidden rounded-full" aria-hidden>
      <div
        className="xenon-countdown bg-foreground/30 h-full w-full origin-left"
        style={{ animationDuration: `${durationMs}ms` }}
      />
    </div>
  );
}

export type ResultPanelProps = {
  /** A student result: marked, queued, already, no-class or outside. */
  result: Extract<
    ScanResult,
    { status: "marked" | "queued" | "already" | "no-class" | "outside" }
  >;
  canPay: boolean;
  durationMs: number;
  onPay: (studentId: number, name: string) => void;
  onClose: () => void;
  /** Only offered for a mark made moments ago, and only while it is showing. */
  onUndo?: (attendanceId: number) => void;
  undoing?: boolean;
  loadClassAttendance: (input: {
    studentId: number;
    courseId: number;
  }) => Promise<ClassAttendance>;
};

export function ResultPanel({
  result,
  canPay,
  durationMs,
  onPay,
  onClose,
  onUndo,
  undoing,
  loadClassAttendance,
}: ResultPanelProps) {
  const { student, arrears } = result;
  const owes = arrears.status === "red" || arrears.status === "darkred";
  const o = outcomeOf(result);

  const candidate: Candidate | null =
    result.status === "marked"
      ? result.mark.candidate
      : result.status === "queued" || result.status === "already"
        ? result.candidate
        : null;

  const at =
    result.status === "marked"
      ? result.mark.at
      : result.status === "queued" || result.status === "already"
        ? result.at
        : null;

  const attendanceId = result.status === "marked" ? result.mark.attendanceId : null;

  return (
    <div
      data-counter-popup
      className={`space-y-3 rounded-xl border-2 p-3 text-left print:hidden ${o.tint}`}
    >
      <div className={`flex items-center justify-between gap-2 ${o.tone}`}>
        <p className="flex items-center gap-2 leading-tight font-semibold">
          <o.icon className="size-5 shrink-0" aria-hidden />
          {o.title}
        </p>
        {at && <span className="shrink-0 text-sm font-medium tabular-nums">{to12Hour(at)}</span>}
      </div>

      {/* Who this is. The photo is the biggest thing here on purpose: no system
          can tell a sibling tapping their brother's card — only a face can. */}
      <div className="flex items-start gap-3">
        <StudentFace
          photoUrl={student.photoUrl}
          name={student.name}
          cardNumber={student.cardNumber}
          size="verify"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-lg leading-tight font-semibold">{student.name}</p>
            <Button
              asChild
              size="icon-sm"
              variant="ghost"
              className="-mt-1 -mr-1 shrink-0"
              title="Open student profile"
            >
              <Link href={`/students/${student.id}`} target="_blank">
                <Info className="size-4" aria-hidden />
                <span className="sr-only">Open {student.name}&apos;s profile</span>
              </Link>
            </Button>
          </div>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {student.cardNumber ?? "no card number"}
          </p>
          {student.school && (
            <p className="text-muted-foreground truncate text-xs">{student.school}</p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <PaymentChip arrears={arrears} />
            {candidate && (
              // `min-w-0` as well as `truncate`: a flex item will not shrink
              // below its content without it, so a long course name ran out of
              // the panel instead of ending in an ellipsis.
              <Badge variant="secondary" className="block min-w-0 max-w-full truncate">
                {candidate.course}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {candidate ? (
        <>
          <p className="text-muted-foreground text-xs leading-tight">
            {candidate.teacher} · {to12Hour(candidate.startTime)}–{to12Hour(candidate.endTime)}
          </p>
          <ClassAttendanceCard
            key={`${student.id}:${candidate.courseId}`}
            studentId={student.id}
            courseId={candidate.courseId}
            load={loadClassAttendance}
          />
        </>
      ) : (
        result.status === "outside" && <p className="text-sm font-medium">{result.message}</p>
      )}

      {result.status === "queued" && (
        <p className="text-muted-foreground text-xs">
          Saved on this device; it syncs when the connection is back.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {owes && canPay && (
          <Button size="sm" className="gap-1.5" onClick={() => onPay(student.id, student.name)}>
            <CreditCard className="size-3.5" aria-hidden />
            Take payment
          </Button>
        )}
        {owes && !canPay && (
          <span className="text-muted-foreground text-xs">Connect to take payment.</span>
        )}
        {attendanceId !== null && onUndo && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={undoing}
            onClick={() => onUndo(attendanceId)}
          >
            <Undo2 className="size-3.5" aria-hidden />
            {undoing ? "Undoing…" : "Undo"}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>

      <Countdown durationMs={durationMs} />
    </div>
  );
}

/**
 * This student's record in the class just marked.
 *
 * Fetched here rather than inside `resolveScan`, because a mark has to land in
 * ONE round trip — the panel is already on screen when this arrives.
 */
function ClassAttendanceCard({
  studentId,
  courseId,
  load,
}: {
  studentId: number;
  courseId: number;
  load: (input: { studentId: number; courseId: number }) => Promise<ClassAttendance>;
}) {
  const [data, setData] = useState<ClassAttendance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    load({ studentId, courseId })
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [studentId, courseId, load]);

  if (failed) return null;

  return (
    <div className="bg-background/70 space-y-2 rounded-lg border p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide uppercase">Attendance (this class)</p>
        {data?.isNew && (
          <Badge variant="outline" className="shrink-0">
            New
          </Badge>
        )}
      </div>

      {!data ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <p className="text-xl leading-none font-bold tabular-nums">
              {data.present} / {data.held}
            </p>
            <p className="text-muted-foreground text-xs">
              Present · {data.rate === null ? "N/A" : `${data.rate}%`}
            </p>
          </div>

          {data.recent.length === 0 ? (
            <p className="text-muted-foreground text-xs">No attendance records yet</p>
          ) : (
            <ul className="max-h-28 space-y-1 overflow-y-auto">
              {data.recent.map((d) => (
                <li key={d.date} className="flex items-center justify-between gap-2 text-xs">
                  <span className="tabular-nums">
                    <span className="font-medium">{d.weekday}</span>{" "}
                    <span className="text-muted-foreground">{d.date.slice(5)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground tabular-nums">
                      {d.at ? to12Hour(d.at) : "—"}
                    </span>
                    <Badge
                      variant={d.present ? "default" : "outline"}
                      className={d.present ? "bg-emerald-600" : "text-red-900"}
                    >
                      {d.present ? "Present" : "Absent"}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
