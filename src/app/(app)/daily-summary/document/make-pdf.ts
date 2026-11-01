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
 * Scale 2 keeps text crisp (about 350 KB a page as JPEG); a device that cannot allocate that canvas is
 * retried at 1.5 and then 1. If all fail the caller says so and offers Print.
 */
export const PDF_FAIL_MESSAGE = "Couldn't make the PDF on this device. Use Print and choose Save as PDF.";

const W = 794;
const H = 1123;

export async function sheetsToPdf(sheets: HTMLElement[], filename: string): Promise<void> {
  if (sheets.length === 0) throw new Error("no sheets");
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  await document.fonts.ready;

  let lastError: unknown = null;
  for (const scale of [2, 1.5, 1]) {
    try {
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
      for (let i = 0; i < sheets.length; i++) {
        const canvas = await html2canvas(sheets[i], {
          scale,
          width: W,
          height: H,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          onclone: (doc) => {
            doc.documentElement.style.background = "#ffffff";
            doc.body.style.background = "#ffffff";
            doc.body.style.color = "#1d1530";
          },
        });
        const image = canvas.toDataURL("image/jpeg", 0.85);
        canvas.width = 0; // let the device have the memory back before the next sheet
        canvas.height = 0;
        if (i > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(image, "JPEG", 0, 0, 210, 297, undefined, "FAST");
      }
      pdf.save(filename);
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("pdf failed");
}
