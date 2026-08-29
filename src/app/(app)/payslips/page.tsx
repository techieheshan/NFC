import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";

import { loadPayslips } from "./actions";
import { PayslipsScreen } from "./payslips-screen";

export const metadata = { title: "Payslips" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}

export default async function PayslipsPage({ searchParams }: PageProps<"/payslips">) {
  await requireNavAccess("/payslips");

  const params = await searchParams;
  // "YYYY-MM" from a month input.
  const asked = toStr(params.month);
  const [y, m] = asked && /^\d{4}-\d{2}$/.test(asked)
    ? asked.split("-").map(Number)
    : [undefined, undefined];

  const result = await loadPayslips({ year: y, month: m });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-md rounded-xl border p-6 text-center">
        <p className="font-medium">Payslip unavailable</p>
        <p className="text-muted-foreground mt-1 text-sm">{result.error}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/payslips">Back</Link>
        </Button>
      </div>
    );
  }

  const { view } = result;
  const current = `${view.report.year}-${String(view.report.month).padStart(2, "0")}`;
  const thisMonth = colomboNow().date.slice(0, 7);

  const filterUi = view.canPickMonth ? (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <div className="space-y-1.5">
        <label htmlFor="month" className="block text-sm font-medium">Month</label>
        <input id="month" name="month" type="month" className={FIELD} defaultValue={current} />
      </div>
      <Button type="submit" variant="secondary">Show</Button>
      {current !== thisMonth && (
        <Button asChild variant="ghost">
          <Link href="/payslips">This month</Link>
        </Button>
      )}
    </form>
  ) : (
    <p className="bg-secondary text-secondary-foreground rounded-lg px-4 py-3 text-sm">
      Payslips are released one month in arrears, so you are seeing{" "}
      <strong>{view.lockedMonthLabel}</strong>. Earlier months and other teachers
      are not available here.
    </p>
  );

  return <PayslipsScreen view={view} filterUi={filterUi} />;
}
