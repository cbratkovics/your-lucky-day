// @ts-check
import { CHARMS } from "./content.js";
import { shiftKey } from "./day.js";
import { bestStreak, currentStreak, totals } from "./streak.js";

/**
 * Personal stats over a player's history.
 *
 * `outcomes` maps dayKey → drawn charm index and is supplied by the caller
 * (the server's public record, or results the client already saw), so nothing
 * here needs the salt. A day counts as decided once its outcome is known,
 * either from `outcomes` or from the record's own `result`.
 *
 * `calls` is every call ever made, including one still waiting for its reveal;
 * `hitRate` is hits over decided calls only, so a pending call doesn't drag it.
 *
 * @param {import("./streak.js").History} history
 * @param {Record<string, number>} [outcomes]
 * @param {string} [throughDay] day the current streak is counted back from;
 *   defaults to the latest day in `history` or `outcomes`
 * @returns {{ calls: number, hits: number, hitRate: number, currentStreak: number, bestStreak: number, favoriteCharm: number|null }}
 */
export function summarize(history, outcomes = {}, throughDay) {
  /** @type {import("./streak.js").History} */
  const decided = {};
  const perCharm = CHARMS.map(() => 0);
  let calls = 0;
  for (const [day, rec] of Object.entries(history)) {
    if (rec.called === null || rec.called === undefined) continue;
    calls += 1;
    if (rec.called >= 0 && rec.called < perCharm.length) perCharm[rec.called] += 1;
    const result = outcomes[day] ?? rec.result;
    if (result !== undefined && result !== null) decided[day] = { called: rec.called, result };
  }
  const { hits, hitRate } = totals(decided);

  // Most-called charm; ties go to the lower index so the answer is stable.
  let favoriteCharm = null;
  for (let i = 0; i < perCharm.length; i++) {
    if (perCharm[i] > 0 && (favoriteCharm === null || perCharm[i] > perCharm[favoriteCharm])) favoriteCharm = i;
  }

  const through = throughDay ?? [...Object.keys(history), ...Object.keys(outcomes)].sort().pop();
  return {
    calls,
    hits,
    hitRate,
    currentStreak: through ? currentStreak(history, through) : 0,
    bestStreak: bestStreak(history),
    favoriteCharm,
  };
}

/**
 * Cells for a Sunday-first, 6-row month calendar (always 42 cells), padded
 * with the neighbouring months' days.
 * @param {string} yearMonth "YYYY-MM"
 * @returns {{ dayKey: string, weekday: number, inMonth: boolean }[]} weekday 0 = Sunday
 */
export function monthGrid(yearMonth) {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`bad yearMonth ${yearMonth}`);
  const first = `${yearMonth}-01`;
  const lead = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, i) => {
    const dayKey = shiftKey(first, i - lead);
    return { dayKey, weekday: i % 7, inMonth: dayKey.startsWith(yearMonth) };
  });
}

/**
 * Move a "YYYY-MM" key by `months` (negative goes back), for calendar paging.
 * @param {string} yearMonth
 * @param {number} months
 */
export function shiftMonth(yearMonth, months) {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
