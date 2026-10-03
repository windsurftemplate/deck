-- Memory schema. One encrypted SQLite file per workspace.
-- Embedding dimension is fixed per workspace; vector tables are created in db.ts.

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- What happened: tasks, calls, emails, tool calls, outcomes. Summaries, not transcripts.
CREATE TABLE IF NOT EXISTS episodes (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL,
  agent     TEXT NOT NULL,
  task_id   TEXT,
  kind      TEXT NOT NULL,
  summary   TEXT NOT NULL,
  raw_ref   TEXT,
  outcome   TEXT
);
CREATE INDEX IF NOT EXISTS episodes_ts ON episodes(ts);
CREATE INDEX IF NOT EXISTS episodes_task ON episodes(task_id);

-- What is true, and when. Rows are superseded, never overwritten.
CREATE TABLE IF NOT EXISTS facts (
  id            INTEGER PRIMARY KEY,
  subject       TEXT NOT NULL,
  attribute     TEXT NOT NULL,
  claim         TEXT NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('stated', 'inferred')),
  confidence    REAL NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  valid_from    TEXT NOT NULL,
  valid_to      TEXT,
  superseded_by INTEGER REFERENCES facts(id),
  episode_id    INTEGER REFERENCES episodes(id),
  last_checked  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS facts_current ON facts(subject, attribute) WHERE valid_to IS NULL;

-- Relationships between subjects (people, companies, projects).
CREATE TABLE IF NOT EXISTS edges (
  id         INTEGER PRIMARY KEY,
  from_subj  TEXT NOT NULL,
  relation   TEXT NOT NULL,
  to_subj    TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to   TEXT
);
CREATE INDEX IF NOT EXISTS edges_from ON edges(from_subj) WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS edges_to ON edges(to_subj) WHERE valid_to IS NULL;

-- How to do things. Versioned; only signed skills run outside observe-only.
CREATE TABLE IF NOT EXISTS skills (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  signature  TEXT,
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  successes  INTEGER NOT NULL DEFAULT 0,
  failures   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS goals (
  id         INTEGER PRIMARY KEY,
  goal       TEXT NOT NULL,
  owner      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'dropped')),
  next_check TEXT,
  created_at TEXT NOT NULL
);

-- The owner's approve, reject and edit decisions: the main learning signal.
CREATE TABLE IF NOT EXISTS feedback (
  id        INTEGER PRIMARY KEY,
  ts        TEXT NOT NULL,
  action_id TEXT NOT NULL,
  agent     TEXT NOT NULL,
  verdict   TEXT NOT NULL CHECK (verdict IN ('approve', 'reject', 'edit')),
  before    TEXT,
  after     TEXT,
  reason    TEXT
);

-- Items that need the owner: contradictions with stated facts, skill approvals.
CREATE TABLE IF NOT EXISTS review_queue (
  id         INTEGER PRIMARY KEY,
  ts         TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL,
  channel TEXT NOT NULL,
  role    TEXT NOT NULL,
  text    TEXT NOT NULL
);

-- Keyword search.
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(subject, claim, content='facts', content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(summary, content='episodes', content_rowid='id');
CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(text, content='conversations', content_rowid='id');

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, subject, claim) VALUES (new.id, new.subject, new.claim);
END;
CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episodes_fts(rowid, summary) VALUES (new.id, new.summary);
END;
CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
  INSERT INTO conversations_fts(rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, subject, claim) VALUES ('delete', old.id, old.subject, old.claim);
END;
