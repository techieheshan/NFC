/**
 * The fonts the sheets are drawn in, and the check that they are REALLY there before the PDF is made.
 *
 * Why: the PDF is a picture of the sheets, drawn by html2canvas inside a cloned page. If the webfonts have not loaded there,
 * the browser silently draws the fallback (a serif) and the PDF no longer matches the print. A wrong-looking PDF that nobody
 * notices is worse than a message, so: load every family the sheet uses (Geist, and Noto Sans Sinhala when the sheets contain
 * Sinhala) at every weight it uses, wait a short while, and if anything is still missing make NO PDF at all.
 *
 * Pure over a small `FontSetLike`, so it is tested with fakes; make-pdf.ts hands it `document.fonts`, and the cloned document's.
 */

/** Weights the sheet's stylesheet uses (regular, semi-bold, bold). */
export const SHEET_FONT_WEIGHTS = [400, 600, 700] as const;

/** Short on purpose: the fonts are already on the page that is showing the sheets, so a longer wait only hides a real failure. */
export const FONT_TIMEOUT_MS = 5000;

export type FontFaceLike = { family: string; status: string };

export type FontSetLike = {
  ready: Promise<unknown>;
  load(font: string, text?: string): Promise<unknown[]>;
  check(font: string, text?: string): boolean;
  [Symbol.iterator](): Iterator<FontFaceLike>;
};

export class SheetFontsError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`fonts not available for the PDF: ${missing.join(", ")}`);
    this.name = "SheetFontsError";
    this.missing = missing;
  }
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset"]);
const SINHALA_CHARS = /[඀-෿]/;
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

/**
 * The NAMED families of a CSS font-family list: no generic families, no "… Fallback" faces (next/font's size-adjusted local
 * stand-ins, which are never webfonts to load).
 */
export function sheetFamilies(fontFamilyList: string): string[] {
  const out: string[] = [];
  for (const raw of fontFamilyList.split(",")) {
    const name = unquote(raw);
    if (name === "" || GENERIC.has(name.toLowerCase()) || /\sFallback$/i.test(name)) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const spec = (weight: number, family: string) => `${weight} 13px "${family}"`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve("timeout"), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Resolves when every needed family is loaded at every weight; throws `SheetFontsError` naming what is not (never loaded,
 * failed to load, or still loading after `timeoutMs`). A family the sheet does not need is not required: Noto Sans Sinhala only
 * when the sheets actually contain Sinhala characters.
 */
export async function ensureSheetFonts(opts: {
  fonts: FontSetLike;
  families: readonly string[];
  text: string;
  timeoutMs?: number;
  weights?: readonly number[];
}): Promise<void> {
  const { fonts, families, text } = opts;
  const timeoutMs = opts.timeoutMs ?? FONT_TIMEOUT_MS;
  const weights = opts.weights ?? SHEET_FONT_WEIGHTS;
  const missing: string[] = [];

  const declared = new Set<string>();
  for (const face of fonts) declared.add(unquote(face.family));

  const sinhalaText = [...text].filter((c) => SINHALA_CHARS.test(c)).join("");
  const checks: Promise<void>[] = [];

  for (const family of families) {
    const isSinhalaFace = /sinhala/i.test(family);
    if (isSinhalaFace && sinhalaText === "") continue; // not used on these sheets
    if (!declared.has(family)) {
      missing.push(`${family} (not declared)`);
      continue;
    }
    const sample = isSinhalaFace ? sinhalaText : text;
    for (const weight of weights) {
      const font = spec(weight, family);
      checks.push(
        (async () => {
          try {
            const r = await withTimeout(fonts.load(font, sample), timeoutMs);
            if (r === "timeout") missing.push(`${family} ${weight} (timed out)`);
            else if (!fonts.check(font, sample)) missing.push(`${family} ${weight} (not loaded)`);
          } catch {
            missing.push(`${family} ${weight} (failed to load)`);
          }
        })(),
      );
    }
  }
  await Promise.all(checks);

  // Anything that was loading when we started must have settled too (but a hung `ready` never blocks past the timeout).
  const ready = await withTimeout(fonts.ready.then(() => "ok" as const), timeoutMs).catch(() => "failed" as const);
  if (ready === "timeout") missing.push("fonts still loading (timed out)");

  if (missing.length > 0) throw new SheetFontsError(missing);
}
