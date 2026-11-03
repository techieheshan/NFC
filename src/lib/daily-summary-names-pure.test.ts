import { test } from "node:test";
import assert from "node:assert/strict";

import { buildDocModel } from "@/app/(app)/daily-summary/document/model";
import { splitSigners } from "@/app/(app)/daily-summary/signer-lists";
import { aggregateStaff, type StaffPaymentRow } from "@/lib/daily-summary-rows";
import { displayName } from "@/lib/display-name";

/*
 * Daily Summary R1: NO database. The real name-building steps (displayName, splitSigners, aggregateStaff, buildDocModel)
 * run on fake rows, and the test fails if ANY name picks up a role hint. The same proof against real stored names through
 * the real loaders is daily-summary-document-names.test.ts (needs `npm run test:db`); this one runs in plain `npm test`,
 * so a hint added to any of these steps cannot get past.
 */

const HINT = /\((?:admin|administrator|staff)\)/i;

// fake users: plain stored names, a Sinhala name, a login with no Staff record, and one stored name that itself has a bracket
const users = [
  { id: "a1", username: "nadeesha", role: "ADMIN", staff: { name: "Nadeesha" } },
  { id: "a2", username: "ruwan", role: "ADMIN", staff: { name: "Ruwan" } },
  { id: "s1", username: "sadun", role: "STAFF", staff: { name: "Sadun" } },
  { id: "s2", username: "thilini", role: "STAFF", staff: { name: "තිලිණි පෙරේරා" } },
  { id: "s3", username: "login.only", role: "STAFF", staff: null },
  { id: "s4", username: "x", role: "STAFF", staff: { name: "Kumari (Maths)" } },
];
const STORED_NAMES = ["Nadeesha", "Ruwan", "Sadun", "තිලිණි පෙරේරා", "login.only", "Kumari (Maths)"];

test("displayName is the Staff name, else the username, and nothing else", () => {
  assert.deepEqual(users.map((u) => displayName(u)), STORED_NAMES);
  assert.equal(displayName({ username: "u", staff: undefined }), "u");
  assert.equal(displayName({ username: "u", staff: null }), "u");
  assert.equal(displayName({ username: "u", staff: { name: "" } }), "", "an empty stored name is not replaced or decorated");
});

test("splitSigners gives every account its stored name, whatever its role, in both lists", () => {
  const { prepared, checked } = splitSigners(users);
  assert.deepEqual(prepared.map((s) => s.name), STORED_NAMES);
  assert.deepEqual(checked.map((s) => s.name), ["Nadeesha", "Ruwan"]);
  for (const s of [...prepared, ...checked]) assert.ok(!HINT.test(s.name), `${s.name} has no role hint`);
});

const row = (id: number, takenById: string, takenBy: StaffPaymentRow["takenBy"], amount = "100.00", ref: string | null = `R${id}`): StaffPaymentRow =>
  ({ id, kind: "CLASS", courseId: 1, amount: { toFixed: () => amount }, transactionRef: ref, takenById, takenBy });

test("the collected-by-staff table names each taker exactly as stored, for every role", () => {
  const rows = users.map((u, i) => row(i + 1, u.id, { username: u.username, staff: u.staff }, `${(i + 1) * 100}.00`));
  const out = aggregateStaff(rows);
  assert.deepEqual(out.map((r) => r.name).sort(), [...STORED_NAMES].sort());
  for (const r of out) assert.ok(!HINT.test(r.name), r.name);
  // and the money still adds up: 100 + 200 + ... + 600
  assert.equal(out.reduce((s, r) => s + Math.round(Number(r.collected) * 100), 0), 210000);
});

test("aggregateStaff: receipts are transactions, a null ref stands alone, a course-less CLASS row is not counted, order is by money", () => {
  const taker = { username: "u", staff: { name: "Sadun" } };
  const out = aggregateStaff([
    row(1, "s1", taker, "50.00", "SAME"),
    row(2, "s1", taker, "25.00", "SAME"),
    row(3, "s1", taker, "10.00", null),
    row(4, "s1", taker, "10.00", null),
    { ...row(5, "s1", taker, "999.00"), courseId: null },
    row(6, "s2", { username: "big", staff: null }, "500.00"),
  ]);
  assert.deepEqual(out, [
    { userId: "s2", name: "big", receipts: 1, collected: "500.00" },
    { userId: "s1", name: "Sadun", receipts: 3, collected: "95.00" },
  ]);
});

test("the document model prints every name it is given exactly as given (signers, generated-by, deduction person and authoriser, staff table)", () => {
  const sourceNames = { staffRow: "Sadun", signerP: "තිලිණි පෙරේරා", signerC: "Nadeesha", person: "Chathura", teacher: "සුනිල් ගුණසේන මහතා", authoriser: "Ruwan", generatedBy: "login.only" };
  const report = {
    from: "2026-10-14", to: "2026-10-14", courses: [], admission: { count: 0, total: "0.00" }, smartCard: { count: 0, total: "0.00" }, classTotal: "0.00", totalCollected: "0.00",
    deductions: { teacherAdvances: "100.00", xenonExpenses: "200.00", total: "300.00" },
    deductionLines: [
      { date: "2026-10-14", kind: "TEACHER_ADVANCE", person: sourceNames.teacher, reason: "r", authorizedBy: sourceNames.authoriser, isStaffAdvance: false, amount: "100.00" },
      { date: "2026-10-14", kind: "XENON", person: sourceNames.person, reason: "r", authorizedBy: sourceNames.authoriser, isStaffAdvance: true, amount: "200.00" },
    ],
    net: "-300.00",
  };
  const m = buildDocModel({
    report: report as never, cancelled: { receipts: 0, total: "0.00" }, generated: { date: "2026-11-01", time: "21:18" }, generatedBy: sourceNames.generatedBy,
    day: { staff: [{ userId: "s1", name: sourceNames.staffRow, receipts: 1, collected: "0.00" }], bringForwardCents: 0, bank: [], preparedBy: sourceNames.signerP, checkedBy: sourceNames.signerC },
  });
  assert.deepEqual([m.preparedBy, m.checkedBy, m.generatedBy], [sourceNames.signerP, sourceNames.signerC, sourceNames.generatedBy]);
  assert.deepEqual(m.deductions.map((d) => [d.person, d.authorizedBy]), [[sourceNames.teacher, sourceNames.authoriser], [sourceNames.person, sourceNames.authoriser]]);
  assert.equal(m.staff[0].name, sourceNames.staffRow);
  const everyName = [m.preparedBy, m.checkedBy, m.generatedBy, ...m.deductions.flatMap((d) => [d.person, d.authorizedBy]), ...m.staff.map((r) => r.name)];
  for (const n of everyName) assert.ok(!HINT.test(n ?? ""), `${n} has no role hint`);
});
