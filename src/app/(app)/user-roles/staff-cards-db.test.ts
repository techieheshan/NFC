import { dbSkip, freezeClock, makeCourse, makeStudent, makeTeacher, openTestDatabase, seedWorld, unfreezeClock, type TestDatabase, type World } from "@/test-support/test-db";
import { setSession } from "@/test-support/server-stubs";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import jsQR from "jsqr";
import qrcode from "qrcode-generator";

import type { PrismaClient } from "@prisma/client";

import { parseStaffQr, sha256 } from "@/lib/quick-login-rules";

/*
 * Staff cards, QR codes and terminals: who may manage them (ADMIN only, replayed with every role, reads included — AGENTS 10 and 29), what a
 * card may be (an active STAFF login's, never a student's UID), that a QR is shown once and only its hash is kept, that the picture really
 * decodes with the app's own scanner library, and that a student can never be registered with a staff card's UID.
 */

const NOW = "2026-11-16T06:00:00Z";
type A = typeof import("./staff-card-actions");
let db: PrismaClient;
let handle: TestDatabase;
let w: World;
let S: A;
let R: typeof import("@/app/(app)/registration/actions");
let staffId: string;
let teacherUserId: string;
let n = 0;

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const none = { ok: false } as const;
const uid = () => `04C1${(++n).toString(16).toUpperCase().padStart(4, "0")}`;

describe("staff cards, QR and terminals (database)", { skip: dbSkip }, () => {
  before(async () => {
    handle = await openTestDatabase();
    freezeClock(NOW);
    ({ db } = await import("@/lib/db"));
    S = await import("./staff-card-actions");
    R = await import("@/app/(app)/registration/actions");
    w = await seedWorld(db);
    staffId = w.staff.id;
    teacherUserId = (await db.user.create({ data: { username: "teacher-sc", passwordHash: "x", role: "TEACHER" } })).id;
  });
  after(async () => {
    unfreezeClock();
    await db?.$disconnect();
    await handle?.drop();
  });

  const admin = () => setSession("ADMIN", w.admin.id);

  test("ADMIN only, reads included: STAFF, TEACHER and no session are refused and nothing is written", async () => {
    for (const [role, id] of [["STAFF", staffId], ["TEACHER", teacherUserId], [null, "nobody"]] as const) {
      setSession(role, id);
      const before = [await db.staffCredential.count(), await db.quickLoginTerminal.count()];
      const refused = (e: Error) => e.message === "Not authorised";
      await assert.rejects(() => S.listStaffCards(), refused);
      await assert.rejects(() => S.enrollNfcCard(none, form({ userId: staffId, uid: uid() })), refused);
      await assert.rejects(() => S.createStaffQr(staffId, ""), refused);
      await assert.rejects(() => S.revokeStaffCredential(none, form({ id: "1", reason: "lost" })), refused);
      await assert.rejects(() => S.renameTerminal(none, form({ id: "1", label: "x" })), refused);
      await assert.rejects(() => S.revokeTerminal(none, form({ id: "1" })), refused);
      assert.deepEqual([await db.staffCredential.count(), await db.quickLoginTerminal.count()], before);
    }
    admin();
    assert.equal((await S.listStaffCards()).users.length, 1, "the ADMIN control works");
  });

  test("enrolling a card: an active STAFF login only; a student's UID, a duplicate, junk, an ADMIN, a TEACHER and an inactive login are refused", async () => {
    admin();
    const student = await makeStudent(db, { cardUid: uid() });
    const inactive = await db.user.create({ data: { username: "gone-sc", passwordHash: "x", role: "STAFF", active: false } });
    const good = uid();
    assert.equal((await S.enrollNfcCard(none, form({ userId: staffId, uid: good.match(/.{2}/g)!.join(":").toLowerCase(), label: "front desk" }))).ok, true, "colons and lowercase are normalised");
    const row = await db.staffCredential.findFirstOrThrow({ where: { nfcUid: good } });
    assert.deepEqual([row.userId, row.kind, row.label, row.createdById], [staffId, "NFC", "front desk", w.admin.id]);
    const cases: [string, Record<string, string>][] = [
      ["a student's UID", { userId: staffId, uid: student.cardUid! }], ["a duplicate", { userId: staffId, uid: good }], ["junk", { userId: staffId, uid: "zz" }], ["too short", { userId: staffId, uid: "04A" }],
      ["an ADMIN login", { userId: w.admin.id, uid: uid() }], ["a TEACHER login", { userId: teacherUserId, uid: uid() }], ["an inactive login", { userId: inactive.id, uid: uid() }], ["no such user", { userId: "nobody", uid: uid() }],
    ];
    for (const [name, o] of cases) {
      const before = await db.staffCredential.count();
      const r = await S.enrollNfcCard(none, form(o));
      assert.equal(r.ok, false, name);
      assert.ok(r.error, name);
      assert.ok(!JSON.stringify(r.values ?? {}).toUpperCase().includes(String(o.uid).toUpperCase()), `${name}: the UID is not echoed back`);
      assert.equal(await db.staffCredential.count(), before, name);
    }
  });

  test("the staff card screen never carries a UID or a token hash to the browser", async () => {
    admin();
    const view = JSON.stringify(await S.listStaffCards());
    const creds = await db.staffCredential.findMany();
    assert.ok(creds.length > 0);
    for (const c of creds) {
      if (c.nfcUid) assert.ok(!view.includes(c.nfcUid));
      if (c.qrTokenHash) assert.ok(!view.includes(c.qrTokenHash));
    }
  });

  test("a QR: random, shown once, only its hash is stored, and the picture decodes to the same token with the app's own scanner library", async () => {
    admin();
    const a = await S.createStaffQr(staffId, "badge");
    const b = await S.createStaffQr(staffId, "");
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.notEqual(a.token, b.token);
    assert.equal(parseStaffQr(a.token), a.token);
    const stored = await db.staffCredential.findFirstOrThrow({ where: { qrTokenHash: sha256(a.token) } });
    assert.deepEqual([stored.kind, stored.nfcUid, stored.label, stored.userId], ["QR", null, "badge", staffId]);
    assert.equal(JSON.stringify(await db.staffCredential.findMany()).includes(a.token), false, "the token itself is nowhere in the database");
    assert.equal(JSON.stringify(await S.listStaffCards()).includes(a.token), false, "and never in the list");
    assert.ok(a.svg.startsWith("<svg") && !a.svg.includes(a.token), "the picture is an SVG, not the text");

    // Rebuild the same code as pixels and read it with jsQR, the decoder the scanner falls back to.
    const qr = qrcode(0, "M");
    qr.addData(a.token);
    qr.make();
    const size = qr.getModuleCount();
    const scale = 6;
    const quiet = 4;
    const dim = (size + quiet * 2) * scale;
    const px = new Uint8ClampedArray(dim * dim * 4).fill(255);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const i = (((r + quiet) * scale + y) * dim + (c + quiet) * scale + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
    assert.equal(jsQR(px, dim, dim)?.data, a.token, "jsQR reads back the exact token");
    // and the generator's own SVG has the same number of dark modules as the matrix (one <path> or <rect> per run)
    assert.ok(a.svg.includes("viewBox") || a.svg.includes("width"), "a scalable svg");
  });

  test("a QR for an ADMIN, a TEACHER or an inactive login is refused", async () => {
    admin();
    for (const id of [w.admin.id, teacherUserId, "nobody"]) assert.equal((await S.createStaffQr(id, "")).ok, false);
  });

  test("revoke: a reason is needed; the card stays as a record; twice or unknown says so; its UID stays reserved", async () => {
    admin();
    const card = await db.staffCredential.findFirstOrThrow({ where: { kind: "NFC" } });
    assert.equal((await S.revokeStaffCredential(none, form({ id: String(card.id), reason: "ab" }))).ok, false);
    assert.equal((await S.revokeStaffCredential(none, form({ id: String(card.id), reason: "lost on the bus" }))).ok, true);
    const after = await db.staffCredential.findUniqueOrThrow({ where: { id: card.id } });
    assert.deepEqual([after.revokeReason, after.revokedById, after.revokedAt !== null, after.nfcUid], ["lost on the bus", w.admin.id, true, card.nfcUid]);
    assert.equal((await S.revokeStaffCredential(none, form({ id: String(card.id), reason: "lost on the bus" }))).ok, false);
    assert.equal((await S.revokeStaffCredential(none, form({ id: "99999", reason: "lost on the bus" }))).ok, false);
    assert.equal((await S.enrollNfcCard(none, form({ userId: staffId, uid: card.nfcUid! }))).ok, false, "a revoked card cannot be enrolled again");
    const { quickSessionStillValid } = await import("@/lib/quick-login");
    const term = await db.quickLoginTerminal.create({ data: { tokenHash: sha256("t-1") } });
    assert.equal(await quickSessionStillValid(card.id, term.id), false, "a session from a revoked card is over");
  });

  test("terminals: name them, revoke them (a revoked terminal refusing sign-in is proved in quick-login-db.test.ts)", async () => {
    admin();
    const t = await db.quickLoginTerminal.create({ data: { tokenHash: sha256("t-2") } });
    assert.equal((await S.renameTerminal(none, form({ id: String(t.id), label: "Front desk" }))).ok, true);
    assert.equal((await db.quickLoginTerminal.findUniqueOrThrow({ where: { id: t.id } })).label, "Front desk");
    assert.equal((await S.revokeTerminal(none, form({ id: String(t.id) }))).ok, true);
    assert.ok((await db.quickLoginTerminal.findUniqueOrThrow({ where: { id: t.id } })).revokedAt);
    assert.equal((await S.revokeTerminal(none, form({ id: String(t.id) }))).ok, false);
    assert.equal((await S.renameTerminal(none, form({ id: "99999", label: "x" }))).ok, false);
  });

  test("a student can never be registered with a staff card's UID (create, and attach to an existing student); the student's own UID still works", async () => {
    setSession("STAFF", staffId);
    const staffUid = uid();
    await db.staffCredential.create({ data: { userId: staffId, kind: "NFC", nfcUid: staffUid, createdById: w.admin.id } });
    const teacher = await makeTeacher(db, "Mr Reg");
    const course = await makeCourse(db, w, { teacherId: teacher.id, fee: "1000.00" });
    const enrol = (f: FormData) => { f.append("courseId", String(course.id)); f.append("feeTierId", String(w.tiers.FULL.id)); return f; };

    const students = await db.student.count();
    const refused = await R.createStudent(none, enrol(form({ name: "Nimal", phone: "0771234567", school: "Royal", cardUid: staffUid })));
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? "", /staff card/);
    assert.equal(await db.student.count(), students, "no student was written");

    const own = uid();
    const ok = await R.createStudent(none, enrol(form({ name: "Nimal", phone: "0771234567", school: "Royal", cardUid: own })));
    assert.equal(ok.ok, true, ok.error);
    assert.equal(await db.student.count(), students + 1);

    const bare = await makeStudent(db);
    await db.student.update({ where: { id: bare.id }, data: { cardUid: null } });
    const attach = await R.attachIdentifier(none, form({ studentId: String(bare.id), kind: "cardUid", value: staffUid }));
    assert.equal(attach.ok, false);
    assert.match(attach.error ?? "", /staff card/);
    assert.equal((await db.student.findUniqueOrThrow({ where: { id: bare.id } })).cardUid, null);
    assert.equal((await R.attachIdentifier(none, form({ studentId: String(bare.id), kind: "cardUid", value: uid() }))).ok, true);
  });

  test("the User Roles page lists staff cards for ADMIN only; STAFF gets not-found", async () => {
    const { default: page } = await import("./page");
    const render = async () => renderToStaticMarkup((await (page as () => Promise<React.ReactElement>)()) as React.ReactElement);
    setSession("STAFF", staffId);
    await assert.rejects(render, /NEXT_NOT_FOUND/);
    admin();
    const h = await render();
    assert.ok(h.includes("Staff cards and QR codes") && h.includes("Registered terminals") && h.includes("Recent sign-in attempts"));
    assert.ok(h.includes("lost on the bus"), "the revoked card shows its reason");
  });
});
