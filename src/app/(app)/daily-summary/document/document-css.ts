/** The A4 document's stylesheet, as a string rendered in a <style> tag (a .css import cannot be loaded by the test runner, and one tag keeps the sheet rules and the print rules together). Hex colours only; see the notes inside. */
import { A4_H_MM, A4_W_MM, MEASURE_W, PAD_SIDE, PAD_TOP, SHEET_H, SHEET_W } from "./sheet-geometry";

export const DOCUMENT_CSS = `/*
 * The Daily Summary A4 document. Plain CSS (not Tailwind utilities) with HEX colours only, on purpose:
 * the PDF is made by drawing these sheets, and the drawing library cannot read the colour notation the rest of
 * the app uses. Nothing here is newer than Chrome 102 (a test scans this very string for the features that
 * are; AGENTS.md has the list).
 */
.ds-doc {
  font-family: var(--font-sans), var(--font-ds-sinhala), system-ui, sans-serif;
  color: #1d1530;
}

/* A fixed A4 sheet: ${SHEET_W} x ${SHEET_H} CSS px at 96 dpi. */
.ds-sheet {
  width: ${SHEET_W}px;
  height: ${SHEET_H}px;
  box-sizing: border-box;
  padding: ${PAD_TOP}px ${PAD_SIDE}px;
  background: #ffffff;
  color: #1d1530;
  position: relative;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.35;
  flex: none;
}
.ds-sheet,
.ds-sheet *,
.ds-measure,
.ds-measure * {
  box-sizing: border-box;
  /* hex, !important: the app's global base sets these colours in a notation the page-to-image step cannot parse */
  border-color: #cfc7e6 !important;
  outline-color: #cfc7e6 !important;
}
.ds-measure {
  position: absolute;
  left: -20000px;
  top: 0;
  width: ${MEASURE_W}px; /* the PRINTED content box (A4 width in px less both side paddings), rounded down: see sheet-geometry.ts */
  visibility: hidden;
  font-size: 13px;
  line-height: 1.35;
  color: #1d1530;
}

.ds-pages {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
}
.ds-preview {
  max-width: 100%;
  overflow-x: auto; /* the sheet is wider than a phone: it scrolls inside this box, never the page */
  background: #e9e6f2;
  padding: 12px;
  border-radius: 12px;
}

.ds-foot {
  position: absolute;
  left: ${PAD_SIDE}px;
  right: ${PAD_SIDE}px;
  bottom: 22px;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  border-top: 1px solid #cfc7e6;
  padding-top: 6px;
  font-size: 12px;
  line-height: 16px;
  color: #1d1530;
}

.ds-sec { margin: 0 0 18px; position: relative; }
.ds-h { margin: 0 0 6px; font-size: 14px; line-height: 20px; font-weight: 700; }
.ds-cont { margin: 0 0 6px; height: 16px; font-size: 12px; line-height: 16px; font-weight: 600; }
.ds-note { margin: 6px 0 0; font-size: 12px; line-height: 16px; color: #1d1530; }

.ds-head { display: flex; justify-content: space-between; align-items: flex-start; }
.ds-logo { display: flex; align-items: center; gap: 10px; }
.ds-x {
  width: 40px; height: 40px; border-radius: 10px; background: #7c3aed; color: #ffffff;
  display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; line-height: 1;
}
.ds-word { font-size: 20px; font-weight: 700; letter-spacing: 0.3em; line-height: 22px; }
.ds-inst { font-size: 12px; letter-spacing: 0.3em; line-height: 14px; }
.ds-title { text-align: right; }
.ds-title b { display: block; font-size: 26px; line-height: 30px; }
.ds-title span { font-size: 13px; }
.ds-rule { height: 0; border-top: 2px solid #7c3aed !important; margin: 10px 0 14px; }

.ds-info { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; margin-bottom: 18px; }
.ds-info > div > div { margin-bottom: 6px; }
.ds-info span { display: block; font-size: 12px; line-height: 16px; color: #4a4166; }
.ds-info b { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }

.ds-table { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.ds-table th {
  background: #f1ebff; text-align: left; font-size: 12px; line-height: 16px; font-weight: 700; padding: 6px;
  border-top: 1px solid #cfc7e6; border-bottom: 1px solid #cfc7e6;
}
.ds-table td {
  padding: 5px 6px; font-size: 13px; line-height: 18px; vertical-align: top; border-bottom: 1px solid #cfc7e6;
  overflow-wrap: anywhere;
}
.ds-table tfoot td { font-weight: 700; background: #faf8ff; border-top: 1px solid #cfc7e6; }
.ds-table .r { text-align: right; }
.ds-table .m { color: #4a4166; }

.ds-two { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.ds-kv { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid #cfc7e6; font-size: 13px; line-height: 18px; }
.ds-kv.sub { padding-left: 14px; color: #4a4166; }
.ds-kv.strong { font-weight: 700; }
.ds-kv span:last-child { text-align: right; white-space: nowrap; }
.ds-box { margin-top: 8px; border: 2px solid #7c3aed !important; background: #f1ebff; padding: 8px 10px; border-radius: 6px; }
.ds-box .ds-kv { border-bottom: 0; padding: 0; font-size: 16px; line-height: 22px; font-weight: 700; }

.ds-sig { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
.ds-sigbox { border: 1px solid #cfc7e6; border-radius: 6px; padding: 10px 12px; }
.ds-sigbox .who { font-size: 12px; line-height: 16px; color: #4a4166; }
.ds-sigbox .name { font-size: 14px; font-weight: 700; margin-top: 2px; }
.ds-sigline { margin-top: 38px; display: flex; gap: 16px; }
.ds-sigline div { flex: 1; border-top: 1px solid #1d1530 !important; padding-top: 3px; font-size: 12px; line-height: 16px; }

@media print {
  @page { size: A4; margin: 0; }
  /* globals.css hides everything but the receipt's #xenon-print while printing (the 58 mm rule): give the page
     back, and keep any receipt copy out. Same pattern as the payslip voucher. */
  body > *:not(#xenon-print) { display: revert !important; }
  #xenon-print { display: none !important; }
  body * { visibility: hidden !important; }
  .ds-pages, .ds-pages * { visibility: visible !important; }
  .ds-measure, .ds-measure * { display: none !important; }
  .ds-preview { position: absolute; left: 0; top: 0; max-width: none; overflow: visible; background: none; padding: 0; border-radius: 0; }
  .ds-pages { display: block; }
  /* ${A4_H_MM} mm, not ${SHEET_H} px: ${SHEET_H} px is a hair over an A4 page and would push an empty page after every sheet */
  .ds-sheet { width: ${A4_W_MM}mm; height: ${A4_H_MM}mm; break-after: page; page-break-after: always; }
  .ds-sheet:last-child { break-after: auto; page-break-after: auto; }
  .no-print { display: none !important; }
}
`;
