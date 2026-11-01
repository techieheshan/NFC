import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/*
 * Daily Summary R1: the words "Asia/Colombo" were printed in the screen subtitle and the PDF subtitle. They are gone
 * from the Daily Summary (screens and document). The other five places that print them are NOT part of this
 * release and are left exactly as they are.
 */

test("'Asia/Colombo' is gone from the Daily Summary screens and document (the other five places are left alone)", () => {
  const root = path.join(process.cwd(), "src", "app", "(app)", "daily-summary");
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
  walk(root);
  assert.ok(files.length >= 10);
  for (const f of files) assert.ok(!readFileSync(f, "utf8").includes("Asia/Colombo"), f);
  for (const other of [["payslips", "voucher", "sheet.tsx"], ["payslips", "payslips-screen.tsx"], ["reports", "report-screen.tsx"], ["reports", "monthly-income", "income-report.tsx"], ["search", "page.tsx"]]) {
    assert.ok(readFileSync(path.join(process.cwd(), "src", "app", "(app)", ...other), "utf8").includes("Asia/Colombo"), other.join("/"));
  }
});
