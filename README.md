# Xenon — Institute Attendance / Payment / Payroll

Phase 0 (foundation) is complete: schema, auth, role-based navigation shell,
PWA installability, and seeded reference data. **No feature screens exist yet** —
every module routes to a "coming soon" placeholder.

## Stack

| Concern  | Choice                                     |
| -------- | ------------------------------------------ |
| Framework| Next.js 16 (App Router) + TypeScript       |
| Database | PostgreSQL on Neon, via Prisma 7           |
| UI       | Tailwind v4 + shadcn/ui (Radix), purple/white |
| Auth     | Auth.js (NextAuth v5), credentials + JWT   |

## Getting started

```bash
npm install                 # runs `prisma generate` via postinstall
cp .env.example .env        # fill in DATABASE_URL, DIRECT_URL, AUTH_SECRET, ADMIN_PASSWORD
npm run db:migrate          # apply migrations
npm run db:seed             # idempotent reference data + admin user
npm run dev
```

Sign in at `/login` with `admin` and whatever `ADMIN_PASSWORD` you seeded.
**Change that password before going live.**

### Scripts

| Script              | Does                                        |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Dev server                                  |
| `npm run build`     | Production build (fails on any TS error)    |
| `npm run typecheck` | `tsc --noEmit`                              |
| `npm run lint`      | ESLint                                      |
| `npm run db:migrate`| `prisma migrate dev`                        |
| `npm run db:deploy` | `prisma migrate deploy` (production)        |
| `npm run db:seed`   | `prisma db seed` — safe to re-run           |
| `npm run db:studio` | `prisma studio`                             |

## How the foundation is wired

### Database

`prisma/schema.prisma` is the **foundation contract** and is used exactly as
supplied, with one unavoidable change: Prisma 7 no longer accepts `url` /
`directUrl` inside the `datasource` block. Connection URLs now live in
[`prisma.config.ts`](prisma.config.ts). No model, field, or relation was touched.

Two connections, deliberately:

- **`DATABASE_URL`** — Neon's *pooled* endpoint. Used by the app at runtime
  through the `@prisma/adapter-pg` driver adapter in [`src/lib/db.ts`](src/lib/db.ts).
- **`DIRECT_URL`** — Neon's *direct* endpoint. Used only by the Prisma CLI
  (migrate / studio / seed), because PgBouncer can't run migration DDL.

### Nothing business-related is hardcoded

Fees, fee tiers, class types, expense types and institute-share presets are all
rows in reference tables (`FeeTier`, `ClassType`, `ExpenseType`, `Stream`, …)
or in `Setting`. Read them from the database — never inline them as constants.
`Subject` and `Grade` are intentionally **not** seeded; the institute adds its
own through the UI.

### Auth

Credentials (username + password) against `User.passwordHash` with bcrypt, JWT
sessions carrying `userId` and `role`. The config is split on purpose:

- [`src/auth.config.ts`](src/auth.config.ts) — edge-safe. No Prisma, no bcrypt.
  [`src/proxy.ts`](src/proxy.ts) (Next 16's renamed `middleware`) instantiates
  NextAuth with this alone, so route protection is a token read.
- [`src/auth.ts`](src/auth.ts) — adds the Credentials provider. Node only.

`trustHost: true` is set because the app is self-hosted and reached by varying
hostnames. Set `AUTH_URL` instead if it ever gets one fixed public origin.

### Navigation

[`src/config/nav.ts`](src/config/nav.ts) is the single menu. Each item declares
`roles` (who may see it) and `surfaces` (`"terminal"` tiles vs `"desktop"`
sidebar). There is no second menu per role — both shells call `navFor(role, surface)`.

That config is also the **authorization source**: `Placeholder` re-checks the
current role against the item's `roles` and 404s otherwise, so a role that can't
see a menu entry can't reach the URL by typing it. Feature tags replacing a
placeholder should keep that guard.

### Setup screens (`/admin/*`)

Subjects, Grades, Teachers and Courses — the backbone reference data everything
else enrols into. **ADMIN + STAFF only**, enforced in three places:

- the menu (`roles` in `src/config/nav.ts`),
- the route (`requireNavAccess` in [`src/lib/authz.ts`](src/lib/authz.ts), which
  reads those same `roles`),
- every server action (`requireSetupAccess`) — actions are independently
  reachable HTTP endpoints, so the page guard alone is not enough.

Two conventions these screens establish for later tags:

- **Soft delete only.** "Delete" sets `active = false`. These rows are
  referenced by courses, enrolments and payments; removing one would orphan
  history. Deactivated rows stay listed and can be reactivated.
- **Derived course names.** `Course.name` holds only what staff typed. When it's
  blank the label is composed at render time by
  [`courseDisplayName`](src/lib/course-name.ts) — never persisted, so renaming a
  grade or subject doesn't leave stale text baked into the row.

Creating a teacher writes a `Teacher` **and** their login `User` inside one
`$transaction`, so a duplicate username leaves neither behind. Deactivating a
teacher disables their login in the same transaction.

### Schedules (`/admin/schedules`)

The timetable the Attendance tag will match against. Two sections, ADMIN + STAFF.

- **Weekly timetable** (`Schedule`) — recurring sessions. A course may hold
  several, and duplicates/overlaps are deliberately allowed. There is **no
  delete**, only deactivate: attendance records are interpreted against the
  timetable as it was, so it has to survive as history.
- **Additional classes** (`AdditionalClass`) — one-off dated sessions. The
  schema gives these no `active` flag, so removal is a real delete, permitted
  **only while no `Attendance` row references them**. The server re-checks that
  on every delete; the UI just shows a locked "Used" button instead.

**Attendance windows** are minute offsets, both defaulting to 30 and editable
per row. They count from *different ends* of the class, which is the easy thing
to get wrong:

```
opens  = startTime - attendanceOpensBeforeMin
closes = endTime   - attendanceClosesBeforeMin
```

So a 3:00–5:00 class with 30/30 accepts marks between 2:30 and 4:30 — the close
counts back from the end, so latecomers past 4:30 aren't marked present. This
tag only stores and displays the window; [`attendanceWindow`](src/lib/schedule-time.ts)
computes it for display. Evaluating it against "now" belongs to Attendance.

Times are `"HH:mm"` strings. Because they're zero-padded 24h, `endTime > startTime`
is a plain string comparison — which is exactly how it's validated.

### Attendance (`/attendance`)

Scan-driven marking, ADMIN + STAFF. Three ways in — NFC tap (UID), QR scan (card
number), or a typeahead search over card number / name / school — all converging
on one matcher.

**Everything "now" is Asia/Colombo**, never the server clock. Production runs
UTC, so an 8–10 PM Colombo class would otherwise resolve against the previous
UTC day and fall outside its own window. [`colomboNow`](src/lib/colombo-time.ts)
derives the weekday, wall-clock time and calendar date through `Intl`, and
`Attendance.date` stores the Colombo day. **Test the app under `TZ=UTC`** — a
dev machine set to `+0530` will pass either way and hide the bug.

The matcher collects the student's candidate classes for today — active
schedules on today's weekday plus additional classes dated today — and keeps
those whose window contains now. Then:

| Candidates | Behaviour |
| --- | --- |
| 0 | Explains *why*: the next class's opens-at, the last one's closed-at, or "no class today" |
| 1 regular | Marks immediately, success cue, one-tap Undo |
| 1 additional | Asks first — one-off classes are unusual enough to acknowledge |
| 2+ | Pick-list tagged regular/additional |
| already marked | "Already marked at HH:mm", distinct cue, no second row |

**Idempotency is two-layered.** An explicit check on (student, course, date
[, additionalClass]) implements the app-level rule the schema deliberately
leaves to code, and the unique `clientRef` — a UUID generated on the client —
catches the concurrent double-submit that the check alone would race past.
`clientRef` exists now so Tag B's offline outbox can dedupe replays on it.

`markCandidate` re-derives the chosen class server-side rather than trusting the
posted ids, so a stale or forged client can't mark a class that isn't actually
open for that student. Undo is restricted to today's rows — correcting history
is not this screen's job.

Cues are synthesised with Web Audio (no asset files): rising two-tone for a
fresh mark, flat double blip for already-marked, low buzz for rejects. The
context is unlocked on the first tap, since browsers refuse to start one without
a gesture.

### Registration (`/registration`)

Scan-driven, ADMIN + STAFF. A card UID either opens a new-student form or loads
the student it already belongs to. There is deliberately no student list here —
browsing belongs to the Search tag.

- **A card carries two identifiers.** `Student.cardUid` is the NFC chip serial;
  `Student.cardNumber` is the number printed on the card and encoded in its QR
  (a plain string like `0186-0001-2000` — no URL, no prefix). Both are unique
  and both are optional, but **at least one is required**, enforced server-side:
  an office with no NFC phone registers by QR alone, an NFC-only flow by UID.
  Lookup matches on either, so tapping a card and scanning its QR find the same
  student, and a student missing one identifier can have it filled in later.
- **Card UIDs are normalised** by [`normalizeCardUid`](src/lib/card-uid.ts) to
  bare uppercase hex. Web NFC returns `04:a2:2b:9c` while staff may type
  `04a22b9c`; `Student.cardUid` is unique, so both must resolve to one string or
  a known card would look new.
- **Card numbers are normalised** by `normalizeCardNumber`, which strips *all*
  whitespace and leaves dashes/case as printed. Staff type `0186 - 0001 - 2000`;
  merely collapsing runs of spaces would still not equal the QR's value, and the
  column is unique, so the same card would look like two.
- **QR scanning** prefers the native `BarcodeDetector` and falls back to `jsqr`,
  which is behind a dynamic import so the decoder never reaches devices that
  have the native API or never open the scanner — this screen also runs on the
  terminal.
- **Web NFC** (`NDEFReader`) is Chrome-on-Android-over-HTTPS only. Support is
  read with `useSyncExternalStore`, and every other browser gets the manual UID
  field instead — that fallback is the desktop path, not a degraded mode.
- **Creating a student is one transaction**: student, enrolments and photo
  upload together. At least one enrolment is required, enforced server-side.
  `admissionPaid` stays `false` — registration charges nothing, and this tag
  creates no `Payment` rows at all.

#### Photos

All uploads are server-side. [`src/lib/photo.ts`](src/lib/photo.ts) is the only
module that knows about Cloudinary; everything else handles `photoUrl` strings,
so swapping storage later is a one-file change. The API secret is read from the
server environment and never reaches the browser — there are no unsigned or
browser-direct uploads.

Two distinct transformations, which is easy to get wrong:

- **Incoming** (`w_400,c_limit` + `q_auto`) runs at upload, so the *stored*
  asset is already 400px — originals are never kept. `fetch_format` must NOT go
  here: it would let Cloudinary pick the stored format, and a replacement could
  land at a different extension than the original.
- **Delivery** (`f_auto,q_auto`) is applied when building the URL, so each
  browser gets WebP/AVIF. The URL carries the asset version, which is what makes
  "replace the photo in place" actually visible instead of a cached no-op.

`public_id` is `xenon/students/<studentId>` with `overwrite: true`, so a
re-upload replaces the image rather than accumulating copies.

### Terminal-weight

The POS/terminal routes run on modest Android hardware, so the shell is
server-rendered. The only client components are `NavLink` (needs the pathname
for active state) and `RegisterServiceWorker`. Sign-out is a plain `<form>`
posting to a server action. Keep it that way on `/attendance` and `/payment`.

### PWA

Manifest at [`src/app/manifest.ts`](src/app/manifest.ts), a deliberately inert
service worker at [`public/sw.js`](public/sw.js). The app is **installable only**.
The offline data-sync engine ships with the Attendance tag — do not add caching
to the service worker before then, or stale payment and attendance screens will
be served.

## Known issues

- `npm audit` reports 3 high-severity advisories in `deepmerge-ts`, reached only
  via `@prisma/config` — a **dev-time CLI dependency**, not shipped in the app.
  Clearing it requires downgrading to Prisma 6. Revisit when Prisma bumps it.
- `pg` warns that `sslmode=require` is currently treated as `verify-full`, and
  will change meaning in pg v9. Connections work today; pin `sslmode=verify-full`
  explicitly when upgrading.
