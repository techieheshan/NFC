import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { CAPTURE_DEADLINE_MS, DeadlineError, withDeadline } from "@/app/(app)/daily-summary/document/deadline";
import { downloadPdf } from "@/app/(app)/daily-summary/document/download-pdf";
import { PDF_FAIL_MESSAGE } from "@/app/(app)/daily-summary/document/make-pdf";
import { SheetFontsError } from "@/app/(app)/daily-summary/document/sheet-fonts";

/*
 * Daily Summary R1: whatever goes wrong while the PDF is made — a missing font, a clone that never loads, a canvas the device
 * cannot allocate — the person sees ONE sentence and no file is made. Behaviour first (downloadPdf, withDeadline); the wiring in
 * make-pdf.ts and document-view.tsx is read with the TypeScript parser.
 */

const MESSAGE = "Couldn't make the PDF on this device. Use Print and choose Save as PDF.";
const never = () => new Promise<void>(() => undefined);

test("downloadPdf: null when the PDF was made, and the agreed sentence for EVERY kind of failure", async () => {
  assert.equal(PDF_FAIL_MESSAGE, MESSAGE);
  assert.equal(await downloadPdf(async () => undefined), null);
  const failures: (() => Promise<void>)[] = [
    async () => { throw new SheetFontsError(["Geist 400 (failed to load)"]); },
    async () => { throw new DeadlineError(30_000); },
    async () => { throw new RangeError("Invalid array length"); },
    async () => { throw "a string, not an Error"; },
    () => Promise.reject(undefined),
    (() => { throw new Error("thrown before a promise exists"); }) as () => Promise<void>,
  ];
  for (const make of failures) assert.equal(await downloadPdf(make), MESSAGE);
});

test("downloadPdf waits for the step: it does not report success early, and a slow success is still a success", async () => {
  let finished = false;
  const r = await downloadPdf(async () => { await new Promise((res) => setTimeout(res, 30)); finished = true; });
  assert.equal(r, null);
  assert.ok(finished);
});

test("withDeadline: passes a result through, passes a rejection through, and gives up on something that never settles", async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 1000), 7);
  await assert.rejects(() => withDeadline(Promise.reject(new Error("real failure")), 1000), /real failure/);
  const t0 = Date.now();
  const err = await withDeadline(never(), 40).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof DeadlineError && err.ms === 40);
  assert.ok(Date.now() - t0 < 1000, "gave up about on time");
});

test("withDeadline does not leave a timer behind after the step settles (a finished step must not fire an error later)", async () => {
  const seen: unknown[] = [];
  process.on("unhandledRejection", (e) => seen.push(e));
  await withDeadline(Promise.resolve(1), 30);
  await withDeadline(Promise.reject(new Error("x")), 30).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(seen, []);
});

test("the capture deadline is finite and generous (a slow terminal must not be cut off, a hung clone must not wait for ever)", () => {
  assert.ok(CAPTURE_DEADLINE_MS >= 10_000 && CAPTURE_DEADLINE_MS <= 60_000, String(CAPTURE_DEADLINE_MS));
});

// ---- wiring, read with the parser ----
const DIR = path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document");
const parse = (f: string) => ts.createSourceFile(f, readFileSync(path.join(DIR, f), "utf8"), ts.ScriptTarget.ES2022, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

test("make-pdf wraps EVERY html2canvas capture in the deadline, and does not retry a deadline or a missing font", () => {
  const sf = parse("make-pdf.ts");
  const captures: { wrapped: boolean; usesConstant: boolean }[] = [];
  let rethrowsDeadline = false;
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "html2canvas") {
      const parent = n.parent;
      const wrapped = ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === "withDeadline" && parent.arguments[0] === n;
      const usesConstant = wrapped && ts.isIdentifier((parent as ts.CallExpression).arguments[1]) && ((parent as ts.CallExpression).arguments[1] as ts.Identifier).text === "CAPTURE_DEADLINE_MS";
      captures.push({ wrapped, usesConstant });
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && ts.isIdentifier(n.right) && n.right.text === "DeadlineError") rethrowsDeadline = true;
    ts.forEachChild(n, walk);
  };
  walk(sf);
  assert.ok(captures.length >= 1, "there is a capture");
  assert.ok(captures.every((c) => c.wrapped && c.usesConstant), "every html2canvas call is inside withDeadline(…, CAPTURE_DEADLINE_MS)");
  assert.ok(rethrowsDeadline, "a DeadlineError is rethrown, not retried");
});

test("the view shows what downloadPdf returns and has no failure sentence of its own", () => {
  const sf = parse("document-view.tsx");
  let callsDownloadPdf = false;
  let setsError = false;
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === "downloadPdf") callsDownloadPdf = true;
      if (n.expression.text === "setError" && n.arguments[0] && ts.isIdentifier(n.arguments[0]) && n.arguments[0].text === "problem") setsError = true;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  assert.ok(callsDownloadPdf && setsError);
  assert.ok(!readFileSync(path.join(DIR, "document-view.tsx"), "utf8").includes("Couldn't make the PDF"), "the sentence lives in one place (make-pdf.ts)");
});

test("make-pdf draws every sheet INSIDE withTemporaryStyle(document, IMG_RULE, …), so the image rule is on the page for the capture and off it afterwards", () => {
  const sf = parse("make-pdf.ts");
  let styled: ts.CallExpression | null = null;
  const captures: ts.CallExpression[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === "withTemporaryStyle") styled = n;
      if (n.expression.text === "html2canvas") captures.push(n);
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  assert.ok(styled, "withTemporaryStyle is called");
  const call = styled as unknown as ts.CallExpression;
  assert.equal(call.arguments[0].getText(), "document");
  assert.equal(call.arguments[1].getText(), "IMG_RULE");
  assert.ok(ts.isArrowFunction(call.arguments[2]) || ts.isFunctionExpression(call.arguments[2]), "the capture is its callback");
  assert.ok(captures.length >= 1);
  for (const c of captures) {
    let inside = false;
    for (let p: ts.Node | undefined = c.parent; p; p = p.parent) if (p === call.arguments[2]) inside = true;
    assert.ok(inside, "every html2canvas capture is inside that callback");
  }
});

test("the view renders <OverflowNotice pages={pages} /> and has no overflow sentence of its own", () => {
  const sf = parse("document-view.tsx");
  let rendered = false;
  const walk = (n: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === "OverflowNotice") {
      rendered = n.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "pages");
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  assert.ok(rendered, "OverflowNotice is rendered with the pages");
  assert.ok(!readFileSync(path.join(DIR, "document-view.tsx"), "utf8").includes("may be cut off"), "the sentence lives in one place (paginate-document.ts)");
});
