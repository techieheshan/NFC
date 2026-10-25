"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { to12Hour } from "@/lib/colombo-time";
import type { Candidate } from "@/lib/attendance-match";

import type { ScanResult } from "./actions";
import { PaymentChip, StudentFace } from "./result-panel";

/**
 * The counter's one blocking question.
 *
 * Everything that REPORTS something lives in `result-panel.tsx`; this file is
 * only the card that asks. The confirmation card that used to live here was
 * replaced by that panel — one place where a result is drawn, not two.
 */
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
            <PaymentChip arrears={result.arrears} />
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
