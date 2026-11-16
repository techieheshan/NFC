import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";

import { listAllCategories } from "../actions";
import { CategoryManager } from "./category-manager";

export const metadata = { title: "Income categories" };

/** ADMIN only. The nav guard first, then not-found for everyone else (rule 30: a refusal is proven by what comes back). */
export default async function IncomeCategoriesPage() {
  const user = await requireNavAccess("/other-incomes");
  if (user.role !== "ADMIN") notFound();
  const categories = await listAllCategories();

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Button asChild variant="ghost" className="min-h-11"><Link href="/other-incomes">← Back to other incomes</Link></Button>
      <div>
        <h1 className="text-xl font-semibold">Income categories</h1>
        <p className="text-muted-foreground text-sm">A category in use is retired, never deleted, so old incomes keep their name.</p>
      </div>
      <CategoryManager categories={categories} />
    </div>
  );
}
