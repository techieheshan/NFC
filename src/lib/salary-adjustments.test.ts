import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildLines, parseAdjustmentInput, parsePayrollMonth, payrollMonthState, signedCents, splitEqual } from "@/lib/salary-adjustments";

const CURRENT = { year: 2026, month: 11 };
const TODAY = "2026-11-16";
const good = (o: Record<string, unknown> = {}) => ({
  kind: "SHARED_EXPENSE", sourceId: "7", title: "Class t-shirts", month: "2026-11", splitMode: "EQUAL", shared: "50,000.00",
  people: [{ key: "t2" }, { key: "t1" }], consentNote: "Both teachers agreed in the staff meeting", consentOn: "2026-11-10", ...o,
});

describe("splitting cents equally", () => {
  test("the remainder cents go to the first people, one each; the parts add up", () => {
    assert.deepEqual(splitEqual(10000, 3), [3334, 3333, 3333]);
    assert.deepEqual(splitEqual(10001, 3), [3334, 3334, 3333]);
    assert.deepEqual(splitEqual(5000000, 2), [2500000, 2500000]);
    assert.deepEqual(splitEqual(1, 3), [1, 0, 0]);
  });
  test("property: for many totals and group sizes the parts sum to the total and differ by at most one cent", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 2000; k++) {
      const total = Math.floor(rnd() * 99_999_999_99);
      const n = 1 + Math.floor(rnd() * 40);
      const parts = splitEqual(total, n);
      assert.equal(parts.length, n);
      assert.equal(parts.reduce((s, c) => s + c, 0), total, `total ${total} / ${n}`);
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
      assert.ok(parts.every((c, i) => i === 0 || c <= parts[i - 1]), "the extra cents are on the first people");
    }
  });
  test("it refuses what it cannot do", () => {
    assert.throws(() => splitEqual(100, 0), RangeError);
    assert.throws(() => splitEqual(-1, 2), RangeError);
    assert.throws(() => splitEqual(1.5, 2), RangeError);
  });
});

describe("the payroll month", () => {
  test("only the current month or a later one (at most 12 ahead); a past month is locked", () => {
    assert.equal(payrollMonthState({ year: 2026, month: 11 }, CURRENT), "ok");
    assert.equal(payrollMonthState({ year: 2026, month: 12 }, CURRENT), "ok");
    assert.equal(payrollMonthState({ year: 2027, month: 11 }, CURRENT), "ok");
    assert.equal(payrollMonthState({ year: 2027, month: 12 }, CURRENT), "too-far");
    assert.equal(payrollMonthState({ year: 2026, month: 10 }, CURRENT), "past");
    assert.equal(payrollMonthState({ year: 2025, month: 12 }, CURRENT), "past");
  });
  test("a month text is a real month in 2000..2100", () => {
    assert.deepEqual(parsePayrollMonth("2026-11"), { year: 2026, month: 11 });
    for (const bad of ["2026-13", "2026-00", "1999-12", "2101-01", "2026-1", "x", "", null, 5]) assert.equal(parsePayrollMonth(bad), null);
  });
});

describe("reading an adjustment", () => {
  test("a good equal split parses; the people keep their keys", () => {
    const r = parseAdjustmentInput(good(), CURRENT, TODAY);
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.value.sharedCents, 5000000);
      assert.deepEqual(r.value.people.map((p) => p.person), [{ kind: "teacher", id: 2 }, { kind: "teacher", id: 1 }]);
    }
  });
  test("a past month is refused with the locked message", () => {
    const r = parseAdjustmentInput(good({ month: "2026-10" }), CURRENT, TODAY);
    assert.equal(!r.ok && r.error.startsWith("That month is already closed"), true);
  });
  test("junk is refused with a plain message, never thrown", () => {
    const bad: [string, unknown][] = [
      ["null", null], ["kind", good({ kind: "LOAN" })], ["source", good({ sourceId: "x" })], ["title", good({ title: "a" })], ["month", good({ month: "soon" })],
      ["mode", good({ splitMode: "HALF" })], ["no people", good({ people: [] })], ["junk person", good({ people: [{ key: "x1" }] })],
      ["same person twice", good({ people: [{ key: "t1" }, { key: "t1" }] })], ["shared zero", good({ shared: "0" })], ["shared junk", good({ shared: "abc" })],
      ["no consent", good({ consentNote: "" })], ["future consent date", good({ consentOn: "2026-11-17" })], ["impossible date", good({ consentOn: "2026-02-30" })],
      ["custom without amounts", good({ splitMode: "CUSTOM", people: [{ key: "t1" }] })], ["custom zero", good({ splitMode: "CUSTOM", people: [{ key: "t1", amount: "0" }] })],
      ["41 people", good({ people: Array.from({ length: 41 }, (_, i) => ({ key: `t${i + 1}` })) })],
    ];
    for (const [name, input] of bad) {
      const r = parseAdjustmentInput(input, CURRENT, TODAY);
      assert.equal(r.ok, false, name);
      if (!r.ok) assert.ok(r.error.length > 0, name);
    }
  });
  test("a custom split reads each typed amount", () => {
    const r = parseAdjustmentInput(good({ splitMode: "CUSTOM", shared: undefined, people: [{ key: "t1", amount: "30,000" }, { key: "s4", amount: "10.50" }] }), CURRENT, TODAY);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value.people.map((p) => p.cents), [3000000, 1050]);
  });
});

describe("the amounts and Xenon's share", () => {
  const eq = (shared: number, keys: string[]) => ({ splitMode: "EQUAL" as const, sharedCents: shared, people: keys.map((k) => ({ person: { kind: k[0] === "t" ? ("teacher" as const) : ("staff" as const), id: Number(k.slice(1)) }, cents: null })) });
  test("100,000.00 expense, 50,000.00 shared between two teachers: 25,000.00 each, Xenon bears 50,000.00", () => {
    const r = buildLines(10000000, eq(5000000, ["t2", "t1"]));
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.lines.map((l) => [l.person.id, l.cents]), [[1, 2500000], [2, 2500000]], "teachers in id order");
      assert.equal(r.instituteCents, 5000000);
    }
  });
  test("teachers first, then staff, each in id order; an odd cent goes to the first", () => {
    const r = buildLines(1000, eq(1001 - 1, ["s9", "t5", "s2", "t3"]));
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.lines.map((l) => `${l.person.kind[0]}${l.person.id}`), ["t3", "t5", "s2", "s9"]);
    const odd = buildLines(10001, eq(10001, ["t1", "t2", "t3"]));
    assert.ok(odd.ok);
    if (odd.ok) assert.deepEqual(odd.lines.map((l) => l.cents), [3334, 3334, 3333]);
  });
  test("the lines plus Xenon's share always equal the total; more than the total is refused", () => {
    const r = buildLines(100000, { splitMode: "CUSTOM", sharedCents: null, people: [{ person: { kind: "teacher", id: 1 }, cents: 33333 }, { person: { kind: "staff", id: 1 }, cents: 12345 }] });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.sharedCents + r.instituteCents, 100000);
    assert.equal(buildLines(100000, { splitMode: "CUSTOM", sharedCents: null, people: [{ person: { kind: "teacher", id: 1 }, cents: 100001 }] }).ok, false);
    assert.equal(buildLines(100000, eq(100001, ["t1"])).ok, false);
    assert.ok(buildLines(100000, eq(100000, ["t1"])).ok, "all of it shared: Xenon bears nothing");
  });
  test("an amount too small to give every person a cent is refused", () => {
    assert.equal(buildLines(100, eq(2, ["t1", "t2", "t3"])).ok, false);
  });
  test("a shared expense is minus on a pay line, a bonus is plus", () => {
    assert.equal(signedCents("SHARED_EXPENSE", 2500000), -2500000);
    assert.equal(signedCents("BONUS", 2500000), 2500000);
  });
});
