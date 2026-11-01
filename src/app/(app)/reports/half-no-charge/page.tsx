import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { buildHalfNoChargeReport, parseModeFilter } from "@/lib/report-half-no-charge";
import { currentColomboMonth } from "@/lib/report-monthly-income";

import { HalfNoChargeScreen } from "./half-no-charge-report";

export const metadata = { title: "Half and No-charge months" };

const FIELD = "border-input bg-background h-11 w-full rounded-md border px-3 py-1 text-sm shadow-xs";
const ROUTE = "/reports/half-no-charge";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Half and No-charge months, for the ADMIN who reviews what staff recorded. READ-ONLY, and
 * guarded twice: the nav access for /reports, then `notFound()` for everyone but ADMIN (a refusal
 * is a not-found screen with none of the data — rule 30). Filters are searchParams, so each is a
 * fresh server render (rule 17); each is validated ONCE, and the one value is used for the query
 * and for what is shown, so junk in the address is ignored rather than rendering an empty report.
 */
export default async function HalfNoChargePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireNavAccess("/reports");
  if (user.role !== "ADMIN") notFound();

  const params = await searchParams;
  const now = currentColomboMonth();
  const asked = first(params.month);
  const parsed = asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked.split("-").map(Number) : null;
  const [year, month] = parsed ?? [now.year, now.month];

  const report = await buildHalfNoChargeReport({
    year,
    month,
    mode: parseModeFilter(first(params.mode)),
    staffId: first(params.staff) ?? null,
  });
  const monthValue = `${year}-${String(month).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-1 h-11 px-3">
          <Link href="/reports">&larr; Reports</Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">Half and No-charge months</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What staff recorded at the counter, for review. By the date it was recorded — the same
          basis as the payslips. Cancelled receipts are shown greyed and counted nowhere.
        </p>
      </div>

      {/* Keyed on the filter signature (AGENTS rule 17): "This month" is a soft navigation, and React applies a
          select's defaultValue only when the select MOUNTS, so without a key the selects would keep showing
          the old person and kind while the report below had already reset. A new signature remounts the form. */}
      <form
        key={`${monthValue}|${report.staffId ?? ""}|${report.mode ?? ""}`}
        method="get"
        action={ROUTE}
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-4 sm:items-end"
      >
        <div className="space-y-1.5">
          <label htmlFor="month" className="block text-sm font-medium">Month</label>
          <input id="month" name="month" type="month" className={FIELD} defaultValue={monthValue} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="staff" className="block text-sm font-medium">Taken by</label>
          <select id="staff" name="staff" className={FIELD} defaultValue={report.staffId ?? ""}>
            <option value="">Everyone</option>
            {report.staffOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="mode" className="block text-sm font-medium">Show</label>
          <select id="mode" name="mode" className={FIELD} defaultValue={report.mode === "HALF" ? "half" : report.mode === "NO_CHARGE" ? "nocharge" : ""}>
            <option value="">Half and No charge</option>
            <option value="half">Half months only</option>
            <option value="nocharge">No-charge months only</option>
          </select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="h-12 flex-1">Show</Button>
          <Button asChild variant="ghost" className="h-12"><Link href={ROUTE}>This month</Link></Button>
        </div>
      </form>

      <HalfNoChargeScreen report={report} />
    </div>
  );
}
