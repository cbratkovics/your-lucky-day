// @ts-check
import { CONFIG } from "./config.js";
import {
  CHARMS,
  LAUNCH_DAY,
  MILESTONES,
  SPARKLES,
  applyFreeze,
  callableDay,
  computeOutcome,
  currentStreak,
  dayNumber,
  describe,
  localParts,
  monthGrid,
  msUntilNextReveal,
  plural,
  pointsFor,
  revealedDay,
  shareText,
  shiftMonth,
  summarize,
} from "./core/index.js";

// ---------------------------------------------------------------------------
// Storage (per-browser; the server never sees any of it except the random id)

const KEY = "yld:v1";
/**
 * `history` is the player's own record per day (see core/streak.js). `days` is
 * what was drawn on every day this browser saw, called or not: the charm index
 * and the fortune text, so the calendar can show days the player only visited.
 * @type {{ player: string, history: Record<string, any>, days: Record<string, { charm: number, fortune: string }>, points: number, unlock?: string, skin?: string, freezes: number, freezeMonth?: string }}
 */
let state = load();

function load() {
  const fresh = { player: crypto.randomUUID(), history: {}, days: {}, points: 0, freezes: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw);
    return { ...fresh, ...parsed };
  } catch {
    return fresh;
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode etc. — the page still works for this visit */
  }
}

// ---------------------------------------------------------------------------
// Skins (charm pack). Skin 0 is the free default.

const SKINS = [
  { id: "classic", name: "Classic", emojis: CHARMS.map((c) => c.emoji) },
  { id: "gems", name: "Gemstone", emojis: ["💚", "💛", "💙", "🧡", "💜", "🤎"] },
  { id: "bakery", name: "Bakery", emojis: ["🥐", "🍩", "🥯", "🥨", "🧁", "🍪"] },
  { id: "tide", name: "Tide", emojis: ["🐚", "🌊", "🐠", "⚓", "🌕", "🪸"] },
];
const hasPack = () => Boolean(state.unlock);
const skin = () => (hasPack() && SKINS.find((s) => s.id === state.skin)) || SKINS[0];
const emojiFor = (i) => skin().emojis[i];

// ---------------------------------------------------------------------------
// DOM

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const el = {
  countdown: $("countdown"), previewNote: $("previewNote"),
  dayNumber: $("dayNumber"), sparkleName: $("sparkleName"), charmGlow: $("charmGlow"), charmBig: $("charmBig"),
  charmName: $("charmName"), fortune: $("fortune"), move: $("move"), verdict: $("verdict"), revealTally: $("revealTally"),
  charms: $("charms"), callStatus: $("callStatus"),
  jarCount: $("jarCount"), jarBar: $("jarBar"), jarFill: $("jarFill"), jarNext: $("jarNext"), jarUnlocked: $("jarUnlocked"),
  streak: $("streak"), best: $("best"), hits: $("hits"), points: $("points"),
  calls: $("calls"), callsLabel: $("callsLabel"), hitRate: $("hitRate"), favorite: $("favorite"),
  calPrev: /** @type {HTMLButtonElement} */ ($("calPrev")), calNext: /** @type {HTMLButtonElement} */ ($("calNext")),
  calTitle: $("calTitle"), cal: $("cal"), calDetail: $("calDetail"),
  community: $("community"), comCalls: $("comCalls"), comCallsLabel: $("comCallsLabel"), comRate: $("comRate"),
  comCharm: $("comCharm"), comBest: $("comBest"), comBestLabel: $("comBestLabel"), communityNote: $("communityNote"),
  shareBtn: $("shareBtn"), copyBtn: $("copyBtn"), freezeBtn: $("freezeBtn"), shareDone: $("shareDone"),
  shareReddit: /** @type {HTMLAnchorElement} */ ($("shareReddit")), shareX: /** @type {HTMLAnchorElement} */ ($("shareX")),
  skins: $("skins"), buyBtn: /** @type {HTMLAnchorElement} */ ($("buyBtn")), packStatus: $("packStatus"), packPrice: $("packPrice"),
  makerLink: /** @type {HTMLAnchorElement} */ ($("makerLink")),
};

/** @type {any} */
let today = null; // last /api/today payload
/** @type {any} */
let community = null; // last /api/community payload; null hides the section
let preview = false;
let calMonth = ""; // "YYYY-MM" shown in the history calendar
let calDay = ""; // dayKey selected in it

// ---------------------------------------------------------------------------
// API with preview fallback

async function api(path, init) {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body: await res.json().catch(() => null) });
  return res.json();
}

function previewToday(now) {
  const revealed = revealedDay(now);
  const callable = callableDay(now);
  return {
    revealed: { dayKey: revealed, outcome: describe(computeOutcome(CONFIG.previewSalt, revealed)), tallies: [412, 388, 201, 296, 340, 177] },
    callable: { dayKey: callable, tallies: [120, 98, 64, 77, 101, 45], msUntilReveal: msUntilNextReveal(now) },
    jar: { total: 1814, next: MILESTONES[2], unlocked: MILESTONES.slice(0, 2).map((m) => m.emoji) },
  };
}

async function loadToday() {
  try {
    today = await api("/api/today");
    preview = false;
  } catch {
    today = previewToday(Date.now());
    preview = true;
  }
  el.previewNote.hidden = !preview;
  if (preview) community = null;
  else loadCommunity();
  reconcileHistory();
  render();
}

async function loadCommunity() {
  try {
    community = await api("/api/community");
  } catch {
    community = null;
  }
  renderCommunity();
}

// ---------------------------------------------------------------------------
// History reconciliation: when a day we called gets revealed, record the result.

function reconcileHistory() {
  const { dayKey, outcome } = today.revealed;
  const rec = state.history[dayKey];
  const resultIdx = CHARMS.findIndex((c) => c.id === outcome.charm.id);
  const sparkleIdx = SPARKLES.findIndex((s) => s.id === outcome.sparkle.id);
  if (rec && rec.called !== null && rec.result === undefined) {
    rec.result = resultIdx;
    state.points += pointsFor(rec.called, { dayKey, charm: resultIdx, sparkle: sparkleIdx, fortune: 0, move: 0 });
    save();
  }
  // Remember what was drawn on every day we see, called or not, for the history
  // calendar. A preview spin is a sample, not a real day.
  if (!preview && !state.days[dayKey]) {
    state.days[dayKey] = { charm: resultIdx, fortune: outcome.fortune };
    save();
  }
  // Monthly freeze grant for pack owners.
  if (hasPack()) {
    const p = localParts(Date.now());
    const month = `${p.y}-${String(p.m).padStart(2, "0")}`;
    if (state.freezeMonth !== month) {
      state.freezeMonth = month;
      state.freezes = Math.min((state.freezes || 0) + 1, 3);
      save();
    }
  }
}

// ---------------------------------------------------------------------------
// Render

function render() {
  renderReveal();
  renderCall();
  renderJar();
  renderCommunity();
  renderYou();
  renderHistory();
  renderPack();
}

/** A stat tile whose label agrees with its number: "1 call", "2 calls". */
function countTile(numEl, labelEl, n, one, many) {
  const [num, ...noun] = plural(n, one, many).split(" ");
  numEl.textContent = num;
  labelEl.textContent = noun.join(" ");
}

function renderReveal() {
  const { dayKey, outcome, tallies } = today.revealed;
  const charmIdx = CHARMS.findIndex((c) => c.id === outcome.charm.id);
  const n = dayNumber(dayKey, LAUNCH_DAY);
  el.dayNumber.textContent = n >= 1 ? `Day ${n}` : "Preview";
  el.sparkleName.textContent = `${outcome.sparkle.glyph} ${outcome.sparkle.name}`;
  document.documentElement.style.setProperty("--charm-hue", String(outcome.charm.hue));
  el.charmBig.textContent = emojiFor(charmIdx);
  el.charmBig.setAttribute("aria-label", `Today's charm: ${outcome.charm.name}`);
  if (!el.charmBig.classList.contains("spin")) requestAnimationFrame(() => el.charmBig.classList.add("spin"));
  el.charmName.textContent = outcome.charm.name;
  el.fortune.textContent = outcome.fortune;
  el.move.textContent = outcome.move;

  const rec = state.history[dayKey];
  if (rec && rec.called !== null && rec.called !== undefined) {
    const hit = rec.called === charmIdx;
    el.verdict.hidden = false;
    el.verdict.className = `verdict ${hit ? "hit" : ""}`;
    el.verdict.textContent = hit
      ? `You called it ${emojiFor(rec.called)} — +${pointsFor(rec.called, { dayKey, charm: charmIdx, sparkle: SPARKLES.findIndex((s) => s.id === outcome.sparkle.id), fortune: 0, move: 0 })} sparkle`
      : `You called ${emojiFor(rec.called)}. Not today — still lucky.`;
  } else {
    el.verdict.hidden = true;
  }

  const total = tallies.reduce((a, b) => a + b, 0);
  el.revealTally.replaceChildren(
    ...(total
      ? CHARMS.map((c, i) => {
          const s = document.createElement("span");
          s.innerHTML = `${emojiFor(i)} <b>${Math.round((100 * tallies[i]) / total)}%</b>`;
          return s;
        })
      : []),
  );
  if (total) {
    const lead = document.createElement("span");
    lead.textContent = `${plural(total, "person", "people")} called it`;
    el.revealTally.prepend(lead);
  }
}

function renderCall() {
  const { dayKey, tallies } = today.callable;
  const mine = state.history[dayKey]?.called;
  const total = tallies.reduce((a, b) => a + b, 0);
  el.charms.replaceChildren(
    ...CHARMS.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `charm ${mine === i ? "selected" : ""}`;
      b.style.setProperty("--h", String(c.hue));
      b.setAttribute("aria-pressed", String(mine === i));
      const pct = total ? Math.round((100 * tallies[i]) / total) : 0;
      b.innerHTML = `<span class="charm-emoji">${emojiFor(i)}</span><span class="charm-label">${c.name}</span><span class="charm-pct">${total ? pct + "%" : "—"}</span><span class="charm-bar"><i style="width:${pct}%"></i></span>`;
      b.addEventListener("click", () => makeCall(i));
      return b;
    }),
  );
  el.callStatus.textContent =
    mine === undefined || mine === null
      ? `No call yet for ${friendlyDay(dayKey)}.`
      : `You called ${emojiFor(mine)} ${CHARMS[mine].name} for ${friendlyDay(dayKey)}. ${plural(total, "call")} so far.`;
}

function renderJar() {
  const { total, next, unlocked } = today.jar;
  el.jarCount.textContent = plural(total, "call");
  const prev = [...MILESTONES].reverse().find((m) => m.calls <= total)?.calls ?? 0;
  const pct = next ? Math.min(100, Math.round((100 * (total - prev)) / (next.calls - prev))) : 100;
  el.jarFill.style.width = `${pct}%`;
  el.jarBar.setAttribute("aria-valuenow", String(pct));
  el.jarNext.textContent = next
    ? `${plural(next.calls - total, "more call")} until "${next.unlock}" ${next.emoji} unlocks for everyone.`
    : "Every milestone unlocked. You did that together.";
  el.jarUnlocked.textContent = unlocked.join(" ");
}

function renderCommunity() {
  el.community.hidden = !community;
  if (!community) return;
  const c = community;
  countTile(el.comCalls, el.comCallsLabel, c.totalCalls, "call");
  el.comRate.textContent = c.settledCalls ? `${Math.round(100 * c.hitRate)}%` : "—";
  el.comCharm.textContent = c.mostCalled === null ? "—" : emojiFor(c.mostCalled);
  if (c.mostCalled !== null) el.comCharm.setAttribute("aria-label", CHARMS[c.mostCalled].name);
  el.comBest.textContent = c.bestDay ? friendlyDay(c.bestDay.dayKey, { month: "short", day: "numeric" }) : "—";
  el.comBestLabel.textContent = c.bestDay ? `best day · ${plural(c.bestDay.hits, "hit")}` : "best day";
  const chance = `chance is ${Math.round(100 * c.baseline)}%`;
  el.communityNote.textContent = c.settledCalls
    ? `${plural(c.totalHits, "call")} landed out of ${c.settledCalls.toLocaleString("en-US")} — ${chance}.`
    : `No spin has been scored yet — ${chance}.`;
}

/** What was drawn on each day this browser has seen: dayKey → charm index. */
function knownOutcomes() {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [day, rec] of Object.entries(state.history)) if (rec.result !== undefined) out[day] = rec.result;
  for (const [day, rec] of Object.entries(state.days)) out[day] = rec.charm;
  return out;
}

function renderYou() {
  const through = today.revealed.dayKey;
  const sum = summarize(state.history, knownOutcomes(), through);
  el.streak.textContent = String(sum.currentStreak);
  el.best.textContent = String(sum.bestStreak);
  el.hits.textContent = String(sum.hits);
  el.points.textContent = String(state.points);
  const canFreeze = hasPack() && state.freezes > 0 && applyFreeze(state.history, through).spent;
  el.freezeBtn.hidden = !canFreeze;
  el.freezeBtn.textContent = `Use streak freeze (${state.freezes})`;

  const text = todayShareText();
  const title = text.split("\n")[0];
  el.shareReddit.href = `https://www.reddit.com/r/YourLuckyDay/submit?title=${encodeURIComponent(title)}&text=${encodeURIComponent(text)}`;
  el.shareX.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  el.shareBtn.hidden = !navigator.share;
}

function renderPack() {
  el.packPrice.textContent = CONFIG.charmPackPrice;
  el.buyBtn.href = CONFIG.polarCheckoutUrl;
  el.buyBtn.hidden = hasPack();
  el.makerLink.href = CONFIG.makerUrl;
  el.makerLink.textContent = CONFIG.makerName;
  el.skins.replaceChildren(
    ...SKINS.map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `skin ${skin().id === s.id ? "active" : ""}`;
      b.disabled = !hasPack() && s.id !== "classic";
      b.innerHTML = `${s.emojis.slice(0, 3).join("")} <span>${s.name}</span>`;
      b.addEventListener("click", () => {
        state.skin = s.id;
        save();
        render();
      });
      return b;
    }),
  );
  if (hasPack()) {
    el.packStatus.hidden = false;
    el.packStatus.textContent = "Charm pack unlocked on this device. Thank you for keeping the lights on.";
  }
}

// ---------------------------------------------------------------------------
// History: personal stats and a month calendar, all from this browser's storage.

function renderHistory() {
  const outcomes = knownOutcomes();
  const sum = summarize(state.history, outcomes, today.revealed.dayKey);
  countTile(el.calls, el.callsLabel, sum.calls, "call");
  const decided = Object.entries(state.history).some(([day, rec]) => rec.called !== null && rec.called !== undefined && outcomes[day] !== undefined);
  el.hitRate.textContent = decided ? `${Math.round(100 * sum.hitRate)}%` : "—";
  el.favorite.textContent = sum.favoriteCharm === null ? "—" : emojiFor(sum.favoriteCharm);
  if (sum.favoriteCharm !== null) el.favorite.setAttribute("aria-label", CHARMS[sum.favoriteCharm].name);

  // Paging is bounded to launch month..current month.
  const { min, max } = calendarBounds();
  if (!calMonth || calMonth < min || calMonth > max) calMonth = max;
  const [y, m] = calMonth.split("-").map(Number);
  el.calTitle.textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  el.calPrev.disabled = calMonth <= min;
  el.calNext.disabled = calMonth >= max;

  el.cal.replaceChildren(
    ...monthGrid(calMonth).map((cell) => {
      const b = document.createElement("button");
      b.type = "button";
      const kind = cell.inMonth ? dayKind(cell.dayKey, outcomes) : "blank";
      b.className = `cal-day ${cell.inMonth ? kind : "out"}${cell.dayKey === calDay ? " on" : ""}`;
      b.disabled = kind === "blank";
      const num = document.createElement("span");
      num.className = "cal-num";
      num.textContent = String(Number(cell.dayKey.slice(8)));
      const emoji = document.createElement("span");
      emoji.className = "cal-emoji";
      emoji.textContent = DAY_MARK[kind] ?? emojiFor(outcomes[cell.dayKey]);
      const dot = document.createElement("i");
      dot.className = `dot ${kind}`;
      b.append(num, emoji, dot);
      if (kind !== "blank") {
        const drawn = outcomes[cell.dayKey];
        b.setAttribute("aria-label", `${friendlyDay(cell.dayKey)}: ${drawn === undefined ? "" : `${CHARMS[drawn].name}, `}${DAY_LABEL[kind]}`);
        b.setAttribute("aria-pressed", String(cell.dayKey === calDay));
        b.addEventListener("click", () => {
          calDay = cell.dayKey;
          renderHistory();
        });
      }
      return b;
    }),
  );
  renderDayDetail(outcomes);
}

function calendarBounds() {
  const max = today.revealed.dayKey.slice(0, 7);
  const launch = LAUNCH_DAY.slice(0, 7);
  return { min: launch < max ? launch : max, max };
}

/**
 * hit / miss / none (drawn, no call) / pending (called, not drawn yet) /
 * unseen (called, but this browser never saw that spin) / frozen / blank.
 */
function dayKind(dayKey, outcomes) {
  const rec = state.history[dayKey];
  const called = rec?.called ?? null;
  const drawn = outcomes[dayKey];
  if (drawn !== undefined) return called === null ? "none" : called === drawn ? "hit" : "miss";
  if (called !== null) return dayKey > today.revealed.dayKey ? "pending" : "unseen";
  return rec?.frozen ? "frozen" : "blank";
}

// What a cell shows when it isn't the drawn charm.
const DAY_MARK = { pending: "…", unseen: "?", frozen: "🧊", blank: "" };
const DAY_LABEL = { hit: "you called it", miss: "not that day", none: "no call", pending: "waiting for the spin", unseen: "spin not seen here", frozen: "streak freeze" };

function renderDayDetail(outcomes) {
  const kind = calDay && calDay.startsWith(calMonth) ? dayKind(calDay, outcomes) : "blank";
  if (kind === "blank") {
    el.calDetail.textContent = "Tap a day to see its fortune.";
    return;
  }
  const called = state.history[calDay]?.called ?? null;
  const mine = called === null ? "" : `${emojiFor(called)} ${CHARMS[called].name}`;
  const head = document.createElement("b");
  const body = document.createElement("span");
  head.textContent = friendlyDay(calDay);
  if (kind === "pending") body.textContent = ` You called ${mine}. The spin is at 8:00 am ET.`;
  else if (kind === "unseen") body.textContent = ` You called ${mine}, but this browser wasn't open for that spin.`;
  else if (kind === "frozen") body.textContent = " Streak freeze. Your streak carried through.";
  else {
    const drawn = outcomes[calDay];
    head.textContent = `${friendlyDay(calDay)} · ${emojiFor(drawn)} ${CHARMS[drawn].name}`;
    // Days recorded before 0.2 have no stored fortune; the charm's own line stands in.
    const stored = state.days[calDay]?.fortune;
    const fortune = typeof stored === "string" ? stored : CHARMS[drawn].blurb;
    const verdict = kind === "none" ? "No call from you that day." : kind === "hit" ? `You called it ${emojiFor(drawn)}.` : `You called ${emojiFor(called)}. Not that day.`;
    body.textContent = ` ${fortune} ${verdict}`;
  }
  el.calDetail.replaceChildren(head, body);
}

function pageMonth(by) {
  const next = shiftMonth(calMonth, by);
  const { min, max } = calendarBounds();
  if (next < min || next > max) return;
  calMonth = next;
  renderHistory();
}

/** @param {Intl.DateTimeFormatOptions} [parts] */
function friendlyDay(dayKey, parts = { weekday: "long", month: "short", day: "numeric" }) {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { ...parts, timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Actions

async function makeCall(i) {
  const dayKey = today.callable.dayKey;
  const before = state.history[dayKey]?.called;
  state.history[dayKey] = { ...(state.history[dayKey] || {}), called: i };
  save();
  if (!preview) {
    try {
      const r = await api("/api/call", { method: "POST", body: JSON.stringify({ player: state.player, charm: i }) });
      today.callable.tallies = r.tallies;
      if (r.dayKey !== dayKey) {
        // The reveal happened while the page was open; refresh everything.
        await loadToday();
        return;
      }
    } catch {
      el.callStatus.textContent = "Couldn't reach the server. Your call is saved here and will show once you're back online.";
    }
  } else {
    const t = today.callable.tallies;
    if (before !== undefined && before !== null) t[before] = Math.max(0, t[before] - 1);
    t[i] += 1;
  }
  render();
}

/** Spoiler-free share card for the currently revealed day. */
function todayShareText() {
  const { dayKey, outcome } = today.revealed;
  return shareText(
    {
      dayKey,
      called: state.history[dayKey]?.called ?? null,
      result: CHARMS.findIndex((c) => c.id === outcome.charm.id),
      sparkle: SPARKLES.findIndex((s) => s.id === outcome.sparkle.id),
      streak: currentStreak(state.history, dayKey),
      fortune: outcome.fortune,
    },
    { site: CONFIG.site },
  );
}

function showCopied() {
  el.shareDone.hidden = false;
  setTimeout(() => (el.shareDone.hidden = true), 2500);
}

/** Copy via the async clipboard API, falling back to a hidden textarea + execCommand. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

el.shareBtn.addEventListener("click", async () => {
  const text = todayShareText();
  try {
    if (navigator.share) await navigator.share({ text });
    else if (await copyText(text)) showCopied();
  } catch {
    /* user cancelled the share sheet */
  }
});

el.copyBtn.addEventListener("click", async () => {
  if (await copyText(todayShareText())) showCopied();
});

el.calPrev.addEventListener("click", () => pageMonth(-1));
el.calNext.addEventListener("click", () => pageMonth(1));

el.freezeBtn.addEventListener("click", () => {
  const r = applyFreeze(state.history, today.revealed.dayKey);
  if (r.spent) {
    state.history = r.history;
    state.freezes -= 1;
    save();
    render();
  }
});

// Charm pack unlock: Polar redirects back with ?checkout_id=…
async function maybeUnlock() {
  const id = new URLSearchParams(location.search).get("checkout_id");
  if (!id) return;
  history.replaceState(null, "", location.pathname);
  el.packStatus.hidden = false;
  el.packStatus.textContent = "Checking your purchase…";
  try {
    const r = await api("/api/unlock", { method: "POST", body: JSON.stringify({ player: state.player, checkout_id: id }) });
    state.unlock = r.token;
    save();
    reconcileHistory();
    render();
  } catch (e) {
    el.packStatus.textContent =
      e.status === 402
        ? "That checkout hasn't completed yet. If you were charged, email the address on the refunds page and it'll be sorted."
        : "Couldn't verify the purchase right now. Reopen this link in a minute; nothing is lost.";
  }
}

// Countdown + automatic refresh at the reveal.
function tick() {
  const ms = msUntilNextReveal(Date.now());
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  el.countdown.textContent = `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  if (today && revealedDay(Date.now()) !== today.revealed.dayKey) {
    el.charmBig.classList.remove("spin");
    loadToday();
  }
}

// ---------------------------------------------------------------------------

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
setInterval(tick, 1000);
tick();
loadToday().then(maybeUnlock);
