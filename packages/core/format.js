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
