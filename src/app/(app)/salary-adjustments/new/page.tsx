import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";

import { listPeople, listShareableExpenses, listShareableIncomes } from "../actions";
import { AdjustmentForm } from "./adjustment-form";

export const metadata = { title: "New salary adjustment" };

export default async function NewAdjustmentPage() {
  const user = await requireNavAccess("/salary-adjustments");
  if (user.role !== "ADMIN") notFound();
  const [expenses, incomes, people] = await Promise.all([listShareableExpenses(), listShareableIncomes(), listPeople()]);
  const today = colomboNow().date;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Button asChild variant="ghost" className="min-h-11"><Link href="/salary-adjustments">← Back to salary adjustments</Link></Button>
      <h1 className="text-xl font-semibold">New salary adjustment</h1>
      <AdjustmentForm expenses={expenses} incomes={incomes} people={people} today={today} />
    </div>
  );
}
