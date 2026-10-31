import Link from "next/link";
import { ChevronLeft, Search, X } from "lucide-react";

import { colomboNow } from "@/lib/colombo-time";
import { LAST_RECEIPTS, SEARCH_RECEIPTS, lastReceipts, searchReceipts } from "@/lib/receipt-lookup";

import { requirePaymentNewPage } from "../access";
import { ReceiptList } from "./receipt-list";

export const metadata = { title: "Receipts" };

const ROUTE = "/payment-new/receipts";

/**
 * Board 6 — Last 10 receipts, and a search for older ones. READ-ONLY: it reads receipts and
 * opens the existing reprint; it never writes, and there is no Cancel here (that stays on
 * the admin's full Receipts page).
 *
 * The search is a plain GET form: the query is a searchParam, so a search is a fresh server
 * render and works before the page has hydrated (AGENTS rule 17 — nothing to sync into state).
 * ADMIN only until the menu switch, through the one constant in ../access.ts. This page is
 * never cached by the service worker (it caches /attendance and nothing else).
 */
export default async function PaymentNewReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePaymentNewPage();

  const raw = (await searchParams).q;
  const q = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim().slice(0, 100);
  const searching = q !== "";

  const result = searching ? await searchReceipts(q) : { ...(await lastReceipts()), tooShort: false };
  const today = colomboNow().date;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-3">
      <div className="flex items-center gap-3">
        <Link
          href="/payment-new"
          aria-label="Back to Start"
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-[#E1DAF0] bg-white"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="text-xl font-bold">Receipts</h1>
      </div>

      <form action={ROUTE} method="get" role="search" className="flex items-center gap-1 rounded-2xl border border-[#CFC6E6] bg-white pl-3">
        <label htmlFor="receipt-q" className="sr-only">
          Search receipts by name, card number or receipt number
        </label>
        {/* Keyed on the query: a new search (or Clear) remounts the field rather than syncing it. */}
        <input
          key={q}
          id="receipt-q"
          name="q"
          type="text"
          inputMode="search"
          enterKeyHint="search"
          defaultValue={q}
          maxLength={100}
          autoComplete="off"
          placeholder="Name, card number or receipt no."
          className="h-[52px] min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {searching && (
          <Link href={ROUTE} aria-label="Clear the search" className="grid size-11 shrink-0 place-items-center rounded-xl text-[#5B5670]">
            <X className="size-5" aria-hidden />
          </Link>
        )}
        <button type="submit" aria-label="Search" className="grid size-11 shrink-0 place-items-center rounded-xl text-[#4C1D95]">
          <Search className="size-5" aria-hidden />
        </button>
      </form>

      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-[#3F3A55]">
          {!searching
            ? `Last ${LAST_RECEIPTS} receipts`
            : result.tooShort
              ? "Search"
              : `${result.receipts.length} ${result.receipts.length === 1 ? "receipt" : "receipts"} found`}
        </span>
        <span className="text-xs text-[#5B5670]">Newest first</span>
      </div>

      {result.tooShort ? (
        <p className="rounded-2xl border border-dashed border-[#D8D2E6] p-5 text-center text-sm text-[#5B5670]">
          Type at least 2 letters of a name or card number, or a receipt number such as XN-1493.
        </p>
      ) : result.receipts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#D8D2E6] p-5 text-center text-sm text-[#5B5670]">
          {searching ? "No receipts found. Check the spelling, or try the card number or the receipt number." : "No receipts yet."}
        </p>
      ) : (
        <ReceiptList receipts={result.receipts} today={today} />
      )}

      {result.more && (
        <p className="text-center text-[13px] text-[#5B5670]">
          {searching
            ? `Showing the latest ${SEARCH_RECEIPTS}. Type more of the name or number to narrow it down.`
            : `Showing the latest ${LAST_RECEIPTS}. Search to find older receipts.`}
        </p>
      )}
    </div>
  );
}
