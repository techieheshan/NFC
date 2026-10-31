"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import type { Receipt } from "@/app/(app)/payment/actions";

const SECONDS = 5;

/**
 * A checkout of ONLY no-charge months. Money did not change hands, so nothing is printed:
 * staff see that it was recorded, and the screen returns to Start by itself after a few
 * seconds (or at the tap). The receipt exists and can be reprinted from Receipts.
 */
export function RecordedNoCharge({ receipt, onDone }: { receipt: Receipt; onDone: () => void }) {
  const [left, setLeft] = useState(SECONDS);
  const done = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current();
  };

  useEffect(() => {
    const timer = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left <= 0) {
      if (done.current) return;
      done.current = true;
      onDoneRef.current();
    }
  }, [left]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <p className="flex items-center justify-center gap-2 text-xl font-bold text-[#0B4A24]">
        <CheckCircle2 className="size-7" aria-hidden />
        Recorded, no charge
      </p>

      <div className="rounded-2xl border border-[#E1DAF0] bg-white p-4">
        <p className="text-lg font-bold break-words">{receipt.student.name}</p>
        <p className="text-sm break-words text-[#5B5670]">{receipt.student.cardNumber ?? "no card number"}</p>
        <ul className="mt-3 divide-y divide-[#E1DAF0] border-t border-[#E1DAF0]">
          {receipt.lines.map((l) => (
            <li key={l.label} className="flex items-start justify-between gap-3 py-2.5 text-[15px]">
              <span className="min-w-0 break-words">{l.label.replace(/ \(No charge\)$/, "")}</span>
              <span className="shrink-0 rounded-full border border-[#2E9E5B] bg-[#D6F2DF] px-2.5 py-0.5 text-[13px] font-semibold text-[#0B4A24]">
                No charge
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[#5B5670]">
          Receipt {receipt.reference} · nothing was printed. You can reprint it from Receipts.
        </p>
      </div>

      <button
        type="button"
        onClick={finish}
        className="h-14 w-full rounded-2xl bg-primary text-lg font-semibold text-primary-foreground"
      >
        Back to Start
      </button>
      <p className="text-center text-sm text-[#5B5670]" aria-live="off">
        Back to Start in {Math.max(left, 0)} s
      </p>
    </div>
  );
}
