const path = require('node:path')
const express = require('express')
const db = require('./db')

const app = express()
const port = 3000

// Today's date in Bulgaria as YYYY-MM-DD (the sv-SE locale formats dates that way).
// toISOString() would give the UTC date, which is still yesterday for the first 2-3 hours after midnight here.
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' })

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

app.get('/api/habits', (req, res) => {
  const habits = db.prepare(`
    SELECT habits.id, habits.name, checkins.date IS NOT NULL AS done
    FROM habits
    LEFT JOIN checkins ON checkins.habit_id = habits.id AND checkins.date = ?
    ORDER BY habits.id
  `).all(today())
  res.json(habits.map(habit => ({ ...habit, done: Boolean(habit.done) })))
})

app.post('/api/habits', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ error: 'Name is required' })
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO habits (name) VALUES (?)').run(name)
  res.status(201).json({ id: lastInsertRowid, name, done: false })
})

app.put('/api/habits/:id/today', (req, res) => {
  if (!db.prepare('SELECT 1 FROM habits WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Habit not found' })
  }
  db.prepare('INSERT OR IGNORE INTO checkins (habit_id, date) VALUES (?, ?)').run(req.params.id, today())
  res.sendStatus(204)
})

app.delete('/api/habits/:id/today', (req, res) => {
  db.prepare('DELETE FROM checkins WHERE habit_id = ? AND date = ?').run(req.params.id, today())
  res.sendStatus(204)
})

app.listen(port, () => {
  console.log(`Habit tracker listening on http://localhost:${port}`)
})
