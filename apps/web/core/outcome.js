// @ts-check
import { CHARMS, LUCKY_MOVES, SPARKLES } from "./content.js";
import { THEMED_FORTUNES } from "./fortunes.js";
import { pickIndex, pickWeighted, rngFrom } from "./rng.js";

/**
 * @typedef {{
 *   dayKey: string,
 *   charm: number,      // index into CHARMS
 *   sparkle: number,    // index into SPARKLES
 *   fortune: number,    // index into THEMED_FORTUNES[charm]
 *   move: number,       // index into LUCKY_MOVES
 * }} Outcome
 */

/**
 * The one spin the whole world shares for `dayKey`.
 *
 * `salt` is a server-side secret so nobody can precompute tomorrow. Rotate it
 * monthly; past days stay reproducible if you keep the old salts keyed by month.
 *
 * @param {string} salt
 * @param {string} dayKey YYYY-MM-DD
 * @returns {Outcome}
 */
export function computeOutcome(salt, dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error(`bad dayKey ${dayKey}`);
  const rng = rngFrom(`${salt}|${dayKey}`);
  // The charm is drawn first; the fortune then comes from that charm's own set.
  const charm = pickIndex(rng, CHARMS.length);
  return {
    dayKey,
    charm,
    sparkle: pickWeighted(rng, SPARKLES.map((s) => s.weight)),
    fortune: pickIndex(rng, THEMED_FORTUNES[charm].length),
    move: pickIndex(rng, LUCKY_MOVES.length),
  };
}

/**
 * Expand an outcome into display content.
 * @param {Outcome} o
 */
export function describe(o) {
  return {
    dayKey: o.dayKey,
    charm: CHARMS[o.charm],
    sparkle: SPARKLES[o.sparkle],
    fortune: THEMED_FORTUNES[o.charm][o.fortune],
    move: LUCKY_MOVES[o.move],
  };
}

/**
 * Sparkle points earned for a day.
 * Participating always earns 1 × multiplier; calling it right earns 3 × multiplier.
 * @param {number|null} called index of charm the player called, or null
 * @param {Outcome} o
 */
export function pointsFor(called, o) {
  if (called === null || called === undefined) return 0;
  const mult = SPARKLES[o.sparkle].multiplier;
  return (called === o.charm ? 3 : 1) * mult;
}
