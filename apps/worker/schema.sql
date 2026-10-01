-- D1 schema for Your Lucky Day. Apply with:
--   wrangler d1 execute yourluckyday --file=schema.sql --remote

-- One row per (game day, charm): how many people called that charm.
CREATE TABLE IF NOT EXISTS tallies (
  day   TEXT NOT NULL,
  charm INTEGER NOT NULL,
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, charm)
);

-- One row per (game day, anonymous player id): prevents double calls and lets
-- a player change their mind before the reveal.
CREATE TABLE IF NOT EXISTS calls (
  day       TEXT NOT NULL,
  player    TEXT NOT NULL,
  charm     INTEGER NOT NULL,
  called_at INTEGER NOT NULL,
  PRIMARY KEY (day, player)
);

-- Lifetime counter for the community luck jar.
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  n   INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO counters (key, n) VALUES ('calls_total', 0);

-- Charm-pack unlocks, keyed by Polar checkout id so a checkout can't be reused.
CREATE TABLE IF NOT EXISTS unlocks (
  checkout_id TEXT PRIMARY KEY,
  player      TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- ---- 0.2: history & community stats ----
-- Everything below is also in migrations/0002-history.sql, for a database created before 0.2.

-- What was drawn each game day, written by the first /api/today request of that day.
CREATE TABLE IF NOT EXISTS outcomes (
  day   TEXT PRIMARY KEY,
  charm INTEGER NOT NULL
);

-- Community stats, kept in `counters`. Hits and settled calls are added once per
-- day when that day's outcome is first recorded. best_day is stored as YYYYMMDD.
INSERT OR IGNORE INTO counters (key, n) VALUES ('total_hits', 0);
INSERT OR IGNORE INTO counters (key, n) VALUES ('settled_calls', 0);
INSERT OR IGNORE INTO counters (key, n) VALUES ('best_day', 0);
INSERT OR IGNORE INTO counters (key, n) VALUES ('best_day_hits', 0);

-- Lifetime calls per charm. Seeded from the tallies already in the table, which
-- is zero on a fresh database.
INSERT OR IGNORE INTO counters (key, n) SELECT 'charm_calls:0', COALESCE(SUM(n), 0) FROM tallies WHERE charm = 0;
INSERT OR IGNORE INTO counters (key, n) SELECT 'charm_calls:1', COALESCE(SUM(n), 0) FROM tallies WHERE charm = 1;
INSERT OR IGNORE INTO counters (key, n) SELECT 'charm_calls:2', COALESCE(SUM(n), 0) FROM tallies WHERE charm = 2;
INSERT OR IGNORE INTO counters (key, n) SELECT 'charm_calls:3', COALESCE(SUM(n), 0) FROM tallies WHERE charm = 3;
INSERT OR IGNORE INTO counters (key, n) SELECT 'charm_calls:4', COALESCE(SUM(n), 0) FROM tallies WHERE charm = 4;
INSERT OR IGNORE INTO counters (key, n) SELECT 'charm_calls:5', COALESCE(SUM(n), 0) FROM tallies WHERE charm = 5;
