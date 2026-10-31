"use client";

import Link from "next/link";

/**
 * The receipts could not be read (the database or the network let the render down): say so in
 * plain words and offer the two ways out. Nothing was written, so there is nothing to undo.
 */
export default function ReceiptsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3">
      <h1 className="text-xl font-bold">Receipts</h1>
      <p role="alert" className="rounded-2xl border border-[#E8851C] bg-[#FFF4E5] px-4 py-3 text-sm font-medium text-[#4A2600]">
        Couldn&apos;t load the receipts. Check the connection and try again.
      </p>
      <button type="button" onClick={reset} className="h-14 rounded-2xl bg-primary text-base font-semibold text-primary-foreground">
        Try again
      </button>
      <Link href="/payment-new" className="grid h-12 place-items-center rounded-2xl border border-[#E1DAF0] bg-white text-sm font-semibold">
        Back to Start
      </Link>
    </div>
  );
}
