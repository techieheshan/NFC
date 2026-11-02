/**
 * The fixed numbers of an A4 sheet, in CSS px at 96 dpi, in ONE place: the stylesheet (document-css.ts), the paginator
 * (paginate-document.ts), the PDF step (make-pdf.ts) and the tests all import them; none of them writes 794, 1123 or 713 itself.
 *
 * The SCREEN sheet is 794 x 1123 px with 40 px padding, so its content box is 714 px wide. The PRINTED sheet is
 * 210 mm = 793.7 px, so its content box is 713.7 px. Blocks are therefore MEASURED at 713 px and every table's
 * columns add up to 713: a cell that fits when measured cannot wrap one line more on paper, which would make a row
 * taller than the paginator thought. Pages are filled to 20 px short of the footer on top of the 4 px of rounding
 * slack, so a small disagreement between the screen and the print cannot push the last row onto the footer.
 */
export const SHEET_W = 794;
export const SHEET_H = 1123;
export const PAD_TOP = 40;
/** Left and right padding of a sheet. */
export const PAD_SIDE = 40;
/** A4 in millimetres: the print sheet and the PDF page. */
export const A4_W_MM = 210;
export const A4_H_MM = 297;
export const FOOTER_RESERVE = 64;
export const ROUNDING_SLACK = 4;
export const SAFETY_MARGIN = 20;
/** The width blocks are measured at, and the most a table's columns may add up to. */
export const MEASURE_W = 713;
/** Height available to blocks on one sheet. */
export const CONTENT_H = SHEET_H - PAD_TOP - FOOTER_RESERVE - ROUNDING_SLACK - SAFETY_MARGIN;
