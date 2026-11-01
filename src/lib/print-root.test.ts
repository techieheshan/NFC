import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * The blank-receipt bug on the POS terminal (Android 8.1, Chrome 102): globals.css hides everything except
 * #xenon-print while printing, and the print copy used to be a React portal that was removed when the receipt
 * screen unmounted (afterprint, or the 2.5 s auto-advance). Android composes the preview after window.print()
 * returns — and again when someone taps Print — so by then the page had NO print content and the whole app was
 * hidden: a blank page 1/1. The copy is now plain markup that outlives the component. A browser lab proved the
 * behaviour (printToPDF at 0 ... 4500 ms after print(), with afterprint never / at once / late); these tests only
 * pin the source so the fix cannot be undone by accident.
 */

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const receipt = read("src/app/(app)/payment/receipt.tsx");
const globals = read("src/app/globals.css");

test("the receipt's print copy is plain markup in #xenon-print, not a React portal that dies with the screen", () => {
  assert.doesNotMatch(receipt, /createPortal/, "a portal's children are removed when the component unmounts");
  assert.doesNotMatch(receipt, /host\.remove\(\)/, "the print root must not be removed by the component's own cleanup");
  assert.match(receipt, /host\.innerHTML = paper\.outerHTML/);
  assert.match(receipt, /document\.body\.appendChild\(host\)/);
});

test("the copy is replaced by the next receipt and pruned only long after the preview is done (10 minutes)", () => {
  assert.match(receipt, /PRINT_COPY_KEEP_MS = 10 \* 60 \* 1000/);
  assert.match(receipt, /window\.clearTimeout\(pruneTimer\)/);
  assert.match(receipt, /getElementById\("xenon-print"\)/); // reuses ONE root: a second receipt never leaves two
});

test("the copy is placed by a child effect, so it exists before AutoPrintReceipt asks the browser to print", () => {
  const view = receipt.slice(receipt.indexOf("export function ReceiptView"), receipt.indexOf("function Paper"));
  assert.match(view, /<PrintCopy paperRef=\{paperRef\} receipt=\{receipt\} \/>/);
});

test("the global rule that hides the app while printing is unchanged (it is what keeps the attendance screen off the paper)", () => {
  assert.match(globals, /body > \*:not\(#xenon-print\) \{\s*display: none !important;/);
  assert.match(globals, /#xenon-print \{\s*display: block !important;/);
});
