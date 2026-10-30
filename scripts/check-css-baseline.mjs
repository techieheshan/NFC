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
