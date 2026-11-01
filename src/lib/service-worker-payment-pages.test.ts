import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/*
 * AGENTS rule 8: public/sw.js caches /attendance and NOTHING else — a stale payment or receipt
 * screen is worse than none. This runs the REAL worker file in a sandbox (a fake `self`, `caches`
 * and `fetch`), sends it navigations and server-action POSTs, and checks what it stored and what
 * it answers when the network is gone. /attendance is the positive control: it IS kept, so the
 * checks below cannot pass just because the sandbox stores nothing.
 */

const ORIGIN = "https://xenon.test";
const SW = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");

function sandbox() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, Response>();
  const puts: string[] = [];
  const state = { online: true, page: "<html>LIVE PAGE</html>" };
  const key = (k: string | { url: string }) => {
    const raw = typeof k === "string" ? k : k.url;
    return raw.startsWith(ORIGIN) ? raw.slice(ORIGIN.length) : raw;
  };
  const cache = {
    put: async (k: string | { url: string }, v: Response) => void (puts.push(key(k)), store.set(key(k), v)),
    add: async () => {},
    addAll: async () => {},
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({
    self,
    URL,
    Response,
    console,
    caches: {
      open: async () => cache,
      match: async (k: string | { url: string }) => store.get(key(k)),
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async () => {
      if (!state.online) throw new TypeError("network down");
      return new Response(state.page, { status: 200, headers: { "content-type": "text/html" } });
    },
  });
  vm.runInContext(SW, context);

  /** Send a request through the worker; null when the worker lets it pass straight through. */
  async function send(pathname: string, init: { method?: string; mode?: string } = {}) {
    let answered: Promise<Response> | null = null;
    handlers.fetch({
      request: { url: `${ORIGIN}${pathname}`, method: init.method ?? "GET", mode: init.mode ?? "navigate" },
      respondWith: (p: Promise<Response>) => void (answered = p),
    });
    return answered ? await (answered as Promise<Response>) : null;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { send, flush, state, store, puts };
}

const PAYMENT_PAGES = [
  "/payment-new/receipts",
  "/payment-new/receipts?q=nimal",
  "/payment-new/receipts?q=XN-1493",
  "/payment-new",
  "/payment-new/42",
  "/payment",
  "/receipts",
  "/receipts?q=heshan",
  "/reports",
];

describe("public/sw.js caches /attendance and nothing else", () => {
  test("control: /attendance IS kept, and comes back from the cache when the network is gone", async () => {
    const sw = sandbox();
    sw.state.page = "<html>ATTENDANCE</html>";
    assert.equal(await (await sw.send("/attendance"))!.text(), "<html>ATTENDANCE</html>");
    await sw.flush();
    assert.deepEqual(sw.puts, ["/attendance"]);
    sw.state.online = false;
    assert.equal(await (await sw.send("/attendance"))!.text(), "<html>ATTENDANCE</html>");
  });

  for (const url of PAYMENT_PAGES) {
    test(`${url}: never stored, and offline it is the "No connection" page — never a stale copy of itself`, async () => {
      const sw = sandbox();
      sw.state.page = "<html>RECEIPT LIST XN-1493 Nimal Perera 2500.00</html>";
      const live = await sw.send(url);
      assert.equal(await live!.text(), sw.state.page, "online it is served from the network");
      await sw.flush();
      assert.deepEqual(sw.puts, [], "nothing was put in any cache");
      assert.equal(sw.store.size, 0);

      sw.state.online = false;
      const offline = await sw.send(url);
      const body = await offline!.text();
      assert.ok(!body.includes("XN-1493") && !body.includes("Nimal Perera"), "no stale receipt data");
      assert.ok(body.includes("No connection"), body.slice(0, 80));
    });
  }

  test("a POST (a server action, such as a reprint) passes straight through the worker, uncached", async () => {
    const sw = sandbox();
    for (const url of ["/payment-new/receipts", "/receipts", "/payment-new/42"]) {
      // a server action is a fetch; a plain form post is a navigation — neither may be touched
      assert.equal(await sw.send(url, { method: "POST", mode: "cors" }), null, `${url} (fetch)`);
      assert.equal(await sw.send(url, { method: "POST", mode: "navigate" }), null, `${url} (form post)`);
    }
    await sw.flush();
    assert.deepEqual(sw.puts, []);
  });

  test("/api/* and a non-navigation GET (a data fetch) are left alone", async () => {
    const sw = sandbox();
    assert.equal(await sw.send("/api/health", { mode: "cors" }), null);
    assert.equal(await sw.send("/payment-new/receipts?_rsc=abc", { mode: "cors" }), null);
    await sw.flush();
    assert.deepEqual(sw.puts, []);
  });
});
