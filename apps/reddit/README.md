# Your Lucky Day

**One spin a day. The whole community shares it.**

Every morning at 8:00 am US Eastern, one of six charms is drawn — Clover, Star, Fish, Key, Moon or Acorn — and it's the same charm for everyone, everywhere. Before the draw, members *call it*: they tap the charm they think will land. When the new spin is posted, everyone sees the result together, along with a short fortune and a small "lucky move" for the day (text an old friend, take the stairs once).

Calling it right earns bragging rights and extends your streak. Calling it wrong costs nothing — there is no losing state. Every call in the community fills a shared **luck jar** that unlocks little milestones for the whole subreddit (a sprout, a garden, a wishing well).

## Who it's for

Any community that likes a low-effort daily ritual: a one-tap moment that gives people a reason to come back tomorrow and something harmless to argue about in the comments ("Fish again?!"). It works for general communities, hobby subs, and Discord-style hangout subs alike. It's suitable for all ages.

## What it is not

- **Not gambling.** Nothing is wagered, nothing of monetary value is awarded, and chance is always free. There are no purchases in this app.
- **Not a bot that spams.** It creates exactly one post per day, at 8:00 am Eastern, and never comments.
- **Not a data collector.** The app stores only which charm a Reddit user called on which day (to compute their streak and history), the daily tallies, and — only for members who opt in to the leaderboard — their username. Nothing leaves Reddit.

## How to use it (moderators)

1. Install the app on your subreddit. It immediately creates today's post.
2. From then on it posts once a day at 8:00 am US Eastern, automatically. Each post owns its day: once a newer spin is out, an older post keeps showing its own day's result and what the member called for it, with a note that today's spin is in the newest post.
3. Want a post right now (for example after a quiet install)? Use the subreddit menu: **[Your Lucky Day] Post today's spin**.
4. Consider pinning the day's post, or giving it a flair. That's it — there are no settings to maintain.

## How to play (members)

- Open the post. The big charm is today's result; the text under it is today's fortune.
- Tap one of the six small charms to call tomorrow's. You can change your mind until 8:00 am Eastern.
- Tap **Streak, jar & share** to see your streak, the community jar, what everyone called, and to share a spoiler-free result card. The same view has your history calendar, this community's stats, and the leaderboard.
- Logged-out visitors can see the spin but need to sign in to call a charm.

## History, stats and leaderboard

The full view adds three sections. **Your history** is a month calendar of what was drawn each day and whether your call landed, plus your own numbers (calls, hits, hit rate, best streak, favorite charm). **This community** shows lifetime totals for the subreddit: calls, hit rate next to the 1-in-6 chance baseline, the most-called charm, and the best day. **Leaderboard** lists the top 10 by current streak and by calls that landed.

The leaderboard is opt-in and off by default. Nobody appears on it until they turn on "Show me on the leaderboard" themselves, and turning it off removes them from both lists and deletes their stored username straight away.

What is stored, per subreddit installation, all in Reddit's own Redis:

- the Reddit user id and the charm that user called on each day (this is the streak and history record);
- the username, only for a user who has opted in to the leaderboard, and only while they stay opted in;
- that user's leaderboard choice, and for opted-in users their streak and hit count;
- per-day call tallies, the charm drawn each day, and the community totals above, none of which identify anyone.

None of this leaves Reddit. A member's own history and stats are shown only to that member; the only thing other people ever see about a member is their leaderboard row, if they opted in.

## Operational notes

- The daily draw is deterministic from a server-side secret plus the date, so nobody — including the developer — can steer or predict it, and every community on Reddit sees the same charm on the same day. Tallies and the luck jar are per community.
- The post uses Reddit's realtime channel so the tally bars update live while people are calling.
- If a day's post is missing (Reddit outage at 8 am, say), the next hourly check posts it, or a moderator can use the menu item.
- Do not rotate the DAILY_SALT setting once live; past posts and the calendar recompute from it.
- A day's result is recorded when that day's post is created, and that is also when the community stats and leaderboard are updated, once per day. If a post was missed, the next one catches up on the days in between (up to a week).
- Data retention: per-day tallies and call lists expire after 60 days; a user's own history, the drawn charm for each day, the community totals and the opt-in leaderboard are kept. Uninstalling the app removes all of it with the installation.

## Built by

Chris Bratkovics. Questions or ideas: message u/cbracky66 or post in r/YourLuckyDay.

---

### For developers

```
npm install
npx devvit login
npx devvit settings set DAILY_SALT     # paste a long random string
npm run playtest                       # builds, uploads, streams logs; opens r/your-lucky-day_dev
npm run publish                        # submit for review
```

Layout: `src/server` (Node, single CJS bundle via esbuild), `src/client` (two entrypoints: `inline` for the feed, `expanded` for the full view), `public/` (static HTML/CSS, bundled JS output), and the shared game core in `../../packages/core` (included in the review bundle via `additionalSourceRoots`). Scheduler runs at 12:00 and 13:00 UTC; the handler posts only when it's 8:00 am America/New_York and no post exists yet for that day, which makes daylight-saving time a non-event.
