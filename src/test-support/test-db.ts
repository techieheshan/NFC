import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { mock } from "node:test";

import { Client } from "pg";
import type { PrismaClient, UserRole } from "@prisma/client";

import { requireSafeTestDatabase } from "@/test-support/db-guard";

/**
 * Database tests.
 *
 * To run them, point `XENON_TEST_DATABASE_URL` at a DISPOSABLE Postgres, e.g.
 *
 *   podman run -d --name xenon-test-pg -p 127.0.0.1:55432:5432 \
 *     -e POSTGRES_PASSWORD=<anything local> -e POSTGRES_DB=xenon_test \
 *     --tmpfs /var/lib/postgresql/data:rw docker.io/library/postgres:16-alpine
 *   XENON_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:55432/xenon_test npm test
 *
 * Why it is built this way:
 *  - It reads its OWN variable, never `DATABASE_URL`, so a production URL that
 *    happens to be exported (or loaded from `.env`) can never be used by a test.
 *  - Unset → every database test is SKIPPED, loudly, so plain `npm test` stays
 *    green and touches nothing. Set to a host that is not allowed → it THROWS.
 *  - Each test FILE creates its own database on that server, applies the repo's
 *    migration SQL to it, and drops it afterwards. Test files run in parallel
 *    and settings / daily totals are global, so sharing one database would make
 *    them trample each other. Nothing is ever dropped that this helper did not
 *    create (name prefix is asserted).
 *  - The clock is frozen, so a test cannot be flaky on the 1st or the last day.
 */

export const TEST_DB_ENV = "XENON_TEST_DATABASE_URL";

/** Spread into `describe(..., { skip: dbSkip })`. */
export const dbSkip: string | false = process.env[TEST_DB_ENV]
  ? false
  : `${TEST_DB_ENV} is not set — database tests skipped (see src/test-support/test-db.ts)`;

// Until a test database is opened, anything that imports `@/lib/db` must land
// on a host that cannot resolve — never on a real database.
process.env.DATABASE_URL = "postgresql://nobody:nobody@db-free.invalid:5432/none";

const DB_PREFIX = "xenon_t_";
const MIGRATIONS = path.join(process.cwd(), "prisma", "migrations");

function withDatabase(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export type TestDatabase = { name: string; drop: () => Promise<void> };

/**
 * Creates this file's private database, applies every migration, and points
 * `DATABASE_URL` at it. Call BEFORE the first import of `@/lib/db` (use dynamic
 * `import()` for the modules under test).
 */
export async function openTestDatabase(): Promise<TestDatabase> {
  const base = process.env[TEST_DB_ENV];
  requireSafeTestDatabase(base); // prints the host; throws before connecting if not allowed

  const name = `${DB_PREFIX}${process.pid}_${randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: base });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(base!, name);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const dir of readdirSync(MIGRATIONS).filter((d) => /^\d/.test(d)).sort()) {
      await client.query(readFileSync(path.join(MIGRATIONS, dir, "migration.sql"), "utf8"));
    }
  } finally {
    await client.end();
  }

  process.env.DATABASE_URL = url;
  console.log(`[test-db] created ${name}`);

  return {
    name,
    drop: async () => {
      if (!name.startsWith(DB_PREFIX)) throw new Error("refusing to drop a database this helper did not create");
      const a = new Client({ connectionString: base });
      await a.connect();
      try {
        await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await a.end();
      }
      console.log(`[test-db] dropped ${name}`);
    },
  };
}

// ---- the clock ----------------------------------------------------------------

/**
 * Freezes `Date` (and so `colomboNow()` and every `new Date()` in the code under
 * test) at one instant. A fixed instant is deliberately stronger than "read the
 * real month once": it cannot straddle midnight or a month rollover mid-run.
 */
export function freezeClock(iso: string) {
  mock.timers.reset(); // safe when not enabled — lets a test move the clock
  mock.timers.enable({ apis: ["Date"], now: new Date(iso) });
}
export function unfreezeClock() {
  mock.timers.reset();
}

// ---- factories ----------------------------------------------------------------
// Each test file builds the data it needs and never reads what happens to exist.

let seq = 0;
const uniq = (p: string) => `${p}-${++seq}`;

export type World = Awaited<ReturnType<typeof seedWorld>>;

/** Reference data + the two staff logins + the two fee settings. */
export async function seedWorld(db: PrismaClient, opts: { admissionFee?: string; smartCardFee?: string } = {}) {
  const [stream, subject, grade, classType] = await Promise.all([
    db.stream.create({ data: { label: "T-Stream" } }),
    db.subject.create({ data: { label: "T-Subject" } }),
    db.grade.create({ data: { label: "T-Grade" } }),
    db.classType.create({ data: { code: "THEORY", label: "Theory" } }),
  ]);
  const tiers = {
    FULL: await db.feeTier.create({ data: { code: "FULL", label: "Full", multiplier: "1.000" } }),
    HALF: await db.feeTier.create({ data: { code: "HALF", label: "Half", multiplier: "0.500" } }),
    FREE: await db.feeTier.create({ data: { code: "FREE", label: "Free", multiplier: "0.000" } }),
  };
  const user = (role: UserRole) =>
    db.user.create({ data: { username: uniq(role.toLowerCase()), passwordHash: "x", role } });
  const [admin, staff] = await Promise.all([user("ADMIN"), user("STAFF")]);
  await db.setting.create({ data: { key: "admission_fee", value: opts.admissionFee ?? "1500" } });
  await db.setting.create({ data: { key: "smart_card_fee", value: opts.smartCardFee ?? "500" } });
  return { stream, subject, grade, classType, tiers, admin, staff };
}

export const makeTeacher = (db: PrismaClient, name = uniq("Teacher")) => db.teacher.create({ data: { name } });

export function makeCourse(
  db: PrismaClient,
  w: World,
  o: { teacherId: number; fee: string; share?: string; name?: string },
) {
  return db.course.create({
    data: {
      name: o.name ?? uniq("Course"),
      teacherId: o.teacherId,
      subjectId: w.subject.id,
      gradeId: w.grade.id,
      streamId: w.stream.id,
      classTypeId: w.classType.id,
      defaultFee: o.fee,
      instituteSharePercent: o.share ?? "20.00",
    },
  });
}

export const makeStudent = (db: PrismaClient, o: { admissionPaid?: boolean; cardUid?: string } = {}) =>
  db.student.create({
    data: { name: uniq("Student"), cardNumber: uniq("CARD"), cardUid: o.cardUid, admissionPaid: o.admissionPaid ?? false },
  });

export const enrol = (
  db: PrismaClient,
  o: { studentId: number; courseId: number; tierId: number; since: string; status?: "ACTIVE" | "DROPPED" },
) =>
  db.enrollment.create({
    data: { studentId: o.studentId, courseId: o.courseId, feeTierId: o.tierId, createdAt: new Date(o.since), status: o.status },
  });

export const makeCombo = (
  db: PrismaClient,
  o: { teacherId: number; items: { courseId: number; fee: string }[]; active?: boolean },
) =>
  db.combo.create({
    data: {
      teacherId: o.teacherId,
      name: uniq("Combo"),
      active: o.active,
      items: { create: o.items.map((i) => ({ courseId: i.courseId, comboFee: i.fee })) },
    },
  });

export const attend = (
  db: PrismaClient,
  o: { studentId: number; courseId: number; date: string; markedById: string; markedAt?: string },
) =>
  db.attendance.create({
    data: {
      studentId: o.studentId,
      courseId: o.courseId,
      date: new Date(`${o.date}T00:00:00Z`),
      method: "SEARCH",
      markedById: o.markedById,
      markedAt: o.markedAt ? new Date(o.markedAt) : undefined,
      clientRef: uniq("ref"),
    },
  });
