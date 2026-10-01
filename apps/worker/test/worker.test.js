import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { computeOutcome } from "../../../packages/core/index.js";
import { D1Shim } from "../d1-shim.js";
import { route, signUnlock } from "../worker.js";

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const MIGRATION_0002 = readFileSync(new URL("../migrations/0002-history.sql", import.meta.url), "utf8");
// schema.sql keeps the 0.2 additions below a marker; everything above it is the 0.1 schema.
const [SCHEMA_0_1, SCHEMA_0_2] = SCHEMA.split(/^-- ---- 0\.2: .*$/m);
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
// 2026-09-30 12:00 ET (EDT = UTC-4) → 16:00Z
const NOON_ET = Date.UTC(2026, 8, 30, 16, 0);

function env(overrides = {}) {
  const DB = new D1Shim();
  DB.exec(SCHEMA);
  return { DB, DAILY_SALT: "test-salt", UNLOCK_SECRET: "test-unlock", ...overrides };
}

async function req(env, method, path, body, now = NOON_ET) {
  const url = new URL(`https://yourluckyday.fyi${path}`);
  const request = new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await route(request, url, env, now);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/today", () => {
  it("returns the revealed outcome, the callable day, and empty tallies", async () => {
    const e = env();
    const { status, body } = await req(e, "GET", "/api/today");
    assert.equal(status, 200);
    assert.equal(body.revealed.dayKey, "2026-09-30");
    assert.equal(body.callable.dayKey, "2026-10-01");
    assert.equal(body.revealed.outcome.charm.id.length > 0, true);
    assert.deepEqual(body.callable.tallies, [0, 0, 0, 0, 0, 0]);
    assert.equal(body.jar.total, 0);
    assert.equal(body.jar.next.calls, 100);
    assert.ok(body.callable.msUntilReveal > 0);
  });

  it("outcome is stable across requests and hidden for the callable day", async () => {
    const e = env();
    const a = (await req(e, "GET", "/api/today")).body;
    const b = (await req(e, "GET", "/api/today")).body;
    assert.deepEqual(a.revealed.outcome, b.revealed.outcome);
    assert.equal(a.callable.outcome, undefined);
  });
});

describe("POST /api/call", () => {
  it("records a call and increments the tally and jar", async () => {
    const e = env();
    const r = await req(e, "POST", "/api/call", { player: P1, charm: 2 });
    assert.equal(r.status, 200);
    assert.equal(r.body.dayKey, "2026-10-01");
    assert.deepEqual(r.body.tallies, [0, 0, 1, 0, 0, 0]);
    const t = (await req(e, "GET", "/api/today")).body;
    assert.deepEqual(t.callable.tallies, [0, 0, 1, 0, 0, 0]);
    assert.equal(t.jar.total, 1);
  });

  it("is idempotent for the same charm and moves the tally when changed", async () => {
    const e = env();
    await req(e, "POST", "/api/call", { player: P1, charm: 2 });
    await req(e, "POST", "/api/call", { player: P1, charm: 2 });
    const r = await req(e, "POST", "/api/call", { player: P1, charm: 4 });
    assert.equal(r.body.changed, true);
    assert.deepEqual(r.body.tallies, [0, 0, 0, 0, 1, 0]);
    const t = (await req(e, "GET", "/api/today")).body;
    assert.equal(t.jar.total, 1, "jar counts players, not clicks");
  });

  it("two players, one charm", async () => {
    const e = env();
    await req(e, "POST", "/api/call", { player: P1, charm: 0 });
    await req(e, "POST", "/api/call", { player: P2, charm: 0 });
    assert.deepEqual((await req(e, "GET", "/api/today")).body.callable.tallies, [2, 0, 0, 0, 0, 0]);
  });

  it("calls after the 08:00 reveal land on the next day", async () => {
    const e = env();
    const before = Date.UTC(2026, 8, 30, 11, 59); // 07:59 ET
    const after = Date.UTC(2026, 8, 30, 12, 0); // 08:00 ET
    assert.equal((await req(e, "POST", "/api/call", { player: P1, charm: 1 }, before)).body.dayKey, "2026-09-30");
    assert.equal((await req(e, "POST", "/api/call", { player: P1, charm: 1 }, after)).body.dayKey, "2026-10-01");
  });

  it("rejects bad input", async () => {
    const e = env();
    assert.equal((await req(e, "POST", "/api/call", { player: "nope", charm: 1 })).status, 400);
    assert.equal((await req(e, "POST", "/api/call", { player: P1, charm: 9 })).status, 400);
    assert.equal((await req(e, "POST", "/api/call", { player: P1, charm: "1" })).status, 400);
    assert.equal((await req(e, "POST", "/api/call", "not json")).status, 400);
  });
});

describe("POST /api/unlock", () => {
  function polarEnv(status = "succeeded", productId = "prod_1") {
    const e = env({ POLAR_TOKEN: "tok", POLAR_PRODUCT_ID: "prod_1", POLAR_API: "https://polar.test" });
    globalThis.fetch = async (url) => {
      const id = String(url).split("/").pop();
      if (id.includes("missing")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ id, status, product_id: productId }), { status: 200 });
    };
    return e;
  }

  it("returns a signed token for a paid checkout and binds it to the player", async () => {
    const e = polarEnv();
    const r = await req(e, "POST", "/api/unlock", { player: P1, checkout_id: "chk_paid_001" });
    assert.equal(r.status, 200);
    assert.equal(r.body.token, await signUnlock("test-unlock", P1));
    // Same player can re-fetch; another player cannot reuse the checkout.
    assert.equal((await req(e, "POST", "/api/unlock", { player: P1, checkout_id: "chk_paid_001" })).status, 200);
    assert.equal((await req(e, "POST", "/api/unlock", { player: P2, checkout_id: "chk_paid_001" })).status, 409);
  });

  it("refuses unpaid, missing, and wrong-product checkouts", async () => {
    assert.equal((await req(polarEnv("open"), "POST", "/api/unlock", { player: P1, checkout_id: "chk_open_001" })).status, 402);
    assert.equal((await req(polarEnv(), "POST", "/api/unlock", { player: P1, checkout_id: "chk_missing_1" })).status, 402);
    assert.equal((await req(polarEnv("succeeded", "prod_other"), "POST", "/api/unlock", { player: P1, checkout_id: "chk_x_0001" })).status, 402);
  });

  it("503 when payments are not configured", async () => {
    assert.equal((await req(env(), "POST", "/api/unlock", { player: P1, checkout_id: "chk_paid_001" })).status, 503);
  });
});

describe("GET /api/community", () => {
  // Calls made at noon ET on Sep 30 are for the Oct 1 spin, revealed at 08:00 ET on Oct 1.
  const NOON_OCT_1 = Date.UTC(2026, 9, 1, 16, 0);
  const drawn = computeOutcome("test-salt", "2026-10-01").charm;
  const miss = (drawn + 1) % 6;
  const P3 = "33333333-3333-4333-8333-333333333333";

  it("starts empty with the 1-in-6 baseline", async () => {
    const { status, body } = await req(env(), "GET", "/api/community");
    assert.equal(status, 200);
    assert.deepEqual(body, {
      totalCalls: 0, totalHits: 0, settledCalls: 0, hitRate: 0, baseline: 1 / 6,
      charmCalls: [0, 0, 0, 0, 0, 0], mostCalled: null, bestDay: null,
    });
  });

  it("counts calls per charm as they come in, following a change of mind", async () => {
    const e = env();
    await req(e, "POST", "/api/call", { player: P1, charm: 2 });
    await req(e, "POST", "/api/call", { player: P2, charm: 2 });
    await req(e, "POST", "/api/call", { player: P3, charm: 5 });
    await req(e, "POST", "/api/call", { player: P3, charm: 4 });
    const { body } = await req(e, "GET", "/api/community");
    assert.equal(body.totalCalls, 3);
    assert.deepEqual(body.charmCalls, [0, 0, 2, 0, 1, 0]);
    assert.equal(body.mostCalled, 2);
    assert.equal(body.totalHits, 0, "nothing is a hit until the reveal");
    assert.equal(body.hitRate, 0);
  });

  it("the first /api/today of a day records the outcome and scores that day once", async () => {
    const e = env();
    await req(e, "POST", "/api/call", { player: P1, charm: drawn });
    await req(e, "POST", "/api/call", { player: P2, charm: drawn });
    await req(e, "POST", "/api/call", { player: P3, charm: miss });

    // Three visitors arrive together at the rollover, then one more later.
    await Promise.all([1, 2, 3].map(() => req(e, "GET", "/api/today", undefined, NOON_OCT_1)));
    await req(e, "GET", "/api/today", undefined, NOON_OCT_1 + 60_000);

    assert.deepEqual(
      (await e.DB.prepare("SELECT day, charm FROM outcomes ORDER BY day").all()).results.map((r) => ({ ...r })),
      [{ day: "2026-10-01", charm: drawn }],
    );
    const { body } = await req(e, "GET", "/api/community");
    assert.equal(body.totalHits, 2);
    assert.equal(body.settledCalls, 3);
    assert.equal(body.hitRate, 2 / 3);
    assert.deepEqual(body.bestDay, { dayKey: "2026-10-01", hits: 2 });
  });

  it("calls still waiting for a reveal don't drag the hit rate down", async () => {
    const e = env();
    await req(e, "POST", "/api/call", { player: P1, charm: drawn });
    await req(e, "GET", "/api/today", undefined, NOON_OCT_1);
    await req(e, "POST", "/api/call", { player: P1, charm: 0 }, NOON_OCT_1); // for Oct 2
    const { body } = await req(e, "GET", "/api/community");
    assert.equal(body.totalCalls, 2);
    assert.equal(body.hitRate, 1);
  });

  it("best day only moves when a later day beats it", async () => {
    const e = env();
    await req(e, "POST", "/api/call", { player: P1, charm: drawn });
    await req(e, "POST", "/api/call", { player: P2, charm: drawn });
    await req(e, "GET", "/api/today", undefined, NOON_OCT_1);
    const next = computeOutcome("test-salt", "2026-10-02").charm;
    await req(e, "POST", "/api/call", { player: P1, charm: next }, NOON_OCT_1);
    await req(e, "GET", "/api/today", undefined, NOON_OCT_1 + 86_400_000);
    const { body } = await req(e, "GET", "/api/community");
    assert.equal(body.totalHits, 3);
    assert.deepEqual(body.bestDay, { dayKey: "2026-10-01", hits: 2 });
  });
});

describe("migration 0002", () => {
  const statements = (sql) => sql.replace(/^--.*$/gm, "").split(";").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

  it("holds exactly the 0.2 block of schema.sql, and only CREATE TABLE / INSERT OR IGNORE", () => {
    assert.deepEqual(statements(MIGRATION_0002), statements(SCHEMA_0_2));
    assert.equal(statements(MIGRATION_0002).length, 11);
    for (const st of statements(MIGRATION_0002)) assert.match(st, /^(CREATE TABLE IF NOT EXISTS|INSERT OR IGNORE INTO) /);
  });

  it("upgrades a live 0.1 database, keeping its data and seeding per-charm counts from the tallies", async () => {
    const DB = new D1Shim();
    DB.exec(SCHEMA_0_1);
    const e = { DB, DAILY_SALT: "test-salt", UNLOCK_SECRET: "test-unlock" };
    DB.exec("INSERT INTO tallies (day, charm, n) VALUES ('2026-09-30', 1, 4), ('2026-10-01', 1, 2), ('2026-10-01', 3, 5)");
    DB.exec("UPDATE counters SET n = 11 WHERE key = 'calls_total'");

    DB.exec(MIGRATION_0002);
    DB.exec(MIGRATION_0002); // running it twice changes nothing

    const { body } = await req(e, "GET", "/api/community");
    assert.equal(body.totalCalls, 11);
    assert.deepEqual(body.charmCalls, [0, 6, 0, 5, 0, 0]);
    assert.equal(body.mostCalled, 1);
    assert.equal(body.totalHits, 0);
    assert.equal((await req(e, "POST", "/api/call", { player: P1, charm: 3 })).status, 200);
    assert.deepEqual((await req(e, "GET", "/api/community")).body.charmCalls, [0, 6, 0, 6, 0, 0]);
  });

  it("a database that hasn't been migrated yet still serves the spin and takes calls", async () => {
    const DB = new D1Shim();
    DB.exec(SCHEMA_0_1);
    const e = { DB, DAILY_SALT: "test-salt", UNLOCK_SECRET: "test-unlock" };
    const logged = [];
    const realError = console.error;
    console.error = (err) => logged.push(err);
    try {
      const t = await req(e, "GET", "/api/today");
      assert.equal(t.status, 200);
      assert.equal(t.body.revealed.dayKey, "2026-09-30");
      assert.equal((await req(e, "POST", "/api/call", { player: P1, charm: 2 })).status, 200);
      assert.equal((await req(e, "GET", "/api/today")).body.jar.total, 1);
    } finally {
      console.error = realError;
    }
    assert.match(String(logged[0]), /no such table: outcomes/);
  });
});

describe("routing", () => {
  it("404 for unknown api paths", async () => {
    assert.equal((await req(env(), "GET", "/api/nope")).status, 404);
  });
});
