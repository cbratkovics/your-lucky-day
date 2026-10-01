// @ts-check
/**
 * Game-day clock. The world shares one clock: America/New_York, reveal at 08:00.
 *
 * A "game day" is named by the date of its reveal. Calls for game day D are
 * accepted from the reveal on D-1 (08:00 ET) until the reveal on D (08:00 ET).
 * After D's reveal you see D's result and can immediately call for D+1.
 *
 * All functions take `now` (ms since epoch) so they are pure and testable.
 */

export const TIME_ZONE = "America/New_York";
export const REVEAL_HOUR = 8; // 08:00 local

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * Local wall-clock parts in the game time zone.
 * @param {number} now
 * @returns {{y:number,m:number,d:number,h:number,min:number,s:number}}
 */
export function localParts(now) {
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of fmt.formatToParts(new Date(now))) p[part.type] = part.value;
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    h: Number(p.hour),
    min: Number(p.minute),
    s: Number(p.second),
  };
}

/** @param {number} y @param {number} m @param {number} d */
function key(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Add `days` to a YYYY-MM-DD key using UTC arithmetic (keys are calendar dates). */
export function shiftKey(dayKey, days) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return key(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * The game day whose result is currently visible (the most recent reveal).
 * @param {number} now
 */
export function revealedDay(now) {
  const p = localParts(now);
  const today = key(p.y, p.m, p.d);
  return p.h >= REVEAL_HOUR ? today : shiftKey(today, -1);
}

/**
 * The game day currently accepting calls (the next reveal).
 * @param {number} now
 */
export function callableDay(now) {
  return shiftKey(revealedDay(now), 1);
}

/**
 * Milliseconds until the next reveal. Computed by scanning forward minute by
 * minute is wasteful; instead we take the local parts and compute the offset
 * to 08:00 today or tomorrow, then correct for DST by re-checking.
 * @param {number} now
 */
export function msUntilNextReveal(now) {
  const target = callableDay(now);
  // Binary search the instant at which revealedDay(t) becomes `target`.
  let lo = now;
  let hi = now + 36 * 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (revealedDay(mid) === target) hi = mid;
    else lo = mid;
  }
  return hi - now;
}

/**
 * Human "day number" since launch, for the share card. Launch day is day 1.
 * @param {string} dayKey
 * @param {string} launchKey
 */
export function dayNumber(dayKey, launchKey) {
  const [y1, m1, d1] = launchKey.split("-").map(Number);
  const [y2, m2, d2] = dayKey.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}
