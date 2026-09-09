import "dotenv/config";
import { randomInt } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

/**
 * The ONE login the institute starts with.
 *
 * Deliberately not part of the structural seed, and deliberately not a password
 * anybody can guess from this repository:
 *
 *  - the temporary password is GENERATED here with `crypto.randomInt` and
 *    printed once. It is never written to a file, never committed, and there is
 *    no default to fall back to, and no well-known placeholder anyone could
 *    try first.
 *  - the account is created with `mustChangePassword`, so the very first login
 *    lands on /change-password and cannot reach any other screen until a real
 *    password is set. Changing it also bumps `tokenVersion`, which revokes the
 *    session the temporary password created.
 *  - it REFUSES to run if any user already exists. "Exactly one bootstrap
 *    admin" is a property of the live database, not of how carefully it is run,
 *    and a second run must never quietly reset a real admin's password.
 *
 * Every other login — staff, teachers, further admins — is created from
 * User Roles and Setup → Teachers once someone is signed in.
 */
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("Neither DIRECT_URL nor DATABASE_URL is set");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Ambiguous characters left out: this gets read off a screen and typed once. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function temporaryPassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME ?? "admin";

  const existing = await db.user.count();
  if (existing > 0) {
    const who = await db.user.findMany({ select: { username: true, role: true } });
    console.error(
      `Refusing to run: this database already has ${existing} login(s) — ` +
        who.map((u) => `${u.username} (${u.role})`).join(", ") +
        ". Reset a password from User Roles instead.",
    );
    process.exitCode = 1;
    return;
  }

  const password = temporaryPassword();
  await db.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      role: "ADMIN",
      mustChangePassword: true,
    },
  });

  console.log("Bootstrap admin created.");
  console.log(`  username           : ${username}`);
  console.log(`  temporary password : ${password}`);
  console.log("  role               : ADMIN");
  console.log("  mustChangePassword : true — the first login must set a real password");
  console.log("\nThis password is shown once and is not stored anywhere else.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
