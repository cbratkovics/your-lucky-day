// @ts-check

/**
 * A count with its noun: plural(1, "call") → "1 call", plural(2, "call") → "2 calls".
 * Pass `many` for irregular nouns: plural(3, "person", "people") → "3 people".
 * @param {number} n
 * @param {string} one
 * @param {string} [many]
 */
export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/**
 * Accessible name for a call button: "Clover, 42% called".
 * @param {string} name the charm's name
 * @param {number} pct share of calls so far, 0-100
 */
export function charmButtonLabel(name, pct) {
  return `${name}, ${pct}% called`;
}

/**
 * Accessible name for a history calendar cell:
 *   "October 3: drew Clover, you called Star, miss"
 *   "October 4: drew Key, no call"
 *   "October 5: you called Moon, waiting for the spin"
 * Charms are passed by name; leave out what isn't known. `note` replaces the
 * closing words for a day with no draw to compare against.
 * @param {string} dayKey
 * @param {{ drew?: string|null, called?: string|null, note?: string }} [p]
 */
export function calendarCellLabel(dayKey, { drew = null, called = null, note } = {}) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const parts = [];
  if (drew) parts.push(`drew ${drew}`);
  if (called) parts.push(`you called ${called}`);
  if (drew) parts.push(called ? (called === drew ? "hit" : "miss") : "no call");
  else parts.push(note ?? (called ? "waiting for the spin" : "nothing recorded"));
  return `${day}: ${parts.join(", ")}`;
}
