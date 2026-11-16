import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";

import { searchExtraReceipts } from "../actions";
import { ReceiptList } from "./receipt-list";

export const metadata = { title: "Extra payment receipts" };

const toStr = (v: string | string[] | undefined) => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
};

/** The last 10 extra-payment receipts, or a search by "XA-" number or 2+ characters of a student's name or card number. Reprint for ADMIN + STAFF; Cancel for ADMIN. */
export default async function ExtraReceiptsPage({ searchParams }: PageProps<"/extra-payments/receipts">) {
  const user = await requireNavAccess("/extra-payments");
  const q = (toStr((await searchParams).q) ?? "").slice(0, 60);
  const receipts = await searchExtraReceipts(q);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Button asChild variant="ghost" className="min-h-11"><Link href="/extra-payments">← Back to extra payments</Link></Button>
      <h1 className="text-xl font-semibold">Extra payment receipts</h1>
      <form method="get" className="flex gap-2">
        <label htmlFor="q" className="sr-only">Receipt number or student</label>
        <input id="q" name="q" defaultValue={q} placeholder="XA-12, or a student's name" autoComplete="off" className="border-input bg-background h-11 min-w-0 flex-1 rounded-md border px-3 text-base" />
        <Button type="submit" variant="secondary" className="min-h-11">Search</Button>
      </form>
      {/* Keyed on the search (rule 17): a new search is a fresh render, never props synced into state. */}
      <ReceiptList key={q} receipts={receipts} canCancel={user.role === "ADMIN"} searched={q !== ""} />
    </div>
  );
}
