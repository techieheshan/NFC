import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_CENTS } from "@/lib/cents";
import { MAX_BANK_LINES } from "@/lib/cash-flow";
import { NOTE_MAX, SLIP_MAX, parseBankLine, parseTypedState, serializeBankLine, typedQuery } from "@/app/(app)/daily-summary/typed-state";
import { splitSigners } from "@/app/(app)/daily-summary/signer-lists";

/*
 * Daily Summary R1: the typed values live in the URL, and the URL is hostile input.
 */

const lists = splitSigners([
  { id: "admin-1", username: "nadeesha", role: "ADMIN", staff: { name: "Nadeesha" } },
  { id: "staff-1", username: "sadun", role: "STAFF", staff: { name: "Sadun" } },
]);
const parse = (q: Record<string, string | string[] | undefined>) => parseTypedState(q, lists);

test("round trip: bring-forward, three bank lines (with awkward text) and both signers survive the URL", () => {
  const bank = [
    { cents: 5000000, time: "10:30", slip: "SLIP-001", note: "morning, to Peoples Bank" },
    { cents: 1250050, time: "13:05", slip: "", note: "a~b & c=d ? % # é සිංහල" },
    { cents: 1, time: "17:59", slip: "x", note: "" },
  ];
  const qs = typedQuery({ bringForwardCents: 500000, bank, preparedId: "staff-1", checkedId: "admin-1" }).toString();
  const back = parse(Object.fromEntries(new URLSearchParams(qs).entries()) as never) && (() => {
    const sp = new URLSearchParams(qs);
    return parse({ bf: sp.get("bf") ?? undefined, b: sp.getAll("b"), prep: sp.get("prep") ?? undefined, chk: sp.get("chk") ?? undefined });
  })();
  assert.equal(back.bringForwardCents, 500000);
  assert.deepEqual(back.bank, bank);
  assert.equal(back.prepared?.id, "staff-1");
  assert.equal(back.checked?.id, "admin-1");
});

test("an empty query is an empty state (nothing typed, nobody chosen)", () => {
  assert.deepEqual(parse({}), { bringForwardCents: 0, bringForwardInvalid: false, bank: [], prepared: null, checked: null });
});

test("a bad bring-forward is FLAGGED (not read as 0.00), a missing or blank one is simply not set, a good one is neither", () => {
  for (const bad of ["-5", "−5", "1e9", "abc", "99999999999", "100000000.00", "1.234", "5,00", "0x10", "NaN", "<script>", "1".repeat(21), "5000.00" + "0".repeat(30)]) {
    const r = parse({ bf: bad });
    assert.equal(r.bringForwardInvalid, true, bad);
    assert.equal(r.bringForwardCents, 0, bad);
  }
  for (const fine of [undefined, "", "   "]) assert.equal(parse({ bf: fine }).bringForwardInvalid, false, String(fine));
  for (const ok of ["0", "5000", "5,000.50", "99999999.99", "1".repeat(20).slice(0, 8)]) assert.equal(parse({ bf: ok }).bringForwardInvalid, false, ok);
  assert.equal(parse({ bf: ["5000", "-1"] }).bringForwardInvalid, false, "first value wins, and it is fine");
  assert.equal(parse({ bf: ["-1", "5000"] }).bringForwardInvalid, true);
});

test("no truncation before parsing: a value longer than 20 characters is refused, never read as a shorter number", () => {
  const r = parse({ bf: "100000000000000000001" }); // 21 chars; the first 20 would have read as a big number
  assert.equal(r.bringForwardInvalid, true);
  assert.equal(r.bringForwardCents, 0);
  const exactly20 = parse({ bf: "0.000000000000000001".padEnd(20, "0") });
  assert.equal(exactly20.bringForwardInvalid, true, "20 characters but 18 decimals is still not an amount");
});

test("hostile bring-forward values are ignored, never turned into money", () => {
  for (const bad of ["-5", "1e9", "abc", "99999999999", "100000000.00", "1.234", "", " ", "0x10", "NaN", "Infinity", "5000; DROP TABLE", "<script>"]) {
    assert.equal(parse({ bf: bad }).bringForwardCents, 0, bad);
  }
  assert.equal(parse({ bf: "99999999.99" }).bringForwardCents, MAX_CENTS);
  assert.equal(parse({ bf: "5,000.50" }).bringForwardCents, 500050);
});

test("a repeated parameter takes its FIRST value (deterministic), for every single-valued field", () => {
  const r = parse({ bf: ["100.00", "999.00"], prep: ["staff-1", "admin-1"], chk: ["admin-1", "staff-1"] });
  assert.equal(r.bringForwardCents, 10000);
  assert.equal(r.prepared?.id, "staff-1");
  assert.equal(r.checked?.id, "admin-1");
});

test("a signer id that is not offered is nobody: a staff id cannot check, an unknown id signs nothing", () => {
  assert.equal(parse({ chk: "staff-1" }).checked, null);
  assert.equal(parse({ chk: "../../etc/passwd" }).checked, null);
  assert.equal(parse({ prep: "admin-1" }).prepared?.id, "admin-1"); // an admin may prepare
  assert.equal(parse({ prep: "nobody" }).prepared, null);
  assert.equal(parse({ prep: "" , chk: ""}).checked, null);
  assert.equal(parse({ prep: ["", "staff-1"] }).prepared, null); // first value wins, and it is empty
});

test("bank lines: bad time, bad amount, wrong field count, bad escapes and oversize lines are dropped", () => {
  const bad = ["25:00~100~~", "9:00~100~~", "10:00~0~~", "10:00~-5~~", "10:00~1.5~~", "10:00~abc~~", `10:00~${MAX_CENTS + 1}~~`,
    "10:00~100~~~extra", "10:00~100", "", "10:00~100~%E0%A4%A~", `10:00~100~~${"a".repeat(2000)}`, "10:00~99999999999~~"];
  for (const b of bad) assert.equal(parseBankLine(b), null, b);
  assert.deepEqual(parse({ b: bad }).bank, []);
  assert.deepEqual(parse({ b: ["10:00~100~~", "nope", "11:00~200~~"] }).bank.map((l) => l.cents), [100, 200]);
});

test("bank lines: at most 10 are read, whatever the URL carries", () => {
  const many = Array.from({ length: 25 }, (_, i) => `10:00~${i + 1}~~`);
  assert.equal(parse({ b: many }).bank.length, MAX_BANK_LINES);
  assert.deepEqual(parse({ b: many }).bank.map((l) => l.cents), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(typedQuery({ bringForwardCents: 0, bank: many.map((m, i) => ({ cents: i + 1, time: "10:00", slip: "", note: "" })) }).getAll("b").length, MAX_BANK_LINES);
});

test("bank line text: control characters stripped, whitespace collapsed, length cut", () => {
  const l = parseBankLine(`10:00~100~${encodeURIComponent("  A\u0000B\n\tC  ")}~${encodeURIComponent("n".repeat(500))}`);
  assert.equal(l?.slip, "A B C");
  assert.equal(l?.note.length, NOTE_MAX);
  const long = parseBankLine(`10:00~100~${encodeURIComponent("s".repeat(100))}~`);
  assert.equal(long?.slip.length, SLIP_MAX);
});

test("prototype-pollution style keys and non-string values do nothing", () => {
  const evil = JSON.parse('{"__proto__":{"bf":"1"},"constructor":{"x":1},"bf":"2.00","b":[1,null,{"a":1},"10:00~300~~"]}');
  const r = parse(evil);
  assert.equal(r.bringForwardCents, 200);
  assert.deepEqual(r.bank.map((l) => l.cents), [300]);
  assert.equal(({} as Record<string, unknown>).bf, undefined);
});

test("serializeBankLine escapes the separator so a note can never split the line", () => {
  const s = serializeBankLine({ cents: 100, time: "10:00", slip: "a~b", note: "c~d~e" });
  assert.equal(s.split("~").length, 4);
  assert.deepEqual(parseBankLine(s), { cents: 100, time: "10:00", slip: "a~b", note: "c~d~e" });
});
