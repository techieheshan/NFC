import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ResponsiveDataList, type DataColumn } from "@/components/ui/responsive-data-list";

type Row = { id: number; course: string; teacher: string; fee: string };
const rows: Row[] = [
  { id: 1, course: "Physics", teacher: "Perera", fee: "2,500.00" },
  { id: 2, course: "Chemistry", teacher: "Silva", fee: "3,000.00" },
];
const columns: DataColumn<Row>[] = [
  { key: "course", header: "Course", cell: (r) => r.course, primary: true },
  { key: "teacher", header: "Teacher", cell: (r) => r.teacher },
  { key: "fee", header: "Fee", cell: (r) => r.fee, align: "right" },
];
const render = (props: Partial<Parameters<typeof ResponsiveDataList<Row>>[0]> = {}) =>
  renderToStaticMarkup(h(ResponsiveDataList<Row>, { items: rows, columns, getKey: (r) => r.id, ...props }));

test("renders a table for wide screens and a card list for narrow ones, from the same rows", () => {
  const html = render();
  assert.match(html, /<table/);
  assert.equal((html.match(/<tr/g) ?? []).length, 1 + rows.length, "header row + one row each");
  assert.equal((html.match(/<li/g) ?? []).length, rows.length, "one card each");
});

test("the table is hidden on phones and the cards are hidden from the breakpoint up", () => {
  const html = render();
  assert.match(html, /class="[^"]*hidden md:block/); // the table wrapper
  assert.match(html, /<ul class="[^"]*md:hidden/);   // the card list
});

test("the breakpoint is configurable, and written out so Tailwind can see it", () => {
  assert.match(render({ breakpoint: "xl" }), /hidden xl:block/);
  assert.match(render({ breakpoint: "xl" }), /xl:hidden/);
});

test("a card uses the primary column as its title and the others as label/value lines", () => {
  const card = render().split("<ul")[1];
  assert.match(card, /font-medium[^>]*>Physics</);
  assert.match(card, /<dt[^>]*>Teacher<\/dt><dd[^>]*>Perera</);
  assert.match(card, /<dt[^>]*>Fee<\/dt><dd[^>]*>2,500\.00</);
  assert.doesNotMatch(card, /<dt[^>]*>Course</, "the title is not repeated as a line");
});

test("the first column is the title when none is marked primary", () => {
  const plain = columns.map((c) => ({ ...c, primary: false }));
  assert.match(render({ columns: plain }).split("<ul")[1], /font-medium[^>]*>Physics</);
});

test("hideInCard leaves a column out of the card but keeps it in the table", () => {
  const cols = columns.map((c) => (c.key === "fee" ? { ...c, hideInCard: true } : c));
  const html = render({ columns: cols });
  assert.match(html.split("<ul")[0], /Fee/, "still a table column");
  assert.doesNotMatch(html.split("<ul")[1], /Fee/, "gone from the card");
});

test("renderCard replaces the default card", () => {
  const html = render({ renderCard: (r) => h("p", { className: "custom" }, `#${r.id} ${r.course}`) });
  assert.match(html, /<p class="custom">#1 Physics<\/p>/);
  assert.doesNotMatch(html, /<dl/);
});

test("right-aligned columns align in the table", () => {
  assert.match(render().split("<ul")[0], /<td[^>]*text-right[^>]*>2,500\.00/);
});

test("no rows: shows the empty state instead of an empty table and an empty list", () => {
  const html = render({ items: [], empty: h("p", null, "Nothing here") });
  assert.equal(html, "<p>Nothing here</p>");
  assert.equal(render({ items: [] }), "");
});
