import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient, UserRole } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";
import { shiftDay } from "@/lib/daily-summary-dates";

import { overBankedBanner, overBankRefusal } from "./over-bank";
import {
  checkClearedChip, checkedChip, editedChip, HISTORY_NOTE, LIVE_DIFFERS, NO_ADMIN, NOT_CHECKED_CHIP, NOT_SAVED_CHIP, savedChip, UNREADABLE_DAY,
} from "./texts";

/*
 * Daily Summary Release 2, Phase 2: every screen and the A4 document, RENDERED for real against a database (made-up data only).
 * The pages are called as the server calls them (with a stubbed session) and turned into markup, and each state is asserted on
 * what comes back (rules 29 and 30), never on a status code. Every test builds its own days, so each passes when run alone.
 */

const NOW = "2026-11-01T15:48:00Z"; // 21:18 in Colombo on 1 Nov 2026
const SAVED_AT = "9:18 PM";

type Q = Record<string, string | string[] | undefined>;
type Page = (a: { searchParams: Promise<Q> }) => Promise<React.ReactNode> | React.ReactNode;

let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: typeof import("@/app/(app)/daily-summary/saved-actions");
let dayPage: unknown;
let docPage: unknown;
let historyPage: unknown;
let admin2: { id: string };
let staff2: { id: string };
let studentId: number;
let xenonId: number;

const html = async (P: unknown, q: Q = {}) => renderToStaticMarkup((await (P as Page)({ searchParams: Promise.resolve(q) })) as React.ReactElement);
const as = (role: UserRole | null, id = "nobody") => setSession(role, id);
const line = (amount: string, time = "09:15", slip = "", note = "") => ({ time, amount, slip, note });
const plain = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<!-- -->/g, "");

describe("Release 2 screens and document, rendered against a real database", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/daily-summary/saved-actions");
    ({ default: dayPage } = await import("@/app/(app)/daily-summary/page"));
    ({ default: docPage } = await import("@/app/(app)/daily-summary/document/page"));
    ({ default: historyPage } = await import("@/app/(app)/daily-summary/history/page"));
    w = await seedWorld(db);
    const st = (name: string) => db.staff.create({ data: { name } });
    await db.user.update({ where: { id: w.admin.id }, data: { username: "nadeesha", staffId: (await st("Nadeesha Admin")).id } });
    await db.user.update({ where: { id: w.staff.id }, data: { username: "sadun", staffId: (await st("Sadun Staff")).id } });
    admin2 = await db.user.create({ data: { username: "ruwan", passwordHash: "x", role: "ADMIN", staffId: (await st("Ruwan Admin")).id } });
    staff2 = await db.user.create({ data: { username: "thilini", passwordHash: "x", role: "STAFF", staffId: (await st("තිලිණි පෙරේරා")).id } });
    studentId = (await makeStudent(db)).id;
    xenonId = (await db.expenseType.create({ data: { code: "XENON", label: "Xenon" } })).id;
    await db.expenseType.create({ data: { code: "TEACHER_ADVANCE", label: "Teacher advance", affectsTeacherPayslip: true } });
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  // ---- helpers ----------------------------------------------------------------
  let dayCounter = 0;
  async function makeDay(o: { pays?: string[]; spends?: [string, string][] } = {}): Promise<string> {
    const date = shiftDay("2026-09-20", dayCounter++);
    for (const [i, amount] of (o.pays ?? ["2500.00", "1250.00"]).entries()) {
      await db.payment.create({ data: { kind: "ADMISSION", studentId, amount, takenById: w.staff.id, paidAt: new Date(`${date}T0${4 + i}:00:00Z`) } });
    }
    for (const [amount, reason] of o.spends ?? []) {
      await db.expense.create({ data: { expenseTypeId: xenonId, amount, reason, date: colomboDateValue(date), recordedById: w.staff.id, authorizedById: admin2.id } });
    }
    return date;
  }
  const seen = async (date: string) => {
    const { dailySummary } = await import("@/lib/reports");
    const r = await dailySummary(date, date);
    return { collected: Math.round(Number(r.totalCollected) * 100), deductions: Math.round(Number(r.deductions.total) * 100) };
  };
  async function save(date: string, doneById: string, over: Record<string, unknown> = {}) {
    as("STAFF", w.staff.id);
    const r = await A.saveDay({ date, mode: "save", baseVersion: 0, doneById, bringForward: "", bank: [], seen: await seen(date), ...over });
    assert.ok(r.ok, JSON.stringify(r));
  }
  async function edit(date: string, base: number, doneById: string, over: Record<string, unknown> = {}) {
    as("STAFF", w.staff.id);
    const r = await A.saveDay({ date, mode: "edit", baseVersion: base, doneById, bringForward: "", bank: [], ...over });
    assert.ok(r.ok, JSON.stringify(r));
  }
  async function check(date: string, base: number, adminId: string, tapper: UserRole = "STAFF") {
    as(tapper, tapper === "ADMIN" ? w.admin.id : w.staff.id);
    const r = await A.markChecked({ date, baseVersion: base, checkedById: adminId });
    assert.ok(r.ok, JSON.stringify(r));
  }
  const dayHtml = async (date: string) => plain(await html(dayPage, { date }));
  const docHtml = async (date: string) => plain(await html(docPage, { date }));

  // ---- a draft ------------------------------------------------------------------
  test("a draft day: 'Not saved', Save day, Print and Download PDF always on, no signer selects, History link", async () => {
    const date = await makeDay();
    as("STAFF", w.staff.id);
    const h = await dayHtml(date);
    assert.ok(h.includes(NOT_SAVED_CHIP) && h.includes("Save day") && h.includes("auto=print") && h.includes("auto=pdf") && h.includes("/daily-summary/history"));
    assert.ok(!h.includes("Prepared by") && !h.includes("Checked by") && !h.includes(NOT_CHECKED_CHIP) && !h.includes(UNREADABLE_DAY));
    assert.ok(h.includes("3,750.00"), "the live collected figure");
    // the hint is absent when nothing was saved within 7 days
    assert.ok(!h.includes("Use this"));
  });

  test("the hint: 'Yesterday closed with 12,000.00. Use this', named date for an older day, '(not checked yet)', none once a bring-forward is typed; never auto-filled", async () => {
    const prev = await makeDay({ pays: ["15000.00"] });
    const date = shiftDay(prev, 1);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "500.00", takenById: w.staff.id, paidAt: new Date(`${date}T05:00:00Z`) } });
    dayCounter++; // the next makeDay must not reuse `date`
    await save(prev, w.admin.id, { bank: [line("3,000.00")] }); // Left in drawer 12,000.00
    as("STAFF", w.staff.id);
    let h = await dayHtml(date);
    assert.ok(h.includes("Yesterday closed with 12,000.00 (not checked yet). Use this"), "yesterday, not checked yet");
    assert.ok(/id="bf"|Bring-forward/.test(h) && !/value="12000\.00"/.test(h), "the field is NOT filled for the person");
    await check(prev, 1, w.admin.id);
    as("STAFF", w.staff.id);
    h = await dayHtml(date);
    assert.ok(h.includes("Yesterday closed with 12,000.00. Use this") && !h.includes("not checked yet"));
    const later = shiftDay(prev, 3); // three days later: an older saved day, named by its date
    h = await dayHtml(later);
    assert.match(h, /(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2} closed with 12,000\.00\. Use this/, "an older day is named by its date");
    assert.ok(!h.includes("Yesterday closed with"));
    // typing a bring-forward in the address hides the hint
    assert.ok(!(plain(await html(dayPage, { date, bf: "50" }))).includes("closed with"));
  });

  // ---- saved -------------------------------------------------------------------
  test("a saved day: the chip 'Saved · version 1 · <Done by> · <time>', frozen numbers, stored deposits with their recorder, Edit / Admin check / Print / Download PDF, 'Not checked'", async () => {
    const date = await makeDay({ pays: ["2500.00", "1250.00"], spends: [["950.00", "repair: door lock"]] });
    await save(date, w.staff.id, { bringForward: "5,000.00", bank: [line("1,500.00", "09:15", "SLIP-1", "Peoples Bank")] });
    as("STAFF", w.staff.id);
    const h = await dayHtml(date);
    assert.ok(h.includes(savedChip(1, "Sadun Staff", SAVED_AT)), "saved chip");
    assert.ok(h.includes(NOT_CHECKED_CHIP), "amber Not checked");
    assert.ok(!h.includes(NOT_SAVED_CHIP) && !h.includes("Edited ·") && !h.includes("Change log"));
    for (const t of ["Edit", "Admin check", "Print", "Download PDF", "5,000.00", "3,750.00", "950.00", "SLIP-1", "Peoples Bank", "Recorded by Sadun Staff", "History"]) assert.ok(h.includes(t), t);
    assert.ok(h.includes("auto=print") && h.includes("auto=pdf") && !h.includes("bf="), "the document links carry no typed values for a saved day");
    assert.ok(!h.includes(LIVE_DIFFERS), "live numbers equal the saved ones");
    // Left in drawer = 5,000 + 3,750 - 950 - 1,500
    assert.ok(h.includes("6,300.00"));
    // ADMIN sees it the same way
    as("ADMIN", w.admin.id);
    assert.ok((await dayHtml(date)).includes("Admin check"), "every ADMIN or STAFF sees the Admin check button");
  });

  test("checked: the green chip 'Checked by <admin>, recorded by <tapper>' with the time; no 'Not checked'", async () => {
    const date = await makeDay();
    await save(date, w.staff.id);
    await check(date, 1, admin2.id);
    as("STAFF", w.staff.id);
    const h = await dayHtml(date);
    assert.ok(h.includes(checkedChip("Ruwan Admin", "Sadun Staff")));
    assert.ok(h.includes("1 Nov 2026, 9:18 PM"), "with the time");
    assert.ok(!h.includes(NOT_CHECKED_CHIP) && h.includes("bg-green-100"));
    assert.ok(!h.includes("Admin check") && /disabled=""[^>]*>(<svg[^>]*>.*?<\/svg>)? ?Checked/.test(h), "the button reads 'Checked' and is off: one version is checked once");
  });

  test("edited (version 3) with the check cleared once: 'Edited · version 3', the change log newest first with who, when and what, 'Check cleared: …'", async () => {
    const date = await makeDay({ pays: ["5000.00"] });
    await save(date, w.admin.id, { bringForward: "100.00", bank: [line("100.00", "09:00", "S1", "n")] });
    await check(date, 1, admin2.id);
    await edit(date, 1, w.staff.id, { bringForward: "200.00", bank: [line("100.00", "09:00", "S1", "n")] }); // money: clears the check
    await edit(date, 2, staff2.id, { bringForward: "200.00", bank: [line("100.00", "09:30", "S2", "n")] }); // slip and time only
    as("STAFF", w.staff.id);
    const h = await dayHtml(date);
    assert.ok(h.includes(savedChip(3, "තිලිණි පෙරේරා", SAVED_AT)) && h.includes(editedChip(3)));
    assert.ok(h.includes(checkClearedChip("Ruwan Admin")), "the check was cleared by the money change and not redone");
    assert.ok(!h.includes("bg-green-100") && !h.includes(">Not checked<"), "no green Checked chip and no plain Not checked");
    assert.ok(h.includes("Change log"));
    const log = h.slice(h.indexOf("Change log"));
    const i3 = log.indexOf("Version 3"), i2 = log.indexOf("Version 2"), iCheck = log.indexOf("Checked by Ruwan Admin, recorded by Sadun Staff"), iSaved = log.indexOf("Saved by Nadeesha Admin");
    assert.ok(i3 > 0 && i3 < i2 && i2 < iCheck && iCheck < iSaved, "newest first: version 3, version 2, the check, then the first save");
    for (const t of ["Edited by Sadun Staff", "Bring-forward changed from 100.00 to 200.00", "Check cleared: the money changed after Ruwan Admin checked it", "Edited by තිලිණි පෙරේරා", "Bank deposit changed from", "Saved by Nadeesha Admin"]) assert.ok(log.includes(t), t);
  });

  test("the live-numbers warning: banner, 'See what changed' and 'Re-save with live numbers' appear when a receipt arrives after saving", async () => {
    const date = await makeDay({ pays: ["2500.00"] });
    await save(date, w.admin.id);
    as("STAFF", w.staff.id);
    assert.ok(!(await dayHtml(date)).includes(LIVE_DIFFERS), "nothing moved yet");
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "300.00", takenById: w.staff.id, paidAt: new Date(`${date}T09:00:00Z`) } });
    const h = await dayHtml(date);
    assert.ok(h.includes(LIVE_DIFFERS) && h.includes("See what changed") && h.includes("Re-save with live numbers"));
    assert.ok(h.includes("2,500.00"), "the screen still shows the FROZEN collected");
    assert.ok(!h.includes("2,800.00"), "the live figure is not shown as the day's number (it is only in the closed 'What changed' sheet)");
  });

  test("over-banked (after a cancelled receipt and a re-save): the red banner with the amount; Admin check refuses with the same words", async () => {
    const date = await makeDay({ pays: ["5000.00", "5000.00"] });
    await save(date, w.admin.id, { bank: [line("10,000.00", "09:00", "S1", "")] });
    const p = await db.payment.findFirstOrThrow({ where: { paidAt: new Date(`${date}T04:00:00Z`) } });
    await db.payment.update({ where: { id: p.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(NOW), cancelReason: "t" } });
    as("STAFF", w.staff.id);
    const r = await A.saveDay({ date, mode: "resave", baseVersion: 1, doneById: w.staff.id, bringForward: "", bank: [], seen: await seen(date) });
    assert.ok(r.ok);
    const h = await dayHtml(date);
    assert.ok(h.includes(overBankedBanner(500000)));
    assert.ok(h.includes("-5,000.00") || h.includes("−5,000.00"), "Left in drawer is shown negative");
    const c = await A.markChecked({ date, baseVersion: 2, checkedById: w.admin.id });
    assert.ok(!c.ok && c.reason === "over-banked" && c.message === overBankedBanner(500000));
    assert.equal(overBankRefusal(500000), "The money taken to the bank is 5,000.00 more than the drawer should hold.");
  });

  test("an unreadable saved day: 'This saved day can't be read. Showing the live numbers.' and the live draft view; no crash", async () => {
    const date = await makeDay();
    await save(date, w.admin.id);
    await db.$executeRawUnsafe(`UPDATE "DailySummaryVersion" SET "snapshotSchema" = 2 WHERE "dayId" = (SELECT id FROM "DailySummaryDay" WHERE date = '${date}')`);
    as("STAFF", w.staff.id);
    const h = await dayHtml(date);
    assert.ok(h.includes(UNREADABLE_DAY) && h.includes(NOT_SAVED_CHIP) && h.includes("Save day"), "the live unsaved view stands in");
    assert.ok(h.includes("3,750.00"));
    assert.ok((await docHtml(date)).includes("Draft, not saved"), "and so does the document");
  });

  test("a purged or very old day simply shows as an unsaved day with live data (C5)", async () => {
    as("STAFF", w.staff.id);
    const h = await dayHtml("2026-05-02");
    assert.ok(h.includes(NOT_SAVED_CHIP) && !h.includes(UNREADABLE_DAY));
    assert.ok((await docHtml("2026-05-02")).includes("Draft, not saved"));
  });

  // ---- History ---------------------------------------------------------------------
  test("History: rows (date, version, who, Collected, Net, Checked / Not checked), links to the day, the note, month chips; junk month = current; an empty month says so", async () => {
    await db.dailySummaryDay.deleteMany();
    const a = "2026-08-20";
    const b = "2026-08-21";
    for (const d of [a, b]) await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${d}T04:00:00Z`) } });
    await db.expense.create({ data: { expenseTypeId: xenonId, amount: "300.00", reason: "paper", date: colomboDateValue(b), recordedById: w.staff.id, authorizedById: admin2.id } });
    await save(a, w.admin.id);
    await check(a, 1, admin2.id);
    await save(b, w.staff.id);
    await edit(b, 1, staff2.id, { bringForward: "10.00" });
    as("STAFF", w.staff.id);
    const month = a.slice(0, 7);
    const h = plain(await html(historyPage, { month }));
    assert.ok(h.includes("History") && h.includes(HISTORY_NOTE) && h.includes(`href="/daily-summary?date=${a}"`) && h.includes(`href="/daily-summary?date=${b}"`));
    assert.ok(h.includes("Saved by Nadeesha Admin") && h.includes("Saved by Sadun Staff · edited by තිලිණි පෙරේරා"));
    assert.ok(h.includes("v1") && h.includes("v2") && h.includes("Checked") && h.includes(NOT_CHECKED_CHIP));
    assert.ok(h.includes("1,300.00") && h.includes("1,000.00"), "Collected and Net");
    assert.ok(h.includes("August 2026") && h.includes("November 2026") && h.includes("href=\"/daily-summary/history?month=2026-11\""), "month chips");
    // a month with nothing: an empty note, never an error
    const empty = plain(await html(historyPage, { month: "2026-10" }));
    assert.ok(empty.includes("No saved days in this month.") && empty.includes(HISTORY_NOTE));
    // junk falls back to the current month
    for (const junk of ["x", "2026-13", "9999-01", ["2026-09", "2026-08"]]) assert.ok(plain(await html(historyPage, { month: junk })).includes("November 2026"), String(junk));
  });

  test("History shows at most 31 rows", async () => {
    await db.dailySummaryDay.deleteMany();
    const month = "2026-10";
    const days = Array.from({ length: 31 }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
    const staffId = w.staff.id;
    for (const d of days) {
      const day = await db.dailySummaryDay.create({ data: { date: colomboDateValue(d), currentVersion: 1 } });
      await db.dailySummaryVersion.create({
        data: {
          dayId: day.id, version: 1, kind: "SAVE", bringForward: "0.00", collected: "1.00", deductions: "0.00", shouldBeInDrawer: "1.00", bankTotal: "0.00", leftInDrawer: "1.00", net: "1.00",
          snapshot: {}, snapshotSchema: 1, changes: [], doneById: staffId, doneByName: "Sadun Staff", preparedById: staffId, preparedByName: "Sadun Staff", savedById: staffId,
        },
      });
    }
    as("STAFF", staffId);
    const h = await html(historyPage, { month });
    assert.equal((h.match(/href="\/daily-summary\?date=2026-10-/g) ?? []).length, 31);
    await db.dailySummaryDay.deleteMany();
  });

  // ---- the A4 document ---------------------------------------------------------------
  test("document, a draft: Status 'Draft, not saved', Prepared by '—', Checked by 'Not checked', empty signature boxes, no Saved or Last edited row, no change log", async () => {
    const date = await makeDay();
    as("STAFF", w.staff.id);
    const h = await docHtml(date);
    assert.ok(h.includes("<span>Status</span><b>Draft, not saved</b>") && h.includes("<span>Prepared by</span><b>—</b>") && h.includes("<b>Not checked</b>"));
    assert.ok(!h.includes("<span>Saved</span>") && !h.includes("<span>Last edited</span>") && !h.includes("Change log"));
    assert.equal((h.match(/<div class="name"><\/div>/g) ?? []).length, 2, "both signature boxes are empty");
  });

  test("document, saved and not checked: 'Saved, version 1, not checked', Saved <date, time> by <v1 Done by>, Prepared by named, Checked by empty; printed from the SAVED figures", async () => {
    const date = await makeDay({ pays: ["2500.00"] });
    await save(date, w.staff.id, { bringForward: "700.00", bank: [line("100.00", "10:15", "SLIP-7", "Peoples")] });
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "999.00", takenById: w.staff.id, paidAt: new Date(`${date}T09:00:00Z`) } }); // live moved
    as("STAFF", w.staff.id);
    const h = await docHtml(date);
    assert.ok(h.includes("<span>Status</span><b>Saved, version 1, not checked</b>"));
    assert.ok(h.includes("<span>Saved</span><b>1 Nov 2026, 9:18 PM by Sadun Staff</b>") && !h.includes("<span>Last edited</span>"));
    assert.ok(h.includes("<span>Prepared by</span><b>Sadun Staff</b>") && h.includes("<span>Checked by (admin)</span><b>Not checked</b>"));
    assert.equal((h.match(/<div class="name"><\/div>/g) ?? []).length, 1, "Checked by's box is empty");
    assert.ok(h.includes("2,500.00") && !h.includes("3,499.00"), "the SAVED collected, not the live one");
    assert.ok(h.includes("SLIP-7") && h.includes("Peoples") && h.includes("700.00"), "stored bank row and bring-forward");
    assert.ok(!h.includes("Change log"));
  });

  test("document, checked: 'Saved, version 1, checked' and the admin's name only (not who tapped) on the signature box", async () => {
    const date = await makeDay();
    await save(date, w.admin.id);
    await check(date, 1, admin2.id);
    as("STAFF", w.staff.id);
    const h = await docHtml(date);
    assert.ok(h.includes("<span>Status</span><b>Saved, version 1, checked</b>") && h.includes("<span>Checked by (admin)</span><b>Ruwan Admin</b>"));
    const sig = h.slice(h.indexOf("7 Signatures"));
    assert.ok(sig.includes("Ruwan Admin") && !sig.includes("recorded by"), "the box shows only the admin");
    assert.ok(!h.includes("<b>Not checked</b>"));
  });

  test("document, edited (version 3) with a check cleared once: Last edited <date, time> by <latest Done by>, the Change log table with every version and 'Checked by X, recorded by Y' and 'Check cleared'", async () => {
    const date = await makeDay({ pays: ["5000.00"] });
    await save(date, w.admin.id, { bringForward: "100.00", bank: [line("100.00", "09:00", "S1", "n")] });
    await check(date, 1, admin2.id);
    await edit(date, 1, w.staff.id, { bringForward: "200.00", bank: [line("100.00", "09:00", "S1", "n")] });
    await edit(date, 2, staff2.id, { bringForward: "200.00", bank: [line("100.00", "09:30", "S2", "n")] });
    as("STAFF", w.staff.id);
    const h = await docHtml(date);
    assert.ok(h.includes("<span>Status</span><b>Saved, version 3, not checked</b>"));
    assert.ok(h.includes("<span>Saved</span><b>1 Nov 2026, 9:18 PM by Nadeesha Admin</b>"), "version 1's time and Done by");
    assert.ok(h.includes("<span>Last edited</span><b>1 Nov 2026, 9:18 PM by තිලිණි පෙරේරා</b>"), "the latest version's Done by");
    assert.ok(h.includes("<span>Prepared by</span><b>Nadeesha Admin</b>"), "Prepared by stays version 1's Done by");
    const log = h.slice(h.indexOf("8 Change log"));
    assert.ok(log.includes("<th>Version</th>") && log.includes("<th>When</th>") && log.includes("<th>By</th>") && log.includes("<th>What changed</th>"));
    for (const t of ["v1", "v2", "v3", "Saved by Nadeesha Admin", "Checked by Ruwan Admin, recorded by Sadun Staff", "Bring-forward changed from 100.00 to 200.00", "Check cleared: the money changed after Ruwan Admin checked it", "Bank deposit changed from"]) assert.ok(log.includes(t), t);
    const order = ["Saved by Nadeesha Admin", "Checked by Ruwan Admin, recorded by Sadun Staff", "Check cleared", "Edited by තිලිණි පෙරේරා"].map((t) => log.indexOf(t));
    assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], "oldest first");
  });

  test("document, over-banked: the one-line note under the cash book; a Sinhala-heavy day keeps every Sinhala name exactly as stored", async () => {
    const over = await makeDay({ pays: ["5000.00", "5000.00"] });
    await save(over, w.admin.id, { bank: [line("10,000.00", "09:00", "S1", "")] });
    const p = await db.payment.findFirstOrThrow({ where: { paidAt: new Date(`${over}T04:00:00Z`) } });
    await db.payment.update({ where: { id: p.id }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(NOW), cancelReason: "t" } });
    as("STAFF", w.staff.id);
    assert.ok((await A.saveDay({ date: over, mode: "resave", baseVersion: 1, doneById: w.staff.id, bringForward: "", bank: [], seen: await seen(over) })).ok);
    assert.ok((await docHtml(over)).includes(overBankedBanner(500000)));
    // Sinhala
    const date = await makeDay({ pays: ["3000.00"], spends: [["1200.00", "ජූනි මාසයේ වැඩ කළ ශිෂ්‍ය සහායකයින්ගේ ගමන් වියදම් සඳහා ලබා දුන් අත්තිකාරම් මුදල"]] });
    await save(date, staff2.id, { bank: [line("500.00", "09:00", "ස්ලිප්-1", "බැංකුවට තැන්පත්")] });
    const h = await docHtml(date);
    for (const t of ["ජූනි මාසයේ වැඩ කළ ශිෂ්‍ය සහායකයින්ගේ ගමන් වියදම් සඳහා ලබා දුන් අත්තිකාරම් මුදල", "ස්ලිප්-1", "බැංකුවට තැන්පත්", "තිලිණි පෙරේරා"]) assert.ok(h.includes(t), t);
  });

  // ---- access: every page, ADMIN, STAFF, TEACHER, nobody (rules 29 and 30) --------------------------
  test("every page answers a TEACHER and nobody with the not-found screen; ADMIN and STAFF are served", async () => {
    const date = await makeDay();
    await save(date, w.admin.id);
    for (const [name, P, q] of [["day", dayPage, { date }], ["document", docPage, { date }], ["history", historyPage, { month: date.slice(0, 7) }]] as const) {
      for (const who of ["TEACHER", null] as const) {
        as(who, "t");
        await assert.rejects(() => html(P, q), /NEXT_NOT_FOUND/, `${name}: ${who ?? "no session"}`);
      }
      for (const who of ["ADMIN", "STAFF"] as const) {
        as(who, who === "ADMIN" ? w.admin.id : w.staff.id);
        assert.ok((await html(P, q)).length > 500, `${name}: ${who} is served`);
      }
    }
  });

  test("a refused TEACHER never sees saved figures: the markup of the refusal holds none of the day's numbers", async () => {
    const date = await makeDay({ pays: ["4321.00"] });
    await save(date, w.admin.id);
    as("TEACHER", "t");
    const err = await html(dayPage, { date }).then(() => null, (e: Error) => e);
    assert.ok(err && /NEXT_NOT_FOUND/.test(err.message) && !err.message.includes("4,321"));
  });

  // ---- the sheets (rendered open, with props) ---------------------------------------------------
  test("the Save sheet: title, 'These numbers are frozen as of now.', the five rows, a required Done by select with a disabled placeholder, Cancel and Save day", async () => {
    const { SaveSheet } = await import("@/app/(app)/daily-summary/save-sheet");
    const doners = [{ id: w.staff.id, name: "Sadun Staff", role: "STAFF" as const }, { id: w.admin.id, name: "Nadeesha Admin", role: "ADMIN" as const }];
    const out = plain(renderToStaticMarkup(createElement(SaveSheet, {
      mode: "save", date: "2026-10-14", dateText: "Wed 14 Oct 2026", baseVersion: 0,
      numbers: { collected: 375000, deductions: 95000, shouldBe: 280000, bankTotal: 150000, left: 130000 }, bankCount: 2, doners,
      bringForward: "", bank: [], onClose: () => undefined,
    })));
    for (const t of ["Save Wed 14 Oct 2026?", "These numbers are frozen as of now.", "Collected", "3,750.00", "Deductions", "950.00", "Should be in the drawer", "2,800.00", "Taken to bank (2)", "1,500.00", "Left in drawer", "1,300.00", "Done by", "Cancel", "Save day", "Sadun Staff (Staff)", "Nadeesha Admin (Admin)"]) assert.ok(out.includes(t), t);
    assert.match(out, /<option value="" disabled(="")?[^>]*>Select who did this…<\/option>/);
    assert.ok(/<button[^>]*disabled=""[^>]*>Save day<\/button>/.test(out), "Save day is off until Done by is chosen");
  });

  test("the Re-save sheet says it uses the live numbers", async () => {
    const { SaveSheet } = await import("@/app/(app)/daily-summary/save-sheet");
    const out = plain(renderToStaticMarkup(createElement(SaveSheet, {
      mode: "resave", date: "2026-10-14", dateText: "Wed 14 Oct 2026", baseVersion: 2,
      numbers: { collected: 1, deductions: 2, shouldBe: 3, bankTotal: 4, left: 5 }, bankCount: 1, doners: [], bringForward: "", bank: [], onClose: () => undefined,
    })));
    assert.ok(out.includes("Re-save Wed 14 Oct 2026 with the live numbers?") && out.includes("Re-save"));
  });

  test("the Admin check sheet: the three numbers, an admin select (admins only), Mark as checked; with no active admin it says so and the button is off", async () => {
    const { CheckSheet } = await import("@/app/(app)/daily-summary/check-sheet");
    const admins = [{ id: w.admin.id, name: "Nadeesha Admin", role: "ADMIN" as const }, { id: admin2.id, name: "Ruwan Admin", role: "ADMIN" as const }];
    const props = { date: "2026-10-14", version: 2, shouldBe: 280000, bankTotal: 150000, left: 130000, onClose: () => undefined };
    const out = plain(renderToStaticMarkup(createElement(CheckSheet, { ...props, admins })));
    for (const t of ["Admin check", "Should be in the drawer", "2,800.00", "Taken to bank", "1,500.00", "Left in drawer", "1,300.00", "Nadeesha Admin", "Ruwan Admin", "Mark as checked", "Select an admin…"]) assert.ok(out.includes(t), t);
    assert.ok(!out.includes("Sadun Staff"));
    const none = plain(renderToStaticMarkup(createElement(CheckSheet, { ...props, admins: [] })));
    assert.ok(none.includes(NO_ADMIN) && /<button[^>]*disabled=""[^>]*>Mark as checked<\/button>/.test(none));
    assert.ok(!none.includes("<select"));
  });

  test("the 'What changed' sheet lists label, saved and live for each difference, and Left in drawer both ways", async () => {
    const { LiveDiffSheet } = await import("@/app/(app)/daily-summary/live-diff-sheet");
    const out = plain(renderToStaticMarkup(createElement(LiveDiffSheet, {
      diffs: [{ key: "totalCollected", label: "Total collected", saved: "3,750.00", live: "3,250.00" }], savedLeft: 130000, liveLeft: 80000, onClose: () => undefined,
    })));
    for (const t of ["Total collected", "Saved", "3,750.00", "Live", "3,250.00", "Left in drawer, as saved", "1,300.00", "Left in drawer, with the live numbers", "800.00"]) assert.ok(out.includes(t), t);
  });
});
