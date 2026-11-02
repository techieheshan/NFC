import { hasOverflow, paginate, type Block, type Page } from "@/lib/paginate";

import { CONTENT_H } from "./sheet-geometry";

/**
 * The ONE place the document's blocks are fitted to sheets: the generic paginator with this document's content height
 * (sheet-geometry.ts: 20 px short of the footer on top of the rounding slack). The view calls this and nothing else, so a
 * test of this function is a test of what the page does.
 */
export const paginateDocument = (blocks: readonly Block[]): Page[] => paginate(blocks, CONTENT_H);

export const OVERFLOW_WARNING =
  "Part of this document is taller than one page and may be cut off. Check the print preview before you print or download it.";

/** The warning to show when any sheet holds something taller than itself, else null. */
export const overflowWarning = (pages: readonly Page[]): string | null => (hasOverflow(pages) ? OVERFLOW_WARNING : null);
