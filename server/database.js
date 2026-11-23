import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      handle TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      account INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      account INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      starts INTEGER NOT NULL,
      ends INTEGER NOT NULL CHECK (ends > starts),
      place TEXT NOT NULL,
      notes TEXT NOT NULL,
      source TEXT NOT NULL,
      sourceUrl TEXT NOT NULL,
      externalId TEXT,
      reminder INTEGER,
      due INTEGER,
      version INTEGER NOT NULL DEFAULT 1,
      alarmVersion INTEGER NOT NULL DEFAULT 1,
      UNIQUE (account, source, externalId)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS events_calendar ON events(account, starts);
    CREATE INDEX IF NOT EXISTS events_due ON events(due);
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY,
      account INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      subscription TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS deliveries (
      event TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      device INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      alarmVersion INTEGER NOT NULL,
      next INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (event, device, alarmVersion)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
  return db;
}

export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
