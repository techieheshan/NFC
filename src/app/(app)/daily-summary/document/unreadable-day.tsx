import Link from "next/link";

import { DOCUMENT_UNREADABLE } from "@/lib/saved-day/texts";

/**
 * What the document route shows for a saved day whose snapshot cannot be read: the refusal and a link back to the day. No sheets, no Print, no
 * Download PDF, and the `auto=print` / `auto=pdf` parameter has nothing to act on. A day that IS saved must never print as a "Draft".
 */
export function UnreadableDay({ date }: { date: string }) {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Daily Summary</h1>
      <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{DOCUMENT_UNREADABLE}</p>
      <Link href={`/daily-summary?date=${date}`} className="border-input bg-background flex h-12 items-center justify-center rounded-md border text-base font-medium">Back to the day</Link>
    </div>
  );
}
