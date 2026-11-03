import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * F2: after a save, edit, check or re-save went through, the action buttons stay OFF until the screen shows the new version, so a quick
 * second tap cannot produce a false conflict or "Already checked".
 *
 * This is a STRUCTURAL test (there is no DOM in the test setup): it reads the screens' source and requires every path that finishes a
 * write to set the `settled` state, and every action surface to honour it. The behaviour itself was driven in a real browser (see the
 * Release 2 evidence); this test is what stops a later edit from quietly dropping one of the links.
 */

const DIR = path.join(process.cwd(), "src/app/(app)/daily-summary");
const src = (f: string) => readFileSync(path.join(DIR, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
const day = src("day-screen.tsx");
const saved = src("saved-day-screen.tsx");
const save = src("save-sheet.tsx");
const check = src("check-sheet.tsx");
const page = src("page.tsx");

test("F2: both sheets tell the screen the write went through BEFORE they close and refresh", () => {
  for (const [name, s] of [["save-sheet", save], ["check-sheet", check]] as const) {
    assert.match(s, /if \(r\.ok\) \{\s*onSaved\(\);\s*router\.refresh\(\);\s*onClose\(\);/, `${name}: onSaved() runs first on success`);
    const refusal = s.slice(s.indexOf("} else {", s.indexOf("if (r.ok)")));
    assert.ok(!refusal.slice(0, 120).includes("onSaved"), `${name}: a refusal never settles the screen`);
  }
});

test("F2: every sheet a screen opens is wired to settle that screen", () => {
  // each JSX element, from its tag to its closing "/>" at the end of a line
  const element = (s: string, tag: string) => (s.match(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`, "g")) ?? []);
  const settles = (el: string) => el.includes("onSaved={() => setSettled(true)}");
  assert.deepEqual(element(day, "SaveSheet").map(settles), [true], "the draft's Save sheet");
  assert.deepEqual(element(saved, "SaveSheet").map(settles), [true], "the re-save sheet");
  assert.deepEqual(element(saved, "CheckSheet").map(settles), [true], "the check sheet");
});

test("F2: the edit's own save settles the screen before it asks for the refresh", () => {
  assert.match(saved, /if \(r\.ok\) \{\s*setSettled\(true\);\s*router\.refresh\(\);/);
});

test("F2: every action on the draft screen is off while settled", () => {
  assert.match(day, /const off = blockReason !== null \|\| settled;/);
  assert.match(day, /disabled=\{off\} onClick=\{\(\) => setSaveSheet\(true\)\}/, "Save day");
  assert.match(day, /href=\{off \? null : docHref\("print"\)\}/, "Print");
  assert.match(day, /href=\{off \? null : docHref\("pdf"\)\}/, "Download PDF");
  assert.match(day, /disabled=\{bank\.length >= MAX_BANK_LINES \|\| unreadable \|\| settled\}/, "Take money to bank");
});

test("F2: every action on the saved screen is off while settled", () => {
  assert.match(saved, /onClick=\{cancelEdit\} disabled=\{settled \|\| pending\}/, "Cancel");
  assert.match(saved, /disabled=\{pending \|\| settled \|\| editBlock !== null\}/, "Save changes");
  assert.match(saved, /sessionDispatch\(\{ type: "start" \}\)\} disabled=\{settled\}/, "Edit");
  assert.match(saved, /disabled=\{saved\.check !== null \|\| settled\}/, "Admin check");
  assert.match(saved, /href=\{settled \? null : docHref\("print"\)\}/, "Print");
  assert.match(saved, /href=\{settled \? null : docHref\("pdf"\)\}/, "Download PDF");
  assert.match(saved, /onClick=\{\(\) => setSheet\("resave"\)\} disabled=\{settled\}/, "Re-save with live numbers");
  assert.match(saved, /MAX_BANK_LINES \|\| settled\}/, "Take money to bank (edit mode)");
});

test("F2: the saved screen is a fresh mount when the version OR the check changes (so settled resets by itself)", () => {
  assert.match(page, /key=\{`\$\{b\.date\}-v\$\{read\.saved\.version\}-\$\{read\.saved\.check \? "checked" : "open"\}`\}/);
});
