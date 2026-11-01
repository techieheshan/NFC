import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Job 4: the corner receipt icon on the new Start screen opens "Last 10 receipts" (it opened the
 * old /receipts page in job 2), and the new page's back arrow returns to Start.
 */

const dir = path.join(process.cwd(), "src", "app", "(app)", "payment-new");
const start = readFileSync(path.join(dir, "start-screen.tsx"), "utf8");
const page = readFileSync(path.join(dir, "receipts", "page.tsx"), "utf8");

test("the Start screen's receipt icon links to /payment-new/receipts, and names it", () => {
  assert.match(start, /href="\/payment-new\/receipts"/);
  assert.match(start, /aria-label="Last 10 receipts"/);
});

test("the Start screen no longer links to the old /receipts page", () => {
  assert.doesNotMatch(start, /href="\/receipts"/);
  assert.doesNotMatch(start, /href=\{?["'`]\/receipts/);
});

test("the receipts page's back arrow returns to Start", () => {
  assert.match(page, /href="\/payment-new"\s+aria-label="Back to Start"/);
});
