import { test } from "node:test";
import assert from "node:assert/strict";

import { paginate, type Block } from "@/lib/paginate";

/*
 * Daily Summary R1: the A4 paginator is a pure function of measured heights.
 */

const box = (id: string, height: number): Block => ({ id, height });
const table = (id: string, rows: number[], top = 50, contTop = 30, bottom = 40): Block => ({
  id, height: top + rows.reduce((s, r) => s + r, 0) + bottom, table: { top, contTop, rows, bottom },
});

const rowsOf = (pages: ReturnType<typeof paginate>, id: string) =>
  pages.flatMap((p, pi) => p.placements.filter((x) => x.blockId === id).map((x) => ({ pi, ...x })));

test("a short document is one page, blocks in order", () => {
  const pages = paginate([box("a", 100), box("b", 200), box("c", 300)], 1000);
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].placements.map((p) => p.blockId), ["a", "b", "c"]);
  assert.equal(pages[0].used, 600);
  assert.equal(pages[0].overflow, false);
});

test("a whole block that does not fit moves to the next page, order kept (nothing jumps ahead to fill a gap)", () => {
  const pages = paginate([box("a", 600), box("b", 500), box("c", 100)], 1000);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].placements.map((p) => p.blockId), ["a"]); // c would have fitted, but stays behind b
  assert.deepEqual(pages[1].placements.map((p) => p.blockId), ["b", "c"]);
});

test("a table splits between rows, repeats its header on the continuation, and every row appears exactly once in order", () => {
  const rows = Array.from({ length: 30 }, () => 40);
  const pages = paginate([box("head", 100), table("t", rows)], 500);
  const slices = rowsOf(pages, "t");
  assert.ok(slices.length >= 3);
  assert.equal(slices[0].continued, false);
  assert.ok(slices.slice(1).every((s) => s.continued === true), "header repeated on every continuation");
  let expected = 0;
  for (const s of slices) {
    assert.equal(s.rowStart, expected);
    assert.ok(s.rowEnd! > s.rowStart!);
    expected = s.rowEnd!;
  }
  assert.equal(expected, 30);
  assert.ok(pages.every((p) => !p.overflow));
  assert.equal(slices.filter((s) => s.last).length, 1);
  assert.equal(slices[slices.length - 1].last, true);
});

test("no sheet is filled past its height (when every row fits on an empty sheet)", () => {
  const pages = paginate([table("t", Array.from({ length: 57 }, (_, i) => 20 + (i % 5) * 9)), box("x", 90)], 480);
  for (const p of pages) assert.ok(p.used <= 480, `used ${p.used}`);
});

test("the totals after the last row are never alone on a sheet: the last row travels with them", () => {
  // top 50 + rows 4 x 100 = 450, bottom 80: all rows fit in 500 but the tail does not
  const pages = paginate([table("t", [100, 100, 100, 100], 50, 30, 80)], 500);
  assert.equal(pages.length, 2);
  const [a, b] = rowsOf(pages, "t");
  assert.equal(a.rowEnd, 3);
  assert.equal(b.rowStart, 3);
  assert.equal(b.rowEnd, 4);
  assert.equal(b.last, true);
  assert.equal(b.continued, true);
});

test("a table that does not fit beside the previous block starts on a fresh sheet when not even one row fits", () => {
  const pages = paginate([box("a", 480), table("t", [60, 60], 50, 30, 20)], 500);
  assert.equal(pages.length, 2);
  assert.equal(rowsOf(pages, "t")[0].pi, 1);
  assert.equal(rowsOf(pages, "t")[0].continued, false);
});

test("a row taller than a sheet is placed alone, flagged as overflow, and the loop still ends", () => {
  const pages = paginate([table("t", [100, 900, 100], 50, 30, 20)], 500);
  assert.equal(rowsOf(pages, "t").map((s) => s.rowEnd! - s.rowStart!).reduce((s, n) => s + n, 0), 3);
  assert.ok(pages.some((p) => p.overflow));
});

test("a block taller than a sheet on an empty sheet is placed and flagged; an empty table is a plain block", () => {
  const pages = paginate([box("big", 2000), table("empty", [], 60, 30, 20)], 1000);
  assert.ok(pages[0].overflow);
  assert.deepEqual(pages.flatMap((p) => p.placements).map((p) => p.blockId), ["big", "empty"]);
});

test("no blocks → one empty page; never a trailing empty page", () => {
  assert.equal(paginate([], 1000).length, 1);
  const pages = paginate([table("t", [10, 10, 10], 20, 10, 10)], 1000);
  assert.equal(pages.length, 1);
  assert.ok(pages.every((p) => p.placements.length > 0));
});

test("deterministic: the same heights always give the same pages", () => {
  const blocks = [box("a", 120), table("t", Array.from({ length: 40 }, (_, i) => 18 + (i % 4) * 11), 60, 28, 50), box("z", 200)];
  assert.deepEqual(paginate(blocks, 650), paginate(blocks, 650));
});

test("a continuation slice costs the repeated header (contTop), not the full top: the sheet is filled to the pixel", () => {
  // top 50 (title + header), contTop 30 (header + 'continued'), 10 rows of 100, bottom 40, sheet 450
  const pages = paginate([table("t", Array.from({ length: 10 }, () => 100), 50, 30, 40)], 450);
  // page 1: 50 + 4 x 100 = 450 (exactly full); page 2: 30 + 4 x 100 = 430; page 3: 30 + 2 x 100 + 40 = 270
  assert.deepEqual(pages.map((p) => p.used), [450, 430, 270]);
  assert.deepEqual(pages.map((p) => p.placements[0].rowEnd! - p.placements[0].rowStart!), [4, 4, 2]);
  assert.ok(pages.every((p) => !p.overflow));
});
