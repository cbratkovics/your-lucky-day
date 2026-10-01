// @ts-check
import { shiftKey } from "./day.js";

/**
 * Player history is a plain object keyed by dayKey:
 *   { "2026-09-30": { called: 2, result: 2 }, ... }
 * `called` is the charm index the player picked (or null if they only visited).
 * `result` is filled in once that day's outcome was seen.
 *
 * Streak = consecutive game days (ending at `throughDay`) on which the player
 * called a charm. Freezes cover a missed day: each freeze token spent bridges
 * one gap day. Tokens are granted by the charm pack (1 per calendar month).
 *
 * @typedef {{ called: number|null, result?: number, frozen?: boolean }} DayRecord
 * @typedef {Record<string, DayRecord>} History
 */

/**
 * @param {History} history
 * @param {string} throughDay the most recent game day that has been revealed
 */
export function currentStreak(history, throughDay) {
  let streak = 0;
  let day = throughDay;
  // Allow the player to not have called `throughDay` yet if it's still today:
  // the streak counts back from the last called day, but a gap of >1 breaks it.
  if (!called(history[day])) {
    day = shiftKey(day, -1);
    if (!called(history[day]) && !history[day]?.frozen) return 0;
  }
  while (called(history[day]) || history[day]?.frozen) {
    if (called(history[day])) streak += 1;
    day = shiftKey(day, -1);
  }
  return streak;
}

/** @param {DayRecord|undefined} rec */
function called(rec) {
  return rec !== undefined && rec.called !== null && rec.called !== undefined;
}

/**
 * Longest streak ever, scanning the whole history.
 * @param {History} history
 */
export function bestStreak(history) {
  const days = Object.keys(history).sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const day of days) {
    const rec = history[day];
    const contiguous = prev !== null && shiftKey(prev, 1) === day;
    if (called(rec)) {
      run = contiguous || prev === null ? run + 1 : 1;
      best = Math.max(best, run);
    } else if (rec.frozen && contiguous) {
      // frozen day keeps the run alive without adding to it
    } else {
      run = 0;
    }
    prev = day;
  }
  return best;
}

/** Lifetime totals for the stats panel. */
export function totals(history) {
  let calls = 0;
  let hits = 0;
  for (const rec of Object.values(history)) {
    if (called(rec)) {
      calls += 1;
      if (rec.result !== undefined && rec.result === rec.called) hits += 1;
    }
  }
  return { calls, hits, hitRate: calls ? hits / calls : 0 };
}

/**
 * Apply a freeze to the single missed day between the last called day and
 * `throughDay`, if exactly one such gap exists. Returns the updated history and
 * whether a token was spent. Pure: does not mutate the input.
 * @param {History} history
 * @param {string} throughDay
 */
export function applyFreeze(history, throughDay) {
  const gap = shiftKey(throughDay, -1);
  const before = shiftKey(gap, -1);
  if (called(history[gap]) || history[gap]?.frozen) return { history, spent: false };
  if (!called(history[before]) && !history[before]?.frozen) return { history, spent: false };
  return { history: { ...history, [gap]: { called: null, frozen: true } }, spent: true };
}

export const MAX_FREEZES = 3;

/**
 * The charm pack's monthly freeze: one token on the first visit of each
 * calendar month, never more than MAX_FREEZES banked. Call it on every visit;
 * it only grants when `yearMonth` is later than the month already recorded, so
 * a repeat visit or a clock that steps back can't grant again. A month visited
 * at the cap is still recorded, so a token spent later that month isn't topped
 * back up. Pure: does not mutate the input.
 * @param {{ freezes?: number, freezeMonth?: string }} state
 * @param {string} yearMonth "YYYY-MM" of the visit
 * @returns {{ freezes: number, freezeMonth: string, granted: boolean }}
 */
export function grantMonthlyFreeze(state, yearMonth) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth)) throw new Error(`bad yearMonth ${yearMonth}`);
  const banked = Math.min(MAX_FREEZES, Math.max(0, Math.floor(Number(state.freezes) || 0)));
  const last = typeof state.freezeMonth === "string" ? state.freezeMonth : "";
  if (yearMonth <= last) return { freezes: banked, freezeMonth: last, granted: false };
  return { freezes: Math.min(MAX_FREEZES, banked + 1), freezeMonth: yearMonth, granted: banked < MAX_FREEZES };
}
