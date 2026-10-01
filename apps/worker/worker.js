// @ts-check
/**
 * Your Lucky Day — Cloudflare Worker.
 *
 * Serves the static site (Workers Static Assets) and a tiny JSON API:
 *
 *   GET  /api/today               → current state: revealed outcome, callable day, tallies, jar
 *   POST /api/call {player,charm} → record/replace the player's call for the callable day
 *   GET  /api/community           → lifetime totals: calls, hits, hit rate, most-called charm, best day
 *   POST /api/unlock {checkout_id,player} → verify a Polar checkout, return a signed unlock token
 *   GET  /api/health
 *
 * Secrets (wrangler secret put ...):
 *   DAILY_SALT     — server-only; makes tomorrow's spin unpredictable
 *   UNLOCK_SECRET  — HMAC key for unlock tokens
 *   POLAR_TOKEN    — Polar API token (read-only is enough) for checkout verification
 * Vars (wrangler.toml):
 *   POLAR_PRODUCT_ID — the charm-pack product id, so a checkout for any other product is refused
 *
 * Privacy: `player` is a random UUID generated in the browser. No accounts, no
 * emails, no IPs stored. The tally is the only thing that is ever aggregated.
 */

import { CHARMS, MILESTONES, callableDay, computeOutcome, describe, msUntilNextReveal, revealedDay } from "../../packages/core/index.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const PLAYER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {unknown} body @param {number} [status] */
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

export default {
  /**
   * @param {Request} request
   * @param {{ DB: D1Database, ASSETS: { fetch(r: Request): Promise<Response> }, DAILY_SALT: string, UNLOCK_SECRET: string, POLAR_TOKEN?: string, POLAR_PRODUCT_ID?: string, POLAR_API?: string }} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await route(request, url, env, Date.now());
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500);
    }
  },
};

/**
 * Exported for tests: pure routing over an injected clock.
 * @param {Request} request
 * @param {URL} url
 * @param {any} env
 * @param {number} now
 */
export async function route(request, url, env, now) {
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/health") return json({ ok: true });
  if (request.method === "GET" && path === "/api/today") return today(env, now);
  if (request.method === "POST" && path === "/api/call") return call(request, env, now);
  if (request.method === "GET" && path === "/api/community") return community(env);
  if (request.method === "POST" && path === "/api/unlock") return unlock(request, env, now);
  return json({ error: "not_found" }, 404);
}

// ---------------------------------------------------------------------------

async function today(env, now) {
  const revealed = revealedDay(now);
  const callable = callableDay(now);
  const drawn = computeOutcome(env.DAILY_SALT, revealed);
  const outcome = describe(drawn);

  const [revealedTallies, callableTallies, jar] = await Promise.all([
    talliesFor(env.DB, revealed),
    talliesFor(env.DB, callable),
    env.DB.prepare("SELECT n FROM counters WHERE key='calls_total'").first("n"),
    recordOutcome(env.DB, revealed, drawn.charm),
  ]);

  const total = Number(jar ?? 0);
  const next = MILESTONES.find((m) => m.calls > total) ?? null;
  const unlocked = MILESTONES.filter((m) => m.calls <= total);

  return json(
    {
      revealed: { dayKey: revealed, outcome, tallies: revealedTallies },
      callable: { dayKey: callable, tallies: callableTallies, msUntilReveal: msUntilNextReveal(now) },
      jar: { total, next, unlocked: unlocked.map((m) => m.emoji) },
      charms: CHARMS.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })),
    },
    200,
    { "cache-control": "public, max-age=30" },
  );
}

/**
 * The first /api/today of a game day stores what was drawn and folds that
 * day's calls into the community stats. It is one batch whose every statement
 * is guarded on the day not being recorded yet, so concurrent first requests
 * still count the day exactly once.
 */
async function recordOutcome(db, day, charm) {
  try {
    if (await db.prepare("SELECT 1 AS known FROM outcomes WHERE day=?").bind(day).first("known")) return;
    const fresh = "NOT EXISTS (SELECT 1 FROM outcomes WHERE day=?)";
    const hits = "COALESCE((SELECT n FROM tallies WHERE day=? AND charm=?), 0)";
    await db.batch([
      db.prepare(`UPDATE counters SET n = n + ${hits} WHERE key='total_hits' AND ${fresh}`).bind(day, charm, day),
      db.prepare(`UPDATE counters SET n = n + COALESCE((SELECT SUM(n) FROM tallies WHERE day=?), 0) WHERE key='settled_calls' AND ${fresh}`).bind(day, day),
      // best_day is compared against the old best_day_hits, so it has to go first.
      db.prepare(`UPDATE counters SET n = ? WHERE key='best_day' AND ${fresh} AND ${hits} > (SELECT n FROM counters WHERE key='best_day_hits')`).bind(dayToInt(day), day, day, charm),
      db.prepare(`UPDATE counters SET n = MAX(n, ${hits}) WHERE key='best_day_hits' AND ${fresh}`).bind(day, charm, day),
      db.prepare("INSERT OR IGNORE INTO outcomes (day, charm) VALUES (?,?)").bind(day, charm),
    ]);
  } catch (err) {
    // Stats are best-effort: a database that hasn't had migrations/0002-history.sql applied must still serve the spin.
    console.error(err);
  }
}

// counters.n is an INTEGER, so the best day is kept as YYYYMMDD.
const dayToInt = (day) => Number(day.replaceAll("-", ""));
const intToDay = (n) => String(n).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

async function community(env) {
  const rows = await env.DB.prepare("SELECT key, n FROM counters").all();
  /** @type {Record<string, number>} */
  const c = {};
  for (const r of rows.results ?? []) c[String(r.key)] = Number(r.n);
  const charmCalls = CHARMS.map((_, i) => Math.max(0, c[`charm_calls:${i}`] ?? 0));
  const top = Math.max(...charmCalls);
  const totalHits = c.total_hits ?? 0;
  const settledCalls = c.settled_calls ?? 0;
  return json(
    {
      totalCalls: c.calls_total ?? 0,
      totalHits,
      settledCalls,
      // Hits over calls whose day has been drawn; calls still waiting for a reveal don't count against it.
      hitRate: settledCalls ? totalHits / settledCalls : 0,
      baseline: 1 / CHARMS.length,
      charmCalls,
      mostCalled: top > 0 ? charmCalls.indexOf(top) : null,
      bestDay: c.best_day ? { dayKey: intToDay(c.best_day), hits: c.best_day_hits ?? 0 } : null,
    },
    200,
    { "cache-control": "public, max-age=30" },
  );
}

async function talliesFor(db, day) {
  const rows = await db.prepare("SELECT charm, n FROM tallies WHERE day = ?").bind(day).all();
  const out = CHARMS.map(() => 0);
  for (const r of rows.results ?? []) out[Number(r.charm)] = Number(r.n);
  return out;
}

async function call(request, env, now) {
  const body = await safeJson(request);
  const player = String(body?.player ?? "");
  const charm = body?.charm;
  if (!PLAYER_RE.test(player)) return json({ error: "bad_player" }, 400);
  if (typeof charm !== "number" || !Number.isInteger(charm) || charm < 0 || charm >= CHARMS.length) {
    return json({ error: "bad_charm" }, 400);
  }

  const day = callableDay(now);
  const prev = await env.DB.prepare("SELECT charm FROM calls WHERE day=? AND player=?").bind(day, player).first("charm");

  const stmts = [];
  if (prev === null || prev === undefined) {
    stmts.push(
      env.DB.prepare("INSERT INTO calls (day, player, charm, called_at) VALUES (?,?,?,?)").bind(day, player, charm, now),
      env.DB.prepare("INSERT INTO tallies (day, charm, n) VALUES (?,?,1) ON CONFLICT(day,charm) DO UPDATE SET n = n + 1").bind(day, charm),
      env.DB.prepare("UPDATE counters SET n = n + 1 WHERE key='calls_total'"),
      env.DB.prepare("UPDATE counters SET n = n + 1 WHERE key=?").bind(`charm_calls:${charm}`),
    );
  } else if (Number(prev) !== charm) {
    stmts.push(
      env.DB.prepare("UPDATE calls SET charm=?, called_at=? WHERE day=? AND player=?").bind(charm, now, day, player),
      env.DB.prepare("UPDATE tallies SET n = MAX(n - 1, 0) WHERE day=? AND charm=?").bind(day, Number(prev)),
      env.DB.prepare("INSERT INTO tallies (day, charm, n) VALUES (?,?,1) ON CONFLICT(day,charm) DO UPDATE SET n = n + 1").bind(day, charm),
      env.DB.prepare("UPDATE counters SET n = MAX(n - 1, 0) WHERE key=?").bind(`charm_calls:${Number(prev)}`),
      env.DB.prepare("UPDATE counters SET n = n + 1 WHERE key=?").bind(`charm_calls:${charm}`),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);

  return json({ ok: true, dayKey: day, charm, changed: prev !== null && prev !== undefined && Number(prev) !== charm, tallies: await talliesFor(env.DB, day) });
}

// ---------------------------------------------------------------------------
// Charm pack unlock. Flow: Polar Checkout Link → success URL /thanks?checkout_id=…
// → client POSTs the id here → we verify with Polar's API → return a signed token
// the client stores locally. Nothing about the buyer is stored except the checkout id.

async function unlock(request, env, now) {
  const body = await safeJson(request);
  const player = String(body?.player ?? "");
  const checkoutId = String(body?.checkout_id ?? "");
  if (!PLAYER_RE.test(player)) return json({ error: "bad_player" }, 400);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(checkoutId)) return json({ error: "bad_checkout" }, 400);
  if (!env.POLAR_TOKEN) return json({ error: "payments_not_configured" }, 503);

  const existing = await env.DB.prepare("SELECT player FROM unlocks WHERE checkout_id=?").bind(checkoutId).first("player");
  if (existing && existing !== player) return json({ error: "checkout_already_used" }, 409);

  if (!existing) {
    const ok = await verifyPolarCheckout(env, checkoutId);
    if (!ok) return json({ error: "checkout_not_paid" }, 402);
    await env.DB.prepare("INSERT OR IGNORE INTO unlocks (checkout_id, player, created_at) VALUES (?,?,?)").bind(checkoutId, player, now).run();
  }
  const token = await signUnlock(env.UNLOCK_SECRET, player);
  return json({ ok: true, token });
}

/** @returns {Promise<boolean>} */
async function verifyPolarCheckout(env, checkoutId) {
  const base = env.POLAR_API ?? "https://api.polar.sh";
  const res = await fetch(`${base}/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
    headers: { authorization: `Bearer ${env.POLAR_TOKEN}` },
  });
  if (!res.ok) return false;
  const data = await res.json();
  const paid = data?.status === "succeeded" || data?.status === "confirmed";
  const rightProduct = !env.POLAR_PRODUCT_ID || data?.product_id === env.POLAR_PRODUCT_ID || data?.product?.id === env.POLAR_PRODUCT_ID;
  return Boolean(paid && rightProduct);
}

/** HMAC-SHA256 token: `${player}.${hex}`. Verified client-side only for UX; the server never trusts it for money. */
export async function signUnlock(secret, player) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unlock:${player}`));
  return `${player}.${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
