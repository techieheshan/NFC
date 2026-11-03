import { ensureSheetFonts, type FontSetLike } from "./sheet-fonts";

/**
 * html2canvas's `onclone` step: html2canvas draws from a CLONE of the page, so the fonts that matter are the CLONE's. Gives the
 * clone a white page, then checks the clone's own `fonts` (never the live page's) and throws SheetFontsError when one is missing;
 * html2canvas awaits what this returns.
 */
export function makeOnClone(families: readonly string[], text: string) {
  return async (doc: Document): Promise<void> => {
    doc.documentElement.style.background = "#ffffff";
    doc.body.style.background = "#ffffff";
    doc.body.style.color = "#1d1530";
    await ensureSheetFonts({ fonts: doc.fonts as unknown as FontSetLike, families, text });
  };
}
