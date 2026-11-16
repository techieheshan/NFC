"use server";

import { revalidatePath } from "next/cache";
import qrcode from "qrcode-generator";

import { requireRole } from "@/lib/authz";
import { normalizeCardUid } from "@/lib/card-uid";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/lib/prisma-errors";
import { purgeOldQuickEvents } from "@/lib/quick-login";
import { newQrToken, sha256 } from "@/lib/quick-login-rules";

/**
 * Staff cards, staff QR codes and registered terminals. ADMIN only, reads included (AGENTS 10 and 29): the list names who holds which card,
 * and a server action is its own endpoint. Nothing is ever deleted: a card or terminal is REVOKED (the audit rows keep pointing at it, and a
 * lost card's later taps are logged as REVOKED). A card is shown by its LABEL only: the UID is never sent back to the browser.
 */
const requireAdmin = () => requireRole(["ADMIN"]);

export type ActionState = { ok: boolean; error?: string; values?: Record<string, string> };

export type CardRow = { id: number; kind: "NFC" | "QR"; label: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokeReason: string | null };
export type StaffCardUser = { userId: string; username: string; name: string; active: boolean; cards: CardRow[] };
export type TerminalRow = { id: number; label: string | null; createdAt: string; lastSeenAt: string; consecutiveQuick: number; lockedUntil: string | null; revokedAt: string | null };
export type EventRow = { id: number; at: string; outcome: string; method: string; who: string | null; terminal: string | null };
export type StaffCardsView = { users: StaffCardUser[]; terminals: TerminalRow[]; events: EventRow[]; purged: number };

const echo = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && !/uid|token/i.test(k))) as Record<string, string>;
const fail = (fd: FormData, error: string): ActionState => ({ ok: false, error, values: echo(fd) });
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const text = (v: FormDataEntryValue | null, max: number) => String(v ?? "").trim().slice(0, max);

export async function listStaffCards(): Promise<StaffCardsView> {
  await requireAdmin();
  const purged = await purgeOldQuickEvents();
  const [users, terminals, events] = await Promise.all([
    db.user.findMany({
      where: { role: "STAFF" },
      select: { id: true, username: true, active: true, staff: { select: { name: true } }, staffCredentials: { orderBy: { id: "asc" } } },
      orderBy: { username: "asc" },
    }),
    db.quickLoginTerminal.findMany({ orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: "desc" }], take: 50 }),
    db.quickLoginEvent.findMany({ orderBy: { id: "desc" }, take: 25 }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.staff?.name ?? u.username]));
  return {
    users: users.map((u) => ({
      userId: u.id, username: u.username, name: u.staff?.name ?? u.username, active: u.active,
      cards: u.staffCredentials.map((c) => ({ id: c.id, kind: c.kind, label: c.label, createdAt: c.createdAt.toISOString(), lastUsedAt: iso(c.lastUsedAt), revokedAt: iso(c.revokedAt), revokeReason: c.revokeReason })),
    })),
    terminals: terminals.map((t) => ({ id: t.id, label: t.label, createdAt: t.createdAt.toISOString(), lastSeenAt: t.lastSeenAt.toISOString(), consecutiveQuick: t.consecutiveQuick, lockedUntil: iso(t.lockedUntil), revokedAt: iso(t.revokedAt) })),
    events: events.map((e) => ({ id: e.id, at: e.at.toISOString(), outcome: e.outcome, method: e.method, who: e.userId ? (names.get(e.userId) ?? "someone") : null, terminal: e.terminalId ? `#${e.terminalId}` : null })),
    purged,
  };
}

/** The STAFF user a card may be given to: it exists, is a STAFF login, and is active. A card for an ADMIN or a TEACHER is refused here, and again at sign-in. */
async function staffHolder(userId: string) {
  return db.user.findFirst({ where: { id: userId, role: "STAFF", active: true }, select: { id: true } });
}

/** Enrol a staff NFC card by its UID (read by tapping it on this screen, or typed). A student's UID is refused. */
export async function enrollNfcCard(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const holder = await staffHolder(text(formData.get("userId"), 64));
  if (!holder) return fail(formData, "Pick an active STAFF login.");
  const uid = normalizeCardUid(String(formData.get("uid") ?? ""));
  if (!/^[0-9A-F]{4,32}$/.test(uid)) return fail(formData, "Tap the card, or type its UID (letters A to F and digits, 4 to 32 characters).");
  if (await db.student.findFirst({ where: { cardUid: uid }, select: { id: true } })) return fail(formData, "That UID is a student's card. A student's card cannot be a staff card.");
  if (await db.staffCredential.findFirst({ where: { nfcUid: uid }, select: { id: true } })) return fail(formData, "That card is already enrolled (a revoked card cannot be used again).");
  try {
    await db.staffCredential.create({ data: { userId: holder.id, kind: "NFC", nfcUid: uid, label: text(formData.get("label"), 60) || null, createdById: admin.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return fail(formData, "That card is already enrolled.");
    throw e;
  }
  revalidatePath("/user-roles");
  return { ok: true };
}

export type QrResult = { ok: true; svg: string; token: string } | { ok: false; error: string };

/**
 * Make a staff QR. The token is random and is returned ONCE, here, to be printed: only its SHA-256 is stored, so it cannot be shown again
 * (revoke it and make a new one). The picture is made on the server, so the browser needs no QR library.
 */
export async function createStaffQr(userId: string, label: string): Promise<QrResult> {
  const admin = await requireAdmin();
  const holder = await staffHolder(typeof userId === "string" ? userId.slice(0, 64) : "");
  if (!holder) return { ok: false, error: "Pick an active STAFF login." };
  const token = newQrToken();
  await db.staffCredential.create({ data: { userId: holder.id, kind: "QR", qrTokenHash: sha256(token), label: String(label ?? "").trim().slice(0, 60) || null, createdById: admin.id } });
  const qr = qrcode(0, "M");
  qr.addData(token);
  qr.make();
  revalidatePath("/user-roles");
  return { ok: true, svg: qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true }), token };
}

export async function revokeStaffCredential(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  const reason = text(formData.get("reason"), 300);
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That card could not be found.");
  if (reason.length < 3) return fail(formData, "Give a reason (at least 3 characters).");
  const done = await db.staffCredential.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: admin.id, revokeReason: reason } });
  if (done.count === 0) return fail(formData, "That card is already revoked, or could not be found.");
  revalidatePath("/user-roles");
  return { ok: true };
}

export async function renameTerminal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That terminal could not be found.");
  const done = await db.quickLoginTerminal.updateMany({ where: { id }, data: { label: text(formData.get("label"), 60) || null } });
  if (done.count === 0) return fail(formData, "That terminal could not be found.");
  revalidatePath("/user-roles");
  return { ok: true };
}

/** A revoked terminal is refused at once, and every quick session that came from it ends on its next request. The device can become a terminal again by a password sign-in. */
export async function revokeTerminal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return fail(formData, "That terminal could not be found.");
  const done = await db.quickLoginTerminal.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: admin.id } });
  if (done.count === 0) return fail(formData, "That terminal is already revoked, or could not be found.");
  revalidatePath("/user-roles");
  return { ok: true };
}
