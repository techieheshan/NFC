import { redirect } from "next/navigation";

import { requireNavAccess } from "@/lib/authz";
import { decimalToCents, formatCents } from "@/lib/cents";
import { colomboNow } from "@/lib/colombo-time";
import { dayLabelShort, resolveRange } from "@/lib/daily-summary-dates";
import { liveFromBundle } from "@/lib/saved-day/live";
import { loadSavedDayAs } from "@/lib/saved-day/store";

import { loadDayBundle } from "./bundle";
import { DayScreen } from "./day-screen";
import { NOTICE_TEXT, noticeKeys } from "./notices";
import { SavedDayScreen } from "./saved-day-screen";
import { parseTypedState } from "./typed-state";

export const metadata = { title: "Daily Summary" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The Daily Summary, one day at a time.
 *
 *   /daily-summary?date=YYYY-MM-DD   the day screen (today when absent, invalid or in the future)
 *   /daily-summary/range             "Several days", view only
 *   /daily-summary/document          the A4 document
 *   /daily-summary/history           the saved days of a month
 *
 * A day that was SAVED (Release 2) opens as the frozen version (`SavedDayScreen`); any other day is a draft (`DayScreen`): bring-forward
 * and bank lines are typed values carried in the URL (parsed here as hostile input) until someone taps "Save day". The live numbers are
 * loaded ONCE here and handed to the saved-day read, which compares the frozen day with them instead of reading them again.
 * Old links (`?from=…&to=…`) still work: the same day opens the day screen, a real range opens the range screen. The `prep` and `chk`
 * parameters of Release 1 are ignored.
 */
export default async function DailySummaryPage({ searchParams }: PageProps<"/daily-summary">) {
  const user = await requireNavAccess("/daily-summary");

  const q = await searchParams;
  const rawFrom = first(q.from);
  const rawTo = first(q.to);
  if (rawFrom !== undefined || rawTo !== undefined) {
    const r = resolveRange(rawFrom, rawTo, colomboNow().date);
    if (r.from !== r.to) redirect(`/daily-summary/range?from=${r.from}&to=${r.to}`);
  }

  const b = await loadDayBundle(first(q.date) ?? rawFrom);
  const read = await loadSavedDayAs(user, b.date, liveFromBundle(b));
  const dateText = dayLabelShort(b.date);

  if (read.saved) {
    // Keyed on the day, its version AND whether it is checked: a new version or a new check is a new screen (rule 17), never props synced into state.
    return (
      <SavedDayScreen
        key={`${b.date}-v${read.saved.version}-${read.saved.check ? "checked" : "open"}`}
        date={b.date}
        today={b.today}
        dateText={dateText}
        saved={read.saved}
        liveDiffs={read.liveDiffs}
        liveUnreadable={read.liveUnreadable}
        live={{ collected: decimalToCents(b.report.totalCollected), deductions: decimalToCents(b.report.deductions.total) }}
        doners={b.signers.prepared}
        admins={b.signers.checked}
      />
    );
  }

  const typed = parseTypedState(q, b.signers);
  // Keyed on the day: another day is a new cash book, so what was typed for this one must not follow.
  return (
    <DayScreen
      key={b.date}
      date={b.date}
      today={b.today}
      dateText={dateText}
      report={b.report}
      cancelled={b.cancelled}
      staff={b.staff}
      doners={b.signers.prepared}
      notices={noticeKeys(typed, q.notice).map((k) => ({ key: k, text: NOTICE_TEXT[k] }))}
      initial={{
        bf: typed.bringForwardCents > 0 ? formatCents(typed.bringForwardCents).replace(/,/g, "") : "",
        bank: typed.bank,
      }}
      hint={read.hint}
      unreadable={read.unreadable}
    />
  );
}
