import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";
import { findTransactions, loadTransaction } from "@/lib/receipts";

import { ReceiptsScreen } from "./receipts-screen";

export const metadata = { title: "Receipts & Cancel" };

const FIELD =
  "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw !== "" ? raw : undefined;
}

export default async function ReceiptsPage({ searchParams }: PageProps<"/receipts">) {
  // ADMIN + STAFF, from the nav config. Cancelling is narrowed to ADMIN below
  // and again inside the action.
  const user = await requireNavAccess("/receipts");

  const params = await searchParams;
  const q = toStr(params.q);
  const from = toStr(params.from);
  const to = toStr(params.to);
  const includeCancelled = toStr(params.cancelled) === "1";
  // Search links straight to one receipt rather than making staff re-find it.
  const key = toStr(params.key);

  const one = key ? await loadTransaction(key) : null;
  const transactions = one ? [one] : key ? [] : await findTransactions({ q, from, to, includeCancelled });
  const searched = Boolean(key || q || (from && to));
  const today = colomboNow().date;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Receipts &amp; Cancel</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Find a receipt to reprint.{" "}
          {user.role === "ADMIN"
            ? "Cancelling voids the whole receipt, with a reason on record."
            : "Cancelling a receipt is an admin action."}
        </p>
      </div>

      {/*
        Filters are searchParams, so applying one is a fresh server render — no
        client state to drift out of sync with what is on screen (AGENTS.md
        rule 17). A plain GET form, so it works before hydration.
      */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
        <div className="min-w-52 flex-1 space-y-2">
          <label htmlFor="q" className="block text-sm font-medium">
            Student
          </label>
          <input
            id="q"
            name="q"
            className={`${FIELD} w-full`}
            defaultValue={q ?? ""}
            placeholder="Card number or name"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="from" className="block text-sm font-medium">
            From
          </label>
          <input id="from" name="from" type="date" className={FIELD} defaultValue={from ?? ""} max={today} />
        </div>
        <div className="space-y-2">
          <label htmlFor="to" className="block text-sm font-medium">
            To
          </label>
          <input id="to" name="to" type="date" className={FIELD} defaultValue={to ?? ""} max={today} />
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="cancelled"
            value="1"
            defaultChecked={includeCancelled}
            className="size-4"
          />
          Show cancelled
        </label>
        <Button type="submit">Find</Button>
        {searched && (
          <Button asChild variant="ghost">
            <Link href="/receipts">Clear</Link>
          </Button>
        )}
      </form>

      {/*
        Keyed on the filter signature: a filter change remounts the list rather
        than syncing props into state.
      */}
      <ReceiptsScreen
        key={`${key ?? ""}|${q ?? ""}|${from ?? ""}|${to ?? ""}|${includeCancelled}`}
        transactions={transactions}
        canCancel={user.role === "ADMIN"}
        searched={searched}
      />
    </div>
  );
}
