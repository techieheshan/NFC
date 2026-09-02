"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Clock,
  CloudOff,
  History,
  UserRound,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";
import type { ArrearsBadge, Candidate } from "@/lib/attendance-match";

import type { ScanResult } from "./actions";

/**
 * One confirmation in the stream.
 *
 * A card is what staff read at a glance while the queue keeps moving, so the
 * three things that can be WRONG are the three things it makes big: who this
 * is, which class is being marked, and whether they owe. The arrears colour is
 * `studentArrears`' verdict, passed through untouched.
 */

const ARREARS: Record<ArrearsBadge["status"], { chip: string; word: string }> = {
  green: { chip: "bg-emerald-100 text-emerald-900 border-emerald-300", word: "Paid up" },
  amber: { chip: "bg-amber-100 text-amber-900 border-amber-300", word: "Owes" },
  red: { chip: "bg-red-100 text-red-900 border-red-300", word: "In arrears" },
  grey: { chip: "bg-muted text-muted-foreground border-border", word: "Free tier" },
};

const TONE = {
  success: "border-emerald-300 bg-emerald-50",
  owes: "border-amber-400 bg-amber-50",
  warn: "border-amber-300 bg-amber-50",
  error: "border-red-300 bg-red-50",
  neutral: "border-border bg-card",
} as const;

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
  // "verify" is the size the mark popup uses. The system cannot detect a
  // sibling tapping their brother's card — only a person looking at the face
  // can — so on the popup that reports a mark, the photo is the largest thing
  // on screen rather than an avatar beside the name.
  const box = size === "verify" ? "size-28" : size === "lg" ? "size-20" : "size-14";
  return (
    <span className={`bg-muted ${box} shrink-0 overflow-hidden rounded-xl border`}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        /* Photos are never cached offline, so this fallback is the normal
           offline appearance, not an error state. */
        <span className="text-muted-foreground grid size-full place-items-center text-center leading-none">
          <span>
            <UserRound className={`mx-auto ${size === "verify" ? "size-10" : "size-6"}`} aria-hidden />
            <span className={`mt-0.5 block px-0.5 ${size === "verify" ? "text-xs" : "text-[9px]"}`}>
              {cardNumber ?? name.slice(0, 8)}
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

function ArrearsChip({ arrears }: { arrears: ArrearsBadge }) {
  const a = ARREARS[arrears.status];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${a.chip}`}>
      {a.word}
      {arrears.status !== "green" && arrears.status !== "grey" ? ` · ${arrears.label}` : ""}
    </span>
  );
}

function ClassLine({ c }: { c: Candidate }) {
  return (
    <p className="text-sm">
      <span className="font-medium">{c.course}</span>
      <span className="text-muted-foreground">
        {" "}· {c.teacher} · {to12Hour(c.startTime)}–{to12Hour(c.endTime)}
      </span>
    </p>
  );
}

export type CardProps = {
  result: ScanResult;
  canPay: boolean;
  onPay: (studentId: number, name: string) => void;
  /** Only passed for the popups that hold the line and must be dismissed. */
  onDismiss?: () => void;
};

export function CounterCard({ result, canPay, onPay, onDismiss }: CardProps) {
  if (result.status === "unknown") {
    // A question, not a result: the system does not know who this is, so the
    // reader holds until staff acknowledge it. See the block rule.
    return (
      <Shell tone="error" icon={XCircle} title="Card not recognised">
        <p className="text-sm">Register this card first, or search by name.</p>
        {onDismiss && (
          <Button className="w-full" onClick={onDismiss}>
            Dismiss — next card
          </Button>
        )}
      </Shell>
    );
  }

  if (result.status === "offline-blocked") {
    return (
      <Shell tone="error" icon={CloudOff} title="Can't mark offline yet">
        <p className="text-sm">{result.message}</p>
      </Shell>
    );
  }

  const { student, arrears } = result;
  const owes = arrears.status === "amber" || arrears.status === "red";

  const verifyHeader = (
    <div className="flex items-start gap-4">
      <StudentFace
        photoUrl={student.photoUrl}
        name={student.name}
        cardNumber={student.cardNumber}
        size="verify"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xl font-semibold">{student.name}</p>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {student.cardNumber ?? "no card number"}
        </p>
        <div className="mt-1.5">
          <ArrearsChip arrears={arrears} />
        </div>
      </div>
    </div>
  );

  const header = (
    <div className="flex items-start gap-3">
      <StudentFace
        photoUrl={student.photoUrl}
        name={student.name}
        cardNumber={student.cardNumber}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold">{student.name}</p>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {student.cardNumber ?? "no card number"}
        </p>
        <div className="mt-1">
          <ArrearsChip arrears={arrears} />
        </div>
      </div>
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size="sm" variant="ghost" className="gap-1.5">
        <Link href={`/students/${student.id}`} target="_blank">
          <History className="size-3.5" aria-hidden />
          View history
        </Link>
      </Button>
      {owes &&
        (canPay ? (
          <Button size="sm" className="gap-1.5" onClick={() => onPay(student.id, student.name)}>
            <Banknote className="size-3.5" aria-hidden />
            Take payment
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">
            Connect to take payment.
          </span>
        ))}
    </div>
  );

  switch (result.status) {
    case "marked":
    case "queued": {
      const candidate = result.status === "marked" ? result.mark.candidate : result.candidate;
      const at = result.status === "marked" ? result.mark.at : result.at;
      return (
        <Shell
          tone={owes ? "owes" : "success"}
          icon={CheckCircle2}
          title={result.status === "queued" ? "Marked — queued" : "Marked present"}
          right={<span className="text-sm font-medium tabular-nums">{to12Hour(at)}</span>}
        >
          {verifyHeader}
          <div className="bg-background/70 rounded-lg border p-2.5">
            <ClassLine c={candidate} />
          </div>
          <p className="text-sm font-medium">
            {owes ? `Thank you — please settle ${arrears.label}.` : "Thank you!"}
          </p>
          {result.status === "queued" && (
            <p className="text-muted-foreground text-xs">
              Saved on this device; it syncs when the connection is back.
            </p>
          )}
          {footer}
        </Shell>
      );
    }

    case "already":
      return (
        <Shell tone="warn" icon={AlertTriangle} title={`Already marked at ${to12Hour(result.at)}`}>
          {header}
          <div className="bg-background/70 rounded-lg border p-2.5">
            <ClassLine c={result.candidate} />
          </div>
          {footer}
        </Shell>
      );

    case "no-class":
      return (
        <Shell tone="error" icon={XCircle} title={`No class open for ${student.name} right now`}>
          {header}
          {footer}
        </Shell>
      );

    case "outside":
      return (
        <Shell tone="warn" icon={Clock} title="Not open yet / already closed">
          {header}
          <p className="text-sm font-medium">{result.message}</p>
          {footer}
        </Shell>
      );

    default:
      return null;
  }
}

function Shell({
  tone,
  icon: Icon,
  title,
  right,
  children,
}: {
  tone: keyof typeof TONE;
  icon: typeof CheckCircle2;
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div data-counter-popup className={`space-y-3 rounded-xl border-2 p-4 ${TONE[tone]}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <Icon className="size-5 shrink-0" aria-hidden />
          {title}
        </p>
        {right}
      </div>
      {children}
    </div>
  );
}

/**
 * The blocking card: two or more classes are open, so the counter refuses to
 * guess. This is the wrong-class guard — the one place the stream stops.
 */
export function ChoiceCard({
  result,
  pending,
  onChoose,
  onCancel,
}: {
  result: Extract<ScanResult, { status: "choose" | "confirm" }>;
  pending: boolean;
  onChoose: (candidate: Candidate) => void;
  onCancel: () => void;
}) {
  const candidates = result.status === "choose" ? result.candidates : [result.candidate];
  const isConfirm = result.status === "confirm";

  return (
    <div data-counter-popup className="border-primary bg-primary/5 space-y-4 rounded-xl border-2 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 shrink-0" aria-hidden />
        {isConfirm ? "Additional class — confirm" : "Which class?"}
      </p>

      <div className="flex items-start gap-3">
        <StudentFace
          photoUrl={result.student.photoUrl}
          name={result.student.name}
          cardNumber={result.student.cardNumber}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold">{result.student.name}</p>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {result.student.cardNumber ?? "no card number"}
          </p>
          <div className="mt-1">
            <ArrearsChip arrears={result.arrears} />
          </div>
        </div>
      </div>

      <p className="text-sm">
        {isConfirm
          ? "This is a one-off extra class. Confirm before recording."
          : "Two or more classes are open right now — pick the right one. Nothing is recorded until you do."}
      </p>

      <ul className="space-y-2">
        {candidates.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              disabled={pending || Boolean(c.markedAt)}
              onClick={() => onChoose(c)}
              className="hover:bg-accent bg-background flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60"
            >
              <ClassLine c={c} />
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

      <Button variant="outline" className="w-full" onClick={onCancel} disabled={pending}>
        Skip this student
      </Button>
    </div>
  );
}
