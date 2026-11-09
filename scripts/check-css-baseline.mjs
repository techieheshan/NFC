#!/usr/bin/env node
/**
 * Audit the BUILT CSS against the browser floor (Chrome 102).
 *
 *   npm run build && npm run check:baseline
 *
 * Chrome silently drops a declaration it does not understand, so a missing
 * feature never throws — a dialog just ends up half off the screen. Desktop
 * emulation cannot show that, so this reads what actually ships. It exits 1 on
 * anything that would break the layout, and only reports (exit 0) the features
 * that merely tune padding or sizing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), ".next", "static", "chunks");
let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".css")).map((f) => join(DIR, f));
} catch {
  console.error(`No built CSS at ${DIR} — run \`npm run build\` first.`);
  process.exit(2);
}
if (files.length === 0) { console.error("No .css chunks found."); process.exit(2); }

/** Remove every balanced `{…}` block whose header matches `headerRx`. */
function stripBlocks(text, headerRx) {
  let out = "", i = 0, removed = 0;
  const rx = new RegExp(headerRx.source, "g");
  for (;;) {
    rx.lastIndex = i;
    const m = rx.exec(text);
    if (!m) { out += text.slice(i); break; }
    out += text.slice(i, m.index);
    let k = text.indexOf("{", m.index + m[0].length - 1);
    let depth = 0;
    for (; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}" && --depth === 0) break;
    }
    removed++; i = k + 1;
  }
  return { text: out, removed };
}

const count = (css, rx) => (css.match(rx) ?? []).length;

/**
 * Opacity modifiers on theme colours (a slash and a number after the colour name). Tailwind v4 writes the plain colour first and the color-mix()
 * version inside `@supports (color: color-mix(...))`. Chrome 102 skips the guarded one, so it is left with the base rule,
 * and for a theme colour (a `var(--primary)`) that base rule is the OPAQUE colour: a "10% purple" circle is solid purple.
 * A static colour (`bg-black/40`) is precomputed to a plain alpha colour instead and has no guarded rule, so it passes. (Do not quote a tinted class name in a comment: Tailwind scans every file, comments included.)
 * Rules under `.dark` are skipped: the dark theme is opt-in and nothing switches it on (css-baseline.test.ts checks that).
 */
function flatten(css, at = [], out = []) {
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    if (css.startsWith("/*", i)) { i = css.indexOf("*/", i) + 2; continue; }
    const brace = css.indexOf("{", i), semi = css.indexOf(";", i);
    if (brace === -1 || (semi !== -1 && semi < brace)) { i = semi === -1 ? css.length : semi + 1; continue; }
    const head = css.slice(i, brace).trim();
    let depth = 0, k = brace;
    for (; k < css.length; k++) { if (css[k] === "{") depth++; else if (css[k] === "}" && --depth === 0) break; }
    const inner = css.slice(brace + 1, k);
    if (head.startsWith("@")) {
      if (!/^@(?:-webkit-)?(?:keyframes|font-face|property)/.test(head)) flatten(inner, [...at, head], out);
    } else out.push({ at, sel: head, body: inner });
    i = k + 1;
  }
  return out;
}
function splitSelectors(sel) {
  const out = []; let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Selectors with an opacity modifier whose Chrome 102 value (the rule outside the color-mix guard) is an opaque colour variable or missing. */
function opaqueModifierFallbacks(css) {
  const guard = /^@supports\s*\(\s*color:\s*color-mix/;
  const modifier = /\\\/(?:\d+(?:\.\d+)?|\\\[[^\]]*\\\])/;
  const seen = new Map();
  for (const r of flatten(css)) {
    const guarded = r.at.some((a) => guard.test(a));
    for (const sel of splitSelectors(r.sel)) {
      if (!modifier.test(sel) || sel.includes(".dark")) continue;
      const e = seen.get(sel) ?? { base: [], guarded: false };
      if (guarded) e.guarded = true; else e.base.push(r.body);
      seen.set(sel, e);
    }
  }
  const bad = [];
  for (const [sel, e] of seen) {
    if (!e.guarded) continue; // precomputed alpha colour (static colour), nothing to fall back from
    const opaque = e.base.length === 0 || e.base.some((b) => /(?:^|;)\s*[a-z-]+\s*:\s*var\(--(?!tw-)[a-z-]+\)\s*(?:;|$)/.test(b));
    if (opaque) bad.push(sel.replace(/\\/g, ""));
  }
  return bad;
}
const FAIL = [
  ["standalone translate/scale/rotate property (Chrome 104)", /(?<![-\w])(?:translate|scale|rotate):/g],
  ["svh/dvh/lvh viewport unit (Chrome 108)", /\b\d*\.?\d+(?:svh|dvh|lvh)\b/g],
];
const INFO = [
  [":has() selector (105) — cosmetic padding/sizing only", /:has\(/g],
  ["@container query (105) — cosmetic only", /@container/g],
  ["field-sizing (123) — textarea auto-grow only", /field-sizing/g],
  ["text-wrap (114) — balance/pretty only", /text-wrap/g],
];

let failed = false;
for (const file of files) {
  const css = readFileSync(file, "utf8");
  const name = file.split("/").pop();
  const problems = [];

  for (const [label, rx] of FAIL) {
    const n = count(css, rx);
    if (n) problems.push(`${n} × ${label}`);
  }

  // Colour functions Chrome 102 cannot parse are fine ONLY inside the @supports
  // blocks Tailwind wraps them in — those are skipped whole there, leaving the
  // plain hex fallback. Outside a guard they would blank the colour.
  const { text: unguarded } = stripBlocks(css, /@supports\s*\(color:\s*(?:color-mix|lab)\([^{]*\{/);
  const loose = count(unguarded, /color-mix\(|(?<![-\w])(?:lab|lch|oklab|oklch)\(/g);
  if (loose) problems.push(`${loose} × colour function outside an @supports guard (Chrome 111)`);

  const opaque = opaqueModifierFallbacks(css);
  if (opaque.length) {
    problems.push(
      `${opaque.length} × opacity modifier on a theme colour that is OPAQUE on Chrome 102 (no color-mix): ${opaque.slice(0, 6).join(", ")}${opaque.length > 6 ? ", …" : ""}. ` +
        "Use a solid token (bg-secondary, bg-muted, bg-accent, bg-destructive-soft, border-primary-line) or opacity-N.",
    );
  }

  if (/(?<![-\w])mask(?:-image|-size|-position|-repeat)?:/.test(css) && !/-webkit-mask/.test(css)) {
    problems.push("unprefixed mask without -webkit-mask (Chrome 120)");
  }

  const notes = INFO.map(([label, rx]) => [label, count(css, rx)]).filter(([, n]) => n);
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${name} (${(css.length / 1024).toFixed(0)} KB)`);
  for (const p of problems) console.log(`        ✗ ${p}`);
  for (const [label, n] of notes) console.log(`        · ${n} × ${label}`);
  if (problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
