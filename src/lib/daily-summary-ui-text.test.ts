import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Daily Summary R1: sentences the screens must carry, checked in the source (there is no browser in the
 * unit tests; the rendered markup of the same sentences is checked in daily-summary-r1-pages.test.ts).
 */

const root = path.join(process.cwd(), "src", "app", "(app)", "daily-summary");
const read = (...p: string[]) => readFileSync(path.join(root, ...p), "utf8");

test("the bank sheet says 'Don't type account numbers.' right under the Note field", () => {
  const src = read("bank-sheet.tsx");
  assert.ok(src.includes(`"Don't type account numbers."`));
  const note = src.indexOf('id="bank-note"');
  const warn = src.indexOf("{BANK_NOTE_WARNING}");
  const buttons = src.indexOf("Add to bank list");
  assert.ok(note > 0 && warn > note && warn < buttons, "between the Note input and the buttons");
});
