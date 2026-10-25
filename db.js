const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

// DB_FILE lets the tests use a database of their own.
const file = process.env.DB_FILE || path.join(__dirname, 'habits.db')
let db = new DatabaseSync(file)

// A database from before accounts (stages 2-3) has habits without an owner, and
// CREATE TABLE IF NOT EXISTS won't add user_id to it. Those habits can't safely be
// given to any account, so the old file is kept as a backup and a new one is started.
const { user_version: version } = db.prepare('PRAGMA user_version').get()
const hasOldTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'habits'").get()
if (version === 0 && hasOldTables) {
  db.close()
  const backup = path.join(path.dirname(file), 'habits-before-accounts.db')
  fs.renameSync(file, backup)
  db = new DatabaseSync(file)
  console.log(`Found a database from before accounts: moved it to ${backup} and started a new one.`)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL, -- YYYY-MM-DD, Bulgarian time
    PRIMARY KEY (habit_id, date)
  );

  PRAGMA user_version = 1;
`)

module.exports = db
