import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { test } from "node:test";
import assert from "node:assert/strict";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DOCUMENT_CSS } from "@/app/(app)/daily-summary/document/document-css";
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
    bringForward: "5,000.00", collected: "76,375.00", deductions: "−8,450.00", shouldBe: "72,925.00",
    bankCount: 2, bankTotal: "−65,000.00", left: "7,925.00", overdrawn: false,
  });
  const text = html(m);
  assert.ok(text.includes("Left in drawer") && text.includes("7,925.00"));
  assert.ok(text.includes("All money collected is cash. Bank deposits are listed below."));
  assert.deepEqual(m.bank.map((l) => [l.time, l.slip, l.amount]), [["10:30 AM", "S-1", "50,000.00"], ["1:05 PM", "—", "15,000.00"]]);
  assert.equal(m.bankTotal, "65,000.00");
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

test("the PDF step puts an inline-<img> rule on the page while it draws (html2canvas mis-places text under Tailwind's block images), and takes it off again", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const src = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document", "make-pdf.ts"), "utf8");
  assert.ok(src.includes("img { display: inline !important;"));
  assert.ok(src.includes("document.head.appendChild(fix)"));
  assert.equal(src.split("fix.remove()").length - 1, 2, "removed on success and on failure");
  assert.ok(src.includes("PDF_FAIL_MESSAGE") && src.includes("Couldn't make the PDF on this device. Use Print and choose Save as PDF."));
});
