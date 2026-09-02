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
8. **`public/sw.js` caches `/attendance` and nothing else.** Everything else
   falls back to `/offline` — a stale payment or report screen is worse than
   none. Never cache a non-GET, `/api/*`, or another route's HTML. Serve a
   cached page by reading its body and building a FRESH `Response`: handing
   `caches.match()`'s stored response straight to a navigation is rejected by
   Chrome for some routes, intermittently, and the user gets the browser's own
   error page instead of ours.
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
16. **Prices are recomputed server-side, always.** The client may say what to
    charge and which combo was decided; it never sends an amount or asserts
    eligibility. See `payment/actions.ts`.
17. **Never sync props into state with an effect.** Filters are searchParams, so
    a filter change is a fresh server render; key the component on the filter
    signature and let it remount instead.
18. **A receipt is a transaction, not a row.** Everything one checkout writes
    shares a `Payment.transactionRef`; reprint and cancel both act on the whole
    group. Never hard-delete a payment — cancelling sets `cancelled` +
    `cancelledById` / `cancelledAt` / `cancelReason`, amounts are never
    recomputed, and reports already exclude cancelled rows. Cancelling an
    ADMISSION row must revert `Student.admissionPaid`; a cancelled SMART_CARD
    leaves `cardUid` alone. A legacy row with a null ref stands alone — never
    filter on `transactionRef: null`, which matches every un-backfilled row.
19. **The edge proxy is a coarse gate; Node is the authority.** `src/proxy.ts`
    runs `auth.config.ts`, which cannot reach Prisma, so it can only ask "is
    there a decodable token" — not whether the account is still active or the
    session still valid. That check lives in the Node `jwt` callback in
    `src/auth.ts`, which returns `null` to end a session. Never let the edge
    redirect a token-holder *away* from `/login`: it will bounce them to a page
    whose Node check bounces them straight back, forever. Anything "am I really
    signed in" belongs on the Node side.
20. **A password change bumps `User.tokenVersion`.** That is what revokes
    already-issued JWTs — deactivation, admin reset, own change, and "sign out
    everywhere" all bump it. Admin-set passwords also set `mustChangePassword`,
    which the `(app)` layout turns into a redirect to `/change-password`; that
    page must stay OUTSIDE the `(app)` group or it redirects to itself.
21. **Offline attendance dedupes on `clientRef`, and only attendance goes
    offline.** The outbox drops an item only when the server confirms it, so a
    flush is always safe to repeat; `writeMark` refuses a second row for the
    same ref OR the same (student, class, day). Never trust `navigator.onLine`
    to decide anything — it stays `true` while every request fails. Try the
    server and fall back on failure. Offline the device clock is the only
    clock: queued mark times are best-effort, and a working set from another
    day refuses to mark at all.
22. **The counter sequences; it never decides.** `/attendance` streams taps
    through a serial queue, but which class is open comes from
    `attendance-match.ts`, the paid/not-paid colour from `studentArrears`
    (`student-arrears.ts`), and every amount from `takePayment` — the popup only
    launches it, embedded via `PaymentScreen`'s `initialStudentId`. Never add a
    second matcher, a second arrears rule or any money math here. ONE popup at a time — no trail,
    no list: the terminal must not scroll, so the next tap replaces what is
    showing. What blocks the reader is whether that popup is a QUESTION or a
    RESULT — a pick-list, an unrecognised card and the open till hold the line
    until answered; "marked", "already marked" and "no class open" are results
    the next tap simply replaces. Two or more
    open classes STOP the stream for a manual pick: guessing the class is the
    one error the counter must never make. Arrears is billing-month based, so a
    July fee paid in August clears July.

Some app-logic invariants are deliberately *not* enforced by DB constraints —
"already marked attendance?" and "already paid this month?" are checked in code
(see the comments in `schema.prisma`). Preserve those checks.
