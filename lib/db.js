import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(process.cwd(), 'data'));
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = path.join(DATA_DIR, 'kanban.db');

// Schema is plain SQL so the WeKan importer (and humans with sqlite3) can rely on it.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT,
  full_name     TEXT,
  password_hash TEXT,
  -- 'bcrypt' = bcrypt(password); 'meteor' = bcrypt(sha256hex(password)) as stored by WeKan/Meteor.
  -- meteor hashes are upgraded to plain bcrypt on the next successful login.
  password_algo TEXT NOT NULL DEFAULT 'bcrypt',
  is_admin      INTEGER NOT NULL DEFAULT 0,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS boards (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  position   REAL NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS board_members (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS lists (
  id         TEXT PRIMARY KEY,
  board_id   TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  position   REAL NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  list_id     TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position    REAL NOT NULL DEFAULT 0,
  archived    INTEGER NOT NULL DEFAULT 0,
  due_at      TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  card_id      TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename     TEXT NOT NULL,
  mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         INTEGER NOT NULL DEFAULT 0,
  -- path relative to UPLOADS_DIR
  storage_path TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_lists_board    ON lists(board_id, position);
CREATE INDEX IF NOT EXISTS idx_cards_list     ON cards(list_id, position);
CREATE INDEX IF NOT EXISTS idx_cards_board    ON cards(board_id);
CREATE INDEX IF NOT EXISTS idx_comments_card  ON comments(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attach_card    ON attachments(card_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
`;

export function openDb(file = DB_PATH) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

// One connection per server process; survive Next.js dev hot reloads.
export function getDb() {
  if (!globalThis.__kanbanDb) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    globalThis.__kanbanDb = openDb();
  }
  return globalThis.__kanbanDb;
}

export function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

export function now() {
  return new Date().toISOString();
}
