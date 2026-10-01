// @ts-check
/**
 * Expanded-view sections below the jar: "Your history", "This community" and
 * "Leaderboard". Kept out of ui.js so the inline (feed) bundle doesn't carry them.
 * Each section loads on its own; one failing never blanks the others.
 */
import { showLoginPrompt, showToast } from "@devvit/web/client";
import { THEMED_FORTUNES, calendarCellLabel, monthGrid, plural, shiftMonth, summarize } from "../../../../packages/core/index.js";
import { $, countTile, friendlyDay } from "./ui.js";
import { boardIsEmpty, dayKind } from "./view.js";

/** @param {any} s the latest /api/state payload */
export function loadExtras(s) {
  state = s;
  wire();
  // Show a call the moment it's made; the refetch below confirms it.
  if (hist && s.mode !== "archive" && s.callable.myCall !== null) hist.calls[s.callable.dayKey] = s.callable.myCall;
  renderStats();
  renderCalendar();
  loadHistory();
  loadCommunity();
  loadLeaderboard();
}

/** @type {any} */
let state = null;

async function getJson(path, init) {
  const r = await fetch(path, { ...init, headers: { accept: "application/json", ...(init?.headers || {}) } });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
  return r.json();
}

// ---------------------------------------------------------------------------
// Your history

/** @type {{ calls: Record<string, number>, outcomes: Record<string, number>, fortunes: Record<string, number>, launchDay: string, revealedDay: string, callableDay: string } | null} */
let hist = null;
let calMonth = ""; // "YYYY-MM" on screen
let calDay = ""; // selected dayKey

async function loadHistory() {
  if (!state.signedIn) {
    $("calWrap").hidden = true;
    $("calDetail").textContent = "Sign in to see your history.";
    return;
  }
  try {
    hist = await getJson("/api/history");
  } catch (e) {
    console.error(e);
    if (!hist) $("calDetail").textContent = "Couldn't load your history. Pull to refresh.";
    return;
  }
  if (!calMonth) calMonth = hist.revealedDay.slice(0, 7);
  renderStats();
  renderCalendar();
}

function renderStats() {
  if (!hist) return;
  const calls = hist.calls;
  const mine = Object.fromEntries(Object.entries(calls).map(([d, c]) => [d, { called: c }]));
  const sum = summarize(mine, hist.outcomes, hist.callableDay);
  const decided = Object.keys(calls).some((d) => hist.outcomes[d] !== undefined);
  $("hits").textContent = String(sum.hits);
  countTile("calls", sum.calls, "call");
  $("hitRate").textContent = decided ? `${Math.round(100 * sum.hitRate)}%` : "—";
  $("bestStreak").textContent = String(sum.bestStreak);
  const fav = sum.favoriteCharm === null ? null : state.charms[sum.favoriteCharm];
  $("favorite").textContent = fav ? fav.emoji : "—";
  if (fav) $("favorite").setAttribute("aria-label", fav.name);
}

function renderCalendar() {
  if (!hist) return;
  $("calWrap").hidden = false;
  const [y, m] = calMonth.split("-").map(Number);
  $("calTitle").textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  // Paging is bounded to launch month..current month.
  /** @type {HTMLButtonElement} */ ($("calPrev")).disabled = calMonth <= hist.launchDay.slice(0, 7);
  /** @type {HTMLButtonElement} */ ($("calNext")).disabled = calMonth >= hist.revealedDay.slice(0, 7);

  $("cal").replaceChildren(
    ...monthGrid(calMonth).map((cell) => {
      const b = document.createElement("button");
      b.type = "button";
      const kind = cell.inMonth ? dayKind(cell.dayKey, hist) : "blank";
      const isToday = cell.inMonth && cell.dayKey === hist.revealedDay;
      b.className = `day ${cell.inMonth ? kind : "out"}${isToday ? " today" : ""}${cell.dayKey === calDay ? " on" : ""}`;
      if (isToday) b.setAttribute("aria-current", "date");
      b.disabled = kind === "blank";
      const drawn = hist.outcomes[cell.dayKey];
      const emoji = kind === "blank" ? "" : kind === "pending" ? "…" : state.charms[drawn].emoji;
      const num = document.createElement("span");
      num.className = "dn";
      num.textContent = String(Number(cell.dayKey.slice(8)));
      const em = document.createElement("span");
      em.className = "de";
      em.textContent = emoji;
      const dot = document.createElement("i");
      dot.className = `dot ${kind}`;
      b.append(num, em, dot);
      if (kind !== "blank") {
        const called = hist.calls[cell.dayKey];
        b.setAttribute("aria-label", calendarCellLabel(cell.dayKey, { drew: state.charms[drawn]?.name, called: state.charms[called]?.name }));
        b.setAttribute("aria-pressed", String(cell.dayKey === calDay));
        b.addEventListener("click", () => {
          calDay = cell.dayKey;
          renderCalendar();
        });
      }
      return b;
    }),
  );
  renderDayDetail();
}

function renderDayDetail() {
  const el = $("calDetail");
  if (!calDay || !calDay.startsWith(calMonth)) {
    el.textContent = "Tap a day to see its fortune.";
    return;
  }
  const drawn = hist.outcomes[calDay];
  const called = hist.calls[calDay];
  if (drawn === undefined && called === undefined) {
    el.textContent = "Tap a day to see its fortune.";
    return;
  }
  const head = document.createElement("b");
  const body = document.createElement("span");
  if (drawn === undefined) {
    head.textContent = friendlyDay(calDay);
    body.textContent = ` You called ${state.charms[called].emoji} ${state.charms[called].name}. The spin is at 8:00 am ET.`;
  } else {
    const c = state.charms[drawn];
    head.textContent = `${friendlyDay(calDay)} · ${c.emoji} ${c.name}`;
    const verdict =
      called === undefined ? "No call from you that day." : called === drawn ? `You called it ${c.emoji}.` : `You called ${state.charms[called].emoji}. Not that day.`;
    // The fortune index is within the drawn charm's own set.
    body.textContent = ` ${THEMED_FORTUNES[drawn]?.[hist.fortunes[calDay]] ?? ""} ${verdict}`;
  }
  el.replaceChildren(head, body);
}

function pageMonth(by) {
  if (!hist) return;
  const next = shiftMonth(calMonth, by);
  if (next < hist.launchDay.slice(0, 7) || next > hist.revealedDay.slice(0, 7)) return;
  calMonth = next;
  renderCalendar();
}

// ---------------------------------------------------------------------------
// This community

async function loadCommunity() {
  let c;
  try {
    c = await getJson("/api/community");
  } catch (e) {
    console.error(e);
    $("communityNote").textContent = "Couldn't load community stats.";
    return;
  }
  // Nothing to tabulate yet: one line instead of a row of dashes.
  $("communityStats").hidden = c.totalCalls === 0;
  if (c.totalCalls === 0) {
    $("communityNote").textContent = "No calls yet in this community.";
    return;
  }
  countTile("comCalls", c.totalCalls, "call");
  const chance = `chance is ${Math.round(100 * c.baseline)}%`;
  $("comRate").textContent = c.settledCalls ? `${Math.round(100 * c.hitRate)}%` : "—";
  const top = c.mostCalled === null ? null : state.charms[c.mostCalled];
  $("comCharm").textContent = top ? top.emoji : "—";
  if (top) $("comCharm").setAttribute("aria-label", top.name);
  $("comBest").textContent = c.bestDay ? friendlyDay(c.bestDay.dayKey, null) : "—";
  $("comBestLabel").textContent = c.bestDay ? `best day · ${plural(c.bestDay.hits, "hit")}` : "best day";
  $("communityNote").textContent = c.settledCalls
    ? `${plural(c.totalHits, "call")} landed out of ${c.settledCalls.toLocaleString("en-US")} — ${chance}.`
    : `No spin has been scored here yet — ${chance}.`;
}

// ---------------------------------------------------------------------------
// Leaderboard (opt-in)

/** @type {any} */
let board = null;

async function loadLeaderboard() {
  try {
    board = await getJson("/api/leaderboard");
  } catch (e) {
    console.error(e);
    if (!board) $("lbMe").textContent = "Couldn't load the leaderboard.";
    return;
  }
  renderLeaderboard();
}

function renderLeaderboard() {
  /** @type {HTMLInputElement} */ ($("lbOptin")).checked = board.optedIn;
  // With nobody on either list, one line stands in for two empty boxes.
  const empty = boardIsEmpty(board);
  $("lbEmpty").hidden = !empty;
  $("lbBoards").hidden = empty;
  fillBoard("lbStreak", board.streak, (n) => plural(n, "day"));
  fillBoard("lbHits", board.hits, (n) => plural(n, "hit"));
  const me = board.me;
  if (!board.optedIn) {
    $("lbMe").textContent = "Off by default. Turning it on shows your Reddit username, streak and hits to this community.";
  } else if (me?.streak && me?.hits) {
    $("lbMe").textContent = `You're #${me.streak.rank} of ${me.streak.of} by streak (${plural(me.streak.score, "day")}) and #${me.hits.rank} by called it (${plural(me.hits.score, "hit")}).`;
  } else {
    $("lbMe").textContent = "You're on the leaderboard.";
  }
}

function fillBoard(id, rows, score) {
  const list = $(id);
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No one yet.";
    list.replaceChildren(li);
    return;
  }
  list.replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement("li");
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = `u/${r.username}`;
      const sc = document.createElement("span");
      sc.className = "sc";
      sc.textContent = score(r.score);
      li.append(who, sc);
      return li;
    }),
  );
}

async function setOptin(box) {
  if (!state.signedIn) {
    box.checked = false;
    showLoginPrompt();
    return;
  }
  box.disabled = true;
  try {
    board = await getJson("/api/leaderboard/optin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ show: box.checked }),
    });
    renderLeaderboard();
  } catch (e) {
    box.checked = !box.checked;
    showToast("Couldn't save that. Try again.");
  } finally {
    box.disabled = false;
  }
}

// ---------------------------------------------------------------------------

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  $("calPrev").addEventListener("click", () => pageMonth(-1));
  $("calNext").addEventListener("click", () => pageMonth(1));
  $("lbOptin").addEventListener("change", (ev) => setOptin(/** @type {HTMLInputElement} */ (ev.target)));
}
