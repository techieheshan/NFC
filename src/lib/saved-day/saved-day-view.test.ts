import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildDocModel, type SavedDocInfo } from "@/app/(app)/daily-summary/document/model";
import { makeBlocks } from "@/app/(app)/daily-summary/document/blocks";
import { paginateDocument } from "@/app/(app)/daily-summary/document/paginate-document";
import { hasOverflow, type Block } from "@/lib/paginate";

import { snapshotOf } from "./fixtures";
import { savedByText } from "./history-text";
import { liveFromBundle } from "./live";
import { changeLogNewestFirst, changeLogRows, formatClock, formatWhen } from "./log-rows";
import type { LogEntry } from "./store";
import { checkClearedChip, checkedChip, checkRefusalMessage, conflictText, editedChip, HISTORY_NOTE, hintLabel, saveTitle, savedChip } from "./texts";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * Daily Summary R2, Phase 2: the pure pieces behind the screens and the document — change-log rows, the document model's saved-day
 * fields, the exact sentences, and the paginator with a long change log. No database, no browser.
 */

const T = (h: number, m = 0) => `2026-11-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`; // UTC; Colombo is +5:30

const v = (n: number, at: string, by: string, items: LogEntry["items"], check: LogEntry["check"] = null): LogEntry => ({
  version: n, kind: n === 1 ? "SAVE" : "EDIT", savedAt: at, doneByName: by, savedByName: "Sadun Staff", items, check,
});

const SIX: LogEntry[] = [
  v(1, T(4), "Nadeesha Admin", [{ t: "saved", by: "Nadeesha Admin" }], { checkedByName: "Ruwan Admin", markedByName: "Sadun Staff", checkedAt: T(4, 30), carriedFromVersion: null }),
  v(2, T(5), "Sadun Staff", [{ t: "edited-by", name: "Sadun Staff" }, { t: "bf", from: 10000, to: 20000 }, { t: "check-cleared", by: "Ruwan Admin", at: T(4, 30) }]),
  v(3, T(6), "තිලිණි පෙරේරා", [{ t: "edited-by", name: "තිලිණි පෙරේරා" }, { t: "bank+", line: { time: "10:30", cents: 150000, slip: "S-1", note: "Peoples" } }]),
  v(4, T(7), "Sadun Staff", [{ t: "edited-by", name: "Sadun Staff" }, { t: "bank~", from: { time: "10:30", cents: 150000, slip: "S-1", note: "Peoples" }, to: { time: "11:00", cents: 150000, slip: "S-2", note: "Peoples" } }], { checkedByName: "Ruwan Admin", markedByName: "Nadeesha Admin", checkedAt: T(7, 20), carriedFromVersion: null }),
  v(5, T(8), "Nadeesha Admin", [{ t: "edited-by", name: "Nadeesha Admin" }, { t: "bank-", line: { time: "11:00", cents: 150000, slip: "S-2", note: "Peoples" } }, { t: "check-cleared", by: "Ruwan Admin", at: T(7, 20) }]),
  v(6, T(9), "Sadun Staff", [{ t: "resaved", by: "Sadun Staff", diffs: [{ label: "Total collected", saved: "3,750.00", live: "3,250.00" }] }]),
];

// ---- log rows ---------------------------------------------------------------
test("formatWhen and formatClock read an instant in Colombo time (UTC+5:30), as '1 Nov 2026, 9:30 AM' and '9:30 AM'", () => {
  assert.equal(formatWhen(T(4)), "1 Nov 2026, 9:30 AM");
  assert.equal(formatClock(T(4)), "9:30 AM");
  assert.equal(formatWhen("2026-10-31T18:29:59Z"), "31 Oct 2026, 11:59 PM", "23:59:59 is still the 31st");
  assert.equal(formatWhen("2026-10-31T18:30:00Z"), "1 Nov 2026, 12:00 AM", "00:00:00 is the next day");
});

test("changeLogRows: one row per version plus one per RECORDED check, oldest first; a carried check is not a new event", () => {
  const rows = changeLogRows(SIX);
  assert.deepEqual(rows.map((r) => [r.version, r.by]), [
    [1, "Nadeesha Admin"], [1, "Sadun Staff"], // the save, then the check recorded by Sadun
    [2, "Sadun Staff"], [3, "තිලිණි පෙරේරා"], [4, "Sadun Staff"], [4, "Nadeesha Admin"], [5, "Nadeesha Admin"], [6, "Sadun Staff"],
  ]);
  assert.equal(rows[1].what, "Checked by Ruwan Admin, recorded by Sadun Staff");
  assert.equal(rows[5].what, "Checked by Ruwan Admin, recorded by Nadeesha Admin");
  assert.ok(rows[2].what.includes("Check cleared: the money changed after Ruwan Admin checked it") && rows[2].what.includes("Bring-forward changed from 100.00 to 200.00"));
  const carried = changeLogRows([v(1, T(4), "A", [{ t: "saved", by: "A" }], { checkedByName: "X", markedByName: "Y", checkedAt: T(4, 5), carriedFromVersion: 1 })]);
  assert.equal(carried.length, 1, "carriedFromVersion set: no extra row");
});

test("changeLogNewestFirst is the same rows reversed; events at the same second keep their order (a version then its own check)", () => {
  const asc = changeLogRows(SIX);
  assert.deepEqual(changeLogNewestFirst(SIX).map((r) => r.what), [...asc].reverse().map((r) => r.what));
  const same = changeLogRows([v(1, T(4), "A", [{ t: "saved", by: "A" }], { checkedByName: "X", markedByName: "Y", checkedAt: T(4), carriedFromVersion: null })]);
  assert.deepEqual(same.map((r) => r.what), ["Saved by A", "Checked by X, recorded by Y"]);
});

// ---- sentences ----------------------------------------------------------------
test("the screens' exact sentences", () => {
  assert.equal(savedChip(2, "Sadun", "4:32 PM"), "Saved · version 2 · Sadun · 4:32 PM");
  assert.equal(editedChip(3), "Edited · version 3");
  assert.equal(checkedChip("Nadeesha", "Sadun"), "Checked by Nadeesha, recorded by Sadun");
  assert.equal(checkClearedChip("Nadeesha", "names"), "Check cleared: names were corrected after Nadeesha checked it. An admin must check again.");
  assert.equal(checkClearedChip("Nadeesha", "money"), checkClearedChip("Nadeesha"), "money is the default");
  assert.equal(checkClearedChip("Nadeesha"), "Check cleared: the money changed after Nadeesha checked it. An admin must check again.");
  assert.equal(hintLabel("Yesterday", "12,000.00", true), "Yesterday closed with 12,000.00. Use this");
  assert.equal(hintLabel("Sat 10 Oct", "12,000.00", false), "Sat 10 Oct closed with 12,000.00 (not checked yet). Use this");
  assert.equal(saveTitle("Wed 14 Oct 2026"), "Save Wed 14 Oct 2026?");
  assert.equal(conflictText("Nadeesha", "4:32 PM", 2), "Nadeesha saved this day at 4:32 PM (version 2) while you were working. Your changes were NOT saved.");
});

test("History's note and the check sheet's refusal wording are exactly these sentences (literals, not the constants under test)", () => {
  assert.equal(HISTORY_NOTE, "Days with no saved summary are not listed. Details are kept for 3 months after the date. A PDF is made from the saved details whenever you print or download.");
  assert.equal(checkRefusalMessage({ reason: "conflict", message: "The server's long sentence about the day." }), "The day changed after you opened it. Look at the new numbers and check again.");
  assert.equal(checkRefusalMessage({ reason: "not-admin", message: "Choose an active admin from the list." }), "Choose an active admin from the list.");
  assert.equal(checkRefusalMessage({ reason: "over-banked", message: "Bank deposits are 5,000.00 more than the drawer should hold. Edit the bank lines or the bring-forward." }), "Bank deposits are 5,000.00 more than the drawer should hold. Edit the bank lines or the bring-forward.");
});

test("the document's footer (built in the browser after measuring) reads 'Generated <when> by <who> · <document no.> · <status>' from the model, with no 'Draft' typed into it", () => {
  const src = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "document", "document-view.tsx"), "utf8");
  assert.ok(src.includes("Generated {model.generatedText} by {model.generatedBy} · {model.docNo} · {model.footerStatus}"));
  assert.ok(!/·\s*Draft/.test(src), "the word Draft is the model's, not the view's");
});

test("the Admin check sheet words a refusal through checkRefusalMessage (the one place the conflict sentence comes from)", () => {
  const src = readFileSync(path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "check-sheet.tsx"), "utf8");
  assert.ok(src.includes("{checkRefusalMessage(refusal)}"));
  assert.ok(!src.includes("{refusal.message}"), "no second, hand-made wording");
});

test("changeLogRows orders by TIME even if the versions arrive out of order (a stable sort: equal times keep their order)", () => {
  const rows = changeLogRows([
    v(2, T(9), "Second", [{ t: "edited-by", name: "Second" }]),
    v(1, T(4), "First", [{ t: "saved", by: "First" }]),
    v(3, T(9), "Third", [{ t: "edited-by", name: "Third" }]),
  ]);
  assert.deepEqual(rows.map((r) => r.by), ["First", "Second", "Third"]);
});

test("savedByText: 'Saved by X' for a day never edited, 'Saved by X · edited by Y' after that", () => {
  assert.equal(savedByText({ version: 1, preparedByName: "Sadun", doneByName: "Sadun" }), "Saved by Sadun");
  assert.equal(savedByText({ version: 3, preparedByName: "Sadun", doneByName: "Thilini" }), "Saved by Sadun · edited by Thilini");
});

test("liveFromBundle builds a snapshot from what the page loaded, and answers null (never throws) for numbers that do not fit", () => {
  const s = snapshotOf();
  assert.deepEqual(liveFromBundle({ report: s.report, cancelled: s.cancelled, staff: s.staff }), s);
  assert.equal(liveFromBundle({ report: { from: "2026-10-14", to: "2026-10-14" } as never, cancelled: s.cancelled, staff: [] }), null);
});

// ---- the document model's saved-day fields ------------------------------------------------
const generated = { date: "2026-11-01", time: "21:18" };
const saved = (over: Partial<SavedDocInfo> = {}): SavedDocInfo => ({
  version: 1, savedAtIso: T(4), savedBy: "Nadeesha Admin", lastEditedAtIso: null, lastEditedBy: null, overBankedBy: null, log: SIX.slice(0, 1), ...over,
});
const model = (day: { preparedBy: string | null; checkedBy: string | null; saved?: SavedDocInfo }) => {
  const s = snapshotOf();
  return buildDocModel({ report: s.report, cancelled: s.cancelled, generated, generatedBy: "Sadun Staff", day: { staff: s.staff, bringForwardCents: 0, bank: [], ...day } });
};

test("document model: a draft says 'Draft, not saved', has no saved lines, no change log, footer 'Draft'", () => {
  const m = model({ preparedBy: null, checkedBy: null });
  assert.deepEqual([m.status, m.savedLine, m.lastEditedLine, m.changeLog, m.overBankedNote, m.footerStatus, m.preparedBy, m.checkedBy], ["Draft, not saved", null, null, null, null, "Draft", null, null]);
});

test("document model: saved version 1 — status, 'Saved <date, time> by <name>', footer 'Saved v1', no Last edited, no change log", () => {
  const m = model({ preparedBy: "Nadeesha Admin", checkedBy: null, saved: saved() });
  assert.equal(m.status, "Saved, version 1, not checked");
  assert.equal(m.savedLine, "Saved 1 Nov 2026, 9:30 AM by Nadeesha Admin");
  assert.deepEqual([m.lastEditedLine, m.changeLog, m.footerStatus], [null, null, "Saved v1"]);
  const checked = model({ preparedBy: "Nadeesha Admin", checkedBy: "Ruwan Admin", saved: saved() });
  assert.equal(checked.status, "Saved, version 1, checked");
});

test("document model: version 3 adds 'Last edited <date, time> by <latest Done by>', the change log (all versions, oldest first) and footer 'Saved v3'", () => {
  const m = model({ preparedBy: "Nadeesha Admin", checkedBy: null, saved: saved({ version: 3, lastEditedAtIso: T(6), lastEditedBy: "තිලිණි පෙරේරා", log: SIX.slice(0, 3) }) });
  assert.equal(m.status, "Saved, version 3, not checked");
  assert.equal(m.lastEditedLine, "Last edited 1 Nov 2026, 11:30 AM by තිලිණි පෙරේරා");
  assert.equal(m.footerStatus, "Saved v3");
  assert.ok(m.changeLog && m.changeLog.length === 4, "3 versions + 1 recorded check");
  assert.deepEqual(m.changeLog!.map((r) => r.version), [1, 1, 2, 3]);
});

test("document model: an over-banked saved day carries the one-line note", () => {
  const m = model({ preparedBy: "A", checkedBy: null, saved: saved({ overBankedBy: 500000 }) });
  assert.equal(m.overBankedNote, "Bank deposits are 5,000.00 more than the drawer should hold. Edit the bank lines or the bring-forward.");
  const out = renderToStaticMarkup(createElement("div", null, makeBlocks(m).map((b) => b.render())));
  assert.ok(out.includes("Bank deposits are 5,000.00 more than the drawer should hold"));
});

test("document blocks: the change log block exists only from version 2, is the LAST block, and prints names exactly as stored (Sinhala included)", () => {
  const one = makeBlocks(model({ preparedBy: "A", checkedBy: null, saved: saved() })).map((b) => b.id);
  assert.ok(!one.includes("changeLog"));
  const m = model({ preparedBy: "A", checkedBy: null, saved: saved({ version: 6, lastEditedAtIso: T(9), lastEditedBy: "Sadun Staff", log: SIX }) });
  const ids = makeBlocks(m).map((b) => b.id);
  assert.equal(ids[ids.length - 1], "changeLog");
  assert.ok(ids.indexOf("signatures") < ids.indexOf("changeLog"));
  const block = makeBlocks(m).find((b) => b.id === "changeLog")!;
  assert.equal(block.table, true, "a table block: it can split between rows");
  const out = renderToStaticMarkup(createElement("div", null, block.render()));
  for (const t of ["8 Change log", "තිලිණි පෙරේරා", "S-2", "Peoples", "Re-saved with live numbers by Sadun Staff", "v6"]) assert.ok(out.includes(t), t);
});

test("the signature boxes: names exactly as stored, an empty box for a draft and for 'not checked'", () => {
  const sig = (m: ReturnType<typeof model>) => renderToStaticMarkup(createElement("div", null, makeBlocks(m).find((b) => b.id === "signatures")!.render()));
  assert.equal((sig(model({ preparedBy: null, checkedBy: null })).match(/<div class="name"><\/div>/g) ?? []).length, 2);
  const one = sig(model({ preparedBy: "ශිෂ්‍ය සහායක", checkedBy: null, saved: saved() }));
  assert.ok(one.includes('<div class="name">ශිෂ්‍ය සහායක</div>') && (one.match(/<div class="name"><\/div>/g) ?? []).length === 1);
  const both = sig(model({ preparedBy: "A", checkedBy: "Ruwan Admin", saved: saved() }));
  assert.ok(both.includes('<div class="name">Ruwan Admin</div>') && !both.includes("recorded by"));
});

// ---- the paginator with a long change log --------------------------------------------------
test("a 6-version change log splits between rows with its header repeated, never inside a row, and never overflows a page", () => {
  const m = model({ preparedBy: "A", checkedBy: null, saved: saved({ version: 6, lastEditedAtIso: T(9), lastEditedBy: "Sadun Staff", log: SIX }) });
  const rows = m.changeLog!.length; // 8 rows
  assert.equal(rows, 8);
  // measured heights, as the browser would give them: a tall header, a page nearly full before the change log, 3-line rows
  const blocks: Block[] = [
    { id: "header", height: 300 },
    { id: "courses", height: 420 },
    { id: "signatures", height: 150 },
    { id: "changeLog", height: 40 + 8 * 70 + 20, table: { top: 40, contTop: 50, rows: Array.from({ length: 8 }, () => 70), bottom: 20 } },
  ];
  const pages = paginateDocument(blocks);
  assert.equal(hasOverflow(pages), false);
  const slices = pages.flatMap((p, pi) => p.placements.filter((x) => x.blockId === "changeLog").map((x) => ({ pi, ...x })));
  assert.ok(slices.length >= 2, "the table splits across at least two pages");
  assert.equal(slices[0].continued, false);
  assert.ok(slices.slice(1).every((x) => x.continued), "the header repeats on every continuation");
  let next = 0;
  for (const s of slices) {
    assert.equal(s.rowStart, next, "no row skipped or repeated");
    next = s.rowEnd!;
  }
  assert.equal(next, rows, "every row appears exactly once");
});
