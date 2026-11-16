import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";

import { getOneOffMaxCents, listClassOptions, listSellableItems } from "./actions";
import { SaleScreen } from "./sale-screen";

export const metadata = { title: "Extra payments" };

/** The counter screen for things that are not class fees: pick items, optionally a student and a class, take the payment, print "XA-" receipt. */
export default async function ExtraPaymentsPage() {
  const user = await requireNavAccess("/extra-payments");
  const [items, classes, oneOffMaxCents] = await Promise.all([listSellableItems(), listClassOptions(), getOneOffMaxCents()]);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Extra payments</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11"><Link href="/extra-payments/receipts">Receipts</Link></Button>
          {user.role === "ADMIN" && <Button asChild variant="outline" className="min-h-11"><Link href="/extra-payments/items">Item list</Link></Button>}
        </div>
      </div>
      <SaleScreen items={items} classes={classes} oneOffMaxCents={oneOffMaxCents} />
    </div>
  );
}
