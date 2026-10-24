const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const db = new DatabaseSync(path.join(__dirname, 'habits.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkins (
    habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
    date TEXT NOT NULL, -- YYYY-MM-DD, Bulgarian time
    PRIMARY KEY (habit_id, date)
  );
`)

module.exports = db
