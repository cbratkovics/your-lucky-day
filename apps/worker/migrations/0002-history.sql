-- 0.2 "History & stats": adds the outcomes table and the community-stats counters
-- to a database created from the 0.1 schema. Safe to run more than once.
--   wrangler d1 execute yourluckyday --file=migrations/0002-history.sql --remote

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
