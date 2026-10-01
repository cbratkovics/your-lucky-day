// @ts-check
/**
 * Shared client logic for both entrypoints.
 *   mode "inline"   — the post as seen in the feed: tap-only, fits without scrolling
 *   mode "expanded" — full view after tapping "More"
 *
 * The server decides whether a post is "live" (today's spin, call grid) or an
 * "archive" (an older post showing its own day, nothing to call).
 */
import { connectRealtime, context, requestExpandedMode, showLoginPrompt, showShareSheet, showToast } from "@devvit/web/client";
import { plural, shareText } from "../../../../packages/core/index.js";

export const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

/**
 * @param {"inline"|"expanded"} mode
 * @param {(s: any) => void} [onState] called with each fresh state; the expanded view loads its extra sections here
 */
export async function boot(mode, onState) {
  let s = await fetchState();
  if (!s) return;
  render(s, mode, onState);
  onState?.(s);
  if (s.mode === "archive") return; // nothing to count down to or call
  subscribe(s.callable.channel, (msg) => {
    if (s.mode !== "archive" && msg?.type === "tally" && msg.dayKey === s.callable.dayKey) {
      s.callable.tallies = msg.tallies;
      renderCall(s, mode, onState);
    }
  });
  // Countdown + reveal flip.
  const timer = setInterval(async () => {
    s.callable.msUntilReveal -= 1000;
    renderCountdown(s);
    if (s.callable.msUntilReveal <= 0) {
      const fresh = await fetchState();
      if (fresh) {
        s = fresh;
        render(s, mode, onState);
        onState?.(s);
        // This post's day is over once the next spin is out.
        if (s.mode === "archive") clearInterval(timer);
      }
    }
  }, 1000);
}

async function fetchState() {
  try {
    const r = await fetch("/api/state", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    $("fortune").textContent = "Couldn't load today's spin. Pull to refresh.";
    console.error(e);
    return null;
  }
}

let subscribed = "";
function subscribe(channel, onMessage) {
  if (subscribed === channel) return;
  subscribed = channel;
  try {
    connectRealtime({ channel, onMessage });
  } catch (e) {
    console.warn("realtime unavailable", e);
  }
}

/**
 * "Wednesday, Sep 30" for a dayKey; pass null for just "Sep 30".
 * @param {string} dayKey
 * @param {"long"|"short"|null} [weekday]
 */
export function friendlyDay(dayKey, weekday = "long") {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { ...(weekday ? { weekday } : {}), month: "short", day: "numeric", timeZone: "UTC" });
}

/** A stat tile whose label agrees with its number: "1 call", "2 calls". */
export function countTile(id, n, one, many) {
  const [num, ...noun] = plural(n, one, many).split(" ");
  $(id).textContent = num;
  $(`${id}Label`).textContent = noun.join(" ");
}

// ---------------------------------------------------------------------------

function render(s, mode, onState) {
  const archive = s.mode === "archive";
  const o = s.revealed.outcome;
  document.documentElement.style.setProperty("--charm-hue", String(o.charm.hue));
  $("dayNumber").textContent = archive ? `Day ${s.dayNumber} · ${friendlyDay(s.revealed.dayKey, null)}` : `Day ${s.dayNumber}`;
  $("sparkleName").textContent = `${o.sparkle.glyph} ${o.sparkle.name}`;
  $("charmBig").textContent = o.charm.emoji;
  $("charmName").textContent = o.charm.name;
  $("fortune").textContent = o.fortune;
  if ($("move")) $("move").textContent = o.move;
  if ($("revealLead")) $("revealLead").textContent = archive ? `On ${friendlyDay(s.revealed.dayKey)} the world drew` : "Today the world drew";

  const v = $("verdict");
  if (s.revealed.myCall !== null) {
    const hit = s.revealed.myCall === s.revealed.charmIndex;
    v.hidden = false;
    v.className = `verdict ${hit ? "hit" : ""}`;
    const mine = s.charms[s.revealed.myCall].emoji;
    if (archive) v.textContent = hit ? `You called it ${mine}` : `You called ${mine}. Not that day — still lucky.`;
    else v.textContent = hit ? `You called it ${mine}` : `You called ${mine}. Not today — still lucky.`;
  } else if (archive && s.signedIn) {
    v.hidden = false;
    v.className = "verdict quiet";
    v.textContent = "You didn't call this one.";
  } else v.hidden = true;

  // An archived post shows its day and points at the newest post instead of taking calls.
  $("callSection").hidden = archive;
  $("archiveNote").hidden = !archive;
  if (!archive) {
    renderCall(s, mode, onState);
    renderCountdown(s);
  }

  if (mode === "expanded") {
    $("streak").textContent = String(s.me.streak);
    $("hits").textContent = String(s.me.hits);
    countTile("calls", s.me.calls, "call");
    $("jarCount").textContent = `${plural(s.jar.total, "call")} here`;
    $("jarNext").textContent = s.jar.next
      ? `${(s.jar.next.calls - s.jar.total).toLocaleString()} more until "${s.jar.next.unlock}" ${s.jar.next.emoji} unlocks for this community.`
      : "Every milestone unlocked.";
    $("jarUnlocked").textContent = s.jar.unlocked.join(" ");
    const total = s.revealed.tallies.reduce((a, b) => a + b, 0);
    if (total) {
      $("revealTally").textContent =
        `${plural(total, "person", "people")} called it here · ` + s.charms.map((c, i) => `${c.emoji} ${Math.round((100 * s.revealed.tallies[i]) / total)}%`).join("  ");
    } else $("revealTally").textContent = archive ? "Nobody called this one here." : "Nobody called this one here. Be first tomorrow.";
  }
  wireButtons(s, mode);
}

function renderCountdown(s) {
  const el = $("countdown");
  if (!el) return;
  const sec = Math.max(0, Math.floor(s.callable.msUntilReveal / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  el.textContent = `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}

function renderCall(s, mode, onState) {
  const grid = $("charms");
  const total = s.callable.tallies.reduce((a, b) => a + b, 0);
  grid.replaceChildren(
    ...s.charms.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `charm ${s.callable.myCall === i ? "selected" : ""}`;
      b.style.setProperty("--h", String(c.hue));
      b.setAttribute("aria-pressed", String(s.callable.myCall === i));
      const pct = total ? Math.round((100 * s.callable.tallies[i]) / total) : 0;
      b.innerHTML = `<span class="ce">${c.emoji}</span><span class="cl">${c.name}</span><span class="cp">${total ? pct + "%" : "—"}</span><span class="cb"><i style="width:${pct}%"></i></span>`;
      b.addEventListener("click", () => makeCall(s, i, mode, onState));
      return b;
    }),
  );
  const st = $("callStatus");
  if (!s.signedIn) st.textContent = "Sign in to call a charm — everyone here shares one spin.";
  else if (s.callable.myCall === null) st.textContent = `No call yet for tomorrow. ${plural(total, "person", "people")} ${total === 1 ? "has" : "have"} called.`;
  else st.textContent = `You called ${s.charms[s.callable.myCall].emoji} ${s.charms[s.callable.myCall].name} for tomorrow. ${plural(total, "call")} so far.`;
}

async function makeCall(s, i, mode, onState) {
  if (!s.signedIn) {
    showLoginPrompt();
    return;
  }
  const before = s.callable.myCall;
  s.callable.myCall = i;
  renderCall(s, mode, onState);
  try {
    const r = await fetch("/api/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ charm: i }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    s.callable.tallies = data.tallies;
    if (before === null) {
      s.jar.total += 1;
      s.me.streak = Math.max(1, s.me.streak);
    }
    render(s, mode, onState);
    onState?.(s); // history, community totals and the leaderboard all move with a call
    showToast({ text: `Called ${s.charms[i].emoji} ${s.charms[i].name}. See you at 8am ET.`, appearance: "success" });
  } catch (e) {
    s.callable.myCall = before;
    renderCall(s, mode, onState);
    showToast("Couldn't save that call. Try again.");
  }
}

let wired = false;
function wireButtons(s, mode) {
  if (wired) return;
  wired = true;
  const more = $("moreBtn");
  if (more) more.addEventListener("click", (ev) => requestExpandedMode(ev, "game"));
  const share = $("shareBtn");
  if (share)
    share.addEventListener("click", () => {
      const text = shareText(
        {
          dayKey: s.revealed.dayKey,
          called: s.revealed.myCall,
          result: s.revealed.charmIndex,
          sparkle: ["bright", "silver", "golden"].indexOf(s.revealed.outcome.sparkle.id),
          streak: s.me.streak,
          fortune: s.revealed.outcome.fortune,
        },
        { site: null },
      );
      showShareSheet({ text, post: context.postId }).catch(() => {});
    });
}
