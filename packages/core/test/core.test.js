import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHARMS,
  FORTUNES,
  LUCKY_MOVES,
  MAX_FREEZES,
  SPARKLES,
  THEMED_FORTUNES,
  applyFreeze,
  bestStreak,
  calendarCellLabel,
  callableDay,
  charmButtonLabel,
  computeOutcome,
  currentStreak,
  dayNumber,
  describe as describeOutcome,
  grantMonthlyFreeze,
  hash53,
  monthGrid,
  msUntilNextReveal,
  plural,
  pointsFor,
  revealedDay,
  shareText,
  shiftKey,
  shiftMonth,
  summarize,
  totals,
} from "../index.js";

// ---- helpers -------------------------------------------------------------
/** ms for a wall-clock instant in New York (handles DST by trial). */
function ny(y, m, d, h, min = 0) {
  const guess = Date.UTC(y, m - 1, d, h + 4, min); // EDT offset
  for (const off of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, h + off, min);
    const s = new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", hour12: false });
    if (s.includes(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`) || s.includes(`${h}:${String(min).padStart(2, "0")}`)) return t;
  }
  return guess;
}

// ---- rng -----------------------------------------------------------------
describe("rng", () => {
  it("hash is stable", () => {
    assert.equal(hash53("your lucky day"), hash53("your lucky day"));
    assert.notEqual(hash53("a"), hash53("b"));
  });
});

// ---- outcome -------------------------------------------------------------
describe("outcome", () => {
  it("is deterministic for salt+day and different across days", () => {
    const a = computeOutcome("s", "2026-09-30");
    const b = computeOutcome("s", "2026-09-30");
    assert.deepEqual(a, b);
    const days = Array.from({ length: 60 }, (_, i) => shiftKey("2026-09-30", i));
    const charms = new Set(days.map((d) => computeOutcome("s", d).charm));
    assert.ok(charms.size >= 5, "60 days should hit most charms");
  });

  it("depends on the salt so tomorrow cannot be precomputed", () => {
    const outs = new Set(["a", "b", "c", "d", "e"].map((s) => JSON.stringify(computeOutcome(s, "2026-10-01"))));
    assert.ok(outs.size >= 4);
  });

  it("indexes are in range", () => {
    for (let i = 0; i < 400; i++) {
      const o = computeOutcome("salt", shiftKey("2026-01-01", i));
      assert.ok(o.charm >= 0 && o.charm < CHARMS.length);
      assert.ok(o.sparkle >= 0 && o.sparkle < SPARKLES.length);
      assert.ok(o.fortune >= 0 && o.fortune < THEMED_FORTUNES[o.charm].length);
      assert.ok(o.move >= 0 && o.move < LUCKY_MOVES.length);
    }
  });

  it("200 consecutive days always yield a fortune from the drawn charm's set", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) {
      const o = computeOutcome("salt", shiftKey("2026-09-30", i));
      const d = describeOutcome(o);
      assert.ok(THEMED_FORTUNES[o.charm].includes(d.fortune), `${o.dayKey}: "${d.fortune}" is not a ${d.charm.id} fortune`);
      assert.equal(d.fortune, THEMED_FORTUNES[o.charm][o.fortune]);
      assert.equal(d.charm, CHARMS[o.charm]);
      seen.add(d.fortune);
    }
    assert.ok(seen.size > 60, `200 days should reach well past the old flat list, saw ${seen.size}`);
  });

  it("sparkle distribution roughly matches weights over many days", () => {
    const counts = [0, 0, 0];
    const n = 3000;
    for (let i = 0; i < n; i++) counts[computeOutcome("w", shiftKey("2000-01-01", i)).sparkle]++;
    assert.ok(Math.abs(counts[0] / n - 0.7) < 0.05, `bright ${counts[0] / n}`);
    assert.ok(Math.abs(counts[2] / n - 0.05) < 0.03, `golden ${counts[2] / n}`);
  });

  it("rejects malformed day keys", () => {
    assert.throws(() => computeOutcome("s", "tomorrow"));
  });

  it("points: participation 1x, hit 3x, golden day triples", () => {
    const o = { dayKey: "2026-09-30", charm: 2, sparkle: 2, fortune: 0, move: 0 };
    assert.equal(pointsFor(null, o), 0);
    assert.equal(pointsFor(1, o), 3);
    assert.equal(pointsFor(2, o), 9);
  });
});

// ---- content -------------------------------------------------------------
describe("content", () => {
  it("has enough variety and no duplicates", () => {
    assert.ok(FORTUNES.length >= 60);
    assert.ok(LUCKY_MOVES.length >= 30);
    assert.equal(new Set(FORTUNES).size, FORTUNES.length);
    assert.equal(new Set(LUCKY_MOVES).size, LUCKY_MOVES.length);
    assert.equal(SPARKLES.reduce((a, s) => a + s.weight, 0), 100);
  });

  it("has one themed fortune set per charm, with no fortune repeated anywhere", () => {
    assert.equal(THEMED_FORTUNES.length, CHARMS.length);
    for (const set of THEMED_FORTUNES) assert.equal(set.length, 18);
    const all = THEMED_FORTUNES.flat();
    assert.equal(new Set(all).size, all.length);
  });

  it("never uses money or winning language", () => {
    const bad = /\b(win|winner|prize|cash|money|jackpot|bet|gamble)\b/i;
    for (const line of [...FORTUNES, ...THEMED_FORTUNES.flat(), ...LUCKY_MOVES]) assert.ok(!bad.test(line), line);
  });

  it("no themed fortune shows a charm emoji, so a shared fortune can't give the charm away", () => {
    for (const line of THEMED_FORTUNES.flat()) for (const c of CHARMS) assert.ok(!line.includes(c.emoji), line);
  });
});

// ---- day clock -----------------------------------------------------------
describe("day clock (08:00 America/New_York)", () => {
  it("before 08:00 ET the revealed day is yesterday", () => {
    assert.equal(revealedDay(ny(2026, 9, 30, 7, 59)), "2026-09-29");
    assert.equal(callableDay(ny(2026, 9, 30, 7, 59)), "2026-09-30");
  });

  it("at 08:00 ET the reveal flips", () => {
    assert.equal(revealedDay(ny(2026, 9, 30, 8, 0)), "2026-09-30");
    assert.equal(callableDay(ny(2026, 9, 30, 8, 0)), "2026-10-01");
  });

  it("late evening ET still shows today's reveal", () => {
    assert.equal(revealedDay(ny(2026, 9, 30, 23, 30)), "2026-09-30");
  });

  it("handles the DST fall-back day (Nov 1, 2026)", () => {
    assert.equal(revealedDay(ny(2026, 11, 1, 7, 30)), "2026-10-31");
    assert.equal(revealedDay(ny(2026, 11, 1, 8, 30)), "2026-11-01");
  });

  it("countdown reaches the next reveal", () => {
    const now = ny(2026, 9, 30, 8, 0);
    const ms = msUntilNextReveal(now);
    assert.ok(ms > 23.9 * 3_600_000 && ms <= 24 * 3_600_000, `${ms}`);
    assert.equal(revealedDay(now + ms), "2026-10-01");
    assert.equal(revealedDay(now + ms - 5000), "2026-09-30");
  });

  it("shiftKey crosses month and year boundaries", () => {
    assert.equal(shiftKey("2026-12-31", 1), "2027-01-01");
    assert.equal(shiftKey("2026-03-01", -1), "2026-02-28");
  });

  it("day numbers count from launch", () => {
    assert.equal(dayNumber("2026-09-30", "2026-09-30"), 1);
    assert.equal(dayNumber("2026-10-30", "2026-09-30"), 31);
  });
});

// ---- streaks -------------------------------------------------------------
describe("streaks", () => {
  const h = (days) => Object.fromEntries(days.map((d) => [d, { called: 0 }]));

  it("counts consecutive called days", () => {
    const hist = h(["2026-09-28", "2026-09-29", "2026-09-30"]);
    assert.equal(currentStreak(hist, "2026-09-30"), 3);
  });

  it("survives not having called the current day yet", () => {
    const hist = h(["2026-09-28", "2026-09-29"]);
    assert.equal(currentStreak(hist, "2026-09-30"), 2);
  });

  it("breaks on a two-day gap", () => {
    const hist = h(["2026-09-26", "2026-09-27"]);
    assert.equal(currentStreak(hist, "2026-09-30"), 0);
  });

  it("freeze bridges exactly one missed day", () => {
    const hist = h(["2026-09-27", "2026-09-28", "2026-09-30"]);
    assert.equal(currentStreak(hist, "2026-09-30"), 1);
    const { history, spent } = applyFreeze(hist, "2026-09-30");
    assert.equal(spent, true);
    assert.equal(currentStreak(history, "2026-09-30"), 3);
    assert.equal(applyFreeze(history, "2026-09-30").spent, false, "no double spend");
  });

  it("freeze refuses when there is nothing to bridge", () => {
    assert.equal(applyFreeze(h(["2026-09-30"]), "2026-09-30").spent, false);
    assert.equal(applyFreeze(h(["2026-09-20"]), "2026-09-30").spent, false);
  });

  it("best streak and totals", () => {
    const hist = {
      "2026-09-01": { called: 1, result: 1 },
      "2026-09-02": { called: 2, result: 0 },
      "2026-09-03": { called: 0, result: 0 },
      "2026-09-10": { called: 3, result: 3 },
    };
    assert.equal(bestStreak(hist), 3);
    assert.deepEqual(totals(hist), { calls: 4, hits: 3, hitRate: 0.75 });
  });
});

// ---- monthly freeze --------------------------------------------------------
describe("monthly freeze grant", () => {
  it("the first visit of a month grants one freeze", () => {
    assert.deepEqual(grantMonthlyFreeze({ freezes: 0 }, "2026-10"), { freezes: 1, freezeMonth: "2026-10", granted: true });
    assert.deepEqual(grantMonthlyFreeze({}, "2026-10"), { freezes: 1, freezeMonth: "2026-10", granted: true }, "a pack bought before freezes existed");
  });

  it("a second visit in the same month grants nothing, however often it runs", () => {
    let s = grantMonthlyFreeze({ freezes: 0 }, "2026-10");
    for (let i = 0; i < 5; i++) {
      s = grantMonthlyFreeze(s, "2026-10");
      assert.deepEqual(s, { freezes: 1, freezeMonth: "2026-10", granted: false });
    }
  });

  it("the next month grants again, and a skipped month isn't made up", () => {
    const oct = grantMonthlyFreeze({ freezes: 0 }, "2026-10");
    assert.deepEqual(grantMonthlyFreeze(oct, "2026-11"), { freezes: 2, freezeMonth: "2026-11", granted: true });
    assert.deepEqual(grantMonthlyFreeze(oct, "2027-01"), { freezes: 2, freezeMonth: "2027-01", granted: true });
  });

  it("the cap holds at three banked", () => {
    let s = { freezes: 0 };
    for (const month of ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]) s = grantMonthlyFreeze(s, month);
    assert.equal(MAX_FREEZES, 3);
    assert.deepEqual(s, { freezes: 3, freezeMonth: "2027-02", granted: false });
    assert.equal(grantMonthlyFreeze({ freezes: 7, freezeMonth: "2026-10" }, "2026-11").freezes, 3, "an over-full bank comes back to the cap");
  });

  it("a month visited at the cap is used up: spending later that month isn't topped back up", () => {
    const full = grantMonthlyFreeze({ freezes: 3, freezeMonth: "2026-10" }, "2026-11");
    assert.deepEqual(grantMonthlyFreeze({ ...full, freezes: 2 }, "2026-11"), { freezes: 2, freezeMonth: "2026-11", granted: false });
  });

  it("a month key that goes backwards never grants, so going forward again can't grant twice", () => {
    const nov = grantMonthlyFreeze({ freezes: 1, freezeMonth: "2026-10" }, "2026-11");
    const back = grantMonthlyFreeze(nov, "2026-10");
    assert.deepEqual(back, { freezes: 2, freezeMonth: "2026-11", granted: false });
    assert.deepEqual(grantMonthlyFreeze(back, "2026-11"), { freezes: 2, freezeMonth: "2026-11", granted: false });
  });

  it("is pure and rejects a malformed month", () => {
    const s = Object.freeze({ freezes: 1, freezeMonth: "2026-10" });
    grantMonthlyFreeze(s, "2026-11");
    assert.deepEqual(s, { freezes: 1, freezeMonth: "2026-10" });
    for (const bad of ["2026-13", "2026-1", "October", ""]) assert.throws(() => grantMonthlyFreeze(s, bad));
  });
});

// ---- share ---------------------------------------------------------------
describe("share card", () => {
  const FORTUNE = "Today is a good day to ask.";

  it("leads with the fortune, is spoiler-free and three lines", () => {
    const t = shareText({ dayKey: "2026-10-05", called: 0, result: 3, sparkle: 1, streak: 6, fortune: FORTUNE }, { site: "example.com" });
    const lines = t.split("\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], FORTUNE);
    assert.equal(lines[1], `Your Lucky Day #6 🌟 · Called ${CHARMS[0].emoji} → not today ➰`);
    assert.ok(!t.includes(CHARMS[3].emoji), "must not reveal today's charm");
    assert.equal(lines[2], "Streak 6 · example.com");
  });

  it("marks a hit", () => {
    const t = shareText({ dayKey: "2026-09-30", called: 2, result: 2, sparkle: 0, streak: 1, fortune: FORTUNE });
    assert.equal(t.split("\n")[1], `Your Lucky Day #1 ✨ · Called ${CHARMS[2].emoji} → called it ✅`);
  });

  it("a missed call still gets the fortune and never shows a charm", () => {
    const t = shareText({ dayKey: "2026-10-01", called: null, result: 4, sparkle: 0, streak: 0, fortune: FORTUNE });
    assert.deepEqual(t.split("\n"), [FORTUNE, "Your Lucky Day #2 ✨ · Missed the call, still lucky.", "Streak 0"]);
    for (const c of CHARMS) assert.ok(!t.includes(c.emoji));
  });

  it("never shows a day number below #1 before launch", () => {
    const t = shareText({ dayKey: "2026-09-20", called: 1, result: 1, sparkle: 0, streak: 1, fortune: FORTUNE });
    assert.match(t.split("\n")[1], /^Your Lucky Day #1 /);
  });

  it("appends no site by default or when { site: null } is passed", () => {
    const p = { dayKey: "2026-10-05", called: 0, result: 3, sparkle: 1, streak: 6, fortune: FORTUNE };
    for (const t of [shareText(p), shareText(p, { site: null })]) {
      const lines = t.split("\n");
      assert.equal(lines.length, 3);
      assert.equal(lines[2], "Streak 6");
      assert.ok(!/\w\.\w/.test(t), "must not contain a URL");
    }
  });

  it("never reveals the drawn charm's emoji on a miss, with real themed fortunes", () => {
    for (let i = 0; i < 200; i++) {
      const o = computeOutcome("salt", shiftKey("2026-09-30", i));
      const called = (o.charm + 1 + (i % 5)) % CHARMS.length; // any charm but the drawn one
      const t = shareText({ dayKey: o.dayKey, called, result: o.charm, sparkle: o.sparkle, streak: 1, fortune: describeOutcome(o).fortune });
      assert.equal(t.split("\n").length, 3);
      assert.ok(!t.includes(CHARMS[o.charm].emoji), `${o.dayKey}: ${t}`);
    }
  });
});

// ---- history -------------------------------------------------------------
describe("history", () => {
  // Ten days: nine calls (one still waiting for its reveal), one skipped day.
  const history = {
    "2026-10-01": { called: 0 },
    "2026-10-02": { called: 1 },
    "2026-10-03": { called: 0 },
    "2026-10-05": { called: 3 },
    "2026-10-06": { called: 0 },
    "2026-10-07": { called: 0 },
    "2026-10-08": { called: 2 },
    "2026-10-09": { called: 0 },
    "2026-10-10": { called: 1 },
  };
  const outcomes = {
    "2026-10-01": 0,
    "2026-10-02": 2,
    "2026-10-03": 0,
    "2026-10-04": 4,
    "2026-10-05": 3,
    "2026-10-06": 1,
    "2026-10-07": 5,
    "2026-10-08": 2,
    "2026-10-09": 4,
  };

  it("summarize on a 10-day fixture", () => {
    assert.deepEqual(summarize(history, outcomes, "2026-10-10"), {
      calls: 9,
      hits: 4,
      hitRate: 0.5, // 4 of the 8 decided calls; the pending one doesn't count against it
      currentStreak: 6,
      bestStreak: 6,
      favoriteCharm: 0,
    });
  });

  it("summarize defaults the streak to the latest known day and reads stored results", () => {
    assert.equal(summarize(history, outcomes).currentStreak, 6);
    const stored = { "2026-10-01": { called: 2, result: 2 }, "2026-10-02": { called: 4, result: 1 } };
    assert.deepEqual(summarize(stored), { calls: 2, hits: 1, hitRate: 0.5, currentStreak: 2, bestStreak: 2, favoriteCharm: 2 });
  });

  it("summarize on an empty history", () => {
    assert.deepEqual(summarize({}, {}), { calls: 0, hits: 0, hitRate: 0, currentStreak: 0, bestStreak: 0, favoriteCharm: null });
  });

  it("no favorite charm is picked from days without a call", () => {
    // A first visit records the drawn days; a visit-only or frozen day is not a call.
    const visited = { "2026-10-01": { called: null }, "2026-10-02": { called: null, frozen: true } };
    const sum = summarize(visited, { "2026-10-01": 3, "2026-10-02": 0 }, "2026-10-02");
    assert.equal(sum.favoriteCharm, null);
    assert.equal(sum.calls, 0);
    assert.equal(summarize({}, { "2026-10-01": 3 }, "2026-10-01").favoriteCharm, null);
  });

  it("monthGrid for 2026-10 is a Sunday-first 6-row calendar", () => {
    const grid = monthGrid("2026-10");
    assert.equal(grid.length, 42);
    assert.deepEqual(grid[0], { dayKey: "2026-09-27", weekday: 0, inMonth: false });
    assert.equal(grid.filter((c) => c.inMonth).length, 31);
    assert.deepEqual(grid[4], { dayKey: "2026-10-01", weekday: 4, inMonth: true });
    assert.equal(grid[41].dayKey, "2026-11-07");
    assert.ok(grid.every((c, i) => c.weekday === i % 7));
  });

  it("monthGrid handles a month that starts on Sunday and rejects bad input", () => {
    const grid = monthGrid("2026-11");
    assert.deepEqual(grid[0], { dayKey: "2026-11-01", weekday: 0, inMonth: true });
    assert.equal(grid.filter((c) => c.inMonth).length, 30);
    assert.throws(() => monthGrid("2026-13"));
    assert.throws(() => monthGrid("October"));
  });

  it("shiftMonth pages across year boundaries", () => {
    assert.equal(shiftMonth("2026-10", -1), "2026-09");
    assert.equal(shiftMonth("2026-12", 1), "2027-01");
    assert.equal(shiftMonth("2027-01", -1), "2026-12");
    assert.equal(shiftMonth("2026-10", 0), "2026-10");
  });
});

// ---- format --------------------------------------------------------------
describe("plural", () => {
  it("picks the singular only for exactly one", () => {
    assert.equal(plural(1, "call"), "1 call");
    assert.equal(plural(2, "call"), "2 calls");
    assert.equal(plural(0, "call"), "0 calls");
  });

  it("groups thousands and takes irregular plurals", () => {
    assert.equal(plural(1814, "call"), "1,814 calls");
    assert.equal(plural(1, "person", "people"), "1 person");
    assert.equal(plural(3, "person", "people"), "3 people");
  });
});

// ---- accessible names ------------------------------------------------------
describe("accessible names", () => {
  it("a charm button reads as its name and share of calls", () => {
    assert.equal(charmButtonLabel("Clover", 42), "Clover, 42% called");
    assert.equal(charmButtonLabel("Acorn", 0), "Acorn, 0% called");
  });

  it("a calendar cell reads as the day, what was drawn, what you called, hit or miss", () => {
    assert.equal(calendarCellLabel("2026-10-03", { drew: "Clover", called: "Star" }), "October 3: drew Clover, you called Star, miss");
    assert.equal(calendarCellLabel("2026-10-04", { drew: "Key", called: "Key" }), "October 4: drew Key, you called Key, hit");
    assert.equal(calendarCellLabel("2026-11-01", { drew: "Moon" }), "November 1: drew Moon, no call");
  });

  it("a calendar cell with no draw yet says why", () => {
    assert.equal(calendarCellLabel("2026-10-05", { called: "Moon" }), "October 5: you called Moon, waiting for the spin");
    assert.equal(calendarCellLabel("2026-10-02", { called: "Fish", note: "spin not seen here" }), "October 2: you called Fish, spin not seen here");
    assert.equal(calendarCellLabel("2026-10-02", { note: "streak freeze" }), "October 2: streak freeze");
  });
});
