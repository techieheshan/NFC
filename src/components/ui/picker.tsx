"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

/**
 * A dropdown that fits a 390px terminal.
 *
 * The native `<select>` overlay is drawn by the OS: on the POS device it
 * overflows the screen and clips long course names ("Other ICT Theory (Kasup
 * Devendra)" losing its tail), which is exactly the text staff need to read to
 * pick the right course. This renders the list in the app instead — a bounded
 * sheet, scrollable inside itself, with the full label wrapped rather than
 * truncated and the WHOLE ROW tappable at ~48px.
 *
 * The value still reaches the server through a hidden input with the same
 * `name`, so every form that used a `<select>` keeps working unchanged.
 */

export type PickerOption = {
  value: string;
  label: string;
  /** Second line — teacher, fee, "already enrolled". */
  hint?: string;
  disabled?: boolean;
};

export function Picker({
  name,
  value,
  onChange,
  options,
  placeholder = "Select…",
  title,
  required,
  className = "",
}: {
  name?: string;
  value: string;
  onChange: (value: string) => void;
  options: PickerOption[];
  placeholder?: string;
  /** Heading on the open sheet — what the person is choosing. */
  title?: string;
  required?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  // The sheet covers the screen, so the page behind it must not scroll away
  // under it while staff are reading a long list.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {name && <input type="hidden" name={name} value={value} required={required} />}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`border-input bg-background flex min-h-12 w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-base shadow-xs ${className}`}
      >
        <span className={`min-w-0 flex-1 ${selected ? "" : "text-muted-foreground"}`}>
          <span className="block truncate">{selected?.label ?? placeholder}</span>
          {selected?.hint && (
            <span className="text-muted-foreground block truncate text-xs">{selected.hint}</span>
          )}
        </span>
        <ChevronDown className="text-muted-foreground size-5 shrink-0" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          {/* Bounded to the viewport, never taller than it: the list scrolls,
              the sheet does not grow past the screen edge. */}
          <div className="bg-background flex max-h-[85svh] flex-col rounded-t-2xl border-t shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <p className="text-base font-semibold">{title ?? placeholder}</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="hover:bg-secondary grid size-10 place-items-center rounded-md"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {options.map((o) => {
                const on = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      disabled={o.disabled}
                      onClick={() => { onChange(o.value); setOpen(false); }}
                      className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left disabled:opacity-40 ${
                        on ? "bg-primary/10" : "active:bg-accent"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        {/* Wrapped, not truncated: the tail of a course name is
                            how staff tell two courses apart. */}
                        <span className="block text-base leading-snug break-words">{o.label}</span>
                        {o.hint && (
                          <span className="text-muted-foreground block text-sm break-words">{o.hint}</span>
                        )}
                      </span>
                      {on && <Check className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />}
                    </button>
                  </li>
                );
              })}
              {options.length === 0 && (
                <li className="text-muted-foreground px-4 py-6 text-center text-sm">
                  Nothing to choose from.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
