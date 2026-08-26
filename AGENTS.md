<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Xenon — project rules

Read `README.md` first. It explains the two DB connections, the split auth
config, and why the shell is server-rendered.

These carry over from the Phase 0 brief and apply to **every** feature tag:

1. **`prisma/schema.prisma` is the foundation contract.** Don't rename, remove,
   or restructure models, fields, or relations. If one looks wrong, stop and
   ask. (Only the `datasource` block was adapted, for Prisma 7 — see README.)
2. **Nothing business-related is hardcoded.** Fees, fee tiers, class types,
   expense types, institute-share presets: read from reference tables or
   `Setting`. Never inline them as constants.
3. **Stack is fixed:** Next.js App Router + TypeScript, Prisma + PostgreSQL
   (Neon), Tailwind + shadcn/ui, Auth.js v5. No substitutions.
4. **Money is `Decimal`, never `Float`.** Percentages are `Decimal(5,2)`.
   Payment amounts are snapshots — past payments never change.
5. **Keep `/attendance` and `/payment` light.** They run on modest Android
   hardware. Server-render by default; add client components only where
   interaction genuinely requires them.
6. **Theme is purple + white**, driven by the tokens in `src/app/globals.css`.
   Hue 300 is the single purple anchor.
7. **One menu.** Add modules to `src/config/nav.ts` with their `roles` and
   `surfaces` — never write a second menu per role. That config is also the
   route-level authorization source; keep the role guard when replacing a
   placeholder with a real screen.
8. **Don't add caching to `public/sw.js`** until the Attendance tag's offline
   sync engine lands. Stale payment/attendance screens are worse than none.
9. **Soft-delete reference data.** Subjects, grades, teachers and courses are
   deactivated (`active = false`), never deleted — later rows point at them.
10. **Guard server actions separately from pages.** Use `requireRole` /
    `requireSetupAccess` / `requireOperationalAccess` from `src/lib/authz.ts`
    inside every action — reads included. A server action is its own HTTP
    endpoint; the page guard does not cover it.
11. **All file uploads are server-side.** Go through `src/lib/photo.ts`. Never
    add unsigned/browser-direct uploads, and never expose a storage secret to
    the client (nothing storage-related may become `NEXT_PUBLIC_`).
12. **Normalise card identifiers** with `normalizeCardUid` / `normalizeCardNumber`
    on every path that reads or writes `Student.cardUid` / `Student.cardNumber`.
    Both are unique columns fed by scanning AND typing, so the two entry routes
    must land on identical strings. A student needs at least one of them.
13. **Money stays out of registration.** Creating a student leaves
    `admissionPaid = false` and writes no `Payment` rows; charging belongs to
    the Payment tag.
14. **React 19 resets an uncontrolled form once its action resolves.** On a
    validation error that would wipe what the user typed, so actions return the
    submitted `values` and inputs use them as defaults. A `<select>` needs more:
    `defaultValue` only applies at mount, so key it on the echoed value —
    otherwise it resets to a `disabled` placeholder and the browser drops the
    field from the submission entirely. See `admin/schedules/schedule-manager.tsx`.
15. **All attendance/"now" logic is `Asia/Colombo`** via `src/lib/colombo-time.ts`,
    never the server clock or `new Date()` parts. Production is UTC; verify with
    `TZ=UTC npm run start`, because a dev box on `+0530` hides the bug.
16. **Never sync props into state with an effect.** Filters are searchParams, so
    a filter change is a fresh server render; key the component on the filter
    signature and let it remount instead.

Some app-logic invariants are deliberately *not* enforced by DB constraints —
"already marked attendance?" and "already paid this month?" are checked in code
(see the comments in `schema.prisma`). Preserve those checks.
