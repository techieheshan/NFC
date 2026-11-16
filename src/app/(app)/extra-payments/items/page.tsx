import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";

import { listAllItems } from "../actions";
import { ItemManager } from "./item-manager";

export const metadata = { title: "Extra payment items" };

/** The admin's price list. ADMIN only: the nav guard first, then not-found for everyone else (rule 30). */
export default async function ExtraItemsPage() {
  const user = await requireNavAccess("/extra-payments");
  if (user.role !== "ADMIN") notFound();
  const items = await listAllItems();
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Button asChild variant="ghost" className="min-h-11"><Link href="/extra-payments">← Back to extra payments</Link></Button>
      <div>
        <h1 className="text-xl font-semibold">Extra payment items</h1>
        <p className="text-muted-foreground text-sm">A new price applies to future bills only: bills already taken keep the price they were sold at. An item in use is retired, never deleted.</p>
      </div>
      <ItemManager items={items} />
    </div>
  );
}
