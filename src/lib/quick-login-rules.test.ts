import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { firstHop, intSetting, newQrToken, newTerminalToken, parseStaffQr, publicCode, quickSessionExpired, readCookie, sha256, QR_PREFIX, type Outcome } from "@/lib/quick-login-rules";

describe("tokens", () => {
  test("a staff QR token is prefixed, random, and parses; nothing else parses", () => {
    const t = newQrToken();
    assert.ok(t.startsWith(QR_PREFIX));
    assert.equal(parseStaffQr(t), t);
    assert.equal(parseStaffQr(` ${t}\n`), t);
    assert.notEqual(newQrToken(), t);
    for (const bad of ["", "0186-0001-2000", "XSTF1.", "XSTF1.short", `${t}x`, t.replace("XSTF1.", "XSTF2."), "xstf1." + t.slice(6)]) assert.equal(parseStaffQr(bad), null, bad);
  });
  test("terminal tokens are long and different each time; the hash is stable and not the token", () => {
    const a = newTerminalToken();
    assert.ok(a.length >= 43);
    assert.notEqual(a, newTerminalToken());
    assert.equal(sha256(a), sha256(a));
    assert.notEqual(sha256(a), a);
    assert.match(sha256(a), /^[0-9a-f]{64}$/);
  });
});

describe("request details", () => {
  test("one cookie from a header; decoded; absent is null", () => {
    assert.equal(readCookie("a=1; xenon_terminal=abc%2Fdef; b=2", "xenon_terminal"), "abc/def");
    assert.equal(readCookie("a=1", "xenon_terminal"), null);
    assert.equal(readCookie(null, "x"), null);
    assert.equal(readCookie("xenon_terminalx=1", "xenon_terminal"), null, "a longer name is not the cookie");
  });
  test("the first hop of X-Forwarded-For", () => {
    assert.equal(firstHop("203.0.113.9, 10.0.0.1"), "203.0.113.9");
    assert.equal(firstHop(null), null);
    assert.equal(firstHop("  "), null);
  });
});

describe("what the person at the terminal is told", () => {
  test("every refusal that could reveal a card's status reads the same: not recognised", () => {
    const same: Outcome[] = ["UNKNOWN_CREDENTIAL", "STUDENT_CARD_REFUSED", "REVOKED", "USER_INACTIVE", "NOT_STAFF_ROLE"];
    assert.deepEqual(new Set(same.map((o) => publicCode(o))), new Set(["unknown"]));
  });
  test("the others say what to do", () => {
    assert.equal(publicCode("DISABLED"), "off");
    assert.equal(publicCode("NO_TERMINAL"), "no-terminal");
    assert.equal(publicCode("RATE_LIMITED"), "paused");
    assert.equal(publicCode("MUST_CHANGE_PASSWORD"), "use-password");
    assert.equal(publicCode("PASSWORD_REQUIRED", "sadun"), "password:sadun");
  });
});

describe("quick session length", () => {
  const H = 3_600_000;
  test("a password session never expires here", () => {
    assert.equal(quickSessionExpired({}, 9e15, 12), false);
    assert.equal(quickSessionExpired({ via: "password", qAt: 0 }, 9e15, 12), false);
  });
  test("a card or QR session ends after the hours; a quick token with no start time is not trusted", () => {
    assert.equal(quickSessionExpired({ via: "nfc", qAt: 1000 }, 1000 + 12 * H, 12), false);
    assert.equal(quickSessionExpired({ via: "nfc", qAt: 1000 }, 1000 + 12 * H + 1, 12), true);
    assert.equal(quickSessionExpired({ via: "qr", qAt: 1000 }, 1000 + 1 * H, 12), false);
    assert.equal(quickSessionExpired({ via: "qr" }, 1, 12), true);
  });
});

describe("settings text", () => {
  test("a whole number in range, else the default", () => {
    assert.equal(intSetting("7", 5), 7);
    for (const bad of ["0", "-1", "1.5", "abc", "", null, undefined, "10000"]) assert.equal(intSetting(bad as string, 5), 5, String(bad));
  });
});
