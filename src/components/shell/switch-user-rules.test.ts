import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_SIGN_OUTS, switchedCount } from "@/components/shell/switch-user-rules";

test("?switched=N is a count from 1 to the limit; anything else is not a switch", () => {
  for (let n = 1; n <= MAX_SIGN_OUTS; n++) assert.equal(switchedCount(String(n)), n);
  for (const bad of ["0", "-1", String(MAX_SIGN_OUTS + 1), "1.5", "abc", "", undefined, null, ["1"], 3]) assert.equal(switchedCount(bad as never), null, String(bad));
});

test("the limit keeps a stuck session from looping for ever", () => {
  assert.ok(MAX_SIGN_OUTS >= 2 && MAX_SIGN_OUTS <= 10);
});
