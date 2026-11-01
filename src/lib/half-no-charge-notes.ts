/**
 * The two notes under the Half and No-charge list, as plain sentences (pure, so the WORDING is tested).
 *
 * What the figures cover, exactly: `rowCount` is every row in the filter INCLUDING cancelled ones, but the
 * per-person counts and totals leave cancelled rows out, so the note says "all <rowCount − cancelledCount>
 * non-cancelled rows". `cancelledCount` is also every cancelled row in the filter; only some may be among the
 * newest `cap` that the list shows, so the cancelled note counts the ones actually SHOWN.
 */
export type CapFacts = {
  rowCount: number;
  cancelledCount: number;
  /** Rows listed (at most `cap`). */
  shown: number;
  /** Cancelled rows among the listed ones. */
  shownCancelled: number;
  cap: number;
};

const rows = (n: number) => (n === 1 ? "row" : "rows");
const isAre = (n: number) => (n === 1 ? "is" : "are");

export function capNotes(f: CapFacts): { cap: string | null; cancelled: string | null } {
  const live = f.rowCount - f.cancelledCount;
  const cap =
    f.rowCount > f.shown
      ? `Showing the newest ${f.cap} of ${f.rowCount} rows. The Half and No-charge counts and amounts above cover all ${live} non-cancelled ${rows(live)}. Choose one person or one kind to narrow the list.`
      : null;

  let cancelled: string | null = null;
  if (f.cancelledCount > 0) {
    const hidden = f.cancelledCount - f.shownCancelled;
    if (hidden === 0) {
      cancelled = `${f.cancelledCount} cancelled ${f.cancelledCount === 1 ? "row is" : "rows are"} shown greyed and counted nowhere.`;
    } else if (f.shownCancelled === 0) {
      cancelled = `${hidden} cancelled ${rows(hidden)} in this filter ${isAre(hidden)} older than the newest ${f.cap} and not shown; counted nowhere.`;
    } else {
      cancelled = `${f.shownCancelled} cancelled ${f.shownCancelled === 1 ? "row is" : "rows are"} shown greyed and counted nowhere; ${hidden} more cancelled ${rows(hidden)} ${isAre(hidden)} older than the newest ${f.cap} and not shown.`;
    }
  }
  return { cap, cancelled };
}
