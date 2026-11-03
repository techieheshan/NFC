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
  const src = read("day-parts.tsx");
  assert.ok(!/<ol[^>]*>\s*<span/.test(src), "no <span> straight inside an <ol>");
  const row = /<span className="([^"]*)">\s*<span className="([^"]*)">Left in drawer<\/span>/.exec(src);
  assert.ok(row, "the Left in drawer label is inside a wrapper span");
  assert.ok(row![1].includes("min-w-0"), "the wrapper can shrink below its longest word");
  assert.ok(row![2].includes("break-words"), "and the label wraps");
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
  const pages: string[] = [];
  const walkPages = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walkPages(path.join(d, e.name)) : e.name === "page.tsx" ? pages.push(path.relative(root, path.join(d, e.name))) : null));
  walkPages(root);
  assert.deepEqual(pages.sort(), ["document/page.tsx", "history/page.tsx", "page.tsx", "range/page.tsx"], "exactly the four routes (Release 2 added History)");
});

test("the day screen's cash flow shows the sign on the LABEL and the number without one ('− Deductions', '− Taken to bank')", () => {
  const src = read("day-parts.tsx");
  assert.ok(src.includes('label="− Deductions" value={formatMoney(report.deductions.total)}'), "Deductions: unsigned number");
  assert.ok(/label="− Taken to bank"[\s\S]{0,260}value=\{formatCents\(flow\.bankTotal\)\}/.test(src), "Taken to bank: unsigned number");
  assert.ok(!src.includes("formatDeduction"), "no signed deduction figure on the day screen");
});

test("the draft and the saved day screen run ALL their typed state through the pure reducer: they dispatch, and hold no copy of their own", () => {
  for (const file of ["day-screen.tsx", "saved-day-screen.tsx"]) {
    const src = read(file);
    // the draft runs the typed reducer itself; the saved screen runs the edit-session reducer, which wraps it (edit-session.ts)
    assert.ok(src.includes(file === "day-screen.tsx" ? "useReducer(typedReducer" : "useReducer(editSessionReducer"), `${file}: driven by the reducer`);
    for (const type of ["bf", "bankAdd", "bankRemove"]) assert.ok(src.includes(`dispatch({ type: "${type}"`), `${file} dispatches ${type}`);
    for (const gone of ["setBfText", "setBank(", "setPreparedId", "setCheckedId", "setOpenNotices", "setEditing(", "useState(\"\")"]) assert.ok(!src.includes(gone), `${file}: ${gone} is gone: nothing sets that state outside the reducer`);
    // Release 2: Prepared by / Checked by are no longer typed on the screen
    for (const type of ["prepared", "checked"]) assert.ok(!src.includes(`dispatch({ type: "${type}"`), `${file} no longer dispatches ${type}`);
  }
  assert.ok(read("day-screen.tsx").includes("notices.filter((n) => openNotices.includes(n.key))"), "only the open notices render");
});
