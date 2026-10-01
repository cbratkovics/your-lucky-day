// @ts-check
/**
 * Routes for the Reddit version of Your Lucky Day.
 *
 *   GET  /api/state                  → revealed outcome, callable day, tallies, jar, this user's record
 *                                      (mode "live"), or the post's own day once a newer spin is out (mode "archive")
 *   POST /api/call {charm}           → record/replace the signed-in user's call for the callable day
 *   GET  /api/history                → the signed-in user's calls plus the last 400 days of outcomes
 *   GET  /api/community              → lifetime community stats
 *   GET  /api/leaderboard            → top 10 by streak and by hits, the caller's rank and opt-in state
 *   POST /api/leaderboard/optin {show} → opt in to / out of the leaderboard
 *   POST /internal/menu/post-today   → mod menu: create today's post now
 *   POST /internal/on/app-install    → create the first post on install
 *   POST /internal/scheduler/daily-post → 12:00 and 13:00 UTC; posts only if it's 08:00 ET and not posted yet
 *
 * Storage (Redis, per subreddit installation):
 *   tally:{day}          hash charm-index → count
 *   calls:{day}          hash userId → charm-index
 *   user:{userId}        hash day → charm-index  (history for streaks)
 *   jar                  string counter of lifetime calls in this community
 *   posted:{day}         "1" once the daily post exists (idempotency for the scheduler)
 *   outcomes             hash day → drawn charm-index, written when that day's post is created
 *   cstats               hash: total_calls, total_hits, settled_calls, best_day, best_day_hits,
 *                        charm_calls:{i}, seeded
 *   lb_optin:{userId}    "1"/"0", the user's leaderboard choice
 *   lb_names             hash userId → username, only for users who opted in
 *   lb_streak, lb_hits   sorted sets of opted-in userIds by current streak / lifetime hits
 */
import { once } from "node:events";
import { context, realtime, reddit, redis, settings } from "@devvit/web/server";

import {
  CHARMS,
  LAUNCH_DAY,
  MILESTONES,
  callableDay,
  computeOutcome,
  currentStreak,
  dayNumber,
  describe,
  localParts,
  msUntilNextReveal,
  revealedDay,
  shiftKey,
} from "../../../../packages/core/index.js";

const FALLBACK_SALT = "unset-salt-run-devvit-settings-set-DAILY_SALT";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_DAYS = 400; // outcomes returned to the calendar: a full year and a bit
const TALLY_DAYS = 60; // how long per-day tally and call keys are kept
const BACKFILL_DAYS = 7; // days a missed post can be caught up on
const LEADERBOARD_SIZE = 10;

/** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
export async function onRequest(req, res) {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const key = `${req.method} ${url.pathname}`;
    switch (key) {
      case "GET /api/state":
        return json(res, 200, await state(Date.now()));
      case "POST /api/call":
        return json(res, 200, await call(await readJson(req), Date.now()));
      case "GET /api/history":
        return json(res, 200, await myHistory(Date.now()));
      case "GET /api/community":
        return json(res, 200, await community());
      case "GET /api/leaderboard":
        return json(res, 200, await leaderboard());
      case "POST /api/leaderboard/optin":
        return json(res, 200, await leaderboardOptin(await readJson(req), Date.now()));
      case "POST /internal/menu/post-today":
        return json(res, 200, await menuPostToday());
      case "POST /internal/on/app-install":
        return json(res, 200, await onInstall());
      case "POST /internal/scheduler/daily-post":
        return json(res, 200, await scheduledPost(Date.now()));
      default:
        return json(res, 404, { error: "not found" });
    }
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status >= 500) console.error(`server error; ${err instanceof Error ? err.stack : err}`);
    return json(res, status, { error: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------

async function salt() {
  const v = await settings.get("DAILY_SALT");
  return typeof v === "string" && v.length > 0 ? v : FALLBACK_SALT;
}

const tallyKey = (day) => `tally:${day}`;
const callsKey = (day) => `calls:${day}`;
const userKey = (uid) => `user:${uid}`;
const channelFor = (day) => `tally_${day.replace(/-/g, "_")}`;
const optinKey = (uid) => `lb_optin:${uid}`;
const charmCallsField = (i) => `charm_calls:${i}`;
const OUTCOMES = "outcomes";
const CSTATS = "cstats";
const LB_STREAK = "lb_streak";
const LB_HITS = "lb_hits";
const LB_NAMES = "lb_names";
const CHARM_LIST = CHARMS.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, hue: c.hue }));

async function tallies(day) {
  const h = await redis.hGetAll(tallyKey(day));
  return CHARMS.map((_, i) => Number(h[String(i)] ?? 0));
}

async function state(now) {
  const revealed = revealedDay(now);
  // Posts own their day: once a newer spin is out, an older post keeps showing its own.
  const postDay = context.postData?.dayKey;
  if (typeof postDay === "string" && DAY_RE.test(postDay) && postDay < revealed) return archiveState(postDay, now);

  const callable = callableDay(now);
  const outcome = describe(computeOutcome(await salt(), revealed));
  const uid = context.userId;

  const [revealedTallies, callableTallies, jarRaw, history] = await Promise.all([
    tallies(revealed),
    tallies(callable),
    redis.get("jar"),
    uid ? redis.hGetAll(userKey(uid)) : Promise.resolve({}),
  ]);

  return {
    mode: "live",
    signedIn: Boolean(uid),
    dayNumber: Math.max(1, dayNumber(revealed, LAUNCH_DAY)),
    revealed: {
      dayKey: revealed,
      outcome,
      charmIndex: CHARMS.findIndex((c) => c.id === outcome.charm.id),
      tallies: revealedTallies,
      myCall: history[revealed] !== undefined ? Number(history[revealed]) : null,
    },
    callable: {
      dayKey: callable,
      tallies: callableTallies,
      myCall: history[callable] !== undefined ? Number(history[callable]) : null,
      msUntilReveal: msUntilNextReveal(now),
      channel: channelFor(callable),
    },
    jar: jarInfo(Number(jarRaw ?? 0)),
    me: await myStats(history, revealed, callable),
    charms: CHARM_LIST,
  };
}

/** A past day as its own post shows it: that day's spin and tallies, the user's stats as of now. No call grid. */
async function archiveState(day, now) {
  const outcome = describe(computeOutcome(await salt(), day));
  const uid = context.userId;

  const [dayTallies, jarRaw, history] = await Promise.all([
    tallies(day),
    redis.get("jar"),
    uid ? redis.hGetAll(userKey(uid)) : Promise.resolve({}),
  ]);

  return {
    mode: "archive",
    signedIn: Boolean(uid),
    dayNumber: Math.max(1, dayNumber(day, LAUNCH_DAY)),
    revealed: {
      dayKey: day,
      outcome,
      charmIndex: CHARMS.findIndex((c) => c.id === outcome.charm.id),
      tallies: dayTallies,
      myCall: history[day] !== undefined ? Number(history[day]) : null,
    },
    live: { dayKey: revealedDay(now) },
    jar: jarInfo(Number(jarRaw ?? 0)),
    me: await myStats(history, revealedDay(now), callableDay(now)),
    charms: CHARM_LIST,
  };
}

/** Streak and lifetime stats, computed server-side from the user's hash. */
async function myStats(history, revealed, callable) {
  const called = (d) => history[d] !== undefined;
  let streak = 0;
  let day = callable;
  if (!called(day)) day = shiftKey(day, -1);
  while (called(day)) {
    streak += 1;
    day = shiftKey(day, -1);
  }
  let hits = 0;
  let calls = 0;
  const s = await salt();
  for (const [d, c] of Object.entries(history)) {
    if (d > revealed) continue; // not revealed yet
    calls += 1;
    if (computeOutcome(s, d).charm === Number(c)) hits += 1;
  }
  return { streak, hits, calls };
}

function jarInfo(jar) {
  const next = MILESTONES.find((m) => m.calls > jar) ?? null;
  return { total: jar, next, unlocked: MILESTONES.filter((m) => m.calls <= jar).map((m) => m.emoji) };
}

async function call(body, now) {
  const uid = context.userId;
  if (!uid) throw Object.assign(new Error("sign in to call a charm"), { status: 401 });
  const charm = body?.charm;
  if (typeof charm !== "number" || !Number.isInteger(charm) || charm < 0 || charm >= CHARMS.length) {
    throw Object.assign(new Error("bad charm"), { status: 400 });
  }
  const day = callableDay(now);
  await seedCommunityStats(now);
  const prev = await redis.hGet(callsKey(day), uid);

  if (prev === undefined) {
    await redis.hSet(callsKey(day), { [uid]: String(charm) });
    await redis.hSet(userKey(uid), { [day]: String(charm) });
    await redis.hIncrBy(tallyKey(day), String(charm), 1);
    await redis.incrBy("jar", 1);
    await redis.hIncrBy(CSTATS, "total_calls", 1);
    await redis.hIncrBy(CSTATS, charmCallsField(charm), 1);
  } else if (Number(prev) !== charm) {
    await redis.hSet(callsKey(day), { [uid]: String(charm) });
    await redis.hSet(userKey(uid), { [day]: String(charm) });
    await redis.hIncrBy(tallyKey(day), prev, -1);
    await redis.hIncrBy(tallyKey(day), String(charm), 1);
    await redis.hIncrBy(CSTATS, charmCallsField(Number(prev)), -1);
    await redis.hIncrBy(CSTATS, charmCallsField(charm), 1);
  }
  // Keep per-day keys for 60 days; user history is kept.
  await redis.expire(callsKey(day), TALLY_DAYS * 86400);
  await redis.expire(tallyKey(day), TALLY_DAYS * 86400);

  // The call is saved at this point; a leaderboard hiccup must not fail it.
  try {
    await refreshLeaderboard(uid, now);
  } catch (e) {
    console.warn(`leaderboard refresh failed: ${e}`);
  }

  const t = await tallies(day);
  try {
    await realtime.send(channelFor(day), { type: "tally", dayKey: day, tallies: t });
  } catch (e) {
    console.warn(`realtime send failed: ${e}`);
  }
  return { ok: true, dayKey: day, charm, tallies: t };
}

// ---------------------------------------------------------------------------
// History

/** The signed-in user's calls, plus what was drawn on each of the last HISTORY_DAYS days. */
async function myHistory(now) {
  const uid = context.userId;
  if (!uid) throw Object.assign(new Error("sign in to see your history"), { status: 401 });
  const revealed = revealedDay(now);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => shiftKey(revealed, -i));
  const [calls, drawn] = await Promise.all([redis.hGetAll(userKey(uid)), redis.hMGet(OUTCOMES, days)]);

  const s = await salt();
  const outcomes = {};
  const fortunes = {};
  days.forEach((d, i) => {
    if (drawn[i] === null || drawn[i] === undefined) return;
    outcomes[d] = Number(drawn[i]);
    fortunes[d] = computeOutcome(s, d).fortune; // index into THEMED_FORTUNES[outcomes[d]], for the calendar's day detail
  });
  return {
    calls: Object.fromEntries(Object.entries(calls).map(([d, c]) => [d, Number(c)])),
    outcomes,
    fortunes,
    launchDay: LAUNCH_DAY,
    revealedDay: revealed,
    callableDay: callableDay(now),
  };
}

// ---------------------------------------------------------------------------
// Community stats

/**
 * One-time per installation: a community that was already calling before
 * `cstats` existed starts from its real totals (the jar, and whatever per-day
 * tallies haven't expired) instead of from zero.
 */
async function seedCommunityStats(now) {
  if (await redis.hGet(CSTATS, "seeded")) return;
  const jar = Number((await redis.get("jar")) ?? 0);
  /** @type {Record<string, string>} */
  const fields = { seeded: "1" };
  if (jar > 0) {
    const last = callableDay(now);
    const days = [];
    for (let d = last, i = 0; i < TALLY_DAYS && d >= LAUNCH_DAY; d = shiftKey(d, -1), i++) days.push(d);
    const perDay = await Promise.all(days.map(tallies));
    fields.total_calls = String(jar);
    CHARMS.forEach((_, c) => {
      fields[charmCallsField(c)] = String(perDay.reduce((sum, t) => sum + t[c], 0));
    });
  }
  await redis.hSet(CSTATS, fields);
}

async function community() {
  const [h, jarRaw] = await Promise.all([redis.hGetAll(CSTATS), redis.get("jar")]);
  const n = (f) => Number(h[f] ?? 0);
  const charmCalls = CHARMS.map((_, i) => Math.max(0, n(charmCallsField(i))));
  const top = Math.max(...charmCalls);
  const settledCalls = n("settled_calls");
  return {
    totalCalls: h.total_calls !== undefined ? n("total_calls") : Number(jarRaw ?? 0),
    totalHits: n("total_hits"),
    settledCalls,
    // Hits over calls whose day has been drawn; calls still waiting for a reveal don't count against it.
    hitRate: settledCalls ? n("total_hits") / settledCalls : 0,
    baseline: 1 / CHARMS.length,
    charmCalls,
    mostCalled: top > 0 ? charmCalls.indexOf(top) : null,
    bestDay: h.best_day ? { dayKey: h.best_day, hits: n("best_day_hits") } : null,
  };
}

/**
 * Record `day`'s drawn charm and fold that day's calls into the community
 * stats and the leaderboard. The hSetNX on `outcomes` is the once-per-day gate,
 * so extra posts for the same day (the mod menu) change nothing. O(calls that day).
 * @returns {Promise<boolean>} whether this run did the settling
 */
async function settleDay(day, s) {
  const charm = computeOutcome(s, day).charm;
  if ((await redis.hSetNX(OUTCOMES, day, String(charm))) === 0) return false;

  const dayCalls = await redis.hGetAll(callsKey(day));
  const hitters = Object.keys(dayCalls).filter((uid) => Number(dayCalls[uid]) === charm);
  await redis.hIncrBy(CSTATS, "total_hits", hitters.length);
  await redis.hIncrBy(CSTATS, "settled_calls", Object.keys(dayCalls).length);
  const best = Number((await redis.hGet(CSTATS, "best_day_hits")) ?? 0);
  if (hitters.length > best) await redis.hSet(CSTATS, { best_day: day, best_day_hits: String(hitters.length) });

  if (hitters.length) {
    const optedIn = new Set((await redis.zRange(LB_HITS, 0, -1, { by: "rank" })).map((e) => e.member));
    for (const uid of hitters) if (optedIn.has(uid)) await redis.zIncrBy(LB_HITS, uid, 1);
  }
  return true;
}

/** Settle `day` when its post is created, catching up on any recent day whose post was missed. */
async function recordDay(day, now) {
  await seedCommunityStats(now);
  const s = await salt();
  const days = [];
  for (let i = BACKFILL_DAYS; i >= 0; i--) {
    const d = shiftKey(day, -i);
    if (i === 0 || d >= LAUNCH_DAY) days.push(d);
  }
  const known = await redis.hMGet(OUTCOMES, days);
  let settledToday = false;
  for (const [i, d] of days.entries()) {
    if (known[i] !== null && known[i] !== undefined) continue;
    const did = await settleDay(d, s);
    if (d === day) settledToday = did;
  }
  if (settledToday) await resetLapsedStreaks(day);
}

// ---------------------------------------------------------------------------
// Leaderboard (opt-in)

/** Current streak and settled hits for one user, from their own hash and the public outcomes. */
async function userScores(uid, now) {
  const calls = await redis.hGetAll(userKey(uid));
  const days = Object.keys(calls);
  const drawn = days.length ? await redis.hMGet(OUTCOMES, days) : [];
  let hits = 0;
  days.forEach((d, i) => {
    if (drawn[i] !== null && drawn[i] !== undefined && Number(drawn[i]) === Number(calls[d])) hits += 1;
  });
  const hist = Object.fromEntries(days.map((d) => [d, { called: Number(calls[d]) }]));
  return { streak: currentStreak(hist, callableDay(now)), hits };
}

/** Rewrite an opted-in user's scores. Does nothing for anyone who hasn't opted in. */
async function refreshLeaderboard(uid, now) {
  if ((await redis.get(optinKey(uid))) !== "1") return;
  const { streak, hits } = await userScores(uid, now);
  await redis.zAdd(LB_STREAK, { member: uid, score: streak });
  await redis.zAdd(LB_HITS, { member: uid, score: hits });
}

/**
 * At `day`'s reveal a streak is over for anyone who called neither `day` nor
 * the day now open. Everyone else's score was set when they called.
 */
async function resetLapsedStreaks(day) {
  const members = (await redis.zRange(LB_STREAK, 0, -1, { by: "rank" })).filter((e) => e.score > 0);
  if (!members.length) return;
  const [dayCalls, nextCalls] = await Promise.all([redis.hGetAll(callsKey(day)), redis.hGetAll(callsKey(shiftKey(day, 1)))]);
  for (const { member } of members) {
    if (dayCalls[member] === undefined && nextCalls[member] === undefined) await redis.zAdd(LB_STREAK, { member, score: 0 });
  }
}

async function leaderboardOptin(body, now) {
  const uid = context.userId;
  if (!uid) throw Object.assign(new Error("sign in to join the leaderboard"), { status: 401 });
  if (typeof body?.show !== "boolean") throw Object.assign(new Error("bad show"), { status: 400 });

  if (body.show) {
    const username = await reddit.getCurrentUsername();
    if (!username) throw Object.assign(new Error("sign in to join the leaderboard"), { status: 401 });
    await redis.set(optinKey(uid), "1");
    await redis.hSet(LB_NAMES, { [uid]: username });
    await refreshLeaderboard(uid, now);
  } else {
    await redis.set(optinKey(uid), "0");
    await redis.zRem(LB_STREAK, [uid]);
    await redis.zRem(LB_HITS, [uid]);
    await redis.hDel(LB_NAMES, [uid]);
  }
  return { ok: true, ...(await leaderboard()) };
}

async function leaderboard() {
  const uid = context.userId;
  const top = { reverse: true, by: /** @type {const} */ ("rank") };
  const [streakTop, hitsTop, optin] = await Promise.all([
    redis.zRange(LB_STREAK, 0, LEADERBOARD_SIZE - 1, top),
    redis.zRange(LB_HITS, 0, LEADERBOARD_SIZE - 1, top),
    uid ? redis.get(optinKey(uid)) : Promise.resolve(undefined),
  ]);
  const uids = [...new Set([...streakTop, ...hitsTop].map((e) => e.member))];
  const names = uids.length ? await redis.hMGet(LB_NAMES, uids) : [];
  const nameOf = new Map(uids.map((u, i) => [u, names[i]]));
  const rows = (entries) =>
    entries.filter((e) => e.score > 0 && nameOf.get(e.member)).map((e) => ({ username: nameOf.get(e.member), score: e.score }));

  const optedIn = optin === "1";
  return {
    signedIn: Boolean(uid),
    optedIn,
    streak: rows(streakTop),
    hits: rows(hitsTop),
    me: optedIn ? { streak: await myRank(LB_STREAK, uid), hits: await myRank(LB_HITS, uid) } : null,
  };
}

/**
 * The user's place on a board, or null if they aren't on it. Ties share a
 * place: rank is one more than the number of members with a higher score.
 */
async function myRank(key, uid) {
  const [score, size] = await Promise.all([redis.zScore(key, uid).catch(() => undefined), redis.zCard(key)]);
  if (score === undefined) return null;
  const higher = await redis.zRange(key, score + 1, Number.MAX_SAFE_INTEGER, { by: "score" });
  return { rank: higher.length + 1, score, of: size };
}

// ---------------------------------------------------------------------------
// Posting

async function createDailyPost(now) {
  const day = revealedDay(now);
  const n = Math.max(1, dayNumber(day, LAUNCH_DAY));
  const o = describe(computeOutcome(await salt(), day));
  const weekday = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName,
    title: `Your Lucky Day #${n} — ${weekday}'s spin is in. Call tomorrow's charm.`,
    entry: "default",
    postData: { dayKey: day },
    textFallback: {
      text:
        `Today the world drew **${o.charm.emoji} ${o.charm.name}** (${o.sparkle.name}).\n\n` +
        `*${o.fortune}*\n\nLucky move: ${o.move}\n\n` +
        `Open this post in the Reddit app or new Reddit to call tomorrow's charm.`,
    },
  });
  await redis.set(`posted:${day}`, post.id);
  // The post is up; recording the day for history and stats must never undo that.
  try {
    await recordDay(day, now);
  } catch (e) {
    console.warn(`recording ${day} failed: ${e}`);
  }
  return post;
}

async function menuPostToday() {
  const post = await createDailyPost(Date.now());
  return { showToast: { text: "Today's spin is posted.", appearance: "success" }, navigateTo: post.url };
}

async function onInstall() {
  const post = await createDailyPost(Date.now());
  return { status: "success", message: `installed; first post ${post.id}` };
}

/** Runs at 12:00 and 13:00 UTC; exactly one of them is 08:00 America/New_York. */
async function scheduledPost(now) {
  const p = localParts(now);
  if (p.h !== 8) return { status: "skipped", reason: `local hour ${p.h} != 8` };
  const day = revealedDay(now);
  const already = await redis.get(`posted:${day}`);
  if (already) return { status: "skipped", reason: `already posted ${already}` };
  const post = await createDailyPost(now);
  return { status: "ok", postId: post.id };
}

// ---------------------------------------------------------------------------

async function readJson(req) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  await once(req, "end");
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("bad json"), { status: 400 });
  }
}

function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}
