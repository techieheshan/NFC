import Link from "next/link";

import { Button } from "@/components/ui/button";
import { requireNavAccess } from "@/lib/authz";
import { colomboNow } from "@/lib/colombo-time";

import { loadDailySummary } from "./actions";
import { SummaryScreen } from "./summary-screen";

export const metadata = { title: "Daily Summary" };

const FIELD = "border-input bg-background h-9 rounded-md border px-3 py-1 text-sm shadow-xs";

function toStr(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw && raw !== "" ? raw : undefined;
}

export default async function DailySummaryPage({
  searchParams,
}: PageProps<"/daily-summary">) {
  await requireNavAccess("/daily-summary");

  const params = await searchParams;
  const today = colomboNow().date;
  const from = toStr(params.from) ?? today;
  const to = toStr(params.to) ?? today;

  const report = await loadDailySummary(from, to);

  const filterUi = (
    <form method="get" className="bg-muted/40 flex flex-wrap items-end gap-3 rounded-xl border p-4">
      <div className="space-y-1.5">
        <label htmlFor="from" className="block text-sm font-medium">From</label>
        <input id="from" name="from" type="date" className={FIELD} defaultValue={report.from} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="to" className="block text-sm font-medium">To</label>
        <input id="to" name="to" type="date" className={FIELD} defaultValue={report.to} />
      </div>
      <Button type="submit" variant="secondary">Apply</Button>
      {(report.from !== today || report.to !== today) && (
        <Button asChild variant="ghost">
          <Link href="/daily-summary">Today</Link>
        </Button>
      )}
    </form>
  );

  return <SummaryScreen report={report} filterUi={filterUi} />;
}
