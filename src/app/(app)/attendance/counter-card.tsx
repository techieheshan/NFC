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
 * One confirmation in the stream, as a FULL-SCREEN block of colour.
 *
 * A card is what staff read at a glance while the queue keeps moving, so the
 * three things that can be WRONG are the three things it makes big: who this
 * is, which class is being marked, and whether they owe. The arrears colour is
 * `studentArrears`' verdict, passed through untouched — and it is now the whole
 * background, because on a small wall-mounted terminal a bordered box was both
 * hard to read from the queue and long enough to scroll. Nothing here scrolls:
 * the layout shrinks to fit the screen it is on.
 *
 * The BLOCKING rule is unchanged and lives in the screen, not here: a question
 * (pick-list, unrecognised card, open till) holds the reader until answered; a
 * result is simply replaced by the next tap — and can also be tapped away, so
 * staff can reach the search box without waiting for another card.
 */

const ARREARS: Record<ArrearsBadge["status"], { screen: string; word: string }> = {
  green: { screen: "bg-emerald-600", word: "PAID UP" },
  red: { screen: "bg-red-600", word: "OWES THIS MONTH" },
  darkred: { screen: "bg-red-900", word: "IN ARREARS" },
  grey: { screen: "bg-neutral-500", word: "FREE TIER" },
};

/** No student, no arrears verdict — these stand on their own colour. */
const NO_STUDENT_SCREEN = "bg-slate-800";

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
  // on screen rather than an avatar beside the name. It is sized in viewport
  // units so it stays the biggest element without pushing anything off a short
  // screen.
  const box =
    size === "verify"
      ? "size-[min(34vw,9rem)] max-h-[26svh]"
      : size === "lg"
        ? "size-[min(24vw,5rem)]"
        : "size-14";
  return (
    <span className={`bg-black/20 ${box} shrink-0 overflow-hidden rounded-xl border border-white/30`}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="size-full object-cover" />
      ) : (
        /* Photos are never cached offline, so this fallback is the normal
           offline appearance, not an error state. */
        <span className="grid size-full place-items-center text-center leading-none text-white/80">
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

/** The verdict word, on the same colour it is written on. */
function ArrearsLine({ arrears }: { arrears: ArrearsBadge }) {
  const owes = arrears.status === "red" || arrears.status === "darkred";
  return (
    <p className="text-base leading-tight font-bold tracking-wide text-white sm:text-lg">
      {ARREARS[arrears.status].word}
      {owes ? <span className="block text-sm font-semibold opacity-90">{arrears.label}</span> : null}
    </p>
  );
}

function ClassLine({ c, onColour = true }: { c: Candidate; onColour?: boolean }) {
  return (
    <p className={`text-sm leading-tight ${onColour ? "text-white" : ""}`}>
      <span className="font-semibold">{c.course}</span>
      <span className={onColour ? "text-white/80" : "text-muted-foreground"}>
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
  /** Closes a RESULT popup. Purely visual — it decides nothing. */
  onClose?: () => void;
};

export function CounterCard({ result, canPay, onPay, onDismiss, onClose }: CardProps) {
  if (result.status === "unknown") {
    // A question, not a result: the system does not know who this is, so the
    // reader holds until staff acknowledge it. See the block rule.
    return (
      <Screen colour={NO_STUDENT_SCREEN} icon={XCircle} title="Card not recognised">
        <p className="text-lg text-white">Register this card first, or search by name.</p>
        {onDismiss && (
          <Button size="lg" variant="secondary" className="w-full" onClick={onDismiss}>
            Dismiss — next card
          </Button>
        )}
      </Screen>
    );
  }

  if (result.status === "offline-blocked") {
    return (
      <Screen colour={NO_STUDENT_SCREEN} icon={CloudOff} title="Can't mark offline yet" onClose={onClose}>
        <p className="text-lg text-white">{result.message}</p>
      </Screen>
    );
  }

  const { student, arrears } = result;
  const owes = arrears.status === "red" || arrears.status === "darkred";
  const colour = ARREARS[arrears.status].screen;

  const identity = (
    <div className="flex min-h-0 items-center gap-4">
      <StudentFace
        photoUrl={student.photoUrl}
        name={student.name}
        cardNumber={student.cardNumber}
        size="verify"
      />
      <div className="min-w-0 flex-1 text-white">
        <p className="truncate text-2xl leading-tight font-semibold sm:text-3xl">{student.name}</p>
        <p className="truncate font-mono text-xs text-white/80">
          {student.cardNumber ?? "no card number"}
        </p>
        <div className="mt-2">
          <ArrearsLine arrears={arrears} />
        </div>
      </div>
    </div>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {owes &&
        (canPay ? (
          <Button size="lg" className="gap-1.5" onClick={() => onPay(student.id, student.name)}>
            <Banknote className="size-4" aria-hidden />
            Take payment
          </Button>
        ) : (
          <span className="text-xs text-white/80">Connect to take payment.</span>
        ))}
      <Button asChild size="sm" variant="ghost" className="gap-1.5 text-white hover:bg-white/15 hover:text-white">
        <Link href={`/students/${student.id}`} target="_blank">
          <History className="size-3.5" aria-hidden />
          History
        </Link>
      </Button>
    </div>
  );

  switch (result.status) {
    case "marked":
    case "queued": {
      const candidate = result.status === "marked" ? result.mark.candidate : result.candidate;
      const at = result.status === "marked" ? result.mark.at : result.at;
      return (
        <Screen
          colour={colour}
          icon={CheckCircle2}
          title={result.status === "queued" ? "Marked — queued" : "Marked present"}
          right={<span className="text-sm font-medium tabular-nums text-white">{to12Hour(at)}</span>}
          onClose={onClose}
        >
          {identity}
          <Panel>
            <ClassLine c={candidate} />
          </Panel>
          <p className="text-base font-medium text-white">
            {owes ? `Thank you — please settle ${arrears.label}.` : "Thank you!"}
          </p>
          {result.status === "queued" && (
            <p className="text-xs text-white/80">
              Saved on this device; it syncs when the connection is back.
            </p>
          )}
          {actions}
        </Screen>
      );
    }

    case "already":
      return (
        <Screen
          colour={colour}
          icon={AlertTriangle}
          title={`Already marked at ${to12Hour(result.at)}`}
          onClose={onClose}
        >
          {identity}
          <Panel>
            <ClassLine c={result.candidate} />
          </Panel>
          {actions}
        </Screen>
      );

    case "no-class":
      return (
        <Screen colour={colour} icon={XCircle} title="No class open right now" onClose={onClose}>
          {identity}
          {actions}
        </Screen>
      );

    case "outside":
      return (
        <Screen colour={colour} icon={Clock} title="Not open yet / already closed" onClose={onClose}>
          {identity}
          <p className="text-base font-medium text-white">{result.message}</p>
          {actions}
        </Screen>
      );

    default:
      return null;
  }
}

/** A translucent block on the colour — readable without becoming a second card. */
function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg bg-black/20 p-2.5">{children}</div>;
}

/**
 * The full-screen container.
 *
 * `fixed inset-0` with `overflow-hidden` is the whole point: the terminal must
 * not scroll, so content that cannot fit is not allowed to try. `onClose`
 * closes a RESULT (a tap anywhere) — a QUESTION never gets one, so the only way
 * past it is the answer it is asking for.
 */
function Screen({
  colour,
  icon: Icon,
  title,
  right,
  onClose,
  children,
}: {
  colour: string;
  icon: typeof CheckCircle2;
  title: string;
  right?: React.ReactNode;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      data-counter-popup
      role="dialog"
      aria-label={title}
      className={`fixed inset-0 z-50 flex flex-col gap-3 overflow-hidden p-4 sm:p-6 ${colour}`}
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div className="flex items-center justify-between gap-3 text-white">
        <p className="flex items-center gap-2 text-lg font-semibold">
          <Icon className="size-6 shrink-0" aria-hidden />
          {title}
        </p>
        {right}
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">{children}</div>

      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg bg-white/15 py-2 text-sm font-medium text-white"
        >
          Close — or just tap the next card
        </button>
      )}
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
  const colour = ARREARS[result.arrears.status].screen;

  return (
    <div
      data-counter-popup
      role="dialog"
      aria-label={isConfirm ? "Additional class — confirm" : "Which class?"}
      className={`fixed inset-0 z-50 flex flex-col gap-3 overflow-hidden p-4 sm:p-6 ${colour}`}
    >
      <p className="flex items-center gap-2 text-lg font-semibold text-white">
        <AlertTriangle className="size-6 shrink-0" aria-hidden />
        {isConfirm ? "Additional class — confirm" : "Which class?"}
      </p>

      <div className="flex items-center gap-3">
        <StudentFace
          photoUrl={result.student.photoUrl}
          name={result.student.name}
          cardNumber={result.student.cardNumber}
          size="lg"
        />
        <div className="min-w-0 flex-1 text-white">
          <p className="truncate text-xl leading-tight font-semibold">{result.student.name}</p>
          <p className="truncate font-mono text-xs text-white/80">
            {result.student.cardNumber ?? "no card number"}
          </p>
          <ArrearsLine arrears={result.arrears} />
        </div>
      </div>

      <p className="text-sm text-white">
        {isConfirm
          ? "This is a one-off extra class. Confirm before recording."
          : "Two or more classes are open — pick the right one. Nothing is recorded until you do."}
      </p>

      {/* The only scrollable thing on the terminal, and only when a student is
          somehow in more classes than fit: losing a candidate off-screen would
          be worse than a short scroll here. */}
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              disabled={pending || Boolean(c.markedAt)}
              onClick={() => onChoose(c)}
              className="bg-background flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left transition-opacity disabled:opacity-60"
            >
              <ClassLine c={c} onColour={false} />
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

      <Button size="lg" variant="secondary" className="w-full shrink-0" onClick={onCancel} disabled={pending}>
        Skip this student
      </Button>
    </div>
  );
}
