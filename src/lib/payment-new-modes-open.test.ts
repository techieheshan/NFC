import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * DECISION (Kavin, AGENTS.md "Decisions recorded from the 3A review"): Full, Half and No charge
 * are open to everyone who can use the screen, for any month, with no note. Who can open the NEW
 * screens at all is ONE constant (PAYMENT_NEW_ROLES in access.ts, ADMIN + STAFF since the menu
 * switch). So nothing else the screen is built from may look at a role: a role check in the
 * month detail, the cards, the actions or the read-side libraries would quietly turn a mode off
 * for staff after the switch.
 *
 * Two rules, an allow-list and a pattern:
 *   1. Only access.ts may import "@/auth" or "@/lib/authz". Every other file reaches the guard
 *      through access.ts's own `requirePaymentNew*`.
 *   2. No other file mentions a role, a role list or another guard.
 */

const ROOT = process.cwd();
const SCREEN_DIR = path.join(ROOT, "src", "app", "(app)", "payment-new");
/** The read-side libraries the screen is built from: a role decision could move into these. */
const LIBRARIES = ["src/lib/payment-view.ts", "src/lib/payment-charge.ts", "src/lib/friendly-date.ts"];

const screenFiles = readdirSync(SCREEN_DIR, { recursive: true, encoding: "utf8" })
  .map(String)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => path.join(SCREEN_DIR, f));
const checked = [...screenFiles.filter((f) => path.basename(f) !== "access.ts"), ...LIBRARIES.map((f) => path.join(ROOT, f))];
const rel = (f: string) => path.relative(ROOT, f);

/**
 * Source with comments removed, so a sentence about ADMIN in a doc comment is not a role check.
 * A line comment only counts when `//` starts the line or follows whitespace, so the `//` inside
 * a URL or a string does not swallow the code after it.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}
const code = (file: string) => stripComments(readFileSync(file, "utf8"));

const AUTH_IMPORT = /from\s+["']@\/(auth|lib\/authz)["']|import\(\s*["']@\/(auth|lib\/authz)["']\s*\)/;
const ROLE_LOOK = new RegExp(
  [
    String.raw`\b(ADMIN|STAFF|TEACHER|UserRole|isAdmin)\b`, // role names, the role type, a helper
    String.raw`\.role\b`, // user.role
    String.raw`\brole\s*[=!]==`, // role === "…"
    String.raw`\{[^}]*\brole\b[^}]*\}\s*=`, // const { role } = user
    String.raw`\brequire\w*Access\b`, // requireOperationalAccess / requireSetupAccess / requireNavAccess
    String.raw`\brequireRole\b`,
    String.raw`\w+_ROLES\b`, // SETUP_ROLES, OPERATIONAL_ROLES, PAYMENT_NEW_ROLES used outside access.ts
  ].join("|"),
);

test("the files under check are really there (the test cannot pass on an empty list)", () => {
  assert.ok(screenFiles.some((f) => path.basename(f) === "access.ts"), "access.ts is where the one switch lives");
  assert.ok(checked.length >= 11, `expected the screen's files and the libraries, found ${checked.map(rel).join(", ")}`);
  for (const f of checked) assert.ok(code(f).length > 0, rel(f));
});

test("only access.ts imports @/auth or @/lib/authz", () => {
  for (const f of checked) assert.doesNotMatch(code(f), AUTH_IMPORT, `${rel(f)} must reach the guard through access.ts`);
  assert.match(code(path.join(SCREEN_DIR, "access.ts")), AUTH_IMPORT);
});

test("nothing else the screen is built from looks at a role, a role list or another guard", () => {
  for (const f of checked) assert.doesNotMatch(code(f), ROLE_LOOK, `${rel(f)} must not check a role`);
});

test("the pattern catches each way a role check could be written (and not the screen's own guard)", () => {
  for (const sample of [
    'if (user.role === "ADMIN") {}',
    "const { role } = session.user;",
    "await requireOperationalAccess();",
    "await requireSetupAccess();",
    'await requireNavAccess("/payment");',
    "await requireRole(SETUP_ROLES);",
    "if (isAdmin(user)) {}",
    "OPERATIONAL_ROLES.includes(x)",
    "type R = UserRole;",
  ]) {
    assert.match(sample, ROLE_LOOK, sample);
  }
  for (const fine of ["await requirePaymentNewAction();", "await requirePaymentNewPage();", 'const url = "https://x.test/a"; const a = 1;']) {
    assert.doesNotMatch(fine, ROLE_LOOK, fine);
  }
  assert.match(stripComments('const path = "a//b"; if (user.role === "STAFF") {}'), ROLE_LOOK, "a // inside a string does not hide the code after it");
});

test("the month detail offers all three modes unconditionally", () => {
  const src = code(path.join(SCREEN_DIR, "month-detail.tsx"));
  for (const label of ['"Full"', '"Half month"', '"No charge"']) assert.ok(src.includes(label), label);
});
