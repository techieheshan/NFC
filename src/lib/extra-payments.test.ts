import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { extraReceiptRef, parseCancelReason, parseExtraInput, parseExtraReceiptRef, parsePrice, priceBill, type CatalogueItem } from "@/lib/extra-payments";

const REF = "sale-0123456789";
const ok = (o: Record<string, unknown> = {}) => parseExtraInput({ clientRef: REF, lines: [{ itemId: 1, quantity: 2 }], ...o });
const shirt: CatalogueItem = { id: 1, label: "T-shirt", priceCents: 150000 };
const book: CatalogueItem = { id: 2, label: "Past papers", priceCents: 75050 };
const cat = new Map([[1, shirt], [2, book]]);

describe("extra payment input", () => {
  test("a good bill parses; optional fields are null", () => {
    const r = ok();
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value, { clientRef: REF, studentId: null, courseId: null, note: null, lines: [{ kind: "item", itemId: 1, quantity: 2 }] });
  });

  test("a student, a class and a note are read; a note is trimmed", () => {
    const r = ok({ studentId: "12", courseId: 3, note: "  for the sports meet " });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.value.studentId, r.value.courseId, r.value.note], [12, 3, "for the sports meet"]);
  });

  test("a price or total sent for a catalogue line is never read (AGENTS 16)", () => {
    const r = parseExtraInput({ clientRef: REF, total: "1.00", lines: [{ itemId: 1, quantity: 1, price: "0.01", unitPrice: "0.01", amount: "0.01" }] });
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.value.lines, [{ kind: "item", itemId: 1, quantity: 1 }]);
  });

  test("junk is refused with a plain message, never thrown", () => {
    const bad: [string, unknown][] = [
      ["null", null], ["a string", "x"], ["no ref", { lines: [{ itemId: 1, quantity: 1 }] }], ["short ref", { clientRef: "abc", lines: [{ itemId: 1, quantity: 1 }] }],
      ["no lines", { clientRef: REF, lines: [] }], ["lines not an array", { clientRef: REF, lines: "x" }],
      ["21 lines", { clientRef: REF, lines: Array.from({ length: 21 }, (_, i) => ({ itemId: i + 1, quantity: 1 })) }],
      ["quantity 0", { clientRef: REF, lines: [{ itemId: 1, quantity: 0 }] }], ["quantity 1000", { clientRef: REF, lines: [{ itemId: 1, quantity: 1000 }] }],
      ["quantity 1.5", { clientRef: REF, lines: [{ itemId: 1, quantity: 1.5 }] }], ["quantity -1", { clientRef: REF, lines: [{ itemId: 1, quantity: -1 }] }],
      ["item id text", { clientRef: REF, lines: [{ itemId: "abc", quantity: 1 }] }], ["item twice", { clientRef: REF, lines: [{ itemId: 1, quantity: 1 }, { itemId: 1, quantity: 1 }] }],
      ["student junk", { clientRef: REF, studentId: "x", lines: [{ itemId: 1, quantity: 1 }] }], ["class zero", { clientRef: REF, courseId: 0, lines: [{ itemId: 1, quantity: 1 }] }],
      ["long note", { clientRef: REF, note: "x".repeat(201), lines: [{ itemId: 1, quantity: 1 }] }],
      ["a null line", { clientRef: REF, lines: [null] }],
    ];
    for (const [name, input] of bad) {
      const r = parseExtraInput(input);
      assert.equal(r.ok, false, name);
      if (!r.ok) assert.ok(r.error.length > 0, name);
    }
  });

  test("a one-off line needs a name and a real price above zero", () => {
    assert.ok(parseExtraInput({ clientRef: REF, lines: [{ label: "Lab coat", price: "1,250.50", quantity: 1 }] }).ok);
    for (const l of [{ label: "x", price: "10" }, { label: "Lab coat", price: "0" }, { label: "Lab coat", price: "abc" }, { label: "Lab coat", price: "-5" }, { label: "Lab coat", price: "1.234" }, { label: "Lab coat" }, { label: "y".repeat(81), price: "5" }]) {
      assert.equal(parseExtraInput({ clientRef: REF, lines: [{ ...l, quantity: 1 }] }).ok, false, JSON.stringify(l));
    }
  });
});

describe("pricing a bill on the server", () => {
  test("every amount comes from the catalogue; the total is the sum of the line amounts", () => {
    const p = parseExtraInput({ clientRef: REF, lines: [{ itemId: 1, quantity: 3 }, { itemId: 2, quantity: 2 }] });
    assert.ok(p.ok);
    if (!p.ok) return;
    const r = priceBill(p.value.lines, cat, 0);
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.lines.map((l) => l.amountCents), [450000, 150100]);
      assert.equal(r.totalCents, 600100);
      assert.ok(r.lines.every((l) => l.amountCents === l.unitCents * l.quantity && !l.custom));
    }
  });

  test("an item that is not in the catalogue (retired, or never existed) refuses the whole bill", () => {
    const p = parseExtraInput({ clientRef: REF, lines: [{ itemId: 1, quantity: 1 }, { itemId: 99, quantity: 1 }] });
    assert.ok(p.ok);
    if (p.ok) assert.equal(priceBill(p.value.lines, cat, 0).ok, false);
  });

  test("a one-off line: off when the cap is 0, allowed up to the cap, refused above it", () => {
    const p = parseExtraInput({ clientRef: REF, lines: [{ label: "Lab coat", price: "500.00", quantity: 2 }] });
    assert.ok(p.ok);
    if (!p.ok) return;
    assert.equal(priceBill(p.value.lines, cat, 0).ok, false, "cap 0 = not allowed");
    const fine = priceBill(p.value.lines, cat, 50000);
    assert.ok(fine.ok);
    if (fine.ok) assert.deepEqual([fine.totalCents, fine.lines[0].custom], [100000, true]);
    assert.equal(priceBill(p.value.lines, cat, 49999).ok, false, "one cent over the cap");
  });
});

describe("receipt numbers, prices and cancel reasons", () => {
  test("XA- is its own series", () => {
    assert.equal(extraReceiptRef(42), "XA-42");
    assert.ok(!extraReceiptRef(1).startsWith("XN-"));
    assert.equal(parseExtraReceiptRef("XA-42"), 42);
    assert.equal(parseExtraReceiptRef(" xa 7 "), 7);
    assert.equal(parseExtraReceiptRef("42"), 42);
    for (const bad of ["XN-4", "", "XA-", "0", "-3", "abc", "XA-1.5", "12345678901"]) assert.equal(parseExtraReceiptRef(bad), null, bad);
  });
  test("an item price is above zero with at most 2 decimals", () => {
    assert.deepEqual(parsePrice("1,500.50"), { ok: true, cents: 150050 });
    for (const bad of ["0", "0.00", "", "-1", "1.234", "abc"]) assert.equal(parsePrice(bad).ok, false, bad);
  });
  test("a cancel reason needs 3 characters", () => {
    assert.equal(parseCancelReason("ab").ok, false);
    assert.ok(parseCancelReason(" wrong item ").ok);
  });
});
