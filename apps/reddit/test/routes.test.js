import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { EventEmitter } from "node:events";
import { store, setContext } from "./fake-devvit.js";
import { onRequest } from "../src/server/routes.js";
import { computeOutcome, summarize } from "../../../packages/core/index.js";

const NOON_ET = Date.UTC(2026, 8, 30, 16, 0);
function fakeReq(method, path, body) {
  const req = new EventEmitter(); req.method = method; req.url = path;
  queueMicrotask(() => { if (body !== undefined) req.emit("data", Buffer.from(JSON.stringify(body))); req.emit("end"); });
  return req;
}
function fakeRes() { const r = { status: 0, body: "" , writeHead(s) { r.status = s; }, end(b) { r.body = b; } }; return r; }
async function call(method, path, body) { const res = fakeRes(); await onRequest(fakeReq(method, path, body), res); return { status: res.status, body: JSON.parse(res.body) }; }
function reset() { store.kv.clear(); store.hashes.clear(); store.zsets.clear(); store.sent.length = 0; store.posts.length = 0; as("alice"); }
/** Act as a signed-in user (or pass null for logged out), optionally from a post that owns `postDay`. */
function as(name, postDay) { setContext({ userId: name ? `t2_${name}` : undefined, subredditName: "testsub", postId: "t3_x", ...(postDay ? { postData: { dayKey: postDay } } : {}) }); }
/** Run `fn` with the handlers' clock pinned: they read Date.now() at call time. */
async function at(ms, fn) { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } }

// All times are EDT (UTC-4). Calls made on day N are for day N+1's spin.
const NOON_SEP_28 = Date.UTC(2026, 8, 28, 16, 0);
const NOON_SEP_29 = Date.UTC(2026, 8, 29, 16, 0);
const REVEAL_SEP_30 = Date.UTC(2026, 8, 30, 12, 0); // 08:00 ET
const REVEAL_OCT_01 = Date.UTC(2026, 9, 1, 12, 0);
const drawn = (day) => computeOutcome("test-salt", day).charm;
const miss = (day) => (drawn(day) + 1) % 6;

describe("reddit routes", () => {
  beforeEach(reset);

  it("state for a signed-in user", async () => {
    const { status, body } = await call("GET", "/api/state");
    assert.equal(status, 200);
    assert.equal(body.signedIn, true);
    assert.match(body.revealed.dayKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body.callable.tallies.length, 6);
    assert.equal(body.me.streak, 0);
    assert.match(body.callable.channel, /^tally_\d{4}_\d{2}_\d{2}$/);
  });

  it("call records, tallies, jar, realtime, and change-of-mind", async () => {
    let r = await call("POST", "/api/call", { charm: 2 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.tallies, [0, 0, 1, 0, 0, 0]);
    assert.equal(store.sent.length, 1);
    r = await call("POST", "/api/call", { charm: 4 });
    assert.deepEqual(r.body.tallies, [0, 0, 0, 0, 1, 0]);
    const s = (await call("GET", "/api/state")).body;
    assert.equal(s.jar.total, 1);
    assert.equal(s.callable.myCall, 4);
    assert.equal(s.me.streak, 1);
  });

  it("second user adds to the same tally", async () => {
    await call("POST", "/api/call", { charm: 0 });
    setContext({ userId: "t2_bob", subredditName: "testsub", postId: "t3_x" });
    const r = await call("POST", "/api/call", { charm: 0 });
    assert.deepEqual(r.body.tallies, [2, 0, 0, 0, 0, 0]);
  });

  it("logged-out users can view but not call", async () => {
    setContext({ userId: undefined, subredditName: "testsub", postId: "t3_x" });
    assert.equal((await call("GET", "/api/state")).body.signedIn, false);
    assert.equal((await call("POST", "/api/call", { charm: 1 })).status, 401);
  });

  it("rejects bad charm", async () => {
    assert.equal((await call("POST", "/api/call", { charm: "1" })).status, 400);
    assert.equal((await call("POST", "/api/call", { charm: 9 })).status, 400);
  });

  it("install and menu create a post with postData and fallback text", async () => {
    const r = await call("POST", "/internal/on/app-install");
    assert.equal(r.body.status, "success");
    assert.equal(store.posts.length, 1);
    assert.equal(store.posts[0].entry, "default");
    assert.match(store.posts[0].postData.dayKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(store.posts[0].textFallback.text, /Today the world drew/);
    const m = await call("POST", "/internal/menu/post-today");
    assert.equal(m.body.showToast.appearance, "success");
    assert.equal(store.posts.length, 2);
  });

  it("scheduler posts only at 08:00 ET and only once", async () => {
    // Hijack Date.now for the handler: it reads Date.now() at call time.
    const real = Date.now;
    try {
      Date.now = () => Date.UTC(2026, 8, 30, 12, 0); // 08:00 EDT
      let r = await call("POST", "/internal/scheduler/daily-post");
      assert.equal(r.body.status, "ok");
      r = await call("POST", "/internal/scheduler/daily-post");
      assert.equal(r.body.status, "skipped");
      assert.match(r.body.reason, /already/);
      Date.now = () => Date.UTC(2026, 8, 30, 13, 0); // 09:00 EDT → the EST cron fires but it's not 8
      r = await call("POST", "/internal/scheduler/daily-post");
      assert.match(r.body.reason, /local hour 9/);
      Date.now = () => Date.UTC(2026, 10, 15, 13, 0); // 08:00 EST in November
      r = await call("POST", "/internal/scheduler/daily-post");
      assert.equal(r.body.status, "ok");
    } finally { Date.now = real; }
  });

  it("unknown route 404", async () => {
    assert.equal((await call("GET", "/api/nope")).status, 404);
  });
});

describe("posts own their day", () => {
  beforeEach(reset);

  it("an older post shows its own day: outcome, tallies, the user's call, no call grid", async () => {
    await at(NOON_SEP_28, async () => {
      await call("POST", "/api/call", { charm: 3 });
      as("bob");
      await call("POST", "/api/call", { charm: 1 });
    });
    as("alice", "2026-09-29");
    const { status, body } = await at(NOON_ET, () => call("GET", "/api/state"));
    assert.equal(status, 200);
    assert.equal(body.mode, "archive");
    assert.equal(body.revealed.dayKey, "2026-09-29");
    assert.equal(body.revealed.charmIndex, drawn("2026-09-29"));
    assert.deepEqual(body.revealed.tallies, [0, 1, 0, 1, 0, 0]);
    assert.equal(body.revealed.myCall, 3);
    assert.equal(body.callable, undefined, "nothing to call from an archived post");
    assert.equal(body.live.dayKey, "2026-09-30");
    assert.equal(body.me.calls, 1, "stats are as of now, not as of that day");
    assert.equal(body.me.streak, 0);
    assert.equal(body.jar.total, 2);
  });

  it("archive mode works logged out and for a day the user skipped", async () => {
    as(null, "2026-09-29");
    let body = (await at(NOON_ET, () => call("GET", "/api/state"))).body;
    assert.equal(body.mode, "archive");
    assert.equal(body.signedIn, false);
    as("alice", "2026-09-29");
    body = (await at(NOON_ET, () => call("GET", "/api/state"))).body;
    assert.equal(body.revealed.myCall, null);
  });

  it("the newest post, and a post without a usable day, stay live", async () => {
    for (const postDay of ["2026-09-30", "2026-10-01", undefined, "yesterday"]) {
      as("alice", postDay);
      const { body } = await at(NOON_ET, () => call("GET", "/api/state"));
      assert.equal(body.mode, "live", `postData.dayKey=${postDay}`);
      assert.equal(body.revealed.dayKey, "2026-09-30");
      assert.equal(body.callable.dayKey, "2026-10-01");
      assert.equal(body.live, undefined);
    }
  });

  it("a live post turns into an archive once the next spin is out", async () => {
    as("alice", "2026-09-30");
    assert.equal((await at(REVEAL_OCT_01 - 1000, () => call("GET", "/api/state"))).body.mode, "live");
    assert.equal((await at(REVEAL_OCT_01, () => call("GET", "/api/state"))).body.mode, "archive");
  });
});

describe("history", () => {
  beforeEach(reset);

  it("401 when logged out", async () => {
    as(null);
    assert.equal((await call("GET", "/api/history")).status, 401);
  });

  it("returns the user's calls and only revealed outcomes, enough for core.summarize", async () => {
    await at(NOON_SEP_29, () => call("POST", "/api/call", { charm: drawn("2026-09-30") }));
    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    const { status, body } = await at(NOON_ET, async () => {
      await call("POST", "/api/call", { charm: 5 });
      return call("GET", "/api/history");
    });
    assert.equal(status, 200);
    assert.deepEqual(body.calls, { "2026-09-30": drawn("2026-09-30"), "2026-10-01": 5 });
    assert.deepEqual(body.outcomes, { "2026-09-30": drawn("2026-09-30") }, "tomorrow's draw is never in the response");
    assert.deepEqual(body.fortunes, { "2026-09-30": computeOutcome("test-salt", "2026-09-30").fortune });
    assert.equal(body.revealedDay, "2026-09-30");
    assert.equal(body.callableDay, "2026-10-01");

    const mine = Object.fromEntries(Object.entries(body.calls).map(([d, c]) => [d, { called: c }]));
    assert.deepEqual(summarize(mine, body.outcomes, body.callableDay), {
      calls: 2, hits: 1, hitRate: 1, currentStreak: 2, bestStreak: 2,
      favoriteCharm: Math.min(drawn("2026-09-30"), 5),
    });
  });

  it("returns a full year of outcomes, and nothing older than the window", async () => {
    // NOON_ET is Sep 30, 2026: 399 days back is the oldest day in the 400-day window.
    store.hashes.set("outcomes", new Map([["2026-09-30", "1"], ["2026-06-01", "2"], ["2025-08-27", "3"], ["2025-08-26", "4"]]));
    const { body } = await at(NOON_ET, () => call("GET", "/api/history"));
    assert.deepEqual(body.outcomes, { "2026-09-30": 1, "2026-06-01": 2, "2025-08-27": 3 });
    for (const [day, i] of Object.entries(body.fortunes)) assert.equal(i, computeOutcome("test-salt", day).fortune);
  });

  it("another user's calls never show up in mine", async () => {
    await at(NOON_SEP_29, () => call("POST", "/api/call", { charm: 2 }));
    as("bob");
    assert.deepEqual((await at(NOON_ET, () => call("GET", "/api/history"))).body.calls, {});
  });

  it("the menu and install posts record the outcome too, once", async () => {
    await at(NOON_ET, () => call("POST", "/internal/on/app-install"));
    await at(NOON_ET, () => call("POST", "/internal/menu/post-today"));
    assert.deepEqual(Object.fromEntries(store.hashes.get("outcomes")), { "2026-09-30": String(drawn("2026-09-30")) });
  });

  it("a missed post is caught up by the next one, but never from before launch", async () => {
    // No post on Sep 30 or Oct 1; the Oct 2 post settles all three days since launch.
    await at(Date.UTC(2026, 9, 2, 12, 0), () => call("POST", "/internal/scheduler/daily-post"));
    assert.deepEqual([...store.hashes.get("outcomes").keys()].sort(), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("community stats", () => {
  beforeEach(reset);

  it("starts empty with the 1-in-6 baseline", async () => {
    const { status, body } = await call("GET", "/api/community");
    assert.equal(status, 200);
    assert.deepEqual(body, {
      totalCalls: 0, totalHits: 0, settledCalls: 0, hitRate: 0, baseline: 1 / 6,
      charmCalls: [0, 0, 0, 0, 0, 0], mostCalled: null, bestDay: null,
    });
  });

  it("counts calls as they come in and hits once the day's post is created", async () => {
    const hit = drawn("2026-09-30");
    await at(NOON_SEP_29, async () => {
      await call("POST", "/api/call", { charm: miss("2026-09-30") });
      await call("POST", "/api/call", { charm: hit }); // change of mind: still one call
      as("bob");
      await call("POST", "/api/call", { charm: hit });
      as("carol");
      await call("POST", "/api/call", { charm: miss("2026-09-30") });
    });
    let c = (await call("GET", "/api/community")).body;
    assert.equal(c.totalCalls, 3);
    assert.equal(c.totalHits, 0, "nothing is a hit until the reveal");
    assert.equal(c.hitRate, 0);
    assert.equal(c.charmCalls[hit], 2);
    assert.equal(c.charmCalls[miss("2026-09-30")], 1);
    assert.equal(c.mostCalled, hit);

    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    c = (await call("GET", "/api/community")).body;
    assert.equal(c.totalHits, 2);
    assert.equal(c.settledCalls, 3);
    assert.equal(c.hitRate, 2 / 3);
    assert.deepEqual(c.bestDay, { dayKey: "2026-09-30", hits: 2 });

    // A second post for the same day (mod menu) must not count the day twice.
    await at(NOON_ET, () => call("POST", "/internal/menu/post-today"));
    assert.deepEqual((await call("GET", "/api/community")).body, c);
  });

  it("calls still waiting for a reveal don't drag the hit rate down", async () => {
    await at(NOON_SEP_29, () => call("POST", "/api/call", { charm: drawn("2026-09-30") }));
    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    await at(NOON_ET, () => call("POST", "/api/call", { charm: 0 }));
    const c = (await call("GET", "/api/community")).body;
    assert.equal(c.totalCalls, 2);
    assert.equal(c.hitRate, 1);
  });

  it("best day only moves when a later day beats it", async () => {
    await at(NOON_SEP_29, async () => {
      await call("POST", "/api/call", { charm: drawn("2026-09-30") });
      as("bob");
      await call("POST", "/api/call", { charm: drawn("2026-09-30") });
    });
    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    await at(NOON_ET, () => call("POST", "/api/call", { charm: drawn("2026-10-01") })); // bob only
    await at(REVEAL_OCT_01, () => call("POST", "/internal/scheduler/daily-post"));
    const c = (await call("GET", "/api/community")).body;
    assert.equal(c.totalHits, 3);
    assert.deepEqual(c.bestDay, { dayKey: "2026-09-30", hits: 2 });
  });

  it("a community that was calling before 0.2 starts from its real totals", async () => {
    store.kv.set("jar", "5");
    store.hashes.set("tally:2026-09-30", new Map([["0", "3"], ["2", "2"]]));
    assert.equal((await call("GET", "/api/community")).body.totalCalls, 5, "falls back to the jar before the first new call");
    await at(NOON_ET, () => call("POST", "/api/call", { charm: 2 }));
    const c = (await call("GET", "/api/community")).body;
    assert.equal(c.totalCalls, 6);
    assert.deepEqual(c.charmCalls, [3, 0, 3, 0, 0, 0]);
  });
});

describe("leaderboard (opt-in)", () => {
  beforeEach(reset);
  const optin = (show) => call("POST", "/api/leaderboard/optin", { show });

  it("requires sign-in and a boolean", async () => {
    assert.equal((await optin("yes")).status, 400);
    assert.equal((await call("POST", "/api/leaderboard/optin")).status, 400);
    as(null);
    assert.equal((await optin(true)).status, 401);
    const { status, body } = await call("GET", "/api/leaderboard");
    assert.equal(status, 200);
    assert.deepEqual(body, { signedIn: false, optedIn: false, streak: [], hits: [], me: null });
  });

  it("nobody is listed, and no username is stored, without opting in", async () => {
    await at(NOON_SEP_29, () => call("POST", "/api/call", { charm: drawn("2026-09-30") }));
    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    const { body } = await at(NOON_ET, () => call("GET", "/api/leaderboard"));
    assert.deepEqual(body, { signedIn: true, optedIn: false, streak: [], hits: [], me: null });
    assert.equal(store.hashes.get("lb_names"), undefined);
    assert.ok([...store.zsets.values()].every((set) => set.size === 0), "no one is in either sorted set");
  });

  it("opt-in stores the username and ranks by streak and by hits", async () => {
    // Sep 30: alice hits, bob misses. Both opt in. Alice keeps calling; bob stops.
    await at(NOON_SEP_29, async () => {
      await call("POST", "/api/call", { charm: drawn("2026-09-30") });
      const r = await optin(true);
      assert.equal(r.status, 200);
      assert.equal(r.body.optedIn, true);
      assert.equal(store.kv.get("lb_optin:t2_alice"), "1");
      as("bob");
      await optin(true); // opting in before the first call works too
      await call("POST", "/api/call", { charm: miss("2026-09-30") });
      as("carol"); // plays, never opts in
      await call("POST", "/api/call", { charm: drawn("2026-09-30") });
    });
    assert.deepEqual(Object.fromEntries(store.hashes.get("lb_names")), { t2_alice: "alice", t2_bob: "bob" });

    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    as("alice");
    await at(NOON_ET, () => call("POST", "/api/call", { charm: miss("2026-10-01") }));

    let b = (await at(NOON_ET, () => call("GET", "/api/leaderboard"))).body;
    assert.deepEqual(b.streak, [{ username: "alice", score: 2 }, { username: "bob", score: 1 }]);
    assert.deepEqual(b.hits, [{ username: "alice", score: 1 }], "zero scores aren't listed");
    assert.deepEqual(b.me, { streak: { rank: 1, score: 2, of: 2 }, hits: { rank: 1, score: 1, of: 2 } });

    as("bob");
    b = (await at(NOON_ET, () => call("GET", "/api/leaderboard"))).body;
    assert.equal(b.optedIn, true);
    assert.deepEqual(b.me.streak, { rank: 2, score: 1, of: 2 });
    assert.deepEqual(b.me.hits, { rank: 2, score: 0, of: 2 }, "on the board at zero, just not listed");

    as("carol");
    b = (await at(NOON_ET, () => call("GET", "/api/leaderboard"))).body;
    assert.equal(b.optedIn, false);
    assert.equal(b.me, null);
    assert.equal(b.streak.length, 2, "carol hit too but isn't listed");

    // Oct 1 reveal: bob called neither Oct 1 nor Oct 2, so his streak is over.
    await at(REVEAL_OCT_01, () => call("POST", "/internal/scheduler/daily-post"));
    b = (await at(REVEAL_OCT_01, () => call("GET", "/api/leaderboard"))).body;
    assert.deepEqual(b.streak, [{ username: "alice", score: 2 }]);
    assert.deepEqual(b.hits, [{ username: "alice", score: 1 }], "a hit is counted once, at the reveal");
  });

  it("opting in mid-streak picks up the existing streak and settled hits", async () => {
    await at(NOON_SEP_29, () => call("POST", "/api/call", { charm: drawn("2026-09-30") }));
    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    const { body } = await at(NOON_ET, async () => {
      await call("POST", "/api/call", { charm: 0 });
      return optin(true);
    });
    assert.deepEqual(body.streak, [{ username: "alice", score: 2 }]);
    assert.deepEqual(body.hits, [{ username: "alice", score: 1 }]);
  });

  it("opting out removes the user from both boards and forgets the username", async () => {
    await at(NOON_SEP_29, async () => {
      await call("POST", "/api/call", { charm: drawn("2026-09-30") });
      await optin(true);
    });
    await at(REVEAL_SEP_30, () => call("POST", "/internal/scheduler/daily-post"));
    const { status, body } = await at(NOON_ET, () => optin(false));
    assert.equal(status, 200);
    assert.deepEqual({ optedIn: body.optedIn, streak: body.streak, hits: body.hits, me: body.me }, { optedIn: false, streak: [], hits: [], me: null });
    assert.equal(store.kv.get("lb_optin:t2_alice"), "0");
    assert.equal(store.zsets.get("lb_streak").size, 0);
    assert.equal(store.zsets.get("lb_hits").size, 0);
    assert.equal(store.hashes.get("lb_names").size, 0);

    // Still playing after opting out must not put them back.
    await at(NOON_ET, () => call("POST", "/api/call", { charm: 1 }));
    await at(REVEAL_OCT_01, () => call("POST", "/internal/scheduler/daily-post"));
    assert.equal(store.zsets.get("lb_streak").size, 0);
    assert.equal(store.zsets.get("lb_hits").size, 0);
  });

  it("lists at most ten", async () => {
    await at(NOON_SEP_29, async () => {
      for (let i = 0; i < 12; i++) {
        as(`user${String(i).padStart(2, "0")}`);
        await call("POST", "/api/call", { charm: 0 });
        await optin(true);
      }
    });
    const { body } = await at(NOON_SEP_29, () => call("GET", "/api/leaderboard"));
    assert.equal(body.streak.length, 10);
    assert.deepEqual(body.me.streak, { rank: 1, score: 1, of: 12 }, "ties share a place, even off the visible list");
  });
});
