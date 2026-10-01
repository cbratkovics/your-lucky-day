// @ts-check
import { CHARMS, SPARKLES } from "./content.js";
import { dayNumber } from "./day.js";

export const LAUNCH_DAY = "2026-09-30";

/**
 * Share text, three lines with the day's fortune as the headline. Spoiler-free:
 * shows what you called and whether it landed, never today's charm itself (so
 * friends still get the reveal).
 *
 * @param {{ dayKey: string, called: number|null, result: number, sparkle: number, streak: number, fortune: string }} p
 *   `fortune` is the day's fortune text
 * @param {{ site?: string|null }} [opts] no URL is appended unless the caller passes a `site`
 */
export function shareText(p, { site = null } = {}) {
  const n = Math.max(1, dayNumber(p.dayKey, LAUNCH_DAY));
  const spark = SPARKLES[p.sparkle];
  const hit = p.called !== null && p.called === p.result;
  const verdict =
    p.called === null
      ? "Missed the call, still lucky."
      : `Called ${CHARMS[p.called].emoji} → ${hit ? "called it ✅" : "not today ➰"}`;
  const line2 = `Your Lucky Day #${n} ${spark.glyph} · ${verdict}`;
  const line3 = site ? `Streak ${p.streak} · ${site}` : `Streak ${p.streak}`;
  return `${p.fortune}\n${line2}\n${line3}`;
}
