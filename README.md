# Your Lucky Day

[![CI](https://github.com/cbratkovics/your-lucky-day/actions/workflows/ci.yml/badge.svg)](https://github.com/cbratkovics/your-lucky-day/actions/workflows/ci.yml)

**One spin a day. The whole world shares it.**

Every morning at 8:00 am Eastern, one of six charms is drawn for everyone. Before
the draw you *call it*: pick the charm you think will land. Everyone then sees the
same spin, the same fortune and the same small "lucky move" for the day. Calling it
right earns sparkle and extends your streak, and every call fills a shared jar that
unlocks milestones for everybody. Nobody ever loses, there is nothing to wager, and
it takes one tap a day. It runs as a web app and as a Reddit app, both built on one
small shared core.

**Play:** [yourluckyday.fyi](https://yourluckyday.fyi) · **Community:** [r/YourLuckyDay](https://www.reddit.com/r/YourLuckyDay)

## How it works

```
                packages/core   pure ES modules, zero dependencies
      seeded outcome · 08:00 ET game clock · streaks · history · share text
                 |                                      |
    copied by scripts/sync-core.js              bundled by esbuild
                 v                                      v
  apps/web      static PWA                  apps/reddit   Devvit Web app
  apps/worker   Cloudflare Worker           one post a day, played inside Reddit
                 |                                      |
                 v                                      v
  Cloudflare D1: tallies, calls,            Reddit-hosted Redis, per subreddit:
  outcomes, counters                        tallies, calls, opt-in leaderboard
```

### One core, two surfaces

```
packages/core/   pure JS ESM: seeded outcome, 08:00 ET clock (DST-safe), streaks, themed fortunes, history stats, share card — 50 tests
apps/web/        static PWA (HTML/CSS/JS, no framework, no bundler)
apps/worker/     Cloudflare Worker: serves the site + JSON API; D1 for tallies and community stats — 24 tests
apps/reddit/     Devvit app reusing the same core — 40 tests
scripts/         sync-core.js copies packages/core → apps/web/core before deploy
```

The core, the web app and the Worker have no npm dependencies and no build step.
There is nothing to rebuild when a package updates, because there are no packages.
The Reddit app is the one exception: Reddit's platform requires its Devvit SDK, and
esbuild bundles the client and server for it.

- **Web.** `apps/web` is a static, installable PWA. The Worker serves it and a small
  JSON API (`/api/today`, `/api/call`, `/api/community`, `/api/unlock`). A player is a
  random id generated in the browser; their history lives in `localStorage`, and the
  server keeps only that id's call for the day and the running tallies.
- **Reddit.** `apps/reddit` creates one post per day in a subreddit. Members call a
  charm with a tap in the feed; the expanded view adds a history calendar, community
  stats and an opt-in leaderboard. Its own [README](apps/reddit/README.md) covers
  moderators, members and what is stored.

### The seeded daily outcome

The day's result is a pure function, `computeOutcome(salt, dayKey)` in
`packages/core/outcome.js`. The salt and the date seed a small PRNG, which then draws,
in order: the charm (one of six), the sparkle tier (bright, silver or golden, weighted
70/25/5), a fortune from that charm's own set of 18, and a lucky move.

The salt is a server-side secret, so nobody can compute tomorrow's spin in advance,
and everyone asking the same server about the same day gets the same answer. No
outcome is stored ahead of time and nothing about a player feeds into it.

### The 08:00 America/New_York game clock

The whole game runs on one clock (`packages/core/day.js`). A game day is named by the
date of its reveal: calls for day D open at the reveal on D-1 and close at 08:00
Eastern on D, when D's result appears and calls for D+1 open. Every function takes
`now` as an argument, so the clock is pure and is tested on a daylight-saving changeover day.
On Reddit the scheduler fires at both 12:00 and 13:00 UTC and the handler posts only
when it is 08:00 in New York and that day has no post yet, which makes the DST switch
a non-event.

## Design rules

The game keeps these on purpose.

- **Chance is always free.** No paid spins, no random paid rewards, no cash or prizes.
- **Purchases are always certain.** The only purchase is a one-time charm pack on the
  web (charm skins and a monthly streak freeze): nothing random, and you get exactly
  what it says. That keeps the game out of sweepstakes and gambling law and inside
  every platform's policy.
- **No accounts.** The web app identifies a browser by a random id. The Reddit app
  uses the Reddit login the member already has, and nothing more.
- **No tracking, no ads.** The only thing ever aggregated is how many people called
  each charm.
- **No off-platform links in the Reddit app.** The Reddit app and the shared core
  never link to or mention the website; there are no purchases on Reddit.
- **Nobody loses.** Every outcome is positive, and a test blocks money or winning
  language from the game's content. It is never described as passive income or a way
  to win money.

## Run it locally

Node ≥ 22 (`node:sqlite` stands in for D1). About 60 seconds:

```bash
npm test          # 74 tests, ~300 ms
npm run dev       # http://localhost:8787 — real API against a local SQLite file
```

Open the URL on your phone via your Mac's LAN IP to feel it on a real screen.

The Reddit tests run against an in-memory stand-in for Devvit and need no install:

```bash
cd apps/reddit && node --import ./test/register.js --test "test/*.test.js"   # 40 tests
```

## Operating

### Deploy to Cloudflare (free tier; ~15 minutes)

1. `npm i -g wrangler && wrangler login`
2. `cd apps/worker && wrangler d1 create yourluckyday` → paste the `database_id` into `wrangler.toml`
3. `wrangler d1 execute yourluckyday --file=schema.sql --remote`
   (a database created before 0.2 needs only `--file=migrations/0002-history.sql`; run it before deploying 0.2)
4. Secrets (long random strings; `openssl rand -hex 32` works):
   ```bash
   wrangler secret put DAILY_SALT
   wrangler secret put UNLOCK_SECRET
   wrangler secret put POLAR_TOKEN        # once the charm pack below is set up; can skip on day 1
   ```
5. `cd ../.. && npm run deploy` → you get a `*.workers.dev` URL immediately.
6. Custom domain: Cloudflare dashboard → Workers → yourluckyday → Settings → Domains → add `yourluckyday.fyi`
   (register the domain at Cloudflare Registrar so DNS is automatic).

### Turn on the charm pack (Polar)

1. Polar → Products → new one-time product "Charm pack", $9, digital.
2. Create a Checkout Link for it. Success URL: `https://yourluckyday.fyi/?checkout_id={CHECKOUT_ID}`
3. Paste the checkout link into `apps/web/config.js` → `polarCheckoutUrl`.
4. Polar → Settings → Access tokens → create a token with `checkouts:read`. `wrangler secret put POLAR_TOKEN`.
5. Put the product id in `wrangler.toml` → `POLAR_PRODUCT_ID`. Redeploy.

Flow: buyer pays on Polar → redirected back with `checkout_id` → the Worker verifies it with
Polar's API → returns a signed unlock token stored in the buyer's browser. No accounts, no emails
touch your server. The checkout id is stored once so it can't be reused on another device
(a buyer restores by reopening their Polar receipt link on the device they want).

### Operating notes

- **Rotate `DAILY_SALT` monthly** on the Worker (`wrangler secret put DAILY_SALT`). Past days don't need to be recomputable; the client stores results locally. The Reddit app is the opposite: its salt must not change once live (see its README).
- **Content**: add fortunes in `packages/core/fortunes.js` (one set per charm) and lucky moves in `packages/core/content.js`, run `npm test` (a test blocks money/winning language), `npm run deploy`.
- **Abuse**: one call per random id per day; a scripted flood only inflates a tally, never anyone's money. If a day looks gamed, `DELETE FROM tallies WHERE day='…'` and move on.
- **Costs**: Workers free tier = 100k requests/day; D1 free = 5M reads/100k writes per day. At those limits the game has ~50k daily players; upgrade is $5/month.

## Built with

Designed and directed by Chris Bratkovics. Most first-draft code was written with
Claude; all of it was reviewed and tested.

## License

[MIT](LICENSE) © 2026 Christopher Bratkovics. The game content is original.
