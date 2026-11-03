"use client";

import { useEffect, type ReactNode } from "react";

/** The bottom sheet R1's bank sheet uses (same look): a dimmed backdrop, a rounded panel at the bottom, Escape and a tap outside close it. */
export function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={label} className="bg-background mx-auto max-h-[90vh] w-full max-w-[720px] overflow-y-auto rounded-t-2xl p-4 shadow-xl">
        {children}
      </div>
    </div>
  );
}

export function SheetRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 text-sm ${strong ? "border-t font-semibold" : ""}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}
