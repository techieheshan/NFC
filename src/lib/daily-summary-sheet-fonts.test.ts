import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  FONT_TIMEOUT_MS, SHEET_FONT_WEIGHTS, SheetFontsError, ensureSheetFonts, sheetFamilies,
  type FontFaceLike, type FontSetLike,
} from "@/app/(app)/daily-summary/document/sheet-fonts";

/*
 * Daily Summary R1: the PDF is made only when the sheets' fonts are REALLY loaded. ensureSheetFonts is tested with fake font sets
 * (loaded, blocked, hanging, undeclared); the wiring in make-pdf.ts is read with the TypeScript parser.
 */

const SPEC = (w: number, f: string) => `${w} 13px "${f}"`;

/** A fake FontFaceSet. `behaviour` says what loading each family does. */
function fakeFonts(faces: FontFaceLike[], behaviour: Record<string, "ok" | "reject" | "hang" | "unloaded"> = {}): FontSetLike & { loadCalls: string[] } {
  const calls: string[] = [];
  const family = (font: string) => /"([^"]+)"/.exec(font)![1];
  return {
    loadCalls: calls,
    ready: Promise.resolve(),
    load: (font: string) => {
      calls.push(font);
      const b = behaviour[family(font)] ?? "ok";
      if (b === "reject") return Promise.reject(new Error("NetworkError"));
      if (b === "hang") return new Promise<unknown[]>(() => undefined);
      return Promise.resolve([{}]);
    },
    check: (font: string) => (behaviour[family(font)] ?? "ok") !== "unloaded",
    [Symbol.iterator]: () => faces[Symbol.iterator](),
  };
}
const FACES = [{ family: "Geist", status: "loaded" }, { family: '"Noto Sans Sinhala"', status: "unloaded" }, { family: "Geist Fallback", status: "loaded" }];
const LATIN = "Daily Summary 1,500.00 Sadun";
const WITH_SINHALA = `${LATIN} සුනිල් ගුණසේන`;

test("sheetFamilies: the named families of the CSS list, without quotes, generics or '… Fallback' stand-ins", () => {
  assert.deepEqual(sheetFamilies('Geist, "Geist Fallback", "Noto Sans Sinhala", "Noto Sans Sinhala Fallback", system-ui, sans-serif'), ["Geist", "Noto Sans Sinhala"]);
  assert.deepEqual(sheetFamilies("serif"), []);
  assert.deepEqual(sheetFamilies(""), []);
  assert.deepEqual(sheetFamilies("Geist, Geist, 'Geist'"), ["Geist"], "each once");
});

test("everything loaded: resolves, and EVERY weight of every needed family was loaded (Geist 400/600/700; Noto Sans Sinhala too when there is Sinhala)", async () => {
  const fonts = fakeFonts(FACES);
  await ensureSheetFonts({ fonts, families: ["Geist", "Noto Sans Sinhala"], text: WITH_SINHALA });
  for (const w of SHEET_FONT_WEIGHTS) {
    assert.ok(fonts.loadCalls.includes(SPEC(w, "Geist")), `Geist ${w}`);
    assert.ok(fonts.loadCalls.includes(SPEC(w, "Noto Sans Sinhala")), `Noto Sans Sinhala ${w}`);
  }
  assert.deepEqual([...SHEET_FONT_WEIGHTS], [400, 600, 700]);
});

test("no Sinhala on the sheets: the Sinhala webfont is not required and not even requested", async () => {
  const fonts = fakeFonts(FACES, { "Noto Sans Sinhala": "reject" });
  await ensureSheetFonts({ fonts, families: ["Geist", "Noto Sans Sinhala"], text: LATIN });
  assert.ok(!fonts.loadCalls.some((c) => c.includes("Sinhala")));
});

async function failure(opts: Parameters<typeof ensureSheetFonts>[0]): Promise<SheetFontsError> {
  const err = await ensureSheetFonts(opts).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof SheetFontsError, "throws SheetFontsError");
  return err as SheetFontsError;
}

test("a font that fails to load (blocked, network error): SheetFontsError naming it", async () => {
  const e = await failure({ fonts: fakeFonts(FACES, { Geist: "reject" }), families: ["Geist"], text: LATIN });
  assert.ok(e.missing.some((m) => m.startsWith("Geist 400") && m.includes("failed to load")), e.message);
  assert.equal(e.missing.filter((m) => m.startsWith("Geist")).length, SHEET_FONT_WEIGHTS.length, "every weight reported");
});

test("a Sinhala webfont that fails to load WHEN the sheets contain Sinhala: no PDF", async () => {
  const e = await failure({ fonts: fakeFonts(FACES, { "Noto Sans Sinhala": "reject" }), families: ["Geist", "Noto Sans Sinhala"], text: WITH_SINHALA });
  assert.ok(e.missing.every((m) => m.startsWith("Noto Sans Sinhala")), "Geist was fine, only Sinhala is missing: " + e.message);
});

test("a font still loading after the timeout: no PDF, and the wait is short (not the browser's default)", async () => {
  const t0 = Date.now();
  const e = await failure({ fonts: fakeFonts(FACES, { Geist: "hang" }), families: ["Geist"], text: LATIN, timeoutMs: 40 });
  const took = Date.now() - t0;
  assert.ok(e.missing.every((m) => m.includes("timed out")), e.message);
  assert.ok(took < 1000, `gave up after about the timeout (took ${took} ms)`);
  assert.ok(FONT_TIMEOUT_MS >= 1000 && FONT_TIMEOUT_MS <= 10_000, "a short, sensible default");
});

test("a family that is not declared at all (its stylesheet never arrived): no PDF", async () => {
  const e = await failure({ fonts: fakeFonts([{ family: "Geist Fallback", status: "loaded" }]), families: ["Geist"], text: LATIN });
  assert.deepEqual(e.missing, ["Geist (not declared)"]);
});

test("a font that 'loaded' but is not usable (check says no): no PDF", async () => {
  const e = await failure({ fonts: fakeFonts(FACES, { Geist: "unloaded" }), families: ["Geist"], text: LATIN });
  assert.ok(e.missing.every((m) => m.includes("not loaded")));
});

test("document.fonts.ready that never settles does not hang the PDF: it times out and no PDF is made", async () => {
  const fonts = { ...fakeFonts(FACES), ready: new Promise<unknown>(() => undefined) } as FontSetLike;
  const e = await failure({ fonts, families: ["Geist"], text: LATIN, timeoutMs: 40 });
  assert.ok(e.missing.includes("fonts still loading (timed out)"));
});

// ---- the wiring in make-pdf.ts, read with the parser ----

const MAKE_PDF = path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document", "make-pdf.ts");

test("make-pdf checks the fonts before it draws anything, and again inside html2canvas's clone step, and does not retry a missing font", () => {
  const sf = ts.createSourceFile("make-pdf.ts", readFileSync(MAKE_PDF, "utf8"), ts.ScriptTarget.ES2022, true);
  const calls: { pos: number; inOnclone: boolean }[] = [];
  let withStylePos = -1;
  let rethrowsFontError = false;
  const walk = (n: ts.Node, inOnclone: boolean) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === "ensureSheetFonts") calls.push({ pos: n.getStart(), inOnclone });
      if (n.expression.text === "withTemporaryStyle") withStylePos = n.getStart();
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && ts.isIdentifier(n.right) && n.right.text === "SheetFontsError") rethrowsFontError = true;
    let next = inOnclone;
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "onclone") {
      assert.ok(ts.isArrowFunction(n.initializer) && !!n.initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword), "onclone is an async function (html2canvas awaits what it returns)");
      next = true;
    }
    ts.forEachChild(n, (c) => walk(c, next));
  };
  walk(sf, false);
  const before = calls.filter((c) => !c.inOnclone);
  assert.equal(before.length, 1, "one check before the capture");
  assert.ok(before[0].pos < withStylePos, "…and it comes before the page is touched and anything is drawn");
  assert.equal(calls.filter((c) => c.inOnclone).length, 1, "one check inside onclone, on the clone's own fonts");
  assert.ok(rethrowsFontError, "a SheetFontsError is rethrown, not retried at a smaller scale");
});
