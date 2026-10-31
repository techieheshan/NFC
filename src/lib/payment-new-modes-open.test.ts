import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * DECISION (Kavin, AGENTS.md "Decisions recorded from the 3A review"): Full, Half and No charge
 * are open to everyone who can use the screen, for any month, with no note. Who can open the NEW
 * screens at all is ONE constant (PAYMENT_NEW_ROLES in access.ts, ADMIN only until the menu
 * switch). So no other file in payment-new may look at a role: a role check in the month detail,
 * the cards or the actions would quietly turn a mode off for staff after the switch.
 */

const DIR = path.join(process.cwd(), "src", "app", "(app)", "payment-new");

/** Source with comments removed, so a sentence about ADMIN in a doc comment is not a role check. */
function code(file: string): string {
  return readFileSync(path.join(DIR, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

test("no file under payment-new except access.ts looks at a role", () => {
  const files = readdirSync(DIR, { recursive: true, encoding: "utf8" })
    .map(String)
    .filter((f) => /\.tsx?$/.test(f) && path.basename(f) !== "access.ts");
  assert.ok(files.length >= 8, `expected the screen's files, found ${files.join(", ")}`);
  for (const f of files) {
    assert.doesNotMatch(code(f), /\b(ADMIN|STAFF|TEACHER|UserRole|OPERATIONAL_ROLES)\b|\.role\b|\brole\s*[=!]==/, `${f} must not check a role`);
  }
});

test("the month detail offers all three modes unconditionally", () => {
  const src = code("month-detail.tsx");
  for (const label of ['"Full"', '"Half month"', '"No charge"']) assert.ok(src.includes(label), label);
});
