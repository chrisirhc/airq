CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_test_at INTEGER NOT NULL DEFAULT 0,
  test_status TEXT NOT NULL DEFAULT 'none'
);
CREATE TABLE snapshots (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL
);
