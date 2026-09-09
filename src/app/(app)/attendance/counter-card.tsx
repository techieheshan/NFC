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
 * One confirmation in the stream, rendered INSIDE the reader box.
 *
 * The result takes the place of the "Reader ON" spinner while it is showing:
 * one box on the screen, in one place, so staff's eyes never move and the
 * terminal never scrolls. It is compact on purpose — the three things that can
 * be WRONG are the three it makes big: who this is, which class is being
 * marked, and whether they owe.
 *
 * The arrears colour is `studentArrears`' verdict, passed through untouched,
 * and it is a solid BADGE on the arrears line — not the whole screen. A
 * full-bleed colour was tried and reverted: it hid the reader controls and made
 * a routine mark feel like an alarm.
 *
 * The BLOCKING rule is unchanged and lives in the screen, not here: a question
 * (pick-list, unrecognised card, open till) holds the reader until answered; a
 * result is simply replaced by the next tap — and can be closed, so staff can
 * get back to the reader box without waiting for another card.
 */

/** Read across a counter, not studied: solid blocks of colour, not tints. */
const ARREARS: Record<ArrearsBadge["status"], { block: string; word: string }> = {
  green: { block: "bg-emerald-600 text-white", word: "PAID UP" },
  red: { block: "bg-red-600 text-white", word: "OWES THIS MONTH" },
  darkred: { block: "bg-red-900 text-white", word: "IN ARREARS" },
  grey: { block: "bg-neutral-500 text-white", word: "FREE TIER" },
};

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
  // on the card that reports a mark the photo is the biggest thing in the box,
  // while still leaving room for the class line and the actions below it.
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
          <span>
            <UserRound className={`mx-auto ${size === "verify" ? "size-7" : "size-5"}`} aria-hidden />
            <span className="mt-0.5 block px-0.5 text-[9px]">
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
  const owes = arrears.status === "red" || arrears.status === "darkred";
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-bold tracking-wide ${a.block}`}>
      {a.word}
      {owes ? ` · ${arrears.label}` : ""}
    </span>
  );
}

function ClassLine({ c }: { c: Candidate }) {
  return (
    <p className="text-sm leading-tight">
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
  /** Closes a RESULT. Purely visual — it decides nothing. */
  onClose?: () => void;
};

export function CounterCard({ result, canPay, onPay, onDismiss, onClose }: CardProps) {
  if (result.status === "unknown") {
    // A question, not a result: the system does not know who this is, so the
    // reader holds until staff acknowledge it. See the block rule.
    return (
      <Body icon={XCircle} title="Card not recognised" tone="text-red-900">
        <p className="text-sm">Register this card first, or search by name.</p>
        {onDismiss && (
          <Button size="sm" className="w-full" onClick={onDismiss}>
            Dismiss — next card
          </Button>
        )}
      </Body>
    );
  }

  if (result.status === "offline-blocked") {
    return (
      <Body icon={CloudOff} title="Can't mark offline yet" tone="text-red-900" onClose={onClose}>
        <p className="text-sm">{result.message}</p>
      </Body>
    );
  }

  const { student, arrears } = result;
  const owes = arrears.status === "red" || arrears.status === "darkred";

  const identity = (
    <div className="flex items-center gap-3 text-left">
      <StudentFace
        photoUrl={student.photoUrl}
        name={student.name}
        cardNumber={student.cardNumber}
        size="verify"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg leading-tight font-semibold">{student.name}</p>
        <p className="text-muted-foreground truncate font-mono text-xs">
          {student.cardNumber ?? "no card number"}
        </p>
        <div className="mt-1">
          <ArrearsChip arrears={arrears} />
        </div>
      </div>
    </div>
  );

  const actions = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {owes &&
        (canPay ? (
          <Button size="sm" className="gap-1.5" onClick={() => onPay(student.id, student.name)}>
            <Banknote className="size-3.5" aria-hidden />
            Take payment
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">Connect to take payment.</span>
        ))}
      <Button asChild size="sm" variant="ghost" className="gap-1.5">
        <Link href={`/students/${student.id}`} target="_blank">
          <History className="size-3.5" aria-hidden />
          History
        </Link>
      </Button>
      {onClose && (
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );

  switch (result.status) {
    case "marked":
    case "queued": {
      const candidate = result.status === "marked" ? result.mark.candidate : result.candidate;
      const at = result.status === "marked" ? result.mark.at : result.at;
      return (
        <Body
          icon={CheckCircle2}
          title={result.status === "queued" ? "Marked — queued" : "Marked present"}
          tone="text-emerald-900"
          right={<span className="text-sm font-medium tabular-nums">{to12Hour(at)}</span>}
        >
          {identity}
          <ClassLine c={candidate} />
          <p className="text-sm font-medium">
            {owes ? `Thank you — please settle ${arrears.label}.` : "Thank you!"}
          </p>
          {result.status === "queued" && (
            <p className="text-muted-foreground text-xs">
              Saved on this device; it syncs when the connection is back.
            </p>
          )}
          {actions}
        </Body>
      );
    }

    case "already":
      return (
        <Body
          icon={AlertTriangle}
          title={`Already marked at ${to12Hour(result.at)}`}
          tone="text-amber-900"
        >
          {identity}
          <ClassLine c={result.candidate} />
          {actions}
        </Body>
      );

    case "no-class":
      return (
        <Body icon={XCircle} title="No class open right now" tone="text-red-900">
          {identity}
          {actions}
        </Body>
      );

    case "outside":
      return (
        <Body icon={Clock} title="Not open yet / already closed" tone="text-amber-900">
          {identity}
          <p className="text-sm font-medium">{result.message}</p>
          {actions}
        </Body>
      );

    default:
      return null;
  }
}

/**
 * The contents of the reader box while a result is showing.
 *
 * No wrapper card and no colour of its own: the box it sits in already has the
 * border and the tint, and a second bordered card inside it was the thing that
 * made the terminal scroll.
 */
function Body({
  icon: Icon,
  title,
  tone,
  right,
  onClose,
  children,
}: {
  icon: typeof CheckCircle2;
  title: string;
  tone: string;
  right?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div data-counter-popup className="space-y-2 text-left">
      <div className={`flex items-center justify-between gap-3 ${tone}`}>
        <p className="flex items-center gap-2 font-semibold">
          <Icon className="size-5 shrink-0" aria-hidden />
          {title}
        </p>
        {right}
      </div>
      {children}
      {onClose && (
        <Button size="sm" variant="outline" className="w-full" onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );
}

/**
 * The blocking card: two or more classes are open, so the counter refuses to
 * guess. This is the wrong-class guard — the one place the stream stops. It
 * renders below the reader box rather than inside it, because it is a question
 * with its own buttons and the box above it is showing "Reader OFF".
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
    <div data-counter-popup className="border-primary bg-primary/5 space-y-3 rounded-xl border-2 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-5 shrink-0" aria-hidden />
        {isConfirm ? "Additional class — confirm" : "Which class?"}
      </p>

      <div className="flex items-center gap-3">
        <StudentFace
          photoUrl={result.student.photoUrl}
          name={result.student.name}
          cardNumber={result.student.cardNumber}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg leading-tight font-semibold">{result.student.name}</p>
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
          : "Two or more classes are open — pick the right one. Nothing is recorded until you do."}
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
