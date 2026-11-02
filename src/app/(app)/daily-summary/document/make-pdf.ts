"use client";

/**
 * Download PDF: draw each fixed A4 sheet to an image and put one image on each page of an A4 PDF.
 *
 * Why an image: jsPDF's built-in fonts have no Sinhala, so a text PDF would print Sinhala names as garbage.
 * Drawing the real sheets keeps Sinhala (and the layout) exactly as the print shows it, at the cost that the
 * text in the PDF cannot be selected. The SAME sheet elements are what `window.print()` prints.
 *
 * html2canvas and jsPDF are imported only when the button is pressed (they are not in any page's first load).
 * html2canvas cannot read the oklch() colours the rest of the app uses, so the clone it draws from gets a plain
 * white page and document.css gives every sheet element a hex border/outline colour.
 *
 * html2canvas places text by measuring a 1px <img> beside a span, which only works when an <img> is INLINE.
 * Tailwind's base styles make every <img> `display: block`, which put every line of text about 6 px too low (found
 * by comparing the PDF with the print), so an inline-img rule is added to the page while the sheets are drawn and
 * removed again afterwards.
 *
 * Scale 2 keeps text crisp (about 350 KB a page as JPEG); a device that cannot allocate that canvas is
 * retried at 1.5 and then 1. If all fail the caller says so and offers Print.
 */
import { ensureSheetFonts, sheetFamilies, SheetFontsError, type FontSetLike } from "./sheet-fonts";
import { A4_H_MM, A4_W_MM, SHEET_H, SHEET_W } from "./sheet-geometry";
import { withTemporaryStyle } from "./temporary-style";

export const PDF_FAIL_MESSAGE = "Couldn't make the PDF on this device. Use Print and choose Save as PDF.";

/** html2canvas's text placement needs an INLINE <img>; Tailwind makes them blocks. Held on the page only while drawing. */
export const IMG_RULE = "img { display: inline !important; vertical-align: baseline !important; max-width: none !important; }";

export async function sheetsToPdf(sheets: HTMLElement[], filename: string): Promise<void> {
  if (sheets.length === 0) throw new Error("no sheets");
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

  // The PDF is a picture of the sheets: if their fonts are not really loaded it would be drawn in a fallback face and no longer
  // match the print. Load them (Geist, and Noto Sans Sinhala when there is Sinhala, at every weight used) and, if any is still
  // missing after a short wait, make NO PDF: the caller shows PDF_FAIL_MESSAGE and nothing is downloaded.
  const text = sheets.map((s) => s.textContent ?? "").join("\n");
  const families = sheetFamilies(getComputedStyle(sheets[0]).fontFamily);
  await ensureSheetFonts({ fonts: document.fonts as unknown as FontSetLike, families, text });

  await withTemporaryStyle(document, IMG_RULE, async () => {
    let lastError: unknown = null;
    for (const scale of [2, 1.5, 1]) {
      try {
        const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
        for (let i = 0; i < sheets.length; i++) {
          const canvas = await html2canvas(sheets[i], {
            scale,
            width: SHEET_W,
            height: SHEET_H,
            backgroundColor: "#ffffff",
            useCORS: true,
            logging: false,
            scrollX: 0,
            scrollY: -window.scrollY,
            // html2canvas draws from a CLONE of the page; wait for the clone's own fonts too (it awaits what this returns).
            onclone: async (doc) => {
              doc.documentElement.style.background = "#ffffff";
              doc.body.style.background = "#ffffff";
              doc.body.style.color = "#1d1530";
              await ensureSheetFonts({ fonts: doc.fonts as unknown as FontSetLike, families, text });
            },
          });
          const image = canvas.toDataURL("image/jpeg", 0.85);
          canvas.width = 0; // let the device have the memory back before the next sheet
          canvas.height = 0;
          if (i > 0) pdf.addPage("a4", "portrait");
          pdf.addImage(image, "JPEG", 0, 0, A4_W_MM, A4_H_MM, undefined, "FAST");
        }
        pdf.save(filename);
        return;
      } catch (e) {
        if (e instanceof SheetFontsError) throw e; // a missing font is not fixed by a smaller scale: stop, no retry, no PDF
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("pdf failed");
  });
}
