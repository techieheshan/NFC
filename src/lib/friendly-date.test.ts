import { test } from "node:test";
import assert from "node:assert/strict";

import { friendlyDate } from "@/lib/friendly-date";

test("friendlyDate: a plain calendar date reads as '8 Aug 2026' — day without a leading zero", () => {
  assert.equal(friendlyDate("2026-08-08"), "8 Aug 2026");
  assert.equal(friendlyDate("2026-11-10"), "10 Nov 2026");
  assert.equal(friendlyDate("2027-01-01"), "1 Jan 2027");
  assert.equal(friendlyDate("2026-12-31"), "31 Dec 2026");
});

test("friendlyDate: the day never moves with the machine's timezone (string work, no Date)", () => {
  const before = process.env.TZ;
  try {
    for (const tz of ["UTC", "Asia/Colombo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      assert.equal(friendlyDate("2026-10-31"), "31 Oct 2026", tz);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test("friendlyDate: anything that is not a plain YYYY-MM-DD is returned unchanged", () => {
  for (const bad of ["", "soon", "2026-13-01", "2026-00-10", "2026-08-00", "2026-08-32", "2026-8-8", "2026-08-08T10:00:00Z"]) {
    assert.equal(friendlyDate(bad), bad, bad);
  }
});
