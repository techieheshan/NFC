import { test } from "node:test";
import assert from "node:assert/strict";

import { capNotes } from "@/lib/half-no-charge-notes";

/*
 * Job 5 review F1: the notes under the admin's Half / No-charge list say exactly what the figures cover.
 * rowCount includes cancelled rows; the counts and totals do not — so the sentences are tested, not only the numbers.
 */

const f = (rowCount: number, cancelledCount: number, shown: number, shownCancelled: number) => ({ rowCount, cancelledCount, shown, shownCancelled, cap: 300 });

test("not capped, nothing cancelled: no note at all", () => {
  assert.deepEqual(capNotes(f(13, 0, 13, 0)), { cap: null, cancelled: null });
});

test("not capped, some cancelled: the original wording, unchanged", () => {
  assert.equal(capNotes(f(13, 2, 13, 2)).cancelled, "2 cancelled rows are shown greyed and counted nowhere.");
  assert.equal(capNotes(f(7, 1, 7, 1)).cancelled, "1 cancelled row is shown greyed and counted nowhere.");
  assert.equal(capNotes(f(13, 2, 13, 2)).cap, null);
});

test("capped, 305 live + 1 cancelled (the cancelled one is among the newest 300): 306 rows, the counts cover 305", () => {
  const n = capNotes(f(306, 1, 300, 1));
  assert.equal(n.cap, "Showing the newest 300 of 306 rows. The counts and totals above cover all 305 non-cancelled rows. Choose one person or one kind to narrow the list.");
  assert.equal(n.cancelled, "1 cancelled row is shown greyed and counted nowhere.");
});

test("capped, 4 cancelled rows are OLDER than the newest 300: they are not claimed to be shown", () => {
  const n = capNotes(f(304, 4, 300, 0));
  assert.equal(n.cap, "Showing the newest 300 of 304 rows. The counts and totals above cover all 300 non-cancelled rows. Choose one person or one kind to narrow the list.");
  assert.equal(n.cancelled, "4 cancelled rows in this filter are older than the newest 300 and not shown; counted nowhere.");
  assert.doesNotMatch(n.cancelled!, /shown greyed/);
});

test("capped, some cancelled rows shown and some past the cap: both numbers, honestly", () => {
  const n = capNotes(f(310, 5, 300, 2));
  assert.equal(n.cancelled, "2 cancelled rows are shown greyed and counted nowhere; 3 more cancelled rows are older than the newest 300 and not shown.");
  assert.match(n.cap!, /cover all 305 non-cancelled rows\./);
});

test("singular and plural: 'row' for one", () => {
  assert.match(capNotes(f(301, 300, 300, 300)).cap!, /cover all 1 non-cancelled row\. /);
  assert.equal(capNotes(f(301, 1, 300, 0)).cancelled, "1 cancelled row in this filter is older than the newest 300 and not shown; counted nowhere.");
});

test("singular and plural in the MIXED note (some shown, some past the cap): each half is inflected on its own number", () => {
  // one shown, one hidden: both singular
  assert.equal(capNotes(f(302, 2, 300, 1)).cancelled, "1 cancelled row is shown greyed and counted nowhere; 1 more cancelled row is older than the newest 300 and not shown.");
  // two shown, one hidden: plural then singular
  assert.equal(capNotes(f(303, 3, 300, 2)).cancelled, "2 cancelled rows are shown greyed and counted nowhere; 1 more cancelled row is older than the newest 300 and not shown.");
  // one shown, three hidden: singular then plural
  assert.equal(capNotes(f(304, 4, 300, 1)).cancelled, "1 cancelled row is shown greyed and counted nowhere; 3 more cancelled rows are older than the newest 300 and not shown.");
});

test("singular and plural in the other two cancelled notes, and in the cap note", () => {
  assert.equal(capNotes(f(40, 1, 40, 1)).cancelled, "1 cancelled row is shown greyed and counted nowhere.");
  assert.equal(capNotes(f(40, 3, 40, 3)).cancelled, "3 cancelled rows are shown greyed and counted nowhere.");
  assert.equal(capNotes(f(303, 3, 300, 0)).cancelled, "3 cancelled rows in this filter are older than the newest 300 and not shown; counted nowhere.");
  assert.match(capNotes(f(303, 1, 300, 0)).cap!, /cover all 302 non-cancelled rows\. /);
});

test("the cap note never repeats the raw row count as what the totals cover", () => {
  for (const [rows, cancelled] of [[306, 1], [304, 4], [400, 100]] as const) {
    const cap = capNotes(f(rows, cancelled, 300, 0)).cap!;
    assert.doesNotMatch(cap, new RegExp(`cover all ${rows} `), `${rows} rows, ${cancelled} cancelled`);
  }
});
