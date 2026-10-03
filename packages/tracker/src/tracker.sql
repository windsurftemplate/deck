-- Local issue tracker. Lives in the same encrypted workspace database as memory.
CREATE TABLE IF NOT EXISTS issues (
  id         INTEGER PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'blocked', 'done', 'cancelled')),
  priority   INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
  labels     TEXT NOT NULL DEFAULT '[]',
  assignee   TEXT,
  due        TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS issues_open ON issues(status, priority);

CREATE TABLE IF NOT EXISTS issue_events (
  id       INTEGER PRIMARY KEY,
  issue_id INTEGER NOT NULL REFERENCES issues(id),
  ts       TEXT NOT NULL,
  actor    TEXT NOT NULL,
  kind     TEXT NOT NULL,
  detail   TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS issues_fts USING fts5(title, body, content='issues', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS issues_ai AFTER INSERT ON issues BEGIN
  INSERT INTO issues_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS issues_au AFTER UPDATE OF title, body ON issues BEGIN
  INSERT INTO issues_fts(issues_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO issues_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
