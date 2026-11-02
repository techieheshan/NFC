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

test("the money-flow lists keep only <li> directly inside <ol> (the vertical line lives on a wrapper), and the Left in drawer row can shrink and wrap", () => {
  const src = read("day-screen.tsx");
  assert.ok(!/<ol[^>]*>\s*<span/.test(src), "no <span> straight inside an <ol>");
  const left = src.slice(src.indexOf("Left in drawer"), src.indexOf("{formatCents(flow.left)}"));
  assert.ok(left.includes("min-w-0") && left.includes("break-words"), "the label shrinks and wraps");
  assert.ok(src.includes('shrink-0 text-2xl font-semibold tabular-nums">{formatCents(flow.left)}'), "the number stays whole");
});

test("no file in the Daily Summary folders is named like a Next.js route file by accident (a `layout.ts` broke the build once: Next reads it as a route layout)", async () => {
  const { readdirSync } = await import("node:fs");
  const reserved = new Set(["layout", "template", "default", "error", "global-error", "loading", "not-found", "route", "forbidden", "unauthorized", "instrumentation", "middleware", "proxy"]);
  const found: string[] = [];
  const walk = (d: string) =>
    readdirSync(d, { withFileTypes: true }).forEach((e) => {
      if (e.isDirectory()) return walk(path.join(d, e.name));
      const base = e.name.replace(/\.(tsx?|jsx?|css)$/, "");
      if (reserved.has(base)) found.push(path.join(d, e.name));
    });
  walk(root);
  assert.deepEqual(found, []);
  const pages = [];
  const walkPages = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walkPages(path.join(d, e.name)) : e.name === "page.tsx" ? pages.push(path.relative(root, path.join(d, e.name))) : null));
  walkPages(root);
  assert.deepEqual(pages.sort(), ["document/page.tsx", "page.tsx", "range/page.tsx"], "exactly the three routes");
});
