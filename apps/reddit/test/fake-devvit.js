// In-memory stand-in for @devvit/web/server, wired in by hooks.js for tests.
export const store = { kv: new Map(), hashes: new Map(), zsets: new Map(), sent: [], posts: [] };
export let ctx = { userId: "t2_alice", subredditName: "testsub", postId: "t3_x" };
export const setContext = (c) => { ctx = c; };
export const context = new Proxy({}, { get: (_, k) => ctx[k] });
const h = (k) => (store.hashes.has(k) ? store.hashes.get(k) : (store.hashes.set(k, new Map()), store.hashes.get(k)));
const z = (k) => (store.zsets.has(k) ? store.zsets.get(k) : (store.zsets.set(k, new Map()), store.zsets.get(k)));
// Ascending by score, then member — the order Redis keeps a sorted set in.
const sorted = (k) => [...z(k)].map(([member, score]) => ({ member, score })).sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));
export const redis = {
  async get(k) { return store.kv.get(k); },
  async set(k, v) { store.kv.set(k, v); return "OK"; },
  async incrBy(k, n) { const v = Number(store.kv.get(k) ?? 0) + n; store.kv.set(k, String(v)); return v; },
  async expire() {},
  async hGetAll(k) { return Object.fromEntries(h(k)); },
  async hGet(k, f) { return h(k).get(f); },
  async hSet(k, fv) { for (const [f, v] of Object.entries(fv)) h(k).set(f, v); return 1; },
  async hIncrBy(k, f, n) { const v = Number(h(k).get(f) ?? 0) + n; h(k).set(f, String(v)); return v; },
  async hSetNX(k, f, v) { if (h(k).has(f)) return 0; h(k).set(f, v); return 1; },
  async hMGet(k, fs) { return fs.map((f) => h(k).get(f) ?? null); },
  async hDel(k, fs) { return fs.filter((f) => h(k).delete(f)).length; },
  async zAdd(k, ...ms) { for (const m of ms) z(k).set(m.member, m.score); return ms.length; },
  async zIncrBy(k, m, n) { const v = (z(k).get(m) ?? 0) + n; z(k).set(m, v); return v; },
  async zRem(k, ms) { return ms.filter((m) => z(k).delete(m)).length; },
  async zScore(k, m) { return z(k).get(m); },
  async zCard(k) { return z(k).size; },
  async zRange(k, start, stop, opts) {
    const a = sorted(k);
    if (opts?.by === "score") return a.filter((e) => e.score >= start && e.score <= stop);
    if (opts?.reverse) a.reverse();
    return a.slice(start, stop < 0 ? a.length + stop + 1 : stop + 1);
  },
};
export const settings = { async get(k) { return k === "DAILY_SALT" ? "test-salt" : undefined; } };
export const realtime = { async send(channel, msg) { store.sent.push({ channel, msg }); } };
export const reddit = {
  async getCurrentUsername() { return ctx.userId ? ctx.username ?? ctx.userId.replace(/^t2_/, "") : undefined; },
  async submitCustomPost(o) { const p = { id: `t3_${store.posts.length + 1}`, url: "https://reddit.com/x", ...o }; store.posts.push(p); return p; },
};
export const createServer = () => ({ on() {}, listen() {} });
export const getServerPort = () => 3000;
