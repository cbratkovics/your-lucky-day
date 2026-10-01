// The client's view decisions (src/client/view.js) and the static markup they rely on.
// No DOM here: the modules under test are pure, and the HTML is checked as text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { boardIsEmpty, dayKind, pctText } from "../src/client/view.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
/** The opening tag of the element with this id. */
const tag = (html, id) => html.match(new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";

describe("call buttons", () => {
  it("a logged-out viewer always sees the tally, even before the first call", () => {
    assert.equal(pctText(40, 5, false), "40%");
    assert.equal(pctText(0, 5, false), "0%");
    assert.equal(pctText(0, 0, false), "0%");
  });

  it("a signed-in viewer sees a dash until someone has called", () => {
    assert.equal(pctText(0, 0, true), "—");
    assert.equal(pctText(100, 1, true), "100%");
  });
});

describe("history calendar cells", () => {
  // Launch day is Sep 30; a test community also has a spin and a call from before it.
  const hist = {
    launchDay: "2026-09-30",
    revealedDay: "2026-10-03",
    calls: { "2026-09-28": 1, "2026-10-01": 2, "2026-10-02": 4, "2026-10-04": 0 },
    outcomes: { "2026-09-28": 1, "2026-09-29": 3, "2026-09-30": 5, "2026-10-01": 2, "2026-10-02": 0 },
  };

  it("days before launch are blank, so they are not tappable", () => {
    assert.equal(dayKind("2026-09-28", hist), "blank", "even with a call and a draw on record");
    assert.equal(dayKind("2026-09-29", hist), "blank");
    assert.equal(dayKind("2026-09-01", hist), "blank");
  });

  it("launch day onward: hit, miss, no call, pending, nothing yet", () => {
    assert.equal(dayKind("2026-09-30", hist), "none");
    assert.equal(dayKind("2026-10-01", hist), "hit");
    assert.equal(dayKind("2026-10-02", hist), "miss");
    assert.equal(dayKind("2026-10-04", hist), "pending");
    assert.equal(dayKind("2026-10-03", hist), "blank", "revealed, but its post hasn't recorded the draw");
    assert.equal(dayKind("2026-10-05", hist), "blank");
  });
});

describe("leaderboard empty state", () => {
  it("is shown only when both lists are empty", () => {
    assert.equal(boardIsEmpty({ streak: [], hits: [] }), true);
    assert.equal(boardIsEmpty({ streak: [{ username: "alice", score: 2 }], hits: [] }), false);
    assert.equal(boardIsEmpty({ streak: [], hits: [{ username: "alice", score: 1 }] }), false);
  });
});

describe("markup", () => {
  const game = read("public/game.html");
  const inline = read("public/index.html");
  const css = read("public/styles.css");

  it("the countdown is never announced: it ticks every second", () => {
    for (const html of [game, inline]) assert.match(tag(html, "countdown"), /aria-live="off"/);
  });

  it("the expanded view has its empty states in place, hidden until needed", () => {
    assert.match(tag(game, "lbEmpty"), /\bhidden\b/);
    assert.ok(game.includes(">Nobody on the board yet — be first<"));
    assert.match(tag(game, "lbBoards"), /\bhidden\b/, "no blank boxes before the leaderboard loads");
    assert.match(tag(game, "communityStats"), /\bhidden\b/);
  });

  it("buttons keep a visible focus ring and today's cell has its ring", () => {
    assert.match(css, /button:focus-visible[^{]*\{[^}]*outline: 3px solid/);
    assert.ok(!/outline:\s*(none|0)\b/.test(css), "nothing removes an outline");
    assert.match(css, /\.day\.today \{[^}]*box-shadow/);
  });
});
