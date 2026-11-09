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
 *   opacity modifier on a THEME     `bg-primary/10`, `border-destructive/30`, `ring-ring/50`... Tailwind v4
 *   colour (any /N)                 compiles them to `color-mix()` (Chrome 111) and falls back to the OPAQUE
 *                                   colour before it. On the terminals the "10% purple" circle is solid purple,
 *                                   its purple icon vanishes, and a tinted error box turns solid red under red
 *                                   text. Use a SOLID token (bg-secondary, bg-muted, bg-accent,
 *                                   bg-destructive-soft, border-primary-line) or `opacity-N`.
 *                                   Static colours (black, white, the palette: `bg-black/40`, `text-red-900/80`)
 *                                   are precomputed to a plain alpha colour and are fine; the built-CSS check
 *                                   (`npm run check:baseline`) proves it on the real stylesheet.
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

// ---- opacity modifiers on theme colours --------------------------------------------------------------------------------
const THEME_TOKENS = [...readFileSync("src/app/globals.css", "utf8").matchAll(/--color-([a-z0-9-]+):\s*var\(/g)].map((m) => m[1]);
const COLOUR_UTILITY = "(?:bg|text|border(?:-[xytblrse])?|ring|ring-offset|outline|divide|fill|stroke|from|via|to|shadow|inset-shadow|drop-shadow|decoration|placeholder|accent|caret|inset-ring|scrollbar)";
const MODIFIER = "(\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])";

/** Every `<utility>-<theme colour>/<N>` token on a line, with its variants. `dark:` variants are reported separately (see below). */
export function opacityModifiers(line: string, tokens: readonly string[] = THEME_TOKENS): { token: string; dark: boolean }[] {
  const names = [...tokens, "current"].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const themed = new RegExp(`(?<![\\w/\\[-])((?:[A-Za-z0-9_\\[\\]=.*&>()-]+:)*)(-?${COLOUR_UTILITY}-(?:${names.join("|")})/${MODIFIER})(?![\\w/])`, "g");
  const arbitrary = new RegExp(`(?<![\\w/\\[-])((?:[A-Za-z0-9_\\[\\]=.*&>()-]+:)*)(-?${COLOUR_UTILITY}-\\[[^\\]]*var\\(--[^\\]]*\\]/${MODIFIER})(?![\\w/])`, "g");
  return [...line.matchAll(themed), ...line.matchAll(arbitrary)].map((m) => ({ token: m[1] + m[2], dark: /(?:^|:)dark:/.test(m[1]) }));
}

test("no theme colour carries an opacity modifier: Chrome 102 has no color-mix(), so it would turn opaque", () => {
  assert.ok(THEME_TOKENS.includes("primary") && THEME_TOKENS.includes("destructive-soft"), "the theme colours were read from globals.css");
  const offences: string[] = [];
  for (const file of walk(ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const { token, dark } of opacityModifiers(line)) {
        if (!dark) offences.push(`${file}:${i + 1}  ${token}`);
      }
    });
  }
  assert.deepEqual(
    offences,
    [],
    `\nOpacity modifiers on theme colours fall back to the OPAQUE colour on Chrome 102 (the terminals have no color-mix()):\n${offences.join("\n")}\n` +
      "Use a solid token instead: bg-secondary / bg-muted / bg-accent for a purple tint, bg-destructive-soft for an error box,\n" +
      "border-primary-line or ring-primary-line for a soft purple line, or `opacity-N` on a text-only element. bg-black/N and bg-white/N are fine.",
  );
});

test("the opacity-modifier guard can fail: it recognises tinted theme colours in every variant and form, and leaves static colours alone", () => {
  const bad = [
    'className="bg-primary/10 text-primary"', 'className="border-destructive/30"', 'className="hover:bg-primary/15"',
    'className="focus-visible:ring-ring/50"', 'className="text-muted-foreground/40"', 'className="from-primary/10 to-transparent"',
    'className="bg-primary/[0.08]"', 'className="has-[[data-slot]:focus-visible]:ring-ring/50"', 'className="bg-[var(--primary)]/10"',
    '@apply border-border outline-ring/50;', 'className="text-sidebar-foreground/80"', 'className="supports-[backdrop-filter]:bg-background/75"',
  ];
  for (const sample of bad) assert.ok(opacityModifiers(sample).some((m) => !m.dark), `should flag: ${sample}`);
  for (const fine of [
    'className="bg-black/40"', 'className="bg-white/35 border-white/60"', 'className="text-red-900/80"', 'className="w-1/2 aspect-3/4"',
    'className="text-sm/6"', 'className="bg-secondary text-primary"', 'className="opacity-40"', 'className="bg-destructive-soft"',
  ]) assert.deepEqual(opacityModifiers(fine), [], `should allow: ${fine}`);
  // dark: variants are reported but marked, because the dark theme is opt-in and nothing switches it on (next test)
  assert.deepEqual(opacityModifiers('className="dark:bg-input/30 dark:hover:bg-input/50"').map((m) => m.dark), [true, true]);
});

test("nothing switches the dark theme on, which is the only reason `dark:` opacity modifiers are tolerated", () => {
  const switches = /classList\.(?:add|toggle|replace)\(\s*["'`]dark["'`]|(?:class|className)\s*=\s*[{"'`][^"'`}]*(?<![\w:-])dark(?![\w:-])[^"'`}]*["'`]|next-themes|ThemeProvider|data-theme/;
  const offences: string[] = [];
  for (const file of walk(ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (switches.test(line)) offences.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    offences,
    [],
    `\nThe dark theme is being switched on. \`dark:\` classes were exempt from the opacity-modifier guard because nothing set .dark; ` +
      `now every dark: bg-x/N falls back to an opaque colour on Chrome 102. Replace them with solid tokens first.\n${offences.join("\n")}`,
  );
});
