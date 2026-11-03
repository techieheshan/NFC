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
    `attendance-match.ts`, the paid/not-paid verdict from `studentArrears`
    (`student-arrears.ts`), and every amount from `takePayment` — the panel only
    launches it, embedded via `PaymentScreen`'s `initialStudentId`. Never add a
    second matcher, a second arrears rule or any money math here.

    The screen is THREE icon-only buttons — NFC, QR, Search — and nothing else.
    No reader toggle, no "Reader ON" line, no status text: the pulsing rings
    around the NFC button are the whole "it is listening" signal, and their
    absence is the whole "it is not". The reader arms itself on arrival
    (`useNfcScan(..., { continuous: true, autoStart: true })`) and stays on;
    never make staff press anything per student. Exactly ONE scan may be live at
    a time — two overlapping `scan()` calls means two `onreading` handlers and
    every card is processed TWICE, which reads as a mark immediately followed by
    "already marked". Re-arm only on a real transition (returning from Search,
    returning from a hidden tab), never on mount, where the hook has already
    done it.

    ONE thing on screen at a time: the buttons, a result panel, or a question.
    Each REPLACES the others and the next tap replaces the panel — no trail, no
    list, and the terminal must never scroll, so staff's eyes never move. The
    arrears verdict is a CHIP carrying an icon and a word as well as a colour,
    never colour alone and never the whole screen: a full-bleed coloured result
    was tried and reverted, because it hid the reader and made a routine mark
    read as an alarm.

    What holds the line is whether what is showing is a QUESTION or a RESULT.
    A pick-list, an additional-class confirmation and the open till are
    questions: the reader is OFF until they are answered and taps are IGNORED,
    never queued — banking taps behind a question would mark students nobody
    verified. Everything else is a result that clears itself after five seconds:
    "marked", "already marked", "no class open", too-early/too-late, and an
    unrecognised card. An unrecognised card used to block and no longer does —
    it writes nothing, there is nothing to answer, and one stranger's card was
    stopping the whole queue; the reject tone is what makes staff look up. Two
    or more open classes still STOP the stream for a manual pick: guessing the
    class is the one error the counter must never make. Arrears is
    billing-month based, so a July fee paid in August clears July.

    Sound needs a real gesture. A card `reading` event is NOT user activation,
    so an `AudioContext` created from one starts `suspended` and every tone is
    dropped silently — `primeAudio` is therefore wired to a document-level
    pointer/touch/key listener, not to this screen's own box. And a suspended
    context's `currentTime` is frozen, so `play` resumes FIRST and reads the
    clock again afterwards; scheduling against a stopped clock banks every blip
    in the past and fires them all at once when it wakes.

23. **Two report clocks, and never a third.** "Who owes?" is BILLING-month —
    `/reports`, `/reports/not-paid` and the counter colour all go through
    `SETTLED_PAYMENT_WHERE` / `student-arrears.ts`, so a July fee taken in
    August clears July everywhere. "What came in?" is `paidAt` — Daily Summary
    and `/reports/monthly-income`. Never mix the two in one figure, and never
    write a third paid-check. By-teacher on the income report is GROSS
    collected; the share belongs to Payslips. Every `/reports/*` screen is
    read-only and guarded twice: `requireNavAccess("/reports")`, then
    `notFound()` for TEACHER on the money ones (not-paid, monthly income);
    the schedule report lets a teacher in but narrows them with
    `courseScopeFor`, spread LAST in the `where` so a query-string filter can
    only narrow. Validate an enum filter (a day, a month) ONCE and use that one
    value for both the query and the grouping — junk in the URL must be
    ignored, not silently render an empty report.
24. **The Daily Summary is a typed DRAFT until someone SAVES it; a saved day is immutable
    versions (Release 2).** An unsaved day is Release 1's draft: bring-forward and the money
    taken to the bank (up to 10 lines: amount, time, optional slip no. and note) are TYPED and
    carried in the URL (`typed-state.ts`: first value wins, amounts re-parsed as integer cents)
    to the A4 document and back and through a reload; that URL state exists ONLY for a draft
    (a saved day is read from the database, its document links carry no typed values, and the
    Release 1 `prep` / `chk` parameters are ignored). Nothing auto-fills: "Yesterday closed
    with … Use this" (newest saved day within 7 days, its date named) is offered, never put in
    the field. The flow is Bring-forward + Collected − Deductions = **Should be in the drawer**;
    minus **Money taken to the bank** = **Left in drawer**, the suggested bring-forward for
    tomorrow (`lib/cash-flow.ts`, integer cents). It is NOT Net (the institute's profit). All
    collected money is cash and the person preparing the summary banks it, so a bank line has
    no "taken by".

    **Saving.** "Save day" stores `DailySummaryDay` (one per Colombo date) and a
    `DailySummaryVersion` (a FULL frozen snapshot, never diffs). A version is written once and
    NEVER updated or deleted by hand: every later save, edit or re-save is a new version, with
    its bank deposits copied (`DailySummaryBankLine`) and at most one `DailySummaryCheck`.
    **Done by is required on every version** (first save, every edit, every re-save): an ACTIVE
    ADMIN or STAFF account looked up on the server; `savedById` is the signed-in user (audit);
    Prepared by is the Done by of version 1, carried unchanged. **The server takes its own
    snapshot** (`dailySummary()` untouched, read BEFORE the transaction, never through `db`
    inside it); the sheet's `seen` figures are only a stale check ("The numbers moved…") and
    are never stored. One per-day advisory lock (`DS_LOCK_NAMESPACE` 7410, never the payment
    lock 7301), `lock_timeout` 4 s, `baseVersion` compared under the lock (a second saver gets
    "…saved this day (version N) while you were working. Your changes were NOT saved."), every
    guard before the first write; a request that cannot finish in time is answered, not thrown.
    Guard every action separately (rule 10): `saved-actions.ts` calls `requireRole` first and
    the store (`lib/saved-day/store.ts`) checks the role again.

    **The check.** ADMIN or STAFF may tap "Admin check"; the person tapping must be an active
    ADMIN or STAFF, and the account they NAME must be an active ADMIN (looked up on the
    server). It attaches to the exact version the person was looking at and a version is
    checked once. **Any money change clears it** (a new version has no check): bring-forward,
    a bank amount, the number of bank lines, or a re-save with new live numbers. Slip, note,
    time or order edits CARRY the check (`carriedFromVersion`). A save that changes nothing is
    refused ("Nothing changed."). The check is refused while the day is over-banked.

    **Over-bank.** Derived from the stored columns, never stored: `bankTotal > 0` and
    `leftInDrawer < 0` (a day whose deductions exceed its cash with nothing banked is NOT
    over-banked). A first save and an edit REFUSE it and name the amount; a re-save with live
    numbers is always allowed (a receipt cancelled after saving can push it over) and the
    version is shown flagged (red banner, negative Left in drawer) until the bank lines or the
    bring-forward are put right.

    **Frozen names, money, schema.** Every name on a saved day is TEXT frozen at write time
    (`doneByName`, `preparedByName`, `savedByName`, `checkedByName`, `markedByName`, and
    `recordedByName` on each deposit; a deposit carried into a new version keeps its recorder
    and time). A rename in Setup never changes a saved day. `diffSummaries` compares names too
    (course, teacher, staff, a deduction's person and authoriser): the snapshot holds names
    only, never ids, so a rename cannot be told from a reassignment; a names-only difference
    is marked `textOnly` (own banner text, own note in "See what changed"), and re-saving after
    it counts as a money change, so it clears the check and an admin looks again. Money columns are `Decimal(12,2)`, written from integer cents by integer
    arithmetic (`lib/saved-day/money.ts`, never a float). `snapshotSchema` is a CONTRACT: a
    stored snapshot is read through `parseSnapshot(json, schema)`, which refuses an unknown
    schema or a wrong shape; never edit a stored snapshot, change the shape only with a NEW
    schema number and a reader for the old one. A saved day that cannot be read shows "This
    saved day can't be read. Showing the live numbers." with the live numbers, and Save day,
    Edit, Admin check, Print and Download PDF OFF (and the reason beside them); the document
    route refuses it too ("This saved day can't be read." with a link back, no sheets, no
    Print, no PDF, never the draft).

    **Retention (lazy, no cron).** Saved days are kept 3 months after their DATE (cutoff =
    today in Colombo minus 3 calendar months, clamped to the month's end; the boundary day is
    kept). `purgeExpired` runs after a save commits (a separate statement) and when History
    opens (BEFORE it reads); a failure is logged and ignored. Its scope is exactly one
    statement: `DailySummaryDay` rows older than the cutoff, and by cascade their versions,
    deposits and checks. It never touches payments or anything else. A day older than the
    cutoff cannot be saved or checked and opens as an unsaved day with live data, like History.
    While Release 1 code is live (after a rollback) nothing purges.

    **Wording.** Draft: grey "Not saved"; the document says "Draft, not saved" with **"—" for
    Prepared by and for Checked by** and empty signature boxes. Saved: "Saved · version N ·
    <Done by> · <time>", "Edited · version N" from version 2 with a change log (newest first),
    document status "Saved, version N, not checked" / "checked"; "Not checked" is ONLY for a
    saved day nobody has checked; checked reads "Checked by <admin>, recorded by <tapper>"
    (the printed signature box shows only the admin); after a money change "Check cleared…".
    A yellow banner appears when the live data differs from what was saved (e.g. a cancelled
    receipt): "The live numbers are different from the saved ones" when any number or flag
    differs, or "Some names differ from the saved day" when ONLY printed names differ (a
    rename in Setup, a deduction given to someone else, a corrected authoriser). The saved day
    never changes by itself; "See what changed" and "Re-save with live numbers" are the two
    ways forward. After any write the screen's actions stay OFF until the
    new version is on screen. **History** (`/daily-summary/history`, ADMIN + STAFF) is linked
    from the day screens (there is no second menu entry, rule 7); a range ("Several days",
    view only) has no cash book and no saved days.

25. **One hall resolver: `hallForClassOnDate` / `classesForDate` in
    `src/lib/halls.ts`.** Where a class meets on a date is "the override for
    that class on that date, else its own default (`Schedule.defaultHallId` /
    `AdditionalClass.hallId`), else unassigned" — and every screen, the
    timetable and the class-schedule column read it from there. Reassigning a
    hall writes a `HallAllocationOverride` for ONE date and must never touch
    the class's default; that is what makes it a one-day change instead of an
    edit to the timetable. A double-booking WARNS and still saves — two classes
    really do share a room, and a system that refuses just gets worked around.
    Halls are soft-deleted reference data with an icon KEY (`src/lib/hall-icons.tsx`),
    never a hardcoded list. `/reports/class-schedule` shows the DEFAULT hall
    (it is the recurring timetable); `/reports/timetable` is per-date and shows
    what an override actually did.
26. **One payroll calculation: `buildPayslips`.** The teacher's screen, the
    printed A4 sheet and the month-end roll-up all render ITS numbers —
    `paidAt` month basis, per-course `instituteSharePercentApplied` frozen on
    each payment. Never add a second way to compute a share: if the roll-up and
    a payslip could disagree, the teacher holding the slip is right. Sheet lines
    group payments by course × billing month × RATE × (Half month or not) so
    `cards × rate = gross` is true on every line; a slip rounds its two halves
    separately, so a multi-teacher total can be a cent out — show that rounding,
    never hide it. A Half-month line split from a same-priced line adds one more
    rounding boundary: the line columns can differ from the Totals row by a cent
    (a 312.50 normal payer and a 312.50 Half-month payer at 25% show 78.13 + 78.13
    = 156.26 against a Totals row of 156.25). The TOTALS ROW is what counts;
    `payslip-half-rounding.test.ts` pins the example.
    A teacher sheet never carries institute profit.
27. **An expense names who authorised it.** `Expense.authorizedById` is required
    and re-checked server-side against active ADMIN/STAFF accounts; the type
    stays immutable on edit but the authoriser can be corrected. It shows
    wherever the expense does — list, staff-advance report, Daily Summary
    deductions, month-end roll-up. Rows predating the column were backfilled
    with `recordedById`.
28. **Any billing month is payable.** The picker offers catch-up months back to
    the enrolment's own start and a bounded few ahead; `takePayment` re-checks
    both ends. The chosen month is what `billingYear`/`billingMonth` stamp, so
    arrears, not-paid and the student list follow it — while `paidAt` stays the
    day the cash arrived.

    **Earlier than the enrolment: only on `/payment-new`, only after a confirm, at
    most `BACK_MONTHS` (12, `src/lib/payment-months.ts`) before the current month,
    ADMIN and STAFF alike, no override.** The month sheet draws those months as
    grey "earlier" tiles (`ViewMonth.beforeStart`, absent on every other month);
    a tap asks "Earlier month … Take payment for …?" and Yes picks it as an
    ordinary Full month. The request then carries `backMonth: true` on those rows
    ONLY, and `takePayment` accepts a month before the enrolment only with that
    flag and only back to `BACK_MONTHS`; with no flag the old refusal ("That month
    is before the student was enrolled.") is unchanged word for word — old phones
    and terminals keep working — and the 12-month floor is also what refuses a
    year typo. `backMonth` on a month that is not before the enrolment is ignored.
    An earlier month is priced, combo-ed, shared and receipted like any other (no
    fee history exists, so it is charged at today's fee) and is never "owed":
    arrears count from the enrolment start. The old `/payment` screen and the
    attendance counter's embedded panel do NOT offer earlier months.

29. **Who may do what, and where it is enforced.** ADMIN and STAFF both do
    setup — subjects, grades, streams (and their subject links), teachers,
    courses, schedules, additional classes — because the admin is not always on
    site (`SETUP_ROLES = OPERATIONAL_ROLES`). Three things stay ADMIN-only, and
    all are money or identity: **cancelling a payment** (`cancelTransaction`
    → `requireRole(["ADMIN"])`; Receipts hides the button from staff, reprint
    stays both), **changing a course's fee tier** after registration
    (`changeFeeTier` → `requireRole(["ADMIN"])`; only among Full / Half / 25%,
    never to or from Free; it takes the payment's per-student lock, writes no
    Payment row, and unpaid months — earlier owed ones too — are charged at the
    new tier from then on) and **User Roles** (creating logins, resetting OTHER
    people's passwords). Everyone changes their own password. The hidden button is a
    courtesy; the guard inside the action is the boundary — prove any change to
    it by replaying the request with a STAFF cookie next to an ADMIN control.

30. **A refusal is proven by what comes back, not by the status code.**
    `(app)/loading.tsx` streams a shell the moment a tap lands, which is what
    makes the terminal feel alive — but once that shell is flushed a later
    `notFound()` can no longer set the status, so a blocked page answers **200**
    with the not-found UI instead of 404. Nothing leaks: the roster, the report
    and the user list are simply absent. When testing an authorization boundary,
    assert on the CONTENT (and on the server action's refusal, which is still a
    hard error) — never on a 404 alone.

Some app-logic invariants are deliberately *not* enforced by DB constraints —
"already marked attendance?" and "already paid this month?" are checked in code
(see the comments in `schema.prisma`). Preserve those checks.

# Live system rules

Xenon is in production and staff may be using it this very minute. A mistake
here hits real students, real payments and real receipts. Be careful and slow.
These apply to **every** tag, on top of rules 1–30 above.

**Database and data**

- Never touch the production database. No schema changes, migrations,
  `migrate deploy`, `db push`, `migrate reset`, seed scripts, or manual writes,
  updates or deletes. A tag that seems to need a schema change stops and asks.
- Before running anything that talks to a database, print which `DATABASE_URL`
  host it points at and confirm it is NOT production. Test against the demo
  database (`.env.demo`) or a separate Neon branch. Never put production
  credentials into a local env file or a script.
- Vercel preview deployments must not be wired to the production database.
  Check before using one, and say so if they are.

**Code and behaviour**

- Work on a feature branch. Never commit or push to `main`, never deploy to
  production — the owner reviews and deploys.
- Do not rewrite or "clean up" working logic. Do not touch payments, money
  calculation, receipt printing, auth/sessions, the proxy, the offline outbox or
  the service worker unless the brief names them. Keep the diff small and the
  commits small and separate, so each one can be reverted alone.
- Server-action and API contracts stay backward compatible (same inputs, same
  response shapes). Phones and terminals keep running the old cached app until
  they reload, and old code must keep working against the new server.
- No new dependencies, no major-version upgrades, and no build-tool migration
  (Tailwind included) without asking first.
- Server-side authority stays where it is: money, combo and payment-status
  decisions are computed on the server and only displayed by the client.

**Browser baseline.** The oldest terminal runs Chrome 102 (32-bit, Android 8.1).
The app must work on Chrome 102 and up, and desktop emulation cannot reproduce
what an old Chrome silently ignores — so a brief that touches CSS names the
screens to check on the real device. Do not use the standalone `translate`,
`scale` or `rotate` properties (Tailwind v4 emits them for `translate-*` /
`scale-*` / `rotate-*`; Chrome 104), `svh`/`dvh`/`lvh` units (108), or rely on
`:has()` or container queries (105) for anything that matters.

**No opacity modifier (a slash and a number) on a THEME colour.** Tailwind v4 compiles
it to `color-mix()` (Chrome 111) and, before it, writes the plain colour as the
fallback. On Chrome 102 a "10% purple" circle is therefore SOLID purple, its purple
icon vanishes, and a tinted error box becomes solid red under red text. Use a solid
token instead: `bg-secondary` / `bg-muted` / `bg-accent` for a purple tint,
`bg-destructive-soft` for an error box, `border-primary-line` / `ring-primary-line`
for a soft purple line, or `opacity-N` on a text-only element; a new tint is a new
token in `globals.css`, never a modifier. Static colours (black, white, the palette)
are precomputed to a plain alpha colour and are fine. `dark:` variants are tolerated
only because nothing switches the dark theme on (a test fails the day something
does). Tailwind scans EVERY file, comments and scripts included, so do not quote a
tinted class name in prose. Enforced by `css-baseline.test.ts` (the source) and by
`npm run check:baseline` (the built CSS: no rule may be left with an opaque fallback).

`package.json` declares the floor (`browserslist`: Chrome/Edge/Firefox 102,
Safari 15.4) and Next 16 honours it — measured, not assumed: a Chrome 50 target
changes the output a lot, and the 102 target changes the JS slightly (+0.8%) and
the CSS not at all. That is NOT a safety net for CSS: no toolchain step can
down-level a property whose value is built from `var()`, which is exactly what
the standalone `translate` is. The floor is enforced by `npm test` (the source)
and `npm run check:baseline` (the built CSS, after `npm run build`).

**Before saying it is done**

- `tsc`, lint, build and the existing tests pass, and anything new that has
  logic gets a test.
- Smoke-test the flows that must not break: NFC attendance tap, payment and
  receipt, registration, search, login/logout.

When in doubt, stop and ask. A paused task costs nothing. A broken live system
does.

# Testing payments

`npm test` runs without a database: the database tests are skipped and say why.
`npm run test:db` runs everything and refuses to start unless
`XENON_TEST_DATABASE_URL` is set.

**Rule: database tests read `XENON_TEST_DATABASE_URL` only — never
`DATABASE_URL`.** A production URL that is exported in the shell or loaded from
`.env` can therefore never be used by a test. The host must be local Postgres,
or be named in `XENON_TEST_DB_ALLOWED_HOSTS` (comma-separated Neon endpoint ids,
set per run, never committed — this repo is public). Anything else makes the run
fail before it connects (`src/test-support/db-guard.ts`).

Start a throw-away Postgres, run, remove it:

```
podman run -d --name xenon-test-pg -p 127.0.0.1:55432:5432 \
  -e POSTGRES_PASSWORD=<anything local> -e POSTGRES_DB=xenon_test \
  --tmpfs /var/lib/postgresql/data:rw docker.io/library/postgres:16-alpine
XENON_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:55432/xenon_test npm run test:db
podman rm -f xenon-test-pg
```

How the tests work (`src/test-support/`): each test **file** creates its own
database on that server, applies `prisma/migrations`, and drops it afterwards;
data comes from factories, never from what happens to exist. The clock is
frozen (`freezeClock`) so nothing is flaky on the 1st, the last day or at
Colombo midnight. The real server actions are called with a stubbed session
(`setSession`); production code is never modified for a test.

A test that locks something we plan to change is named
`CURRENT BEHAVIOUR (will change in job N): …`. When that job lands, the failing
test points at the sentence to update. Checklist:

- **Job 3B — any past month payable:** the server already accepts months older
  than the panel's window; the panel offers 5 past + current + 3 ahead; arrears
  are unlimited (`payment-take`, `arrears-db`, `payment-view`). Screens only.
- **Job 3A — settled, now RULES (no longer CURRENT BEHAVIOUR):** a card is
  charged once per UID; the same course+month twice in one request is refused;
  one charge per student at a time (advisory lock, checks under it); combo state
  (`auto` / `needs-confirmation` / `exempt-new` / `exempt-free` / `off`, in
  `combos.ts`); Half month and No charge (`Payment.chargeMode`). See below.
- **Job 5 — settled, now RULES (no longer CURRENT BEHAVIOUR):** the four tests in
  `payment-reports-nocharge.test.ts` that documented how No-charge and Half rows inflated
  Daily Summary, payslip and roll-up counts now state the new rule (see "Gate CLOSED").
- **Job 3 — one `lastCompletedMonth`:** `combos.ts` and `payslips.ts` each have
  their own copy (`last-completed-month`). Merge them, then keep the cases.
- **Rounding (`report 9.2`):** money is a JS float then `toFixed(2)`, so half-cent
  results go either way (`1333.33×0.5 → 666.66`, `1250.05×0.5 → 625.02`,
  `10.15×0.5 → 5.08`).
- **Rounding (`report 9.3`):** a slip rounds each teacher's two halves separately,
  so slips and the month-end roll-up can differ by a cent.
- **KNOWN ISSUE, month parameters on the older pages (not fixed: the byte-identical rule
  forbids touching them in job 5; a later small job):** `reports/monthly-income/page.tsx`,
  `payslips/page.tsx` and `payslips/voucher/page.tsx` accept any `YYYY-MM` and reach
  `monthInstants`, which throws a RangeError ("Invalid time value") for a well-formed year such
  as `0999` or `9999` (checked on `monthInstants`), so `?month=0999-05` shows the error page
  instead of the current month; `reports/page.tsx` and `reports/not-paid/page.tsx` also accept
  any `YYYY-MM` (month `00`, `13`…). The new `/reports/half-no-charge` bounds the year to
  2000-2100 and takes a real month only (`parseMonthParam` in `report-half-no-charge.ts`,
  junk means the current month); the later job can reuse it.
- **KNOWN ISSUE, old Receipts page (decided: not fixed now; a later small job):**
  `findTransactions` groups only the newest 300 ROWS, so a receipt cut at that boundary
  shows fewer lines and a smaller total (and a number that is only right when its
  lowest-id row survives). The new screen does not use it. The fix belongs in that later
  job (read whole receipts by key, as `receipt-lookup.ts` does), and the test
  `receipt-lookup.test.ts` — `CURRENT BEHAVIOUR (old Receipts page, NOT changed in job 4)`
  — is the sentence to update when it lands.
- **Silent zero fee:** a missing or empty `admission_fee` / `smart_card_fee`
  setting charges `0.00` instead of failing.
- **Quirk, not planned to change:** a student with no active enrolment reads as
  grey "Free tier".

**Gate CLOSED (job 5): the reports are ready for Half and No-charge months.** The menu
switch has been prepared on its own branch (`release/payment-menu-switch`, one commit:
the Payment entry's address and `PAYMENT_NEW_ROLES`), to be deployed after Kavin's
real-device checks (Terminal 1, Chrome 102). What job 5 did, and what must stay:

- **A No-charge month is settled, 0.00, not cash and not a payer.** It is in no paid
  count: not Daily Summary's Full / Half / 25%, not the payslip's paying students, tier
  counts, sheet lines or cards, and so not the month-end roll-up's "students". Its student
  reads as not paid for a Daily Summary range. Every money figure was already right and
  did not move. The exclusion is a JAVASCRIPT comparison (`chargeMode !== "NO_CHARGE"`),
  because a NULL (full-fee) row must stay a payer. `chargemode-null-safe.test.ts` is a
  BEST-EFFORT text scan, not a proof: a green run does not mean no such filter exists. It reads
  `src` (non-test `.ts`/`.tsx`, `src/test-support` included, comments stripped). It CATCHES:
  Prisma `chargeMode: { not … }` and `chargeMode: { notIn … }` when `not` / `notIn` is the first
  key; Prisma `NOT: { chargeMode … }`, `NOT: [{ chargeMode … }]` and
  `NOT: { OR: [{ chargeMode … }] }` when `chargeMode` follows within 300 characters and no `;`;
  `chargeMode !== "FULL"` / `!= "FULL"` (and `<> "FULL"` in SQL text), because a full-fee row is
  NULL, never the string FULL; raw SQL `"chargeMode" <>`, `"chargeMode" !=`, `chargeMode <>`,
  `"chargeMode" NOT IN` / `NOT LIKE`.
  It does NOT catch (accepted gaps, so review these by eye): `not` / `notIn` that is not the
  first key (`chargeMode: { in: x, not: "HALF" }`); a quoted key (`"chargeMode": { not: … }`);
  a filter held in a variable (`chargeMode: modeWhere`, or `NOT: someWhereVar`, where the object
  is built elsewhere); "not FULL" written with the operands reversed (`"FULL" !== p.chargeMode`),
  in a backtick literal, or through an alias (`const m = p.chargeMode; m !== "FULL"`); a cast or
  wrapper such as `"chargeMode"::text <> 'X'`; `NOT ("chargeMode" = 'HALF')` in raw SQL;
  `NOT: { … }` with `chargeMode` more than 300 characters later; any file outside `src` or any
  `*.test.ts` file; and code hidden by the approximate comment stripping (it removes `//` after
  whitespace or at a line start and `/* … */`, so a `//` or `/*` inside a string literal can
  hide code from the scan). It can also FAIL a safe query that puts `NOT: { cancelled: true }`
  and `chargeMode: { in: […] }` close together; if that happens, restructure the query rather
  than loosening the pattern. The safe shapes stay a positive `in` / equals, or a JavaScript
  `!== "NO_CHARGE"` / `=== "HALF"`.
- **A Half month is a real payment, and its student is a normal payer of THEIR tier.** In
  Daily Summary and payslips "Half" still means the HALF TIER: no column is renamed or
  moved. The month is shown, not hidden. **Daily Summary (changed in Release 1):** under
  Class fees, on the day screen, the range screen and the A4 document, from ONE helper
  (`ofWhichLines` in `daily-summary/extra-lines.ts`), come indented lines: "of which Half
  months (N)" with the amount (already inside Class fees, so it is an "of which", never a
  figure to add) and "No-charge months (N): nothing charged" 0.00; the document's footnote
  says both are included in the amounts. The earlier wording ("Half months (N): <amount>,
  included in Class fees" with "-" in a Total cell) is gone with the old table. The
  payslip's sheet line is its own line (it no longer merges into a
  Half-TIER student's line of the same price), the voucher says "(Half month)" as a second
  line INSIDE the course cell (a zero-width block, so the eight columns keep their widths),
  and the Payslips SCREEN (not the voucher, not any PDF) notes "incl. Half months: N cards,
  amount". The month-end roll-up has no Half figure (decided). The column widths were
  measured at a 703 px SCREEN width — the A4 content width (186 mm) the voucher's own print
  rules give — NOT in real print media: printing the voucher can come out blank (see the
  "Observed, NOT fixed" note below), so the layout has not been seen on real paper.
- **Omit when none.** The new fields (`halfMonths`, `noChargeMonths` on the summary,
  `halfMonth` on a line, `halfMonths` on a slip) are ABSENT when there is nothing to say, so
  for data with no Half and no No-charge row every report, payslip, roll-up, search row and
  profile is byte for byte what it was. `reports-golden.test.ts` proves it from a fixture
  generated by the code BEFORE job 5; refresh it only for a change someone chose, in its
  own commit. In addition, Claude ran a LOCAL browser comparison on 1 Nov 2026 — the build
  from before job 5 against the build after the review fixes F1–F10 (tip `014d003`), on the
  same local database: 18 outputs, of which 13 HTML pages are identical (the two voucher pages
  after removing their "Generated <date> <time>" stamp, a clock reading, before comparing) and 4
  PDFs are identical by text and pixel (17 identical), and 1 page differs: the Reports page, by
  the new ADMIN-only button. The evidence file records no commit SHA: "tip `014d003`" comes from
  my own note of when it was run (after F1-F10, before the later re-review commits, which touch
  only the admin page and are not among the 18 outputs). That comparison is NOT reproducible from the repo (its harness
  lived in a scratch folder); its evidence file, `payment-job5-fixes-normal-case-before-after.txt`,
  was delivered to Kavin and sits in the working directory's gitignored `review-shots/`.
  (`payment-job5-normal-case-before-after.txt` next to it is the EARLIER run, before the
  review fixes.) What the repo itself proves is the golden master above.
- **The readers that did not change are on purpose:** arrears, Not paid, the Student List,
  attendance month states and `payment-view` read `SETTLED_PAYMENT_WHERE` (billing-month
  clock, rule 23): a No-charge or Half month is settled, so it is not owed.
- **Search and the student profile** show the mode on such a line, in the receipts' own
  words; label text only. Search appends "(Half month)" / "(No charge)" to the course text
  (`chargeModeSuffix`). The profile keeps the course text plain and carries `mode` as its own
  field, present only on a month that was not the full fee, shown as its own small
  non-truncated label after the course span (a long course name on a phone cannot cut it off).
- **`/reports/half-no-charge` — the admin's review of what staff recorded.** ADMIN only,
  guarded twice (`requireNavAccess("/reports")`, then `notFound()` unless ADMIN), reached by
  one ADMIN-only button on the Reports page (no menu item). Month by `paidAt`, cut at the
  payslips' Colombo midnight (`monthInstants`); filters: person and Half / No charge. The
  per-person counts and the Half amount are a groupBy over EVERY row in the filter and are
  never taken from the list, which is the newest 300 with a plain note; cancelled rows are
  listed greyed with a Cancelled chip and counted nowhere; "share of their months" is out of
  that person's non-cancelled class months in the same month and person filter (NULL counted
  as normal). A No-charge month's waived value is not stored (0.00), so none is shown. No CSV.
  Everyone who recorded a month is NAMED, whatever role they hold today: a taker who is no
  longer ADMIN / STAFF shows their name with "(former role)", and a user that cannot be found
  reads "Unknown user (#id)" — never a dash (`takerName`). The person filter accepts ONLY ids it
  offers: the current ADMIN / STAFF logins, plus anyone who recorded a Half or No-charge month
  in the chosen month (a former taker is offered, and can be filtered on, only for a month in
  which they recorded one). Any other `staff` value — no such user, a teacher, a former taker
  with nothing that month — is ignored like any junk in the URL (rule 23), so the select and
  the report always agree. The cap and cancelled notes say what the figures cover (`capNotes`): the counts
  cover the non-cancelled rows, and only cancelled rows actually listed are called shown. The
  month parameter is a real month in 2000-2100 (`parseMonthParam`), else the current month.
- **Observed, NOT fixed (out of scope for job 5):** printing the voucher can come out blank.
  The global 58 mm rule in `globals.css` (`body > *:not(#xenon-print) { display: none
  !important }`) hides the whole page under print media, while the voucher page relies on
  its own `visibility` rules; under print emulation the sheet measures 0 px wide. A later
  job on the print path should reconcile the two.

**The Daily Summary (Release 1: screens, A4 document, Print and Download PDF, no database change; Release 2: saved days, History, the admin check):**

- **Release 2 (saved days; rule 24 is the contract).** Four tables and one enum, ADDITIVE ONLY
  (`prisma/migrations/20261102175857_daily_summary_saved_days`, 19 statements, `SET lock_timeout = '3s'`
  first; it touches no existing table). The migration reaches a database BEFORE the code that reads it:
  demo, then production, then merge and deploy. Production uses `~/xenon-release/r2-prod-backup-dump.sh`
  and `r2-prod-migrate.sh` (checksum of the migration file, one transaction, the exact schema verified
  read-only, `--dry-run`), never `migrate deploy`. The code is `src/lib/saved-day/` (store, snapshot,
  diff, bank-lines, check-rule, retention, hint, texts) behind `daily-summary/saved-actions.ts` (every
  action guarded first, rule 10) and the screens `day-screen.tsx` (the DRAFT), `saved-day-screen.tsx`
  (a saved day), `save-sheet.tsx`, `check-sheet.tsx`, `live-diff-sheet.tsx`, `history/page.tsx`. The
  page keys the saved screen on date + version + checked (rule 17). Bank-line limits (10 lines, slip 30,
  note 80 characters) have ONE definition (`lib/bank-limits.ts`, `lib/cash-flow.ts`). Carry-over of a
  deposit's recorder across an edit is matched GLOBALLY (`bank-lines.ts`: every same-amount pair scored
  by equal time, slip and note, best pairs first, ties to the earlier old line). The data object, the
  golden masters and the whole PDF step are untouched by Release 2. Tests: `saved-day-*.test.ts` (the
  race file is run x20), `edit-session.test.ts`, `settle-after-save.test.ts` (structural: every write
  settles the screen); each database test builds its own days and passes alone. The release scripts
  refuse `--dump-dir` on any host but the local throw-away one, and refuse a dump folder inside a git
  work tree or readable by group or others (mode 700); `--dry-run` opens no connection and starts no
  container (it makes and removes a temporary folder, and asks git for the checkout state with
  `--no-optional-locks`).

- **Routes.** `/daily-summary?date=` (the day screen; the old `?from=&to=` links still work: the same
  day opens the day screen, a real range redirects to the range screen), `/daily-summary/range`
  (view only), `/daily-summary/document` (the A4 document), `/daily-summary/history` (Release 2: the saved days
  of a month). All ADMIN + STAFF through the nav guard
  (TEACHER: not-found); the data comes from the guarded loaders in `daily-summary/bundle.ts`.
- **The data object is untouched.** `dailySummary()` and what it returns are pinned byte for byte by
  `reports-golden.test.ts` (six "Daily Summary:" keys); every new figure comes from a NEW read-only
  helper in `lib/daily-summary-extras.ts` (cancelled receipts, collected by staff, day by day — two
  queries however long the range, proven equal to `dailySummary()` for every day by
  `daily-summary-extras.test.ts`). "Not paid" is no longer shown (it is still in the data object).
  Money here is integer cents (`lib/cents.ts`), displayed with thousands separators; zero never
  shows a minus sign. Typed amounts: digits, optional commas, up to 2 decimals, 0 to 99,999,999.99.
- **Dates.** A real calendar day in 2000..2100, else today; the future is today; a reversed range is
  swapped; a range is cut to 366 days (`lib/daily-summary-dates.ts`). Impossible dates never reach a query.
- **The document is a normal page, not a portal** (the receipt's old blank print preview came from a
  portal unmounting before the preview composed). It uses the payslip voucher's print override
  (`body > *:not(#xenon-print) { display: revert }`, `visibility` to show only the sheets). The sheets are
  FIXED A4 (794 x 1123 px on screen, 210 x 297 mm in print — 1123 px is a hair over a page and would add
  a blank page after each sheet), filled by `lib/paginate.ts` from block heights MEASURED in the browser
  after `document.fonts.ready`: a table splits between rows with its header repeated, never inside a row,
  and its totals never sit alone on a sheet. The same sheet DOM is printed and drawn into the PDF. The
  stylesheet is a string in `document/document-css.ts` with hex colours only and nothing newer than
  Chrome 102 (a test scans it; the build-time baseline script does not see inline CSS). Page numbers and
  the footer are made by the paginator, not by CSS.
- **Download PDF is a RASTER PDF.** jsPDF's built-in fonts have no Sinhala, so a text PDF would print
  Sinhala as garbage (the other nine reports still do, through `downloadReportPdf`, which is untouched).
  Each sheet is drawn with html2canvas 1.4.1 (MIT; already in the tree as jsPDF's optional dependency)
  to a JPEG (scale 2; a sheet that fails or stalls is drawn again at 1.5, then 1 — see "The PDF is made only when…") in an A4 PDF; the text cannot be
  selected. Two traps are handled and tested: html2canvas cannot parse the `oklch()` colours the rest of
  the app uses (the sheet CSS gives every element hex border/outline colours and the clone a white page),
  and Tailwind's `img { display: block }` makes html2canvas draw text about 6 px low (an inline-img rule
  is held on the page while it draws). Sinhala for the document is a Noto Sans Sinhala webfont scoped to
  this route (`document/fonts.ts`, `preload: false`). **Tested on Chrome 154 only: Chrome 102 / the
  Terminal 1 are NOT proven** — see `~/xenon-release/DAILY-SUMMARY-R1-CHECKS.md`. If the capture
  throws, the screen says to use Print and choose Save as PDF.
- **Anything unusable in the address is refused, never printed smaller.** A bring-forward that is not an amount
  (unparseable, negative, above 99,999,999.99, longer than 20 characters — never truncated before parsing), a junk bank
  line, or an 11th bank line makes the document route redirect to the day screen (`notice=bf` / `notice=bank`, texts in
  `daily-summary/notices.ts`), keeping what WAS valid: the bring-forward when it was fine, the first ten valid bank lines,
  the Release 1 `prep` and `chk` parameters are IGNORED (Release 2 has no signer selects; a name never comes from the
  address). The day screen shows the same notices for a hand-edited address; the bring-forward notice goes away when a
  valid amount is typed, the bank notice when a line is added or removed. With NO active admin the Check sheet shows
  "No active admin account. Ask an owner to activate one." (plain text named by aria-labelledby, no `<label for>`) and
  its button stays off; Print and Download PDF are not affected. The draft's Save day, Print and Download PDF are off for
  an unparseable bring-forward or an over-banked list, with the reason shown beside them (`block-reason.ts`).
- **The reconcile warning is back, and says what it can say.** "N row(s) do not reconcile. A payment used a tier outside
  Full/Half/25%, or a student's enrolment changed. Check these courses." — only when N > 0, from each course's existing
  `reconciles` flag (`reconcileWarning` in `extra-lines.ts`; the data object is not touched), on the day screen, the range
  screen and both documents. It is true for those two causes (and for a student who paid under two tiers in a range);
  it does not say which course, so staff check the By course list.
- **Names print exactly as stored.** The document does not trim or decorate a name (there is no `plainName`): a saved day
  prints the FROZEN names (rule 24); names taken at the moment of saving are `Staff.name ?? username`, deduction people are
  teacher / staff names, and the collected-by-staff table is `Staff.name ?? username`. `daily-summary-document-names.test.ts` sends real stored names (a Sinhala one, one with a bracket,
  a login with no Staff record) through the real loaders and requires the same strings on the model. The screens' Prepared
  by list adds "(Admin)" / "(Staff)" to the option text only (in Release 2 that is the Done by list).
- **The sheet's numbers live in ONE file, `document/sheet-geometry.ts`** (794 x 1123 px, padding, the 713 px measuring width
  that a 210 mm print can hold, the 20 px page margin, A4 in mm). The stylesheet, the paginator (`paginate-document.ts`)
  and the PDF step import them; a test fails if one of them writes 794, 1123 or 713 itself. Do NOT name a file in these
  folders `layout`, `template`, `default`, `error`, `loading`, `not-found` or `route`: Next reads them as route files (a
  `layout.ts` here broke the build once, and a test now guards it). When a page reports overflow the document shows a visible,
  unprinted warning (`OverflowNotice`).
- **The PDF is made only when the sheets' fonts are really loaded.** The PDF is a picture, drawn from a CLONE of the page; if the
  webfonts are not there the browser draws a fallback face and the PDF no longer matches the print. So `make-pdf.ts` first
  loads every family the sheet uses (read from the sheet's computed font-family: Geist, and Noto Sans Sinhala when the sheets contain
  Sinhala) at weights 400, 600 and 700 (`document/sheet-fonts.ts`, pure over a font-set interface and tested with fakes), and
  repeats the check on the CLONE's own fonts inside html2canvas's `onclone` (`document/clone-fonts.ts`; the library awaits it). A font
  that is missing, failed, undeclared or still loading raises `SheetFontsError`. One check can wait up to about 10 s: 5 s for the font
  loads, then up to 5 s more for `document.fonts.ready` (`FONT_TIMEOUT_MS`, one after the other). A `SheetFontsError` is never
  retried at a smaller scale: it ends the job at once. `downloadPdf` turns ANY failure into the one sentence "Couldn't make the PDF on
  this device. Use Print and choose Save as PDF." and no file is made. NOT covered: if the PAGE's own fonts never load, the app stays on
  its startup splash (older behaviour).
- **Retry at a lower scale, and the deadlines (`document/capture-plan.ts`, `document/deadline.ts`).** One ATTEMPT is one sheet at one
  scale. A sheet that fails or does not finish inside its deadline is drawn AGAIN, the same sheet, at the next rung: scale 2, then 1.5,
  then 1, each rung with its own deadline (`ATTEMPT_DEADLINES_MS`, 25 s each). The ladder is shared by the whole PDF — once it has
  stepped down, later sheets start at the lower rung — so there are at most three failed attempts in total, and a capture that hangs
  ends with the message after at most 75 s of FAILED attempts (3 x 25 s) however many sheets there are. That 75 s counts only the failed
  attempts: sheets that finish before the hang add their own time (up to 25 s each), and the page-font check before the first sheet can
  take about 10 s (a stalled import ends separately, at 20 s). A device that finishes every sheet inside its deadline is never cut off,
  whatever the number of sheets. The dynamic import of html2canvas and jsPDF has its
  own deadline (`IMPORT_DEADLINE_MS`, 20 s) and ends in the same one message. **Why the deadline is per sheet:** measured on the laptop
  with CPU throttling, drawing a sheet costs the SAME time at scale 2, 1.5 and 1 (about 12.4 s per sheet at 12x, at every scale), so a
  smaller scale does not rescue a CPU-slow device — it helps when a big canvas cannot be allocated. A deadline over the whole document
  therefore cut off a slow device that was making steady progress (3 sheets at 12x failed under a 25 s whole-attempt deadline in the
  first version of this work and are made under the per-sheet deadline); the per-sheet deadline only trips on a stall. An abandoned
  attempt cannot be stopped (a browser promise has no cancel), so it is marked dead: its late result is freed, never encoded, never
  reaches the PDF, and cannot draw another sheet or report progress. The hidden `iframe.html2canvas-container` copies of the page that
  html2canvas leaves behind after a failure are removed after every failed attempt and in a `finally` (`clone-cleanup.ts`; only copies
  this capture added, never one it did not see appear). Only one PDF is made at a time: a module-level lock (`exclusive.ts`) refuses a
  second call at once ("A PDF is already being made. Wait for it to finish.", the only other sentence), and the button is disabled while
  busy. The button shows "Preparing PDF, page n of N" while it works. **Measured** (Chrome 154, 360 px, `Emulation.setCPUThrottlingRate`;
  this is a laptop with a throttled main thread, NOT a Terminal 1): 2-sheet day, scale 2 throughout: 2.2 s unthrottled, 7.7 s at 4x
  (3.9 s per sheet), 11.4 s at 6x (5.8 s per sheet). 3-sheet dense day, scale 2 throughout: 3.1 s, 11.0 s at 4x, 18.0 s at 6x, 34.6 s
  at 12x, 45.7 s at 16x, 69.9 s at 24x (about 21 s per sheet, inside the 25 s deadline). With the clone's font files never answering, both
  days end with the message at 77.1 s, nothing downloaded, the button back to "Download PDF", and no clone iframe left in the page.
  Chrome 102 / the Terminal 1 are still NOT proven. The evidence is in `~/xenon-release/r1-fix4-evidence/`.
- **Known limit: a lower scale does not fix a stalled font or a slow CPU.** A sheet costs the same at every scale, so a clone font that
  never answers stalls all three rungs: the message comes after about 77 s, not sooner. If Terminal 1 turns out slower than this
  laptop, the per-sheet deadline constant (`ATTEMPT_DEADLINES_MS`) is the lever.
- **Known limit: the PDF lock is module-level.** After a give-up a dead attempt may still be rendering when the lock is released, and
  after navigating away in the middle of a PDF another day's tap says "A PDF is already being made".
- **Known limit: memory.** Every page image is held until the PDF is finished, so the peak memory is about double the old code
  (which added each page as it went).
- **Known limit: a deadline can only fire between tasks.** `withDeadline` fires at a macrotask boundary: a long synchronous parse or
  render is never cut off in the middle, only noticed at the next real wait.
- **Small pure units behind the day screen, so they can be tested without a browser.** What is typed on a draft (bring-forward,
  bank lines) and which notices are open is ONE reducer (`daily-summary/typed-reducer.ts`, used with `useReducer`; the screen
  only dispatches; its signer fields are unused since Release 2). One EDIT of a saved day (edit mode, what is typed, Done by) is
  ONE reducer too (`edit-session.ts`; Cancel returns to the saved numbers with Done by empty and clears the refusal; a refusal
  that arrives after a Cancel carries an old epoch and is ignored; Cancel is off while a save is pending), and the sentence beside a
  disabled button comes from `block-reason.ts`. Names come from `displayName` (`lib/display-name.ts`) and the collected-by-staff mapping from `aggregateStaff`
  (`lib/daily-summary-rows.ts`); `daily-summary-names-pure.test.ts` runs them on fake rows with no database and fails if any name
  gets a role hint. The "one source for the sheet's numbers" test reads the real imports with the TypeScript parser, so an alias
  (`import { CONTENT_H as H }`) or a namespace import cannot get round it.
- **Follow-ups, not in this release.** Other-income entry (income that is not a payment) is its own later job. A "History"
  menu entry would be a second menu item for one module (rule 7): it is a link on the day screens until the owner decides
  otherwise. Saved days past 3 months are not exported anywhere before the purge deletes them.

**Rules for the money rules (job 3A) that later work must keep:**

- `takePayment` inputs only ever GROW, and every new field is optional with
  today's meaning when absent (`mode`, `off`). Old phones and terminals keep
  sending the old shape for days. `payment-golden.test.ts` replays 26 old-style
  requests and must stay byte-identical; its fixture came from the code before
  the change and is refreshed only for a change someone chose, in its own commit.
- `Payment.chargeMode` is NULL for a full-fee row (everything written before it
  existed and by any old client). NEVER filter it with `{ not: … }`: in SQL that
  drops the NULL rows. A NO_CHARGE row is an ordinary CLASS row with amount 0.00,
  so `SETTLED_PAYMENT_WHERE` is the only paid-check it needs.
- The combo rule lives in `comboStateOf` / `comboStates` and nowhere else; the
  server decides whether a question is due, the client never asserts it.
- The migration reaches a database BEFORE the code that selects its column
  (Prisma selects every column): demo, then production, then merge and deploy.
- **All guards run before the first write, and a refusal writes nothing.** In the
  charge transaction every check (admission, clash, smart card) comes before the
  first `create`/`update`; a refusal is returned from the callback, which COMMITS —
  that is only safe while no write precedes a guard. A new guard goes above the
  writes, never below. A new write goes below the guards, never above.
- **One clock per request.** `takePayment` takes `paidAt` once and judges the month
  limits, "before enrolment" and `comboStates` (`at: paidAt`) at that instant.
- **A payment that cannot finish in time is answered, not thrown.** A request that
  cannot get the per-student lock in 4 s (`lock_timeout`), or whose transaction
  expires (P2028; `maxWait` 2 s, `timeout` 6 s), returns `{ ok: false, error: "The
  payment didn't go through in time and nothing was charged. Check Receipts, then try
  again." }` and writes nothing. The wording names no cause on purpose: another
  checkout of the same student, an exhausted pool, a slow database or a long catch-up
  all end here. The old screen has no catch; a throw is a browser crash page.
- **Open release item: the platform time limit.** No `maxDuration` is set in the
  repo (on purpose, until the Vercel plan is known). Without Fluid compute the limit
  is 10 s, and the transaction's own limits already add up to 8 s before cold start
  and database wake-up; with Fluid compute it is 300 s. Kavin confirms the plan
  before release.
- **Inside the transaction use `tx`, never `db`.** A read through `db` there takes a
  second pooled connection while the lock is held and can starve the pool.

**Decisions recorded from the 3A independent review (Kavin, accepted as built):**

- **Half and No charge are free for staff.** Any month, any student, no note and no
  role limit: staff run the counter and admins review. The server does not limit
  NO_CHARGE (a crafted STAFF request can waive months too) — accepted. Job 5 gave
  admins a "Half and No-charge months" view (`/reports/half-no-charge`) so they can
  review who recorded what (`takenById` is on every row). `PAYMENT_NEW_ROLES` only decides who
  may open the NEW screens (ADMIN + STAFF since the menu switch); it is not a limit on the modes.
- **A re-enrolled class is not "new".** "New" uses `Enrollment.createdAt`, and
  re-enrolling reactivates the old row without resetting it, so a student who
  dropped Chemistry in March and came back on 3 Nov with 0 days in October gets a
  needs-confirmation question, not exempt-new. (Review finding 7.)
- **One FREE class exempts the whole combo.** In a three-class combo, FREE +
  Physics (5 days) + Chemistry (0 days) is `exempt-free`: no question, and
  Chemistry is billed at the combo rate. FREE is checked before 0 days. (Finding 8.)
- **No charge on one class does not stop the combo on the other.** Combo A+B, A
  recorded as No charge and B as Full: B is charged the combo rate. A NO_CHARGE row
  stores `comboId` null. (Finding 9.)
- **A month recorded as No charge says so when charged again** (not "already
  paid"); only an administrator can cancel that record. (Finding 10.)

**The new payment screens (`/payment-new`, job 3B):**

- **Open to ADMIN + STAFF since the menu switch**, through ONE constant, `PAYMENT_NEW_ROLES` in
  `src/app/(app)/payment-new/access.ts` (a COPY of `OPERATIONAL_ROLES`, so a test that edits it
  cannot change the shared array), read by both pages and both read actions. The Payment menu
  entry in `src/config/nav.ts` now points at `/payment-new`; the old `/payment` address has no
  menu entry any more, so `requireNavAccess("/payment")` answers not-found to everyone (the
  old code stays in the repo; the attendance counter's embedded panel is the old UI and keeps
  working). `payment-new-actions.test.ts` is tied to the constant. To revert the switch, put the
  nav address back to `/payment` and the constant back to `["ADMIN"]` (one commit). This guards
  the screens, not a hand-crafted request to `takePayment` — that action is shared with the old
  screen and is ADMIN + STAFF.
- **Two server rules are RESTATED on the read side, on purpose, for now:** the Half
  amount (`halfMonthly` / `halfComboMonthly` in `buildPaymentView`, the same
  `money(Number(full) * 0.5)` as `takePayment`) and the smart-card "already
  charged" check (`smartCard.chargedOn`, the same query as the server's guard).
  `takePayment` lives in a `"use server"` file, so neither can be shared without
  moving it. The parity tests (`payment-view.test.ts`, `payment-screen-rules.test.ts`)
  fail on any drift, and the server stays the authority. **A later cleanup job
  should merge each pair into ONE shared source** (the screen would then
  show what the server function itself returns).
- **No role limit on the modes.** Full, Half and No charge are open to everyone who can
  open the screen; `PAYMENT_NEW_ROLES` is the only role check under `payment-new`
  (`payment-new-modes-open.test.ts` fails on any other). The earlier ADMIN-only
  period was a staged-release step (the report gate was closed by job 5), not a limit on the modes.
- **A half MONTH never reads as a bare "Half".** "Half" alone is the fee TIER chip; a
  half month says "Half month" (or "½ month" in the calendar tile).
- **Full dates read "8 Aug 2026"** through the one shared `friendlyDate`
  (`src/lib/friendly-date.ts`): the smart-card row ("already charged on …" and "last
  …") and the server's smart-card refusal. Attendance dates keep their short
  "26 Sep" form. Never print a raw `YYYY-MM-DD` to staff.
- **Last 10 receipts (`/payment-new/receipts`, job 4) is READ-ONLY.** Same
  `PAYMENT_NEW_ROLES` guard as the other new pages; no server action of its own is
  exposed (it reads on the server), and Reprint is the existing `reprintTransaction`
  with `ReceiptView`. There is no Cancel there — that stays admin-only on `/receipts`.
  The lookup (`src/lib/receipt-lookup.ts`) returns WHOLE receipts: it walks payments
  newest first to collect distinct transaction keys (never filtering on
  `transactionRef: null`), then loads each through `loadTransaction`, so the list, the
  Receipts page and a reprint cannot disagree. `XN-n` names a receipt only when n is
  the LOWEST payment id of its transaction; a middle row's id matches nothing. List
  cap 10, search cap 20, names need 2 characters, cancelled receipts are included
  with their chip. The search is a GET form (a searchParam, rule 17). Tests lock it
  read-only twice: in the source and on a database that refuses every write.
- **`public/sw.js` is proven not to cache any payment or receipt page**
  (`service-worker-payment-pages.test.ts` runs the real worker in a sandbox, with
  `/attendance` as the positive control). Keep that test when the worker changes.
- The screen's Total is the receipt's total: every price is a server-built string,
  one pure function (`comboApplies` in `payment-charge.ts`) says when a combo
  applies, and `payment-screen-rules.test.ts` compares the displayed Total with the
  real receipt for every state, switch, answer and mode.

Not covered, on purpose: receipt printing (no automated way). The overlapping-request
guards are tested in-process against a direct Postgres connection; the Neon pooler
path is not reproducible locally, so run the race scenario against demo through the
pooled URL before relying on it in production.
