// Static checks on the site this worker serves (apps/web). They live here because
// everything under apps/web is deployed as an asset, test files included.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(new URL(`../../web/${path}`, import.meta.url), "utf8");
const html = read("index.html");
const css = read("styles.css");
const app = read("app.js");
/** The opening tag of the element with this id. */
const tag = (id) => html.match(new RegExp(`<[a-z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";

describe("site markup", () => {
  it("the countdown is never announced: it ticks every second", () => {
    assert.match(tag("countdown"), /aria-live="off"/);
    const clock = html.match(/<div class="clock"[^>]*>/)?.[0] ?? "";
    assert.ok(clock && !clock.includes("aria-live"), "and it doesn't sit inside a live region");
  });

  it("every id the app looks up exists in the page", () => {
    const ids = [...app.matchAll(/\$\("([A-Za-z]+)"\)/g)].map((m) => m[1]);
    assert.ok(ids.length > 40);
    for (const id of ids) assert.ok(tag(id), `#${id}`);
  });

  it("an empty community is one line, not a row of dashes", () => {
    assert.ok(tag("comStats"), "the tiles can be hidden as a group");
    assert.ok(app.includes('"No calls yet in this community."'));
  });

  it("first visit: hit rate and favorite charm start as a dash, with the legend in place", () => {
    for (const id of ["hitRate", "favorite"]) assert.ok(html.includes(`id="${id}">—<`), `#${id}`);
    assert.match(html, /<p class="cal-legend">/);
  });

  it("buttons keep a visible focus ring and today's cell has its ring", () => {
    assert.match(css, /button:focus-visible \{[^}]*outline: 3px solid/);
    assert.ok(!/outline:\s*(none|0)\b/.test(css), "nothing removes an outline");
    assert.match(css, /\.cal-day\.today \{[^}]*box-shadow/);
  });
});
