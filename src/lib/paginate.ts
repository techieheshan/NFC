/**
 * The A4 paginator for the Daily Summary document — pure arithmetic on MEASURED heights.
 *
 * The browser measures every block after the fonts are ready (a Sinhala name wraps differently from a
 * Latin one, so nothing can be guessed) and hands the numbers here; this decides which block goes on
 * which fixed A4 sheet. Rules:
 *   - blocks keep their order and are never reordered to fill gaps;
 *   - a block that is not a table moves whole to the next sheet if it does not fit (unless the sheet is
 *     empty, then it stays and is flagged `overflow` — a block taller than a sheet cannot be helped);
 *   - a TABLE may split between rows (never inside a row); its header is repeated on the continuation;
 *   - the part after the last row (totals, notes) is never left alone on a sheet: if it does not fit with
 *     the last row, the last row travels to the next sheet with it;
 *   - at least one row is placed per slice, so the loop always ends.
 */

export type TableBlock = {
  /** Heading, header row and the space above the first row, in px. */
  top: number;
  /** Repeated at the top of each continuation slice (the header row, with a short "continued" label). */
  contTop: number;
  rows: readonly number[];
  /** What follows the last row: totals, a note, and the gap to the next block. */
  bottom: number;
};

export type Block = {
  id: string;
  /** Whole height, including the gap after it. For a table: top + all rows + bottom. */
  height: number;
  table?: TableBlock;
};

export type Placement = {
  blockId: string;
  /** Tables: the slice of rows shown, [rowStart, rowEnd). Absent for a whole block. */
  rowStart?: number;
  rowEnd?: number;
  /** A continuation slice: repeat the header and the "continued" label. */
  continued?: boolean;
  /** The slice that carries the part after the rows. */
  last?: boolean;
};

export type Page = { placements: Placement[]; used: number; overflow: boolean };

export function paginate(blocks: readonly Block[], pageHeight: number): Page[] {
  const pages: Page[] = [{ placements: [], used: 0, overflow: false }];
  const cur = () => pages[pages.length - 1];
  const next = () => pages.push({ placements: [], used: 0, overflow: false });
  const room = () => pageHeight - cur().used;
  const add = (p: Placement, h: number) => {
    cur().placements.push(p);
    cur().used += h;
    if (cur().used > pageHeight) cur().overflow = true;
  };

  for (const b of blocks) {
    if (!b.table || b.table.rows.length === 0) {
      if (b.height > room() && cur().placements.length > 0) next();
      add({ blockId: b.id }, b.height);
      continue;
    }

    const t = b.table;
    const n = t.rows.length;
    let i = 0;
    let continued = false;
    while (i < n) {
      const head = continued ? t.contTop : t.top;
      // how many rows fit after the head on this sheet
      let k = 0;
      let h = head;
      while (i + k < n && h + t.rows[i + k] <= room()) {
        h += t.rows[i + k];
        k++;
      }
      // everything fits except the tail: take the last row with it to the next sheet
      if (i + k === n && h + t.bottom > room()) k = Math.max(0, k - 1);
      if (k === 0) {
        if (cur().placements.length > 0) {
          next();
          continue; // try again on the empty sheet
        }
        k = 1; // an empty sheet and still no fit: place one row, flagged by `add`
      }
      let used = head + t.rows.slice(i, i + k).reduce((s, r) => s + r, 0);
      const finished = i + k === n;
      if (finished) used += t.bottom;
      add({ blockId: b.id, rowStart: i, rowEnd: i + k, continued, last: finished }, used);
      i += k;
      continued = true;
      if (!finished) next();
    }
  }
  if (pages.length > 1 && cur().placements.length === 0) pages.pop();
  return pages;
}
