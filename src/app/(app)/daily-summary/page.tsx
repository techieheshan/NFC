import { redirect } from "next/navigation";

import { requireNavAccess } from "@/lib/authz";
import { formatCents } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { resolveRange } from "@/lib/daily-summary-dates";

import { loadDayBundle } from "./bundle";
import { DayScreen } from "./day-screen";
import { parseTypedState } from "./typed-state";

export const metadata = { title: "Daily Summary" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The Daily Summary, one day at a time (Release 1).
 *
 *   /daily-summary?date=YYYY-MM-DD   the day screen (today when absent, invalid or in the future)
 *   /daily-summary/range             "Several days", view only
 *   /daily-summary/document          the A4 document: Print and Download PDF
 *
 * Old links (`?from=…&to=…`) still work: the same day opens the day screen, a real range opens the range screen.
 * Bring-forward, bank lines and the two signers are typed values carried in the URL (never stored): they are
 * parsed here as hostile input and handed to the screen as its starting state.
 */
export default async function DailySummaryPage({ searchParams }: PageProps<"/daily-summary">) {
  await requireNavAccess("/daily-summary");

  const q = await searchParams;
  const rawFrom = first(q.from);
  const rawTo = first(q.to);
  if (rawFrom !== undefined || rawTo !== undefined) {
    const r = resolveRange(rawFrom, rawTo, colomboNow().date);
    if (r.from !== r.to) redirect(`/daily-summary/range?from=${r.from}&to=${r.to}`);
  }

  const b = await loadDayBundle(first(q.date) ?? rawFrom);
  const typed = parseTypedState(q, b.signers);

  // Keyed on the day: another day is a new cash book, so what was typed for this one must not follow.
  return (
    <DayScreen
      key={b.date}
      date={b.date}
      today={b.today}
      report={b.report}
      cancelled={b.cancelled}
      staff={b.staff}
      signers={b.signers}
      initial={{
        bf: typed.bringForwardCents > 0 ? formatCents(typed.bringForwardCents).replace(/,/g, "") : "",
        bank: typed.bank,
        preparedId: typed.prepared?.id ?? "",
        checkedId: typed.checked?.id ?? "",
      }}
    />
  );
}
