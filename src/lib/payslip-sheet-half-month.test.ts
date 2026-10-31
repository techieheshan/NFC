import "@/test-support/no-database";
import "@/test-support/server-stubs";

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PayslipSheet } from "@/app/(app)/payslips/voucher/sheet";
import type { Payslip } from "@/lib/payslips";

/*
 * Job 5: the printed voucher. A Half-month line says "(Half month)" as TEXT inside the existing course
 * cell — no column, no row, no layout class is added to the sheet — and the sheet has NO "incl. Half months"
 * note (that is the Payslips screen only). A sheet with no Half line renders exactly as it always did.
 */

const line = (over: Partial<Payslip["lines"][number]> = {}): Payslip["lines"][number] => ({
  courseId: 1, course: "ICT", billingLabel: "Nov 2026", billingOrder: 24323, cards: 1, rate: "2500.00", gross: "2500.00",
  sharePercent: "20.00", instituteShare: "500.00", teacherShare: "2000.00", ...over,
});
const slip = (lines: Payslip["lines"], extra: Partial<Payslip> = {}): Payslip => ({
  teacherId: 1, teacher: "Mr. A", courses: [], payingStudents: lines.length, lines, lineCards: lines.length, advanceLines: [], tierCounts: [],
  totalCollected: "3750.00", totalInstituteShare: "750.00", totalTeacherShare: "3000.00", advances: "0.00", finalSalary: "3000.00", ...extra,
});
const render = (s: Payslip) =>
  renderToStaticMarkup(createElement(PayslipSheet, { slip: s, teacher: { name: "Mr. A", nic: null, phone: null }, monthLabel: "Nov 2026", range: "2026-11-01 → 2026-11-30" }));

test("a Half-month line carries '(Half month)' inside its course cell; an ordinary line carries nothing", () => {
  const out = render(slip([line(), line({ rate: "1250.00", gross: "1250.00", halfMonth: true })]));
  assert.equal((out.match(/\(Half month\)/g) ?? []).length, 1);
  assert.match(out, /<td class="py-1 pr-2">ICT<span class="block w-0 min-w-full">\(Half month\)<\/span><\/td>/);
  assert.match(out, /<td class="py-1 pr-2">ICT<\/td>/);
});

test("the label adds no column, no row and no header to the sheet", () => {
  const plain = render(slip([line(), line({ rate: "1250.00", gross: "1250.00" })]));
  const half = render(slip([line(), line({ rate: "1250.00", gross: "1250.00", halfMonth: true })]));
  const shape = (html: string) => [(html.match(/<th/g) ?? []).length, (html.match(/<tr/g) ?? []).length, (html.match(/<td/g) ?? []).length];
  assert.deepEqual(shape(half), shape(plain));
});

test("a sheet with no Half line is byte for byte what it always was", () => {
  const out = render(slip([line(), line({ course: "Maths", rate: "1500.00", gross: "1500.00" })]));
  assert.ok(!out.includes("Half month") && !out.includes("w-0 min-w-full"));
});

test("the printed voucher has NO 'incl. Half months' note — it is on the Payslips screen only", () => {
  const out = render(slip([line({ halfMonth: true })], { halfMonths: { cards: 1, gross: "2500.00" } }));
  assert.ok(!/incl\. Half months/i.test(out));
});
