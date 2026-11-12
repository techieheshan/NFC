import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { PrismaClient, UserRole } from "@prisma/client";
import ts from "typescript";

import { colomboDateValue } from "@/lib/colombo-time";
import { shiftDay } from "@/lib/daily-summary-dates";

/*
 * Who may call each saved-day action, replayed with ADMIN, STAFF, TEACHER and no session (rules 10, 29 and 30). The server action
 * is its own HTTP endpoint, so the proof is the action's own refusal: it throws "Not authorised" and the database is unchanged.
 * (There is no status code to assert on: nothing leaks because nothing is returned.) ADMIN is the control next to each refusal.
 * C1: STAFF may do everything ADMIN may, including "Mark as checked"; the admin it names must still be an active ADMIN.
 */

const NOW = "2026-11-02T10:00:00Z";

type Actions = typeof import("@/app/(app)/daily-summary/saved-actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: Actions;
let teacherId: string;
let studentId: number;

describe("saved-day authorisation replay", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/daily-summary/saved-actions");
    w = await seedWorld(db);
    teacherId = (await db.user.create({ data: { username: "teacher-x", passwordHash: "x", role: "TEACHER" } })).id;
    studentId = (await makeStudent(db)).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const rows = async () => ({
    days: await db.dailySummaryDay.count(),
    versions: await db.dailySummaryVersion.count(),
    lines: await db.dailySummaryBankLine.count(),
    checks: await db.dailySummaryCheck.count(),
  });
  const SEEN = { collected: 130000, deductions: 0 };
  /** A fresh day with 1,300.00 collected (every test builds its own, so each passes when run alone). */
  let dayCounter = 0;
  async function newDay(): Promise<string> {
    const date = shiftDay("2026-10-01", dayCounter++);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date(`${date}T04:00:00Z`) } });
    return date;
  }
  const saveInput = (date: string) => ({ date, mode: "save", baseVersion: 0, doneById: w.staff.id, bringForward: "", bank: [], seen: SEEN });

  type Who = { name: string; role: UserRole | null; id: string };
  const refused: Who[] = [
    { name: "TEACHER", role: "TEACHER", id: "" },
    { name: "no session", role: null, id: "" },
  ];
  const allowed: Who[] = [
    { name: "ADMIN", role: "ADMIN", id: "" },
    { name: "STAFF", role: "STAFF", id: "" },
  ];
  const sign = (who: Who) => setSession(who.role, who.role === "ADMIN" ? w.admin.id : who.role === "STAFF" ? w.staff.id : who.role === "TEACHER" ? teacherId : "nobody");

  // ---- a first save, an edit and a re-save ----------------------------------------
  test("saveDay (first save, edit, re-save): ADMIN and STAFF are served; TEACHER and no session are refused and nothing is written", async () => {
    const DAY = await newDay();
    for (const who of refused) {
      sign(who);
      const base = await rows();
      for (const input of [saveInput(DAY), { ...saveInput(DAY), mode: "edit", baseVersion: 1 }, { ...saveInput(DAY), mode: "resave", baseVersion: 1 }]) {
        await assert.rejects(() => A.saveDay(input), (e: Error) => e.message === "Not authorised", `${who.name} is refused`);
      }
      assert.deepEqual(await rows(), base, `${who.name}: nothing was written`);
    }
    // controls
    for (const who of allowed) {
      sign(who);
      const day = await newDay();
      const first = await A.saveDay(saveInput(day));
      assert.ok(first.ok && first.version === 1, `${who.name} can save: ${JSON.stringify(first)}`);
      const ed = await A.saveDay({ ...saveInput(day), mode: "edit", baseVersion: 1, bringForward: "10.00" });
      assert.ok(ed.ok && ed.version === 2, `${who.name} can edit`);
      await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "50.00", takenById: w.staff.id, paidAt: new Date(`${day}T05:00:00Z`) } });
      const re = await A.saveDay({ date: day, mode: "resave", baseVersion: 2, doneById: w.staff.id, bringForward: "", bank: [], seen: { collected: 135000, deductions: 0 } });
      assert.ok(re.ok && re.version === 3, `${who.name} can re-save: ${JSON.stringify(re)}`);
    }
  });

  // ---- markChecked (C1) --------------------------------------------------------------
  test("markChecked: ADMIN and STAFF may tap it (C1); TEACHER and no session are refused and no check is written", async () => {
    const DAY = await newDay();
    sign(allowed[0]);
    assert.ok((await A.saveDay(saveInput(DAY))).ok);
    const base = await rows();
    for (const who of refused) {
      sign(who);
      await assert.rejects(() => A.markChecked({ date: DAY, baseVersion: 1, checkedById: w.admin.id }), (e: Error) => e.message === "Not authorised", who.name);
    }
    assert.deepEqual(await rows(), base);
    sign(allowed[1]); // STAFF taps, naming the admin
    const r = await A.markChecked({ date: DAY, baseVersion: 1, checkedById: w.admin.id });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.markedByName, w.staff.username);
    assert.equal(r.checkedByName, w.admin.username);
  });

  test("markChecked: a STAFF session cannot make a STAFF user the checker, and cannot reuse a TEACHER or unknown id; ADMIN control accepted", async () => {
    const day = await newDay();
    sign(allowed[0]);
    assert.ok((await A.saveDay(saveInput(day))).ok);
    sign(allowed[1]);
    const base = await rows();
    for (const id of [w.staff.id, teacherId, "no-such-user"]) {
      const r = await A.markChecked({ date: day, baseVersion: 1, checkedById: id });
      assert.ok(!r.ok && r.reason === "not-admin", `${id} is refused as the checker`);
    }
    assert.deepEqual(await rows(), base);
    sign(allowed[0]);
    assert.ok((await A.markChecked({ date: day, baseVersion: 1, checkedById: w.admin.id })).ok, "control: an ADMIN checker is accepted");
  });

  // ---- reads ---------------------------------------------------------------------------
  test("loadSavedDay and loadHistory: ADMIN and STAFF get the data; TEACHER and no session get nothing but 'Not authorised'", async () => {
    const DAY = await newDay();
    sign(allowed[0]);
    assert.ok((await A.saveDay(saveInput(DAY))).ok);
    for (const who of refused) {
      sign(who);
      await assert.rejects(() => A.loadSavedDay(DAY), (e: Error) => e.message === "Not authorised", who.name);
      await assert.rejects(() => A.loadHistory(DAY.slice(0, 7)), (e: Error) => e.message === "Not authorised", who.name);
    }
    for (const who of allowed) {
      sign(who);
      const d = await A.loadSavedDay(DAY);
      assert.ok(d.saved && d.saved.version === 1, `${who.name} sees the saved day`);
      const h = await A.loadHistory(DAY.slice(0, 7));
      assert.ok(h.rows.some((r) => r.date === DAY), `${who.name} sees History`);
    }
  });

  test("a refused TEACHER call does not even read: the lazy purge does not run for them", async () => {
    await db.dailySummaryDay.deleteMany();
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "1300.00", takenById: w.staff.id, paidAt: new Date("2026-05-20T04:00:00Z") } });
    // plant an expired day under an earlier clock; a TEACHER opening History must not trigger its deletion
    freezeClock("2026-08-05T06:00:00Z");
    try {
      sign(allowed[1]);
      assert.ok((await A.saveDay({ ...saveInput("2026-05-20") })).ok);
    } finally {
      freezeClock(NOW);
    }
    sign(refused[0]);
    await assert.rejects(() => A.loadHistory("2026-10"));
    assert.ok(await db.dailySummaryDay.findUnique({ where: { date: colomboDateValue("2026-05-20") } }), "the expired day is still there");
    sign(allowed[0]);
    assert.equal((await A.loadHistory("2026-10")).purged, 1, "an ADMIN opening History purges it");
  });

  // ---- the guard is the first statement of every action (static) --------------------------
  test("every exported action in saved-actions.ts calls requireRole(...) as its first statement and passes the role list [ADMIN, STAFF]", () => {
    const file = path.join(process.cwd(), "src", "app", "(app)", "daily-summary", "saved-actions.ts");
    const src = readFileSync(file, "utf8");
    const sf = ts.createSourceFile("saved-actions.ts", src, ts.ScriptTarget.ES2022, true);
    assert.equal(sf.statements[0].getText(), '"use server";', "the file is a server-actions file");
    const exported = sf.statements.filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && !!s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
    assert.deepEqual(exported.map((f) => f.name?.text).sort(), ["loadHistory", "loadSavedDay", "markChecked", "saveDay"]);
    for (const fn of exported) {
      assert.ok(fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword), `${fn.name?.text} is async`);
      const first = fn.body!.statements[0];
      const call = first.getText();
      assert.match(call, /await requireRole\(\[\.\.\.OPERATIONAL\]\)/, `${fn.name?.text}: the guard comes first`);
    }
    assert.match(src, /const OPERATIONAL = \["ADMIN", "STAFF"\] as const;/);
    assert.ok(!/TEACHER/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "TEACHER appears in no role list");
  });
});
