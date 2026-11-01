"use client";

import { useState } from "react";
import { AlertTriangle, Check, Layers, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ApplicableCombo, ComboDecision } from "@/app/(app)/payment/actions";
import { shortMoney } from "@/lib/payment-charge";

/**
 * Board 9 — the combo question, restyled. The decision logic is the old pop-up's,
 * unchanged: it is shown only when the existing code needs an answer, "Yes" applies
 * the combo, and "No" needs a reason that is stored on the payment.
 *
 * Every number here is display only. The new rules (answering automatically when the
 * student attended, new-student and free-card exemptions, a switch on the card) are
 * job 3 and are not built.
 */

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lastLabel = (iso: string | null | undefined) =>
  iso ? `Last attended ${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}` : "Never attended";

export function ComboSheet({
  combo,
  studentName,
  lastAttended,
  pending,
  onAnswer,
  onCancel,
}: {
  combo: ApplicableCombo;
  studentName: string;
  /** Most recent class attended, by course ("2026-10-24"). */
  lastAttended: Record<number, string | null>;
  pending: boolean;
  onAnswer: (decision: ComboDecision) => void;
  onCancel: () => void;
}) {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  const zero = combo.attendance.filter((a) => a.days === 0);
  const monthWord = combo.lastMonthLabel.split(" ")[0];
  // A combo can span teachers, so a day count needs an owner (the old pop-up's rule).
  const spansTeachers = new Set(combo.attendance.map((a) => a.teacher)).size > 1;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false} className="gap-3 p-4 sm:max-w-md">
        <div className="flex items-start gap-2.5">
          <Layers className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-xl leading-tight font-bold break-words">{combo.name}</DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] break-words text-[#5B5670]">
              {studentName} · {combo.teacher}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E1DAF0] bg-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {zero.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-[#E8851C] bg-[#FFF4E5] px-3.5 py-3 text-[#4A2600]">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p className="text-[15px] leading-snug">
              <span className="font-bold">
                {zero.map((a) => a.course).join(", ")}: 0 days attended in {monthWord}.
              </span>{" "}
              Check before giving the combo price.
            </p>
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-[#E1DAF0]">
          <h3 className="bg-[#F5F2FF] px-3.5 py-2.5 text-sm font-semibold text-[#3F3A55]">
            Attendance in {combo.lastMonthLabel}
          </h3>
          <ul>
            {combo.attendance.map((a) => (
              <li
                key={a.courseId}
                className={`flex items-center justify-between gap-3 border-t border-[#E1DAF0] px-3.5 py-3 ${
                  a.days === 0 ? "bg-[#FFF3F3]" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="text-[15px] leading-tight font-semibold break-words">{a.course}</p>
                  <p className={`text-[13px] break-words ${a.days === 0 ? "text-[#8A1C1C]" : "text-[#5B5670]"}`}>
                    {lastLabel(lastAttended[a.courseId])}
                    {spansTeachers ? ` · ${a.teacher}` : ""}
                  </p>
                </div>
                <span
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-[15px] font-bold ${
                    a.days === 0
                      ? "border-[#D64545] bg-[#FDE0E0] text-[#8A1C1C]"
                      : "border-[#2E9E5B] bg-[#D6F2DF] text-[#0B4A24]"
                  }`}
                >
                  {a.days === 0 ? (
                    <X className="size-4" strokeWidth={3} aria-hidden />
                  ) : (
                    <Check className="size-4" strokeWidth={3} aria-hidden />
                  )}
                  {a.days} {a.days === 1 ? "day" : "days"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="overflow-hidden rounded-2xl border border-[#E1DAF0]">
          <h3 className="bg-[#F5F2FF] px-3.5 py-2.5 text-sm font-semibold text-[#3F3A55]">Combined rate</h3>
          <ul>
            {combo.items.map((i) => (
              <li key={i.courseId} className="flex items-center justify-between gap-3 border-t border-[#E1DAF0] px-3.5 py-3">
                <span className="min-w-0 text-[15px] break-words">{i.course}</span>
                <span className="shrink-0 tabular-nums">
                  <span className="mr-2 text-[#6B6680] line-through">{shortMoney(i.defaultFee)}</span>
                  <span className="text-[19px] font-bold">{shortMoney(i.comboFee)}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-[#E1DAF0] px-3.5 py-2 text-xs text-[#5B5670]">
            Shown before the fee tier — the student&apos;s tier still applies.
          </p>
        </section>

        {refusing && (
          <div className="space-y-1.5">
            <label htmlFor="combo-reason" className="text-base font-semibold">
              Reason for refusing (required)
            </label>
            <input
              id="combo-reason"
              className="h-12 w-full rounded-xl border border-[#CFC6E6] bg-white px-3 text-base outline-none focus-visible:ring-4 focus-visible:ring-ring"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Did not attend Paper last month"
              autoComplete="off"
              autoFocus
            />
            <p className="text-xs text-[#5B5670]">Stored on the payment so this can be justified later.</p>
          </div>
        )}

        <div className="flex gap-2.5">
          {refusing ? (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => setRefusing(false)}
                className="min-h-14 flex-1 rounded-2xl border-2 border-primary bg-white px-2 py-2 text-[15px] leading-tight font-bold text-primary disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="button"
                disabled={pending || trimmed === ""}
                onClick={() => onAnswer({ comboId: combo.comboId, apply: false, reason: trimmed })}
                className="min-h-14 flex-[1.3] rounded-2xl bg-[#B42318] px-2 py-2 text-[15px] leading-tight font-bold text-white disabled:opacity-60"
              >
                {pending ? "Charging…" : "Charge normal rate"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => setRefusing(true)}
                className="min-h-14 flex-1 rounded-2xl border-2 border-primary bg-white px-2 py-2 text-[15px] leading-tight font-bold text-primary disabled:opacity-60"
              >
                No · normal rate
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => onAnswer({ comboId: combo.comboId, apply: true })}
                className="min-h-14 flex-1 rounded-2xl bg-primary px-2 py-2 text-[15px] leading-tight font-bold text-primary-foreground disabled:opacity-60"
              >
                {pending ? "Charging…" : "Yes · apply combo"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
