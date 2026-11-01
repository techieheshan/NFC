import "@/test-support/no-database";
import "@/test-support/server-stubs";

import test from "node:test";
import assert from "node:assert/strict";

import { comboStateOf, type ComboClassFacts, type ComboState } from "@/lib/combos";

// Job 3A: the combo rule table, pure (no database, no clock). The same function is what
// takePayment enforces and what job 3B will use to show the state, so there is one rule.

const cls = (over: Partial<ComboClassFacts> & { courseId?: number } = {}): ComboClassFacts => ({
  courseId: 1,
  free: false,
  isNew: false,
  days: 3,
  ...over,
});
const OLD_ATTENDED = cls();
const OLD_ZERO = cls({ days: 0 });
const NEW_ZERO = cls({ isNew: true, days: 0 });
const NEW_ATTENDED = cls({ isNew: true, days: 2 });
const FREE = cls({ free: true, days: 0 });

// ---- the named rows of the table -----------------------------------------------------------------

test("auto: every class that can be checked was attended at least one day", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, cls({ courseId: 2, days: 1 })]), "auto");
});

test("needs-confirmation: a class that existed last month has 0 days", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, cls({ courseId: 2, days: 0 })]), "needs-confirmation");
  assert.equal(comboStateOf([OLD_ZERO, OLD_ZERO]), "needs-confirmation");
});

test("exempt-free: one class is a FREE enrolment — the combo applies, with no check at all", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, FREE]), "exempt-free");
  // ...even when the paid class itself has 0 days: there is nothing to cross-check it against.
  assert.equal(comboStateOf([OLD_ZERO, FREE]), "exempt-free");
});

test("exempt-new: a class that began this month has no completed month, so it is not checked", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, NEW_ZERO]), "exempt-new");
  assert.equal(comboStateOf([NEW_ZERO, cls({ courseId: 2, isNew: true, days: 0 })]), "exempt-new"); // both new
  assert.equal(comboStateOf([OLD_ATTENDED, NEW_ATTENDED]), "exempt-new"); // days on a new class change nothing
});

test("a NEW class is exempt only for itself: the other class with 0 days still needs a person", () => {
  assert.equal(comboStateOf([OLD_ZERO, NEW_ZERO]), "needs-confirmation");
});

test("off: staff switched the combo off, whatever the attendance says", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, OLD_ATTENDED], true), "off");
  assert.equal(comboStateOf([OLD_ZERO, OLD_ATTENDED], true), "off");
  assert.equal(comboStateOf([OLD_ATTENDED, FREE], true), "off");
  assert.equal(comboStateOf([NEW_ZERO, OLD_ATTENDED], true), "off");
});

test("precedence: off > exempt-free > needs-confirmation > exempt-new > auto", () => {
  // free beats a 0-day class and a new class
  assert.equal(comboStateOf([FREE, OLD_ZERO, NEW_ZERO]), "exempt-free");
  // a 0-day (checkable) class beats a new class
  assert.equal(comboStateOf([OLD_ZERO, NEW_ZERO, OLD_ATTENDED]), "needs-confirmation");
});

// ---- three-class combos ----------------------------------------------------------------------------

test("three classes: needs-confirmation as soon as ONE checkable class has 0 days", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, OLD_ATTENDED, OLD_ZERO]), "needs-confirmation");
  assert.equal(comboStateOf([OLD_ATTENDED, OLD_ATTENDED, cls({ days: 1 })]), "auto");
});

test("three classes with a FREE one: the whole combo is exempt (as the brief reads), even beside a 0-day class", () => {
  assert.equal(comboStateOf([FREE, OLD_ATTENDED, OLD_ZERO]), "exempt-free");
});

test("three classes, one new and the rest attended: exempt-new", () => {
  assert.equal(comboStateOf([OLD_ATTENDED, OLD_ATTENDED, NEW_ZERO]), "exempt-new");
});

// ---- the whole table: every combination for two classes ------------------------------------------------

type Kind = { name: string; facts: ComboClassFacts };
const kinds: Kind[] = [];
for (const free of [false, true]) for (const isNew of [false, true]) for (const days of [0, 3])
  kinds.push({ name: `${free ? "free" : "paid"}/${isNew ? "new" : "old"}/${days}d`, facts: cls({ free, isNew, days }) });

/** The rule, written out a second way, to check the implementation against. */
function oracle(classes: ComboClassFacts[], off: boolean): ComboState {
  if (off) return "off";
  if (classes.filter((c) => c.free).length > 0) return "exempt-free";
  const checkable = classes.filter((c) => !c.isNew);
  if (checkable.filter((c) => c.days < 1).length > 0) return "needs-confirmation";
  return classes.filter((c) => c.isNew).length > 0 ? "exempt-new" : "auto";
}

test(`all ${kinds.length * kinds.length * 2} two-class combinations (x switch on/off) match the rule`, () => {
  let checked = 0;
  for (const a of kinds) for (const b of kinds) for (const off of [false, true]) {
    const classes = [a.facts, { ...b.facts, courseId: 2 }];
    assert.equal(comboStateOf(classes, off), oracle(classes, off), `${a.name} + ${b.name}, off=${off}`);
    checked++;
  }
  assert.equal(checked, 128);
});

test("the order of the classes never changes the state", () => {
  for (const a of kinds) for (const b of kinds) {
    assert.equal(comboStateOf([a.facts, { ...b.facts, courseId: 2 }]), comboStateOf([{ ...b.facts, courseId: 2 }, a.facts]));
  }
});
