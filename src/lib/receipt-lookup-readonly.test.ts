import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * Job 4 is READ-ONLY: it reads payments and never creates, updates or cancels one. The database
 * test (receipt-lookup.test.ts) runs the functions on a database that refuses every write; this is
 * the second line, over the source: no write call, no raw SQL, no transaction, and no import of
 * anything that charges or cancels. Reprint is the existing `reprintTransaction`, which is a read.
 */

const ROOT = process.cwd();
const PAGE_DIR = path.join(ROOT, "src", "app", "(app)", "payment-new", "receipts");
const FILES = [
  path.join(ROOT, "src", "lib", "receipt-lookup.ts"),
  ...readdirSync(PAGE_DIR, { recursive: true, encoding: "utf8" }).map(String).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(PAGE_DIR, f)),
];
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

const WRITE = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$queryRaw|\$transaction|\$runCommandRaw/;
const CHARGES = /\b(takePayment|cancelTransaction|loadPanel)\b/;

test("the files under check are the lookup and every file of the page", () => {
  assert.ok(FILES.length >= 5, FILES.map((f) => path.relative(ROOT, f)).join(", "));
});

test("no write call, raw SQL or transaction in the lookup or the page", () => {
  for (const f of FILES) assert.doesNotMatch(strip(readFileSync(f, "utf8")), WRITE, path.relative(ROOT, f));
});

test("nothing that charges or cancels is imported or called there (reprintTransaction is the one action used)", () => {
  for (const f of FILES) assert.doesNotMatch(strip(readFileSync(f, "utf8")), CHARGES, path.relative(ROOT, f));
  const list = strip(readFileSync(path.join(PAGE_DIR, "receipt-list.tsx"), "utf8"));
  assert.match(list, /import \{ reprintTransaction \} from "@\/app\/\(app\)\/receipts\/actions"/);
});

test("the pattern catches what it is meant to (control)", () => {
  for (const bad of ["db.payment.update({})", "tx.payment.deleteMany()", "db.$executeRaw`x`", "db.$queryRaw`x`", "db.$transaction(fn)", "db.payment.create({})"]) {
    assert.match(bad, WRITE, bad);
  }
  for (const fine of ["db.payment.findMany({})", "db.payment.findUnique({})", "const updated = 1; // update( is only a word here"]) {
    assert.doesNotMatch(strip(fine), WRITE, fine);
  }
});
