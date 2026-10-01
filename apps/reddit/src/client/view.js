// @ts-check
/**
 * View decisions shared by the client modules. Nothing here touches the DOM or
 * the Devvit SDK, so the tests can import it directly.
 */

/**
 * What a history calendar cell shows:
 * hit / miss / none (drawn, no call) / pending (called, not drawn yet) / blank (nothing to show, not tappable).
 * Days before launch are always blank, whatever a test community recorded for them.
 * @param {string} dayKey
 * @param {{ calls: Record<string, number>, outcomes: Record<string, number>, launchDay: string, revealedDay: string }} hist the /api/history payload
 */
export function dayKind(dayKey, hist) {
  if (dayKey < hist.launchDay) return "blank";
  const drawn = hist.outcomes[dayKey];
  const called = hist.calls[dayKey];
  if (drawn !== undefined) return called === undefined ? "none" : called === drawn ? "hit" : "miss";
  return called !== undefined && dayKey > hist.revealedDay ? "pending" : "blank";
}

/**
 * The share of calls printed on a call button. A signed-out viewer can't call,
 * so they always get the tally as it stands (0% before the first call); a
 * signed-in viewer sees a dash until someone has called.
 * @param {number} pct 0-100
 * @param {number} total calls so far for the callable day
 * @param {boolean} signedIn
 */
export function pctText(pct, total, signedIn) {
  return total || !signedIn ? `${pct}%` : "—";
}

/** True when neither leaderboard list has a row. @param {{ streak: unknown[], hits: unknown[] }} board the /api/leaderboard payload */
export function boardIsEmpty(board) {
  return board.streak.length === 0 && board.hits.length === 0;
}
