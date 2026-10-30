import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser floor, enforced in the source.
 *
 * The oldest terminal runs Chrome 102. Chrome silently DROPS a CSS declaration
 * it does not understand, so a feature that is missing there does not fail — the
 * dialog just sits half off the screen. Desktop Chrome cannot reproduce that, so
 * these are guarded here instead of discovered on the counter.
 *
 *   translate-* / scale-* / rotate-*   Tailwind v4 emits the standalone
 *                                      `translate`/`scale`/`rotate` properties
 *                                      (Chrome 104). Centre with flex; transform
 *                                      by writing `transform` explicitly.
 *   svh / dvh / lvh                    viewport units (Chrome 108). A dialog's
 *                                      own `max-h-full` bounds it already.
 *
 * `:has()`, container queries and `field-sizing` are NOT banned: where they are
 * used they only tune padding or sizing, and the layout works without them.
 */
const ROOT = "src";

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.includes("/generated/")) yield p;
  }
}

/** Tailwind scans comments too, so a banned class mentioned in prose still ships. */
const BANNED: { name: string; rx: RegExp }[] = [
  {
    name: "standalone-transform utility (translate-*, scale-*, rotate-*)",
    // A Tailwind token: preceded by a quote/space/colon/bracket, not part of another word.
    rx: /(?<![\w-])-?(?:translate|scale|rotate)(?:-[xyz])?-(?:\d|px|full|\[|[a-z]*\/\d)/,
  },
  { name: "svh/dvh/lvh unit", rx: /(?<![\w-])(?:\d+(?:\.\d+)?|min-h-|max-h-|h-)(?:svh|dvh|lvh)\b|\[\d+(?:svh|dvh|lvh)\]/ },
];

test("no source file uses a CSS feature Chrome 102 silently ignores", () => {
  const offences: string[] = [];
  for (const file of walk(ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const { name, rx } of BANNED) {
        if (rx.test(line)) offences.push(`${file}:${i + 1}  ${name}\n      ${line.trim().slice(0, 110)}`);
      }
    });
  }
  assert.deepEqual(offences, [], `\n${offences.join("\n")}`);
});

test("the guard itself can fail: it recognises each banned pattern", () => {
  const samples = [
    'className="fixed -translate-x-1/2"', 'className="scale-95"', 'className="rotate-180"',
    'className="translate-y-px"', 'className="max-h-[90svh]"', 'className="min-h-svh"', 'height: 100dvh',
  ];
  for (const sample of samples) {
    assert.ok(BANNED.some((b) => b.rx.test(sample)), `should flag: ${sample}`);
  }
  for (const fine of ['className="zoom-in-95"', 'transform: translateY(1px)', 'className="min-h-screen"', 'className="max-h-[85%]"']) {
    assert.ok(!BANNED.some((b) => b.rx.test(fine)), `should allow: ${fine}`);
  }
});

test("the dialog panel cannot be widened by its contents", () => {
  // A flex item and a grid column are both as wide as their widest child's
  // min-content unless told otherwise. A fixed-width child (the 384px receipt
  // preview) made the reprint dialog's column 384px inside a 328px panel, which
  // pushed the TOTAL and the Close button off a 360px screen.
  const src = readFileSync("src/components/ui/dialog.tsx", "utf8");
  assert.match(src, /\bmin-w-0\b/, "the panel must be allowed to shrink below its content");
  assert.match(src, /grid-cols-\[minmax\(0,1fr\)\]/, "the single column must be allowed to shrink below its content");
});
