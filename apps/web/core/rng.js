// @ts-check
/**
 * Deterministic hashing + PRNG that behave identically in browsers, Cloudflare
 * Workers and Node — no crypto dependency, no async.
 *
 * `hash53` is cyrb53 (public-domain, by bryc). `mulberry32` is a small, fast
 * 32-bit PRNG that is plenty for picking charms and fortunes.
 */

/**
 * 53-bit string hash. Same input → same output on every platform.
 * @param {string} str
 * @param {number} [seed]
 * @returns {number}
 */
export function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Seeded PRNG. Returns a function producing floats in [0, 1).
 * @param {number} seed 32-bit integer
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a PRNG from any string.
 * @param {string} key
 * @returns {() => number}
 */
export function rngFrom(key) {
  return mulberry32(hash53(key) % 4294967296);
}

/**
 * Pick an index in [0, n) from a PRNG.
 * @param {() => number} rng
 * @param {number} n
 */
export function pickIndex(rng, n) {
  return Math.floor(rng() * n);
}

/**
 * Weighted pick. `weights` need not sum to 1.
 * @param {() => number} rng
 * @param {number[]} weights
 * @returns {number} index
 */
export function pickWeighted(rng, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
