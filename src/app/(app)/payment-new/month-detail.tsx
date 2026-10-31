"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { PaymentMode } from "@/app/(app)/payment/actions";
import { shortMoney } from "@/lib/payment-charge";
import type { MonthDetail, MonthDetailRow } from "@/lib/payment-view";

/**
 * Board 5 — one month's attendance for one course: the classes the student ACTUALLY
 * attended, and nothing else. No expected class days, no absences, no "of N": those
 * would be derived from today's timetable, which has no history.
 *
 * Staff pick how this month is charged: Full, Half or No charge (no reason, no attendance
 * limit). The amounts are the server-built strings the card already shows — Half is half of
 * this month's normal amount for this student, No charge is nothing. A month that is already
 * PAID can be looked at, never charged again: it shows how it was charged and offers Close.
 */

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (iso: string) => `${iso.slice(8, 10)} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;
const lastLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;

const CHIP = "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold";

function Attended({ row }: { row: MonthDetailRow }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-[#5B5670] tabular-nums">{row.time}</span>
      <span className={`${CHIP} border-[#2E9E5B] bg-[#D6F2DF] text-[#0B4A24]`}>
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
        Present
      </span>
    </span>
  );
}

export function MonthDetailSheet({
  studentId,
  courseId,
  year,
  month,
  fullAmount,
  halfAmount,
  state,
  paidMode,
  currentMode,
  load,
  onUse,
  onRemove,
  onClose,
}: {
  studentId: number;
  courseId: number;
  year: number;
  month: number;
  /** What this month costs in Full and in Half for this student — the server's strings, combo-aware. */
  fullAmount: string | null;
  halfAmount: string | null;
  /** paid months can be looked at, but not used for a payment. */
  state: "paid" | "unpaid" | "ahead";
  /** How a PAID month was charged: null = the full fee. */
  paidMode: "HALF" | "NO_CHARGE" | null;
  /** The mode this month is currently picked in for this payment, or null if it is not picked. */
  currentMode: PaymentMode | null;
  load: (input: { studentId: number; courseId: number; year: number; month: number }) => Promise<MonthDetail | null>;
  onUse: (mode: PaymentMode) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PaymentMode>(currentMode ?? "FULL");
  const [detail, setDetail] = useState<MonthDetail | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  // Fetch once on open. The parent keys this component on the month, so a
  // different month is a fresh instance rather than a prop synced into state.
  useEffect(() => {
    startTransition(async () => {
      try {
        setDetail(await load({ studentId, courseId, year, month }));
      } catch {
        setFailed(true);
      }
    });
  }, [load, studentId, courseId, year, month]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} className="gap-3 p-4 sm:max-w-md">
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[22px] leading-tight font-bold">
              {detail?.label ?? `${SHORT[month - 1]} ${year}`}
            </DialogTitle>
            <DialogDescription className="mt-0.5 text-[13px] break-words text-[#5B5670]">
              {detail ? `${detail.course} · ${detail.teacher}` : "Attendance for this month"}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E1DAF0] bg-white"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {detail === undefined && !failed && (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-[#5B5670]">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading attendance…
          </p>
        )}

        {(failed || detail === null) && (
          <p role="alert" className="rounded-xl border border-[#E8851C] bg-[#FFF4E5] px-3 py-3 text-sm text-[#4A2600]">
            {failed
              ? "Couldn't load the attendance. Check the connection and try again."
              : "No attendance to show for this course."}
          </p>
        )}

        {detail && (
          <>
            <div
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                detail.attended > 0
                  ? "border-[#2E9E5B] bg-[#E8F7EE] text-[#0B4A24]"
                  : "border-[#E8851C] bg-[#FFF4E5] text-[#4A2600]"
              }`}
            >
              <span className="text-[34px] leading-none font-bold">{detail.attended}</span>
              <div>
                <p className="text-[15px] font-bold">{detail.attended === 1 ? "class attended" : "classes attended"}</p>
                {detail.lastAttended && <p className="text-sm">Last attended {lastLabel(detail.lastAttended)}</p>}
              </div>
            </div>

            {detail.rows.length > 0 ? (
              <ul className="overflow-hidden rounded-2xl border border-[#E1DAF0]">
                {detail.rows.map((r) => (
                  <li
                    key={`${r.date}-${r.time}`}
                    className="flex min-h-12 items-center justify-between gap-3 border-b border-[#E1DAF0] px-3.5 py-2 last:border-b-0"
                  >
                    <span className="text-[15px]">
                      {dayMonth(r.date)} · {r.weekday}
                    </span>
                    <Attended row={r} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-[#D8D2E6] px-3.5 py-4 text-center text-sm text-[#5B5670]">
                No classes attended this month.
              </p>
            )}
          </>
        )}

        {state === "paid" ? (
          <p className="rounded-xl border border-[#2E9E5B] bg-[#E8F7EE] px-3.5 py-3 text-sm font-semibold text-[#0B4A24]">
            Already paid — charged as {paidMode === "HALF" ? "a half month" : paidMode === "NO_CHARGE" ? "no charge" : "the full fee"}.
          </p>
        ) : (
          <div role="radiogroup" aria-label="Fee for this month">
            <p className="mb-1.5 text-sm font-semibold">Fee for this month</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["FULL", "Full", shortMoney(fullAmount)],
                  ["HALF", "Half", shortMoney(halfAmount)],
                  ["NO_CHARGE", "No charge", "0"],
                ] as const
              ).map(([value, label, amount]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={`flex h-16 flex-col items-center justify-center rounded-xl border-2 px-1 ${
                    mode === value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-[#CFC6E6] bg-white text-foreground"
                  }`}
                >
                  <span className="text-sm font-semibold">{label}</span>
                  <span className="text-lg font-bold tabular-nums">{amount}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="h-[52px] flex-1 rounded-[14px] border border-[#CFC6E6] bg-white text-base font-semibold"
          >
            {state === "paid" ? "Close" : "Cancel"}
          </button>
          {state !== "paid" && (
            <button
              type="button"
              onClick={() => {
                onUse(mode);
                onClose();
              }}
              className="h-[52px] flex-[1.4] rounded-[14px] bg-primary text-base font-semibold text-primary-foreground"
            >
              Use for payment
            </button>
          )}
        </div>
        {state !== "paid" && currentMode !== null && (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="h-12 w-full rounded-[14px] border border-[#CFC6E6] bg-white text-base font-semibold text-[#8A1C1C]"
          >
            Remove from payment
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
