import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { A4_H_MM, A4_W_MM, CONTENT_H, MEASURE_W, PAD_SIDE, PAD_TOP, SHEET_H, SHEET_W } from "@/app/(app)/daily-summary/document/sheet-geometry";
import { DOCUMENT_CSS } from "@/app/(app)/daily-summary/document/document-css";

/*
 * Daily Summary R1: the A4 sheet's numbers live in ONE file (document/sheet-geometry.ts), and the fitting of blocks to sheets
 * in ONE function (document/paginate-document.ts). These tests read the real source with the TypeScript compiler's parser, so
 * an ALIAS cannot get round them: `import { CONTENT_H as H }`, `import { paginate as fit }`, `import * as g from "./sheet-geometry"`,
 * a re-export, a dynamic import() and a numeric literal are all seen for what they are.
 */

const DIR = path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document");
const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));
const sourceOf = (f: string) => ts.createSourceFile(f, readFileSync(path.join(DIR, f), "utf8"), ts.ScriptTarget.ES2022, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/**
 * The module an import specifier really names, as a repo-relative path without extension: "@/lib/paginate" and
 * "../../../../lib/paginate" (from this folder) are the SAME module and must be seen as one.
 */
function canon(spec: string): string {
  let abs: string;
  if (spec.startsWith("@/")) abs = path.join(process.cwd(), "src", spec.slice(2));
  else if (spec.startsWith(".")) abs = path.resolve(DIR, spec);
  else return spec; // a package
  return path.relative(process.cwd(), abs).split(path.sep).join("/").replace(/\.(tsx?|jsx?)$/, "");
}

type Imp = { module: string; names: string[]; namespace: boolean; typeOnly: boolean; dynamic: boolean; reexport: boolean };

function importsOf(sf: ts.SourceFile): Imp[] {
  const out: Imp[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      const names: string[] = [];
      let namespace = false;
      if (c?.name) names.push("default");
      if (c?.namedBindings) {
        if (ts.isNamespaceImport(c.namedBindings)) namespace = true;
        else for (const e of c.namedBindings.elements) names.push((e.propertyName ?? e.name).text); // the ORIGINAL name, whatever it is called locally
      }
      out.push({ module: canon(n.moduleSpecifier.text), names, namespace, typeOnly: !!c?.isTypeOnly, dynamic: false, reexport: false });
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const names = n.exportClause && ts.isNamedExports(n.exportClause) ? n.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : [];
      out.push({ module: canon(n.moduleSpecifier.text), names, namespace: !n.exportClause || ts.isNamespaceExport(n.exportClause), typeOnly: n.isTypeOnly, dynamic: false, reexport: true });
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      out.push({ module: canon(n.arguments[0].text), names: [], namespace: true, typeOnly: false, dynamic: true, reexport: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const GEOMETRY = canon("./sheet-geometry");
const PAGINATE = canon("@/lib/paginate");
/** The only files that may take the sheet's numbers from sheet-geometry.ts. */
const MAY_IMPORT_GEOMETRY = new Set(["document-css.ts", "make-pdf.ts", "paginate-document.ts"]);
/** The only file that may use the paginator's VALUES (types are fine anywhere). */
const MAY_IMPORT_PAGINATE_VALUES = new Set(["paginate-document.ts"]);

test("the parser sees what it should (guard against a test that parses nothing)", () => {
  assert.ok(files.length >= 10, `${files.length} source files in the document folder`);
  const view = importsOf(sourceOf("document-view.tsx"));
  assert.ok(view.some((i) => i.module === canon("./paginate-document") && i.names.includes("paginateDocument")));
  assert.ok(view.some((i) => i.module === canon("./make-pdf") && i.names.includes("sheetsToPdf")));
  const aliased = ts.createSourceFile("x.ts", `import { CONTENT_H as H } from "./sheet-geometry"; import { paginate as fit } from "@/lib/paginate"; import * as g from "./sheet-geometry"; export * from "./sheet-geometry"; const m = import("./sheet-geometry");`, ts.ScriptTarget.ES2022, true);
  const found = importsOf(aliased);
  assert.deepEqual(found.map((i) => [i.module, i.names.join(","), i.namespace, i.dynamic, i.reexport]), [
    [GEOMETRY, "CONTENT_H", false, false, false],
    [PAGINATE, "paginate", false, false, false],
    [GEOMETRY, "", true, false, false],
    [GEOMETRY, "", true, false, true],
    [GEOMETRY, "", true, true, false],
  ], "an alias, a namespace import, a re-export and a dynamic import are all reported under their real module and original name");
});

test("a RELATIVE path to the same module is seen as that module (not only the '@/…' spelling)", () => {
  assert.equal(canon("@/lib/paginate"), "src/lib/paginate");
  assert.equal(canon("../../../../lib/paginate"), "src/lib/paginate", "four levels up from the document folder");
  assert.equal(canon("../../../../lib/paginate.ts"), "src/lib/paginate", "with an extension too");
  assert.equal(canon("./sheet-geometry"), canon("@/app/(app)/daily-summary/document/sheet-geometry"));
  assert.equal(canon("../document/sheet-geometry"), GEOMETRY, "round-trips through a sibling folder name");
  assert.equal(canon("react"), "react", "a package stays as it is");
  const sneaky = ts.createSourceFile("x.ts", `import { paginate as fit } from "../../../../lib/paginate"; import { CONTENT_H as H } from "../document/sheet-geometry"; export { SHEET_W } from "../../daily-summary/document/sheet-geometry";`, ts.ScriptTarget.ES2022, true);
  const found = importsOf(sneaky);
  assert.deepEqual(found.map((i) => i.module), [PAGINATE, GEOMETRY, GEOMETRY], "all three are caught under their real module");
  assert.ok(found.every((i) => !i.typeOnly));
});

test("only the stylesheet, the PDF step and the fitting function import the sheet's numbers — under any alias, namespace, re-export or import()", () => {
  const offenders: string[] = [];
  for (const f of files) {
    const touches = importsOf(sourceOf(f)).filter((i) => i.module === GEOMETRY);
    if (touches.length > 0 && !MAY_IMPORT_GEOMETRY.has(f) && f !== "sheet-geometry.ts") offenders.push(`${f} imports ${touches.map((t) => t.names.join(",") || "*").join(";")}`);
  }
  assert.deepEqual(offenders, []);
  // and those three really do take the numbers from there
  const need = { "document-css.ts": ["SHEET_W", "SHEET_H", "PAD_TOP", "PAD_SIDE", "MEASURE_W", "A4_W_MM", "A4_H_MM"], "make-pdf.ts": ["SHEET_W", "SHEET_H", "A4_W_MM", "A4_H_MM"], "paginate-document.ts": ["CONTENT_H"] } as const;
  for (const [f, names] of Object.entries(need)) {
    const got = importsOf(sourceOf(f)).filter((i) => i.module === GEOMETRY).flatMap((i) => i.names);
    for (const n of names) assert.ok(got.includes(n), `${f} imports ${n} from sheet-geometry`);
  }
});

test("the view fits blocks with paginateDocument and nothing else: it cannot take CONTENT_H or the paginator under another name", () => {
  const view = sourceOf("document-view.tsx");
  const imps = importsOf(view);
  assert.ok(!imps.some((i) => i.module === GEOMETRY), "document-view.tsx does not import sheet-geometry at all");
  for (const i of imps.filter((x) => x.module === PAGINATE)) assert.ok(i.typeOnly, `document-view.tsx imports ${i.names.join(",") || "*"} from the paginator as a VALUE`);
  // no value import of the paginator anywhere but paginate-document.ts
  const offenders = files.filter((f) => !MAY_IMPORT_PAGINATE_VALUES.has(f)).filter((f) => importsOf(sourceOf(f)).some((i) => i.module === PAGINATE && !i.typeOnly));
  // (type-only `import type` is fine; an inline `import { type Block, type Page }` has no value names, which the check below confirms)
  assert.deepEqual(offenders.filter((f) => {
    const sf = sourceOf(f);
    let valueNames = 0;
    sf.forEachChild((n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.moduleSpecifier.text === PAGINATE && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
        valueNames += n.importClause.namedBindings.elements.filter((e) => !e.isTypeOnly && !n.importClause!.isTypeOnly).length;
      }
    });
    return valueNames > 0;
  }), []);
  assert.ok(imps.some((i) => i.module === canon("./paginate-document") && i.names.includes("paginateDocument")));
  // and the call is really made: paginateDocument( ... ) appears as a call expression (not just an import)
  let called = false;
  const walk = (n: ts.Node) => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "paginateDocument") called = true; ts.forEachChild(n, walk); };
  walk(view);
  assert.ok(called, "document-view.tsx calls paginateDocument");
});

test("no source file in the folder (except sheet-geometry.ts) writes a sheet number itself: numeric literals, strings and template text", () => {
  const BANNED = new Set([SHEET_W, SHEET_H, MEASURE_W, MEASURE_W + 1, A4_W_MM, A4_H_MM, CONTENT_H]);
  const textBanned = /(?<![\d.])(794|1123|713|714|210|297)(?![\d])/;
  const found: string[] = [];
  for (const f of files.filter((x) => x !== "sheet-geometry.ts")) {
    const walk = (n: ts.Node) => {
      if (ts.isNumericLiteral(n) && BANNED.has(Number(n.text))) found.push(`${f}: number ${n.text}`);
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && textBanned.test(n.text)) found.push(`${f}: text "${n.text.slice(0, 40)}"`);
      ts.forEachChild(n, walk);
    };
    walk(sourceOf(f));
  }
  assert.deepEqual(found, []);
});

test("the stylesheet is built from the constants: its output shows exactly their values", () => {
  assert.ok(DOCUMENT_CSS.includes(`width: ${SHEET_W}px;`) && DOCUMENT_CSS.includes(`height: ${SHEET_H}px;`));
  assert.ok(DOCUMENT_CSS.includes(`padding: ${PAD_TOP}px ${PAD_SIDE}px;`));
  assert.ok(new RegExp(`\\.ds-measure \\{[^}]*width: ${MEASURE_W}px`).test(DOCUMENT_CSS));
  assert.ok(DOCUMENT_CSS.includes(`width: ${A4_W_MM}mm; height: ${A4_H_MM}mm;`));
  assert.ok(MEASURE_W <= (A4_W_MM / 25.4) * 96 - 2 * PAD_SIDE, "measured no wider than the printed content box");
});
