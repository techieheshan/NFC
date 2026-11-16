import { dbSkip, freezeClock, makeStudent, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";

import { colomboDateValue } from "@/lib/colombo-time";
import { shiftDay } from "@/lib/daily-summary-dates";

/*
 * The Daily Summary screens and the A4 document with other income: rendered for real (made-up data). A day WITHOUT other income shows
 * none of the new lines (omit-when-none); a day WITH it shows "+ Other cash in" inside the drawer figure and the bank-transfer line
 * apart from it, on the draft screen, the saved screen, the document and the range screen.
 */

const NOW = "2026-11-02T10:00:00Z";
type Q = Record<string, string | string[] | undefined>;
type Page = (a: { searchParams: Promise<Q> }) => Promise<React.ReactNode> | React.ReactNode;
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let A: typeof import("@/app/(app)/daily-summary/saved-actions");
let dayPage: unknown;
let docPage: unknown;
let rangePage: unknown;
let studentId: number;
let catId: number;
let n = 0;

const html = async (P: unknown, q: Q = {}) => renderToStaticMarkup((await (P as Page)({ searchParams: Promise.resolve(q) })) as React.ReactElement);
const plain = (s: string) => s.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/<!-- -->/g, "");

describe("other income on the Daily Summary screens and document", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    A = await import("@/app/(app)/daily-summary/saved-actions");
    ({ default: dayPage } = await import("@/app/(app)/daily-summary/page"));
    ({ default: docPage } = await import("@/app/(app)/daily-summary/document/page"));
    ({ default: rangePage } = await import("@/app/(app)/daily-summary/range/page"));
    w = await seedWorld(db);
    studentId = (await makeStudent(db)).id;
    catId = (await db.incomeCategory.findFirstOrThrow({ where: { code: "DONATION" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  async function day(withIncome: boolean): Promise<string> {
    const date = shiftDay("2026-10-01", n++);
    await db.payment.create({ data: { kind: "ADMISSION", studentId, amount: "2000.00", takenById: w.staff.id, paidAt: new Date(`${date}T04:00:00Z`) } });
    if (withIncome) {
      const base = { categoryId: catId, date: colomboDateValue(date), receivedById: w.staff.id, recordedById: w.staff.id };
      await db.otherIncome.create({ data: { ...base, amount: "750.00", method: "CASH", source: "Old boys" } });
      await db.otherIncome.create({ data: { ...base, amount: "12000.00", method: "BANK", source: "The Trust" } });
    }
    return date;
  }
  const staff = () => setSession("STAFF", w.staff.id);

  test("a day WITHOUT other income shows none of the new lines, on the draft, the document and the range", async () => {
    staff();
    const d = await day(false);
    for (const [name, P, q] of [["day", dayPage, { date: d }], ["document", docPage, { date: d }], ["range", rangePage, { from: shiftDay(d, -1), to: d }]] as const) {
      const h = plain(await html(P, q as Q));
      assert.ok(h.length > 500, name);
      assert.ok(!/Other cash in|bank transfer|Other income<|Other incomes|Other cash/.test(h), `${name}: no other-income wording`);
    }
    assert.ok(plain(await html(dayPage, { date: d })).includes("Should be in the drawer"));
  });

  test("the draft day: + Other cash in is inside Should be in the drawer; the bank transfer line says it is not", async () => {
    staff();
    const d = await day(true);
    const h = plain(await html(dayPage, { date: d }));
    assert.ok(h.includes("+ Other cash in"));
    assert.ok(h.includes("Other income by bank transfer") && h.includes("Not in the drawer"));
    assert.ok(h.includes("2,750.00"), "should be in the drawer = 2,000.00 collected + 750.00 other cash (the 12,000.00 bank is not added)");
    assert.ok(!h.includes("14,750.00") && !h.includes("14,000.00"));
    assert.ok(h.includes("12,000.00"), "the bank figure is shown on its own line");
    assert.ok(h.includes("Old boys") && h.includes("The Trust"));
  });

  test("the document (draft and saved) prints the Other cash in line, the drawer figure and an Other income table", async () => {
    staff();
    const d = await day(true);
    const draft = plain(await html(docPage, { date: d }));
    for (const t of ["+ Other cash in", "2,750.00", "Other income", "Old boys", "The Trust", "Bank transfer", "not in the drawer"]) assert.ok(draft.includes(t), `draft document has "${t}"`);
    const saved = await A.saveDay({ date: d, mode: "save", baseVersion: 0, doneById: w.staff.id, bringForward: "", bank: [], seen: { collected: 200000, deductions: 0, otherCash: 75000, otherBank: 1200000 } });
    assert.ok(saved.ok, JSON.stringify(saved));
    const doc = plain(await html(docPage, { date: d }));
    for (const t of ["Saved, version 1", "+ Other cash in", "2,750.00", "The Trust"]) assert.ok(doc.includes(t), `saved document has "${t}"`);
    // the saved day screen shows the frozen other income, even if the live income is cancelled afterwards
    await db.otherIncome.updateMany({ where: { date: colomboDateValue(d) }, data: { cancelled: true, cancelledById: w.admin.id, cancelledAt: new Date(), cancelReason: "test" } });
    const screen = plain(await html(dayPage, { date: d }));
    assert.ok(screen.includes("+ Other cash in") && screen.includes("2,750.00") && screen.includes("The live numbers are different"), "frozen lines stay; the banner says the live numbers differ");
    assert.ok(plain(await html(docPage, { date: d })).includes("Old boys"), "the saved document still prints what was saved");
  });

  test("the range screen and document list other income only when the range has some", async () => {
    staff();
    const d = await day(true);
    const range = plain(await html(rangePage, { from: shiftDay(d, -1), to: d }));
    assert.ok(range.includes("Other incomes (not part of Net)") && range.includes("750.00") && range.includes("12,000.00"));
    const doc = plain(await html(docPage, { from: shiftDay(d, -1), to: d }));
    assert.ok(doc.includes("Other cash") && doc.includes("Other bank") && doc.includes("Old boys"));
  });
});
