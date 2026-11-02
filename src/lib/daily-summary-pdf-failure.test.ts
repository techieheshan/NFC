import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { runCaptures, SCALES, type CapturePlan } from "@/app/(app)/daily-summary/document/capture-plan";
import { trackNew } from "@/app/(app)/daily-summary/document/clone-cleanup";
import { makeOnClone } from "@/app/(app)/daily-summary/document/clone-fonts";
import { ATTEMPT_DEADLINES_MS, DeadlineError, IMPORT_DEADLINE_MS, withDeadline } from "@/app/(app)/daily-summary/document/deadline";
import { downloadPdf, PDF_BUSY_MESSAGE } from "@/app/(app)/daily-summary/document/download-pdf";
import { BusyError, createLock } from "@/app/(app)/daily-summary/document/exclusive";
import { PDF_FAIL_MESSAGE } from "@/app/(app)/daily-summary/document/make-pdf";
import { SheetFontsError, type FontFaceLike, type FontSetLike } from "@/app/(app)/daily-summary/document/sheet-fonts";

/*
 * Daily Summary R1: whatever goes wrong while the PDF is made — a missing font, a clone that never loads, a canvas the device
 * cannot allocate — the person sees ONE sentence and no file is made; a slow device still gets a PDF at a lower scale.
 *
 * Everything with logic (the deadline, the retries, the lock, the clone cleanup, the clone-font step) is tested by BEHAVIOUR with
 * fake timers and fake fonts. What cannot run without a browser (make-pdf.ts's own wiring, the view) is read with the TypeScript
 * parser at the end.
 */

const MESSAGE = "Couldn't make the PDF on this device. Use Print and choose Save as PDF.";
const never = () => new Promise<never>(() => undefined);
const tick = () => new Promise<void>((r) => setImmediate(r));

// ---- fake timers: setTimeout / clearTimeout become a registry we can look at and fire by hand ----
type Timer = { id: number; ms: number; fn: () => void };
const realSet = globalThis.setTimeout;
const realClear = globalThis.clearTimeout;
let registry: Timer[] = [];
let fired: number[] = [];
let created: number[] = [];
function installFakeTimers() {
  registry = [];
  fired = [];
  created = [];
  let next = 1;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    const t = { id: next++, ms: ms ?? 0, fn };
    created.push(t.ms);
    registry.push(t);
    return t.id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    registry = registry.filter((t) => t.id !== id);
  }) as unknown as typeof clearTimeout;
}
function restoreTimers() {
  globalThis.setTimeout = realSet;
  globalThis.clearTimeout = realClear;
}
/** Fires the oldest pending timer (as the clock reaching it would) and returns its delay. */
function fireOldest(): number {
  const t = registry.shift();
  assert.ok(t, "a timer is pending");
  fired.push(t.ms);
  t.fn();
  return t.ms;
}
const pending = () => registry.length;
afterEach(restoreTimers);

// ---- downloadPdf ----

test("downloadPdf: null when the PDF was made, and the agreed sentence for EVERY kind of failure", async () => {
  assert.equal(PDF_FAIL_MESSAGE, MESSAGE);
  assert.equal(await downloadPdf(async () => undefined), null);
  const failures: (() => Promise<void>)[] = [
    async () => { throw new SheetFontsError(["Geist 400 (failed to load)"]); },
    async () => { throw new DeadlineError(25_000); },
    async () => { throw new RangeError("Invalid array length"); },
    async () => { throw "a string, not an Error"; },
    () => Promise.reject(undefined),
    (() => { throw new Error("thrown before a promise exists"); }) as () => Promise<void>,
  ];
  for (const make of failures) assert.equal(await downloadPdf(make), MESSAGE);
});

test("downloadPdf waits for the step: it does not report success early, and a slow success is still a success", async () => {
  let finished = false;
  const r = await downloadPdf(async () => { await new Promise((res) => realSet(res, 30)); finished = true; });
  assert.equal(r, null);
  assert.ok(finished);
});

test("downloadPdf: a second tap while a PDF is being made says so (its own sentence), it is not 'couldn't make the PDF'", async () => {
  assert.notEqual(PDF_BUSY_MESSAGE, MESSAGE);
  assert.equal(await downloadPdf(async () => { throw new BusyError(); }), PDF_BUSY_MESSAGE);
});

// ---- withDeadline, with fake timers ----

test("withDeadline: a result passes through and leaves NO timer pending", async () => {
  installFakeTimers();
  assert.equal(await withDeadline(Promise.resolve(7), 1000), 7);
  assert.equal(pending(), 0, "the timer was cleared after success");
});

test("withDeadline: a rejection passes through unchanged and leaves NO timer pending", async () => {
  installFakeTimers();
  await assert.rejects(() => withDeadline(Promise.reject(new Error("real failure")), 1000), /real failure/);
  assert.equal(pending(), 0, "the timer was cleared after failure");
});

test("withDeadline: something that never settles is given up on when ITS timer fires, with that delay", async () => {
  installFakeTimers();
  const run = withDeadline(never(), 4321).then(() => null, (e: unknown) => e);
  assert.equal(pending(), 1);
  assert.equal(registry[0].ms, 4321, "the timer is for the requested time");
  fireOldest();
  const err = await run;
  assert.ok(err instanceof DeadlineError && err.ms === 4321);
  assert.equal(pending(), 0);
});

test("withDeadline: a step that settles AFTER the deadline changes nothing (the first outcome stands)", async () => {
  installFakeTimers();
  let late!: (v: number) => void;
  const run = withDeadline(new Promise<number>((r) => { late = r; }), 100).then(() => "value", () => "deadline");
  fireOldest();
  assert.equal(await run, "deadline");
  late(5);
  await tick();
  assert.equal(pending(), 0);
});

test("the deadlines: one per rung, each long enough to matter, a hung capture ends within about 75 s, the import within about 20 s", () => {
  assert.deepEqual([...SCALES], [2, 1.5, 1]);
  assert.equal(ATTEMPT_DEADLINES_MS.length, SCALES.length, "each scale has its own deadline");
  assert.ok(ATTEMPT_DEADLINES_MS.every((ms) => ms >= 10_000), "none is so short that a working device is cut off");
  assert.ok(ATTEMPT_DEADLINES_MS.reduce((a, b) => a + b, 0) <= 75_000, "a hung capture ends within 75 s in total");
  assert.ok(IMPORT_DEADLINE_MS >= 10_000 && IMPORT_DEADLINE_MS <= 20_000, String(IMPORT_DEADLINE_MS));
});

// ---- runCaptures: the retry behaviour ----

type Call = { index: number; scale: number };
function plan(over: Partial<CapturePlan<string>> = {}, count = 2) {
  const calls: Call[] = [];
  const finishes: string[][] = [];
  const progress: string[] = [];
  let cleanups = 0;
  const p: CapturePlan<string> = {
    count,
    scales: SCALES,
    deadlinesMs: ATTEMPT_DEADLINES_MS,
    capture: async (index, scale) => { calls.push({ index, scale }); return `img-${index}@${scale}`; },
    finish: (images) => { finishes.push(images); },
    cleanup: () => { cleanups++; },
    onProgress: (page, total) => progress.push(`${page}/${total}`),
    ...over,
  };
  return { p, calls, finishes, progress, cleanups: () => cleanups };
}
/** Lets a started run reach its next await, so its deadline timer exists. */
const settle = async () => { await tick(); await tick(); };

test("runCaptures: all good at scale 2 → every sheet once, in order; finish gets all images; progress is 'page n of N'", async () => {
  installFakeTimers();
  const t = plan();
  await runCaptures(t.p);
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }, { index: 1, scale: 2 }]);
  assert.deepEqual(t.finishes, [["img-0@2", "img-1@2"]]);
  assert.deepEqual(t.progress, ["1/2", "2/2"]);
  assert.equal(t.cleanups(), 0, "nothing to clean after a success");
  assert.equal(pending(), 0, "no deadline timer left running");
});

test("runCaptures: a SheetFontsError gives EXACTLY ONE attempt — no smaller scale, no finish, one cleanup", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); throw new SheetFontsError(["Geist 400 (not loaded)"]); } });
  const err = await runCaptures(t.p).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof SheetFontsError);
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }], "one attempt, one sheet");
  assert.equal(t.finishes.length, 0);
  assert.equal(t.cleanups(), 1);
  assert.equal(pending(), 0);
});

test("runCaptures: a SheetFontsError on the SECOND sheet also stops everything (no retry at a smaller scale)", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); if (index === 1) throw new SheetFontsError(["clone"]); return "ok"; } });
  await assert.rejects(() => runCaptures(t.p), SheetFontsError);
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }, { index: 1, scale: 2 }]);
  assert.equal(t.finishes.length, 0);
});

test("runCaptures: a DeadlineError on a sheet → the SAME sheet again at the next scale under the NEXT deadline; later sheets stay on that rung", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); if (scale === 2) return never(); return `img-${index}@${scale}`; } });
  const run = runCaptures(t.p);
  await settle();
  assert.equal(registry[0].ms, ATTEMPT_DEADLINES_MS[0], "scale 2 runs under the first deadline");
  fireOldest(); // sheet 0 stalls at scale 2
  await run;
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }, { index: 0, scale: 1.5 }, { index: 1, scale: 1.5 }]);
  assert.deepEqual(t.finishes, [["img-0@1.5", "img-1@1.5"]], "finish ran once, with the retried sheet and the next one");
  assert.equal(t.cleanups(), 1, "the abandoned attempt was cleaned up");
  assert.deepEqual(fired, [ATTEMPT_DEADLINES_MS[0]]);
  assert.equal(pending(), 0);
});

test("runCaptures: a stall on a LATER sheet keeps the sheets already drawn (they are not redone)", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); if (index === 1 && scale === 2) return never(); return `img-${index}@${scale}`; } });
  const run = runCaptures(t.p);
  await settle();
  fireOldest();
  await run;
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }, { index: 1, scale: 2 }, { index: 1, scale: 1.5 }]);
  assert.deepEqual(t.finishes, [["img-0@2", "img-1@1.5"]]);
});

test("runCaptures: the deadline is for ONE sheet, not the whole document — a slow device that finishes each sheet in time is never cut off", async () => {
  installFakeTimers();
  const t = plan({}, 6);
  await runCaptures(t.p);
  assert.equal(t.calls.length, 6);
  assert.deepEqual(registry, [], "each sheet's timer was cleared when its sheet finished");
  assert.equal(t.finishes.length, 1);
});

test("runCaptures: scales 2 and 1.5 both stall on the sheet → it is drawn at scale 1 under the third deadline", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); if (scale !== 1) return never(); return `img-${index}@1`; } }, 1);
  const run = runCaptures(t.p);
  await settle();
  fireOldest();
  await settle();
  assert.equal(registry[0].ms, ATTEMPT_DEADLINES_MS[1], "scale 1.5 runs under the second deadline");
  fireOldest();
  await run;
  assert.deepEqual(created, [...ATTEMPT_DEADLINES_MS], "scale 1 ran under the third deadline");
  assert.deepEqual(t.calls.map((c) => c.scale), [2, 1.5, 1]);
  assert.equal(t.cleanups(), 2);
  assert.deepEqual(t.finishes, [["img-0@1"]]);
});

test("runCaptures: a capture that hangs on every rung → exactly three attempts, a DeadlineError, nothing finished, and downloadPdf gives the ONE message", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); return never(); } });
  const run = runCaptures(t.p).then(() => null, (e: unknown) => e);
  for (let i = 0; i < 3; i++) { await settle(); fireOldest(); }
  const err = await run;
  assert.ok(err instanceof DeadlineError);
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }, { index: 0, scale: 1.5 }, { index: 0, scale: 1 }]);
  assert.deepEqual(fired, [...ATTEMPT_DEADLINES_MS], "each attempt ran under its own deadline");
  assert.equal(t.finishes.length, 0);
  assert.equal(t.cleanups(), 3);
  assert.equal(pending(), 0);
  assert.equal(await downloadPdf(async () => { throw err; }), MESSAGE);
});

test("runCaptures: each rung uses ITS OWN deadline (distinct values, so 'always the first' cannot pass)", async () => {
  installFakeTimers();
  const t = plan({ deadlinesMs: [1111, 2222, 3333], capture: async (index, scale) => { t.calls.push({ index, scale }); return never(); } }, 1);
  const run = runCaptures(t.p).then(() => null, (e: unknown) => e);
  for (let i = 0; i < 3; i++) { await settle(); fireOldest(); }
  assert.ok((await run) instanceof DeadlineError);
  assert.deepEqual(created, [1111, 2222, 3333]);
  assert.deepEqual(fired, [1111, 2222, 3333]);
});

test("runCaptures: the ladder is shared — stalls on three DIFFERENT sheets still end after three failed attempts in total, not three per sheet", async () => {
  installFakeTimers();
  // every attempt at the current rung of its own sheet stalls: sheet 0 @2 → sheet 0 @1.5 ok; sheet 1 @1.5 stalls → @1 ok; sheet 2 @1 stalls → end
  const t = plan({
    capture: async (index, scale) => {
      t.calls.push({ index, scale });
      if ((index === 0 && scale === 2) || (index === 1 && scale === 1.5) || (index === 2 && scale === 1)) return never();
      return `img-${index}@${scale}`;
    },
  }, 3);
  const run = runCaptures(t.p).then(() => null, (e: unknown) => e);
  for (let i = 0; i < 3; i++) { await settle(); fireOldest(); }
  assert.ok((await run) instanceof DeadlineError);
  assert.deepEqual(t.calls, [{ index: 0, scale: 2 }, { index: 0, scale: 1.5 }, { index: 1, scale: 1.5 }, { index: 1, scale: 1 }, { index: 2, scale: 1 }]);
  assert.equal(fired.length, 3, "three deadlines in total: the hung-capture bound does not grow with the number of sheets");
  assert.ok(fired.reduce((a, b) => a + b, 0) <= 75_000);
});

test("runCaptures: a failure that is not a deadline (the canvas cannot be allocated) also moves the same sheet to the next scale", async () => {
  installFakeTimers();
  const t = plan({ capture: async (index, scale) => { t.calls.push({ index, scale }); if (scale === 2) throw new RangeError("Invalid array length"); return "ok"; } }, 1);
  await runCaptures(t.p);
  assert.deepEqual(t.calls.map((c) => c.scale), [2, 1.5]);
});

test("runCaptures: every rung fails with an ordinary error → that error is thrown (and downloadPdf gives the one message)", async () => {
  installFakeTimers();
  const t = plan({ capture: async () => { throw new RangeError("Invalid array length"); } }, 1);
  const err = await runCaptures(t.p).then(() => null, (e: unknown) => e);
  assert.ok(err instanceof RangeError);
  assert.equal(await downloadPdf(async () => { throw err; }), MESSAGE);
});

test("runCaptures: building the PDF failing is a failure of the whole job, not a retry of the sheets", async () => {
  installFakeTimers();
  const t = plan({ finish: () => { throw new Error("out of memory"); } }, 1);
  await assert.rejects(() => runCaptures(t.p), /out of memory/);
  assert.equal(t.calls.length, 1, "the sheet was not drawn again");
});

test("runCaptures: a LATE result from an abandoned attempt is harmless — it is told it is dead, and it draws nothing, reports nothing, finishes nothing", async () => {
  installFakeTimers();
  const held: ((v: string) => void)[] = [];
  const liveChecks: (() => boolean)[] = [];
  const t = plan({
    capture: async (index, scale, isLive) => {
      t.calls.push({ index, scale });
      liveChecks.push(isLive);
      if (scale === 2) return new Promise<string>((r) => held.push(r));
      return `img-${index}@${scale}`;
    },
  });
  const run = runCaptures(t.p);
  await settle();
  assert.equal(liveChecks[0](), true, "alive while it runs");
  fireOldest(); // sheet 0 stalls at scale 2 → abandoned
  await run;
  assert.equal(liveChecks[0](), false, "…and dead once it was given up on");
  assert.equal(liveChecks[1](), true, "the attempt that succeeded stays alive");
  const callsBefore = t.calls.length, progressBefore = t.progress.length, finishesBefore = t.finishes.length;
  held[0]("late-image"); // the abandoned capture finally answers
  await settle();
  assert.equal(t.calls.length, callsBefore);
  assert.equal(t.progress.length, progressBefore);
  assert.equal(t.finishes.length, finishesBefore);
  assert.deepEqual(t.finishes[0], ["img-0@1.5", "img-1@1.5"], "the late image is not in the PDF");
});

// ---- the lock: one capture at a time ----

test("createLock: a second run while one is in progress is refused at once; it is allowed again when the first ends, however it ends", async () => {
  const lock = createLock();
  let release!: () => void;
  const first = lock.run(() => new Promise<string>((r) => { release = () => r("first"); }));
  assert.equal(lock.held, true);
  await assert.rejects(() => lock.run(async () => "second"), BusyError);
  release();
  assert.equal(await first, "first");
  assert.equal(lock.held, false);
  assert.equal(await lock.run(async () => "third"), "third");
  await assert.rejects(() => lock.run(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(lock.held, false, "released after a failure too");
  assert.equal(await lock.run(async () => "fifth"), "fifth");
});

// ---- the clone cleanup ----

test("trackNew: removes the copies that appeared since, and never one that was already there", () => {
  type El = { name: string; removed: boolean; remove(): void };
  const el = (name: string): El => ({ name, removed: false, remove() { this.removed = true; } });
  const page: El[] = [el("someone-elses")];
  const track = trackNew(() => page.filter((e) => !e.removed));
  const a = el("clone-a"), b = el("clone-b");
  page.push(a, b);
  assert.equal(track.removeNew(), 2);
  assert.deepEqual(page.map((e) => [e.name, e.removed]), [["someone-elses", false], ["clone-a", true], ["clone-b", true]]);
  assert.equal(track.removeNew(), 0, "nothing left to remove");
});

// ---- the clone-font step (html2canvas's onclone) ----

const faces: FontFaceLike[] = [{ family: "Geist", status: "loaded" }];
function fakeFonts(missing: boolean): FontSetLike & { loads: string[] } {
  const loads: string[] = [];
  return {
    loads,
    ready: Promise.resolve(),
    load: (font: string) => { loads.push(font); return Promise.resolve([{}]); },
    check: () => !missing,
    [Symbol.iterator]: () => faces[Symbol.iterator](),
  };
}
function fakeCloneDoc(fonts: FontSetLike) {
  const html = { background: "", color: "" };
  const body = { background: "", color: "" };
  return { doc: { documentElement: { style: html }, body: { style: body }, fonts } as unknown as Document, html, body };
}

test("onclone checks the CLONE's fonts — every weight — and never the live page's document.fonts", async () => {
  const pageFonts = fakeFonts(false);
  const cloneFonts = fakeFonts(false);
  (globalThis as { document?: unknown }).document = { fonts: pageFonts };
  try {
    const { doc, html, body } = fakeCloneDoc(cloneFonts);
    await makeOnClone(["Geist"], "Daily Summary")(doc);
    assert.deepEqual(cloneFonts.loads.sort(), ['400 13px "Geist"', '600 13px "Geist"', '700 13px "Geist"']);
    assert.deepEqual(pageFonts.loads, [], "the live page's fonts were not consulted");
    assert.equal(html.background, "#ffffff", "the clone's <html> gets a white page");
    assert.equal(body.background, "#ffffff", "…and so does its <body>");
    assert.equal(body.color, "#1d1530", "…with the document's text colour");
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

test("onclone: fonts missing in the CLONE → SheetFontsError, even though the live page's fonts are fine", async () => {
  (globalThis as { document?: unknown }).document = { fonts: fakeFonts(false) };
  try {
    const { doc } = fakeCloneDoc(fakeFonts(true));
    await assert.rejects(() => makeOnClone(["Geist"], "Daily Summary")(doc), SheetFontsError);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
});

// ---- wiring, read with the parser ----
const DIR = path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document");
const parse = (f: string) => ts.createSourceFile(f, readFileSync(path.join(DIR, f), "utf8"), ts.ScriptTarget.ES2022, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
function calls(sf: ts.SourceFile, name: string): ts.CallExpression[] {
  const out: ts.CallExpression[] = [];
  const walk = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === name) out.push(n);
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return out;
}
const isInside = (n: ts.Node, ancestor: ts.Node) => { for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (p === ancestor) return true; return false; };

test("make-pdf: sheetsToPdf runs through the lock; the imports have their deadline; the plan gets SCALES and ATTEMPT_DEADLINES_MS and a cleanup; leftover clones are removed in a finally", () => {
  const sf = parse("make-pdf.ts");
  // the lock
  const lockRuns = calls(sf, "pdfLock.run");
  assert.equal(lockRuns.length, 1);
  const exported = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "sheetsToPdf");
  assert.ok(exported && isInside(lockRuns[0], exported), "the exported sheetsToPdf calls pdfLock.run");
  assert.ok(sf.getText().includes("createLock()"), "a module-level lock exists");
  // the imports
  const withD = calls(sf, "withDeadline");
  assert.equal(withD.length, 1, "one withDeadline in make-pdf (the per-attempt deadline is inside runCaptures)");
  assert.equal(withD[0].arguments[1].getText(), "IMPORT_DEADLINE_MS");
  assert.ok(calls(sf, "import").length === 2 && calls(sf, "import").every((c) => isInside(c, withD[0])), "both dynamic imports are inside that deadline");
  // the plan
  const [plan] = calls(sf, "runCaptures");
  assert.ok(plan, "runCaptures is called");
  const props = Object.fromEntries((plan.arguments[0] as ts.ObjectLiteralExpression).properties.map((p) => [p.name?.getText(), p]));
  assert.equal((props.scales as ts.PropertyAssignment).initializer.getText(), "SCALES");
  assert.equal((props.deadlinesMs as ts.PropertyAssignment).initializer.getText(), "ATTEMPT_DEADLINES_MS");
  assert.ok(props.cleanup && props.onProgress && props.capture && props.finish, "cleanup, progress, capture and finish are all given");
  // a late canvas from an abandoned attempt is freed, not encoded: the capture asks isLive() before toDataURL
  const capture = (props.capture as ts.PropertyAssignment).initializer as ts.ArrowFunction;
  assert.deepEqual(capture.parameters.map((q) => q.name.getText()), ["i", "scale", "isLive"], "the capture is handed isLive");
  const liveCalls = calls(sf, "isLive");
  const encode = calls(sf, "canvas.toDataURL");
  assert.ok(liveCalls.length === 1 && encode.length === 1 && isInside(encode[0], liveCalls[0].parent), "toDataURL is only reached when isLive() says so");
  // leftover clones: tracked, removed after a failed attempt (cleanup) and in a finally
  assert.equal(calls(sf, "trackNew").length, 1);
  const removes = calls(sf, "clones.removeNew");
  assert.ok(removes.length >= 2);
  assert.ok(removes.some((r) => isInside(r, props.cleanup)), "removed after a failed attempt");
  assert.ok(removes.some((r) => { for (let p: ts.Node | undefined = r.parent; p; p = p.parent) if (ts.isTryStatement(p) && p.finallyBlock && isInside(r, p.finallyBlock)) return true; return false; }), "and in a finally, whatever happens");
});

test("make-pdf draws every sheet INSIDE withTemporaryStyle(document, IMG_RULE, …), so the image rule is on the page for the capture and off it afterwards", () => {
  const sf = parse("make-pdf.ts");
  const [styled] = calls(sf, "withTemporaryStyle");
  assert.ok(styled, "withTemporaryStyle is called");
  assert.equal(styled.arguments[0].getText(), "document");
  assert.equal(styled.arguments[1].getText(), "IMG_RULE");
  assert.ok(ts.isArrowFunction(styled.arguments[2]) || ts.isFunctionExpression(styled.arguments[2]), "the capture is its callback");
  const captures = calls(sf, "html2canvas");
  assert.ok(captures.length >= 1);
  for (const c of captures) assert.ok(isInside(c, styled.arguments[2]), "every html2canvas capture is inside that callback");
  assert.ok(calls(sf, "runCaptures").every((c) => isInside(c, styled.arguments[2])), "…and so is the retry loop");
});

test("the view shows what downloadPdf returns, shows 'Preparing PDF, page n of N', disables the button while busy, and has no failure sentence of its own", () => {
  const sf = parse("document-view.tsx");
  const dl = calls(sf, "downloadPdf");
  assert.equal(dl.length, 1);
  assert.ok(calls(sf, "setError").some((c) => c.arguments[0]?.getText() === "problem"));
  const src = readFileSync(path.join(DIR, "document-view.tsx"), "utf8");
  assert.ok(!src.includes("Couldn't make the PDF"), "the sentence lives in one place (make-pdf.ts)");
  assert.match(src, /Preparing PDF, page \$\{progress\.page\} of \$\{progress\.total\}/);
  assert.match(src, /disabled=\{!pages \|\| busy\}/);
  assert.ok(calls(sf, "sheetsToPdf").length === 1 && calls(sf, "sheetsToPdf")[0].arguments.length === 3, "progress is passed to sheetsToPdf");
  assert.ok(calls(sf, "setProgress").some((c) => c.arguments[0]?.getText() === "null"), "the progress text is cleared when the PDF ends, however it ends");
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
