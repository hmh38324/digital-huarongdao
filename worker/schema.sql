CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  moves INTEGER NOT NULL,
  time_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rank ON scores (moves ASC, time_ms ASC, created_at ASC);


