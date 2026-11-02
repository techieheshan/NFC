import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { test } from "node:test";
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DOCUMENT_CSS } from "@/app/(app)/daily-summary/document/document-css";
import { A4_H_MM, A4_W_MM, CONTENT_H, FOOTER_RESERVE, MEASURE_W, PAD_SIDE, PAD_TOP, SAFETY_MARGIN, SHEET_H, SHEET_W } from "@/app/(app)/daily-summary/document/sheet-geometry";
import { IMG_RULE, PDF_FAIL_MESSAGE } from "@/app/(app)/daily-summary/document/make-pdf";
import { OverflowNotice } from "@/app/(app)/daily-summary/document/overflow-notice";
import { OVERFLOW_WARNING, overflowWarning, paginateDocument } from "@/app/(app)/daily-summary/document/paginate-document";
import { withTemporaryStyle } from "@/app/(app)/daily-summary/document/temporary-style";
import { makeBlocks } from "@/app/(app)/daily-summary/document/blocks";
import { buildDocModel } from "@/app/(app)/daily-summary/document/model";
import type { DailySummary } from "@/lib/reports";

/*
 * Daily Summary R1: what the A4 document prints, tested as data and as markup — and the CSS it ships, against the
 * Chrome 102 floor (the build-time baseline script only scans the built css chunks, and this stylesheet is
 * inline, so it is checked here).
 */

const course = (name: string, teacher: string, full: number, half: number, q: number, free: number, amount: string) => ({
  courseId: Math.abs(name.length * 7 + full), course: name, teacher, registered: 20, paidFull: full, paidHalf: half, paidQuarter: q,
  notPaid: 3, free, amount, reconciles: true,
});

const base: DailySummary = {
  from: "2026-10-14", to: "2026-10-14",
  courses: [
    course("ICT Theory", "Mr. A. Gunawardena", 1, 0, 1, 2, "5625.00"),
    course("භෞතික විද්‍යාව - Theory", "සුනිල් ගුණසේන මහතා", 4, 0, 1, 0, "13000.00"),
    course("Biology Paper Class", "Ms. K", 0, 0, 0, 0, "0.00"),
  ],
  admission: { count: 4, total: "5200.00" }, smartCard: { count: 3, total: "1500.00" },
  classTotal: "69675.00", totalCollected: "76375.00",
  deductions: { teacherAdvances: "5000.00", xenonExpenses: "3450.00", total: "8450.00" },
  deductionLines: [
    { date: "2026-10-14", kind: "TEACHER_ADVANCE", person: "Ms. R", reason: "advance", authorizedBy: "Thilini", isStaffAdvance: false, amount: "5000.00" },
    { date: "2026-10-14", kind: "XENON", person: "Chathura", reason: "salary advance", authorizedBy: "Ruwan", isStaffAdvance: true, amount: "2500.00" },
    { date: "2026-10-14", kind: "XENON", person: null, reason: "repair: door lock", authorizedBy: "Ruwan", isStaffAdvance: false, amount: "950.00" },
  ],
  net: "67925.00",
};
const generated = { date: "2026-11-01", time: "21:18" };
const staff = [{ userId: "u1", name: "Sadun", receipts: 3, collected: "70000.00" }, { userId: "u2", name: "Thilini", receipts: 2, collected: "6375.00" }];
const dayModel = (over: Partial<DailySummary> = {}, day: Partial<{ bringForwardCents: number; bank: { cents: number; time: string; slip: string; note: string }[] }> = {}, cancelled = { receipts: 0, total: "0.00" }) =>
  buildDocModel({
    report: { ...base, ...over }, cancelled, generated, generatedBy: "Nadeesha",
    day: { staff, bringForwardCents: day.bringForwardCents ?? 500000, bank: day.bank ?? [], preparedBy: "Sadun", checkedBy: "Ruwan" },
  });
const html = (m: ReturnType<typeof dayModel>) => makeBlocks(m).map((b) => renderToStaticMarkup(createElement("div", null, b.render()))).join("\n");

test("a day without Half / No-charge months prints no 'of which' line and no footnote about them", () => {
  const m = dayModel();
  assert.deepEqual(m.ofWhich, []);
  assert.equal(m.includedNote, null);
  const text = html(m);
  assert.ok(!/of which|No-charge months|Half months/.test(text));
  assert.ok(text.includes("Half is the Half fee tier."));
});

test("Half and No-charge months: indented 'of which' lines under Class fees, and the footnote under the course table", () => {
  const m = dayModel({ halfMonths: { count: 2, total: "2750.00" }, noChargeMonths: { count: 2 } });
  const text = html(m);
  assert.ok(text.includes("of which Half months (2)") && text.includes("2,750.00"));
  assert.ok(text.includes("No-charge months (2): nothing charged"));
  assert.ok(text.includes("Half months (2: 2,750.00) and No-charge months (2: 0.00) are included in the amounts."));
});

test("the cash flow: bring-forward + collected − deductions = should be in the drawer; minus the bank = left in the drawer", () => {
  const m = dayModel({}, { bringForwardCents: 500000, bank: [{ cents: 5000000, time: "10:30", slip: "S-1", note: "Peoples Bank" }, { cents: 1500000, time: "13:05", slip: "", note: "" }] });
  assert.deepEqual(m.flow, {
    bringForward: "5,000.00", collected: "76,375.00", deductions: "8,450.00", shouldBe: "72,925.00",
    bankCount: 2, bankTotal: "65,000.00", left: "7,925.00", overdrawn: false,
  });
  const text = html(m);
  assert.ok(text.includes("Left in drawer") && text.includes("7,925.00"));
  assert.ok(text.includes("All money collected is cash. Bank deposits are listed below."));
  assert.deepEqual(m.bank.map((l) => [l.time, l.slip, l.amount]), [["10:30 AM", "S-1", "50,000.00"], ["1:05 PM", "—", "15,000.00"]]);
  assert.equal(m.bankTotal, "65,000.00");
});

test("cash book: the sign is on the LABEL ('− Deductions', '− Taken to bank (N)'), the number has none, so it never reads minus-minus; elsewhere negatives keep their sign", () => {
  const m = dayModel({}, { bank: [{ cents: 2000000, time: "10:30", slip: "", note: "" }] });
  const text = html(m);
  assert.ok(/− Deductions<\/span><span>8,450\.00</.test(text), "'− Deductions' then an unsigned number");
  assert.ok(/− Taken to bank \(1\)<\/span><span>20,000\.00</.test(text));
  assert.ok(!/− Deductions<\/span><span>−/.test(text) && !/− Taken to bank \(\d+\)<\/span><span>−/.test(text), "no minus-minus");
  assert.ok(text.includes("−5,000.00") && text.includes("−3,450.00"), "the Totals lines keep their minus sign");
});

test("no bank lines: the 'Money taken to the bank' section is omitted entirely", () => {
  assert.ok(!makeBlocks(dayModel()).some((b) => b.id === "bank"));
  assert.ok(!html(dayModel()).includes("Money taken to the bank"));
  assert.ok(makeBlocks(dayModel({}, { bank: [{ cents: 100, time: "09:00", slip: "", note: "" }] })).some((b) => b.id === "bank"));
});

test("deductions are shown as negatives next to the totals they come off, collected and net as they are", () => {
  const m = dayModel();
  assert.equal(m.teacherAdvances, "−5,000.00");
  assert.equal(m.xenonExpenses, "−3,450.00");
  assert.equal(m.totalCollected, "76,375.00");
  assert.equal(m.net, "67,925.00");
  const text = html(m);
  assert.ok(text.includes("−5,000.00") && text.includes("−3,450.00"));
});

test("no minus sign on zero: a day with no deductions prints 0.00", () => {
  const m = dayModel({ deductions: { teacherAdvances: "0.00", xenonExpenses: "0.00", total: "0.00" }, deductionLines: [], net: "76375.00" });
  assert.equal(m.teacherAdvances, "0.00");
  assert.equal(m.xenonExpenses, "0.00");
  assert.equal(m.flow?.deductions, "0.00");
  assert.ok(!html(m).includes("−0.00") && !html(m).includes("-0.00"));
});

test("courses with no payments are named in the note, not given rows; Sinhala names pass through untouched", () => {
  const m = dayModel();
  assert.deepEqual(m.courses.map((c) => c.course), ["ICT Theory", "භෞතික විද්‍යාව - Theory"]);
  assert.deepEqual(m.noPaymentCourses, ["Biology Paper Class"]);
  const text = html(m);
  assert.ok(text.includes("No payments: Biology Paper Class."));
  assert.ok(text.includes("සුනිල් ගුණසේන මහතා"));
});

test("collected by staff: the table total equals Total collected; a cancelled line appears only when there are cancellations", () => {
  const m = dayModel();
  assert.equal(m.staffTotal.collected, m.totalCollected);
  assert.equal(m.staffTotal.receipts, 5);
  assert.equal(m.cancelledLine, null);
  assert.ok(!html(m).includes("Cancelled:"));
  const c = dayModel({}, {}, { receipts: 1, total: "3750.55" });
  assert.equal(c.cancelledLine, "Cancelled: 1 receipt, 3,750.55 (not counted)");
  assert.equal(dayModel({}, {}, { receipts: 3, total: "10.00" }).cancelledLine, "Cancelled: 3 receipts, 10.00 (not counted)");
});

test("the document says 'Smart card replacement (N)' and puts the Admission note under the Admission line, in that order", () => {
  const text = html(dayModel());
  const a = text.indexOf("Admission (4)");
  const n = text.indexOf("Admission includes the first smart card");
  const c = text.indexOf("Smart card replacement (3)");
  assert.ok(a > 0 && n > a && c > n, "Admission, then its note, then Smart card replacement");
  assert.ok(!text.includes("Smart card (3)"));
});

test("the document prints names EXACTLY as given: nothing is trimmed, not even a stored bracket (the proof against real stored names is daily-summary-document-names.test.ts)", () => {
  const m = buildDocModel({
    report: { ...base, deductionLines: [{ date: "2026-10-14", kind: "XENON", person: "Chathura (Staff)", reason: "salary advance", authorizedBy: "Ruwan (Admin)", isStaffAdvance: true, amount: "2500.00" }] },
    cancelled: { receipts: 0, total: "0.00" }, generated, generatedBy: "Nadeesha (Administrator)",
    day: { staff: [{ userId: "u", name: "Sadun (Staff)", receipts: 1, collected: "76375.00" }], bringForwardCents: 0, bank: [], preparedBy: "Sadun (Staff)", checkedBy: "Kumari (Maths)" },
  });
  assert.deepEqual([m.preparedBy, m.checkedBy, m.generatedBy], ["Sadun (Staff)", "Kumari (Maths)", "Nadeesha (Administrator)"]);
  assert.equal(m.deductions[0].person, "Chathura (Staff)");
  assert.equal(m.deductions[0].authorizedBy, "Ruwan (Admin)");
  assert.equal(m.staff[0].name, "Sadun (Staff)");
  const text = html(m);
  for (const stored of ["Sadun (Staff)", "Kumari (Maths)", "Chathura (Staff)", "Ruwan (Admin)"]) assert.ok(text.includes(stored), stored);
});

test("the info grid has three rows a side: Date, Prepared by, Checked by (admin) | Document no., Status, Generated", () => {
  const text = makeBlocks(dayModel()).find((b) => b.id === "header")!.render();
  const out = renderToStaticMarkup(createElement("div", null, text));
  const mid = out.indexOf("<span>Document no.</span>");
  const left = out.slice(out.indexOf('class="ds-info"'), mid);
  const right = out.slice(mid);
  const order = (s: string, labels: string[]) => labels.map((l) => s.indexOf(`<span>${l}</span>`));
  const l = order(left, ["Date", "Prepared by", "Checked by (admin)"]);
  const r = order(right, ["Document no.", "Status", "Generated"]);
  assert.ok(l.every((i) => i >= 0) && l[0] < l[1] && l[1] < l[2], "left column order");
  assert.ok(r.every((i) => i >= 0) && r[0] < r[1] && r[1] < r[2], "right column order");
  assert.ok(!left.includes("<span>Status</span>") && !left.includes("<span>Generated</span>"));
});

test("the document carries the reconcile warning in the course note when some course does not reconcile, and not otherwise", () => {
  const bad = dayModel({ courses: [{ ...base.courses[0], reconciles: false }, base.courses[1]] });
  assert.equal(bad.reconcileWarning, "1 row(s) do not reconcile: a payment used a tier outside Full/Half/25%");
  assert.ok(html(bad).includes("1 row(s) do not reconcile: a payment used a tier outside Full/Half/25%."));
  assert.equal(dayModel().reconcileWarning, null);
  assert.ok(!html(dayModel()).includes("do not reconcile"));
});

test("the RANGE document carries the reconcile warning in its course note too (same model, same words)", () => {
  const m = buildDocModel({
    report: { ...base, from: "2026-10-12", to: "2026-10-17", courses: [{ ...base.courses[0], reconciles: false }, base.courses[1]] },
    cancelled: { receipts: 0, total: "0.00" }, generated, generatedBy: "N",
    byDay: { days: [{ date: "2026-10-12", collected: "1.00", deductions: "0.00", net: "1.00" }], total: { date: "total", collected: "1.00", deductions: "0.00", net: "1.00" } },
  });
  assert.equal(m.kind, "range");
  assert.equal(m.reconcileWarning, "1 row(s) do not reconcile: a payment used a tier outside Full/Half/25%");
  assert.ok(html(m).includes("1 row(s) do not reconcile: a payment used a tier outside Full/Half/25%."));
});

test("a day document has the signature boxes and the info grid; the words 'Asia/Colombo' appear nowhere in it", () => {
  const text = html(dayModel());
  for (const needle of ["Prepared by", "Checked by (admin)", "Signature", "Date", "Document no.", "DS-20261014", "Draft, not saved", "Wednesday, 14 October 2026", "Collection and cash book", "XENON", "INSTITUTE"]) {
    assert.ok(text.includes(needle), needle);
  }
  assert.ok(!text.includes("Asia/Colombo"));
});

test("a range document: day-by-day, no cash book, no signatures, no bank, no staff table", () => {
  const m = buildDocModel({
    report: { ...base, from: "2026-10-12", to: "2026-10-14" }, cancelled: { receipts: 0, total: "0.00" }, generated, generatedBy: "Nadeesha",
    byDay: {
      days: [{ date: "2026-10-12", collected: "100.00", deductions: "40.00", net: "60.00" }, { date: "2026-10-13", collected: "0.00", deductions: "4500.00", net: "-4500.00" }],
      total: { date: "total", collected: "100.00", deductions: "4540.00", net: "-4440.00" },
    },
  });
  const ids = makeBlocks(m).map((b) => b.id);
  assert.deepEqual(ids, ["header", "dayByDay", "courses", "income", "deductions"]);
  const text = html(m);
  assert.ok(text.includes("−4,500.00") && text.includes("Day by day"));
  assert.ok(!/Cash book|Signature|Left in drawer|Prepared by/.test(text));
  assert.equal(m.docNo, "DS-20261012-20261014");
});

// ---- the stylesheet against the Chrome 102 floor ----------------------------------------------------------------

test("document CSS: nothing newer than Chrome 102, hex colours only, nothing under 12px", () => {
  const css = DOCUMENT_CSS;
  assert.ok(!/(?<![-\w])(?:translate|scale|rotate):/.test(css), "standalone translate/scale/rotate (Chrome 104)");
  assert.ok(!/\d(?:svh|dvh|lvh)\b/.test(css), "svh/dvh/lvh (Chrome 108)");
  for (const bad of [":has(", "@container", "color-mix", "oklch", "oklab", "text-wrap", "field-sizing", "subgrid", "@layer", "rgb(", "hsl("]) {
    assert.ok(!css.includes(bad), bad);
  }
  for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 12, `font-size ${m[1]}px`);
  assert.ok(!css.includes("tabular-nums"), "html2canvas draws default figures, so tabular figures would move right-aligned numbers in the PDF");
  assert.ok(css.includes("size: A4") && css.includes("margin: 0"), "@page A4, no margin");
  assert.ok(css.includes("width: 794px") && css.includes("height: 1123px"), "fixed A4 sheet");
  assert.ok(/body > \*:not\(#xenon-print\)\s*{\s*display: revert !important/.test(css), "gives the page back from the global 58 mm rule");
  assert.ok(css.includes("#xenon-print { display: none !important; }"));
});


test("print width: blocks are measured at 713 px and every table's columns add up to at most 713 (210 mm prints a 713.7 px content box)", () => {
  assert.equal(MEASURE_W, 713);
  assert.ok(MEASURE_W <= (210 / 25.4) * 96 - 80, "less than the printed content box");
  const m = /\.ds-measure \{[^}]*width: (\d+)px/.exec(DOCUMENT_CSS);
  assert.ok(m && Number(m[1]) <= 713, "the measuring container is at most 713 px");
  const withBank = dayModel({}, { bank: [{ cents: 100, time: "09:00", slip: "", note: "" }] });
  const range = buildDocModel({ report: { ...base, from: "2026-10-12", to: "2026-10-14" }, cancelled: { receipts: 0, total: "0.00" }, generated, generatedBy: "N", byDay: { days: [{ date: "2026-10-12", collected: "1.00", deductions: "0.00", net: "1.00" }], total: { date: "total", collected: "1.00", deductions: "0.00", net: "1.00" } } });
  let tables = 0;
  for (const model of [withBank, range]) {
    for (const block of makeBlocks(model)) {
      const out = renderToStaticMarkup(createElement("div", null, block.render()));
      if (!out.includes("<table")) continue;
      tables++;
      const sum = [...out.matchAll(/<col style="width:(\d+)px"/g)].reduce((s, x) => s + Number(x[1]), 0);
      assert.ok(sum > 0 && sum <= 713, `${block.id}: columns add up to ${sum}`);
    }
  }
  assert.ok(tables >= 6, "courses, deductions, bank, staff (day) and day-by-day, courses, deductions (range)");
});

test("pages are filled 20 px short of the footer, on top of the rounding slack", () => {
  assert.ok(CONTENT_H <= SHEET_H - PAD_TOP - FOOTER_RESERVE - SAFETY_MARGIN);
  assert.equal(SAFETY_MARGIN, 20);
});


// ---- behaviour (not source text) for the page margin, the overflow warning and the PDF step's temporary rule --------

test("paginateDocument leaves the 20 px margin: a block that would just fit in the old height goes to the next sheet", () => {
  const block = (id: string, height: number) => ({ id, height });
  const old = SHEET_H - PAD_TOP - FOOTER_RESERVE - 4; // the content height before the margin existed
  assert.equal(CONTENT_H, old - SAFETY_MARGIN);
  // 985 + 30 = 1015 fits in the old height (1015) but not in this one (995)
  assert.equal(paginateDocument([block("a", CONTENT_H - 10), block("b", 30)]).length, 2, "split across two sheets");
  assert.equal(paginateDocument([block("a", CONTENT_H - 10), block("b", 10)]).length, 1, "exactly full still fits");
  const full = paginateDocument([block("a", CONTENT_H)]);
  assert.equal(full.length, 1);
  assert.equal(full[0].overflow, false);
  assert.equal(paginateDocument([block("a", CONTENT_H + 1)])[0].overflow, true, "one px more than a sheet holds is flagged");
});

test("the overflow warning: the sentence when any page overflows, nothing otherwise, and the notice renders it visibly but not on paper", () => {
  const ok = { placements: [], used: 10, overflow: false };
  const bad = { placements: [], used: 5000, overflow: true };
  assert.equal(overflowWarning([ok, ok]), null);
  assert.equal(overflowWarning([ok, bad]), OVERFLOW_WARNING);
  assert.match(OVERFLOW_WARNING, /may be cut off/);
  assert.equal(renderToStaticMarkup(createElement(OverflowNotice, { pages: [ok] })), "");
  const shown = renderToStaticMarkup(createElement(OverflowNotice, { pages: [ok, bad] }));
  assert.ok(shown.includes(OVERFLOW_WARNING) && shown.includes('role="alert"'), "visible and announced");
  assert.ok(shown.includes("no-print"), "and kept off the paper");
});

test("withTemporaryStyle puts the rule on the page while it runs and takes it off however the run ends (returns, throws, rejects)", async () => {
  const makeDoc = () => {
    const attached = new Set<object>();
    const doc = {
      head: { appendChild: (n: object) => (attached.add(n), n) },
      createElement: () => {
        const el = { textContent: "", remove() { attached.delete(el); } };
        return el;
      },
    };
    return { doc: doc as unknown as Document, attached };
  };
  // returns
  let h = makeDoc();
  const value = await withTemporaryStyle(h.doc, "x{y:z}", async () => {
    assert.equal(h.attached.size, 1, "on the page during the run");
    assert.equal([...h.attached][0] && (([...h.attached][0] as { textContent: string }).textContent), "x{y:z}");
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(h.attached.size, 0, "removed after a normal return");
  // rejects
  h = makeDoc();
  await assert.rejects(() => withTemporaryStyle(h.doc, "x", async () => { throw new Error("capture failed"); }), /capture failed/);
  assert.equal(h.attached.size, 0, "removed after a rejection");
  // throws synchronously inside the callback
  h = makeDoc();
  await assert.rejects(() => withTemporaryStyle(h.doc, "x", (() => { throw new Error("sync"); }) as () => Promise<never>), /sync/);
  assert.equal(h.attached.size, 0, "removed after a synchronous throw");
  // many runs leave nothing behind
  h = makeDoc();
  for (let i = 0; i < 20; i++) await withTemporaryStyle(h.doc, "x", async () => i).catch(() => undefined);
  assert.equal(h.attached.size, 0);
});

test("the PDF step's rule is the inline-image rule, and its failure sentence is the agreed one", () => {
  assert.ok(IMG_RULE.includes("img { display: inline !important;"));
  assert.ok(IMG_RULE.includes("vertical-align: baseline"));
  assert.equal(PDF_FAIL_MESSAGE, "Couldn't make the PDF on this device. Use Print and choose Save as PDF.");
});

test("wiring: the view fits blocks with paginateDocument only (no CONTENT_H or paginate of its own), shows OverflowNotice, and the PDF step goes through withTemporaryStyle", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const read = (f: string) => readFileSync(path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document", f), "utf8");
  const view = read("document-view.tsx");
  assert.ok(view.includes("paginateDocument(measure("));
  assert.ok(!/\bCONTENT_H\b/.test(view) && !/[^e]paginate\(/.test(view), "no local content height, no direct paginate call");
  assert.ok(view.includes("<OverflowNotice pages={pages} />"));
  assert.ok(read("make-pdf.ts").includes("withTemporaryStyle(document, IMG_RULE"));
});

// ---- one source for the sheet's numbers --------------------------------------------------------------------------

test("sheet-geometry.ts is the single source: the stylesheet shows its numbers, and neither the stylesheet nor the PDF step writes 794, 1123 or 713 itself", async () => {
  const css = DOCUMENT_CSS;
  assert.ok(css.includes(`width: ${SHEET_W}px;`) && css.includes(`height: ${SHEET_H}px;`));
  assert.ok(css.includes(`padding: ${PAD_TOP}px ${PAD_SIDE}px;`));
  assert.ok(new RegExp(`\\.ds-measure \\{[^}]*width: ${MEASURE_W}px`).test(css));
  assert.ok(css.includes(`width: ${A4_W_MM}mm; height: ${A4_H_MM}mm;`));
  assert.ok(MEASURE_W <= (A4_W_MM / 25.4) * 96 - 2 * PAD_SIDE, "measured no wider than the printed content box");
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document");
  for (const f of ["document-css.ts", "make-pdf.ts", "paginate-document.ts", "document-view.tsx"]) {
    assert.ok(!/\b(794|1123|713)\b/.test(readFileSync(path.join(dir, f), "utf8")), `${f} has no hard-coded sheet number`);
  }
  assert.ok(readFileSync(path.join(dir, "make-pdf.ts"), "utf8").includes("SHEET_W") && readFileSync(path.join(dir, "document-css.ts"), "utf8").includes("SHEET_W"));
});
