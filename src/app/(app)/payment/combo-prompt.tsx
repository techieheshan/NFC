"use client";

import { useState } from "react";
import { AlertTriangle, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ApplicableCombo, ComboDecision } from "./actions";

/**
 * The fraud check.
 *
 * A student qualifies for a combo by enrolment alone, which says nothing about
 * whether they actually attend both classes. Before the discount is granted,
 * staff see last completed month's attendance across every course in the combo —
 * a lopsided count (Theory 5, Paper 1) is the tell that the student is claiming
 * a bundle they only half use.
 *
 * Asked fresh every transaction; no answer is ever remembered.
 */
export function ComboPrompt({
  combo,
  studentName,
  pending,
  onAnswer,
  onCancel,
}: {
  combo: ApplicableCombo;
  studentName: string;
  pending: boolean;
  onAnswer: (decision: ComboDecision) => void;
  onCancel: () => void;
}) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");

  const trimmed = reason.trim();

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="size-5 shrink-0" aria-hidden />
            {combo.name}
          </DialogTitle>
          <DialogDescription>
            {studentName} · {combo.teacher}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">
              Attendance in {combo.lastMonthLabel}
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {combo.attendance.map((a) => (
                <li key={a.courseId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{a.course}</span>
                  <span
                    className={`shrink-0 tabular-nums ${
                      a.days === 0 ? "text-destructive font-medium" : ""
                    }`}
                  >
                    {a.days} {a.days === 1 ? "day" : "days"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border p-3">
            <p className="text-sm font-medium">Combined rate</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {combo.items.map((i) => (
                <li key={i.courseId} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{i.course}</span>
                  <span className="shrink-0 tabular-nums">
                    <span className="text-muted-foreground mr-2 line-through">
                      {i.defaultFee}
                    </span>
                    {i.comboFee}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground mt-2 text-xs">
              Shown before the fee tier — the student&apos;s tier still applies.
            </p>
          </div>

          {refusing && (
            <div className="space-y-2">
              <Label htmlFor="combo-reason">Reason for refusing (required)</Label>
              <Input
                id="combo-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Did not attend Paper last month"
                autoComplete="off"
                autoFocus
              />
              <p className="text-muted-foreground text-xs">
                Stored on the payment so this can be justified later.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {refusing ? (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setRefusing(false)}
                disabled={pending}
              >
                Back
              </Button>
              <Button
                variant="destructive"
                className="flex-1 gap-1.5"
                disabled={pending || trimmed === ""}
                onClick={() =>
                  onAnswer({ comboId: combo.comboId, apply: false, reason: trimmed })
                }
              >
                <AlertTriangle className="size-4" aria-hidden />
                {pending ? "Charging…" : "Charge normal rate"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setRefusing(true)}
                disabled={pending}
              >
                No — normal rate
              </Button>
              <Button
                className="flex-1"
                disabled={pending}
                onClick={() => onAnswer({ comboId: combo.comboId, apply: true })}
              >
                {pending ? "Charging…" : "Yes — apply combo"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
