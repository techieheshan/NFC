import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireNavAccess } from "@/lib/authz";
import { formatCents } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { dayLabelShort } from "@/lib/daily-summary-dates";
import { retentionCutoff } from "@/lib/saved-day/retention";
import { savedByText } from "@/lib/saved-day/history-text";
import { loadHistoryAs } from "@/lib/saved-day/store";
import { HISTORY_NOTE, NOT_CHECKED_CHIP } from "@/lib/saved-day/texts";

import { Chip } from "../day-parts";

export const metadata = { title: "Daily Summary history" };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shiftMonth = (m: string, delta: number) => {
  const i = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + delta;
  return `${String(Math.floor(i / 12)).padStart(4, "0")}-${String((i % 12) + 1).padStart(2, "0")}`;
};

/**
 * The saved days of one month (ADMIN and STAFF, through the nav guard; a TEACHER gets not-found). The month is validated once
 * (`resolveMonth`, junk means the current month). Opening this page also runs the lazy purge of days older than 3 months, BEFORE it reads.
 * Server-rendered, no client JavaScript: the month chips are links (a filter is a searchParam, rule 17).
 */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireNavAccess("/daily-summary");
  const q = await searchParams;
  const h = await loadHistoryAs(user, first(q.month));
  const today = colomboNow().date;
  const current = today.slice(0, 7);
  const oldest = retentionCutoff(today).slice(0, 7);
  // the months that can hold saved days (this one and the three before it), plus the one being looked at
  const months = [current, shiftMonth(current, -1), shiftMonth(current, -2), shiftMonth(current, -3)].filter((m) => m >= oldest);
  if (!months.includes(h.month)) months.push(h.month);
  const rows = h.rows;

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 pb-8">
      <Link href="/daily-summary" className="text-primary flex min-h-11 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline">
        <ChevronLeft className="size-4" aria-hidden /> Daily Summary
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">History</h1>

      <nav aria-label="Month" className="flex flex-wrap gap-2">
        {months.map((m) => (
          <Link
            key={m} href={`/daily-summary/history?month=${m}`} aria-current={m === h.month ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-md border px-3 text-sm font-medium ${m === h.month ? "bg-primary text-primary-foreground border-primary" : "border-input bg-background"}`}
          >
            {monthLabel(m)}
          </Link>
        ))}
      </nav>

      <h2 className="text-base font-semibold">{monthLabel(h.month)}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">No saved days in this month.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((r) => (
            <li key={r.date}>
              <Link href={`/daily-summary?date=${r.date}`} className="block min-h-11 space-y-1 px-4 py-3">
                <span className="flex items-center justify-between gap-3">
                  <span className="font-medium">{dayLabelShort(r.date)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Chip tone="grey">v{r.version}</Chip>
                    {r.checked ? <Chip tone="green">Checked</Chip> : <Chip tone="amber">{NOT_CHECKED_CHIP}</Chip>}
                  </span>
                </span>
                <span className="text-muted-foreground block break-words text-xs">{savedByText(r)}</span>
                <span className="flex justify-between gap-3 text-sm">
                  <span><span className="text-muted-foreground">Collected </span><span className="tabular-nums">{formatCents(r.collected)}</span></span>
                  <span><span className="text-muted-foreground">Net </span><span className="tabular-nums">{formatCents(r.net)}</span></span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{HISTORY_NOTE}</p>
    </div>
  );
}
