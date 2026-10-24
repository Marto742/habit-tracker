const path = require('node:path')
const express = require('express')
const db = require('./db')
const { todayInBulgaria, lastDays, streak } = require('./days')

const app = express()
const port = 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

function findHabit(id) {
  return db.prepare('SELECT id, name FROM habits WHERE id = ?').get(id)
}

function checkinDates(habitId) {
  return db.prepare('SELECT date FROM checkins WHERE habit_id = ?').all(habitId).map(row => row.date)
}

// A habit as the page shows it: checked today or not, its streak and the last 7 days, oldest first.
function describeHabit(habit, dates, today) {
  const checked = new Set(dates)
  return {
    id: habit.id,
    name: habit.name,
    done: checked.has(today),
    streak: streak(dates, today),
    week: lastDays(today, 7).map(date => ({ date, done: checked.has(date) })),
  }
}

app.get('/api/habits', (req, res) => {
  const today = todayInBulgaria()
  const habits = db.prepare('SELECT id, name FROM habits ORDER BY id').all()
  res.json({ date: today, habits: habits.map(habit => describeHabit(habit, checkinDates(habit.id), today)) })
})

app.post('/api/habits', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ error: 'Name is required' })
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO habits (name) VALUES (?)').run(name)
  res.status(201).json(describeHabit({ id: lastInsertRowid, name }, [], todayInBulgaria()))
})

app.put('/api/habits/:id/today', (req, res) => {
  const habit = findHabit(req.params.id)
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' })
  }
  const today = todayInBulgaria()
  db.prepare('INSERT OR IGNORE INTO checkins (habit_id, date) VALUES (?, ?)').run(habit.id, today)
  res.json(describeHabit(habit, checkinDates(habit.id), today))
})

app.delete('/api/habits/:id/today', (req, res) => {
  const habit = findHabit(req.params.id)
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' })
  }
  const today = todayInBulgaria()
  db.prepare('DELETE FROM checkins WHERE habit_id = ? AND date = ?').run(habit.id, today)
  res.json(describeHabit(habit, checkinDates(habit.id), today))
})

app.listen(port, () => {
  console.log(`Habit tracker listening on http://localhost:${port}`)
})
