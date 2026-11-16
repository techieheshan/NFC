import { test } from "node:test";
import assert from "node:assert/strict";

import { Prisma } from "@prisma/client";

import { checkFkKind, fkColumn, saveFkKind } from "./fk";

const err = (message: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError(message, { code: "P2003", clientVersion: "test", ...(meta ? { meta } : {}) });

test("fkColumn reads the column from the constraint name, whether it is in the message or only in the driver-adapter meta", () => {
  assert.equal(fkColumn(err("Foreign key constraint violated on the constraint: `DailySummaryVersion_doneById_fkey`")), "doneById");
  assert.equal(fkColumn(err("x", { driverAdapterError: { cause: { constraint: { index: "DailySummaryCheck_markedById_fkey" } } } })), "markedById");
  assert.equal(fkColumn(err("constraint DailySummaryBankLine_recordedById_fkey failed")), "recordedById");
  assert.equal(fkColumn(err("on `DailySummaryVersion_preparedById_fkey`")), "preparedById");
  assert.equal(fkColumn(err("on `DailySummaryVersion_savedById_fkey`")), "savedById");
  assert.equal(fkColumn(err("on `DailySummaryCheck_checkedById_fkey`")), "checkedById");
});

test("fkColumn is null when the constraint cannot be told (no name, another table's name, not a Prisma error, unserialisable meta)", () => {
  assert.equal(fkColumn(err("Foreign key constraint violated")), null);
  assert.equal(fkColumn(err("on `Payment_studentId_fkey`")), null, "not one of ours");
  assert.equal(fkColumn(new Error("DailySummaryVersion_doneById_fkey")), null, "not a Prisma error");
  assert.equal(fkColumn("DailySummaryVersion_doneById_fkey"), null);
  assert.equal(fkColumn(null), null);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(fkColumn(err("on `DailySummaryVersion_doneById_fkey`", circular)), "doneById", "meta that cannot be written out does not hide the message");
  assert.equal(fkColumn(err("nothing", circular)), null);
});

test("saveFkKind: only savedById is the person's own sign-in, only doneById is the Done by they chose; every other column and null is 'other'", () => {
  assert.equal(saveFkKind("savedById"), "session");
  assert.equal(saveFkKind("doneById"), "done-by");
  for (const c of ["recordedById", "preparedById", "dayId", "versionId", "checkedById", "markedById", null]) assert.equal(saveFkKind(c), "other", String(c));
});

test("checkFkKind: only markedById is the person tapping, only checkedById is the admin they named; every other column and null is 'other'", () => {
  assert.equal(checkFkKind("markedById"), "session");
  assert.equal(checkFkKind("checkedById"), "named-admin");
  for (const c of ["savedById", "doneById", "recordedById", "versionId", null]) assert.equal(checkFkKind(c), "other", String(c));
});
