# Your Lucky Day

**One spin a day. The whole world shares it.**

Every morning at 8:00 ET one charm is drawn for everyone on Earth. Before that,
you *call it* — pick the charm you think will land. Everyone sees the same spin,
the same fortune, the same lucky move. Calling it right earns sparkle and extends
your streak. Every call fills a shared jar that unlocks things for everybody.

Nobody ever loses. Chance is always free. Purchases are always certain.

## Stack (zero build step, by design)

```
packages/core/   pure JS ESM: seeded outcome, 08:00 ET clock (DST-safe), streaks, themed fortunes, history stats, share card — 39 tests
apps/web/        static PWA (HTML/CSS/JS, no framework, no bundler)
apps/worker/     Cloudflare Worker: serves the site + JSON API; D1 for tallies and community stats — 19 tests
apps/reddit/     Devvit app (Day 2) reusing the same core
scripts/         sync-core.js copies packages/core → apps/web/core before deploy
```

No dependencies. Nothing to rebuild when a package updates, because there are no packages.
Node ≥ 22 for tests and the local dev server (`node:sqlite` stands in for D1).

## Run it locally (60 seconds)

```bash
npm test          # 58 tests, ~250 ms
npm run dev       # http://localhost:8787 — real API against a local SQLite file
```

Open the URL on your phone via your Mac's LAN IP to feel it on a real screen.

## Deploy to Cloudflare (free tier; ~15 minutes)

1. `npm i -g wrangler && wrangler login`
2. `cd apps/worker && wrangler d1 create yourluckyday` → paste the `database_id` into `wrangler.toml`
3. `wrangler d1 execute yourluckyday --file=schema.sql --remote`
   (a database created before 0.2 needs only `--file=migrations/0002-history.sql`; run it before deploying 0.2)
4. Secrets (long random strings; `openssl rand -hex 32` works):
   ```bash
   wrangler secret put DAILY_SALT
   wrangler secret put UNLOCK_SECRET
   wrangler secret put POLAR_TOKEN        # after step 6; can skip on day 1
   ```
5. `cd ../.. && npm run deploy` → you get a `*.workers.dev` URL immediately.
6. Custom domain: Cloudflare dashboard → Workers → yourluckyday → Settings → Domains → add `yourluckyday.fyi`
   (register the domain at Cloudflare Registrar so DNS is automatic).

## Turn on the charm pack (Polar)

1. Polar → Products → new one-time product "Charm pack", $9, digital.
2. Create a Checkout Link for it. Success URL: `https://yourluckyday.fyi/?checkout_id={CHECKOUT_ID}`
3. Paste the checkout link into `apps/web/config.js` → `polarCheckoutUrl`.
4. Polar → Settings → Access tokens → create a token with `checkouts:read`. `wrangler secret put POLAR_TOKEN`.
5. Put the product id in `wrangler.toml` → `POLAR_PRODUCT_ID`. Redeploy.

Flow: buyer pays on Polar → redirected back with `checkout_id` → the Worker verifies it with
Polar's API → returns a signed unlock token stored in the buyer's browser. No accounts, no emails
touch your server. The checkout id is stored once so it can't be reused on another device
(a buyer restores by reopening their Polar receipt link on the device they want).

## Operating notes

- **Rotate `DAILY_SALT` monthly** (`wrangler secret put DAILY_SALT`). Past days don't need to be recomputable; the client stores results locally.
- **Content**: add fortunes in `packages/core/fortunes.js` (one set per charm) and lucky moves in `packages/core/content.js`, run `npm test` (a test blocks money/winning language), `npm run deploy`.
- **Abuse**: one call per random id per day; a scripted flood only inflates a tally, never anyone's money. If a day looks gamed, `DELETE FROM tallies WHERE day='…'` and move on.
- **Costs**: Workers free tier = 100k requests/day; D1 free = 5M reads/100k writes per day. At those limits the game has ~50k daily players; upgrade is $5/month.

## Rules the game keeps on purpose

- No paid spins, no random paid rewards, no cash or prizes, no ads, no accounts, no tracking.
- Purchases are cosmetic and deterministic. That keeps it out of sweepstakes/gambling law and inside every platform's policy.
- Never describe it as "passive income" or "win money" anywhere public.

## License

Source © 2026 Chris Bratkovics. All rights reserved for now; the `packages/core` folder may be
relicensed MIT later. The game content is original.
