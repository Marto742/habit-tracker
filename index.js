const path = require('node:path')
const express = require('express')
const db = require('./db')
const auth = require('./auth')
const { todayInBulgaria, lastDays, streak } = require('./days')

const app = express()
const port = 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Names are stored in lowercase, so "Marto" and "marto" are the same account.
function readCredentials(body) {
  return {
    name: typeof body?.name === 'string' ? body.name.trim().toLowerCase() : '',
    password: typeof body?.password === 'string' ? body.password : '',
  }
}

app.post('/api/register', async (req, res) => {
  const { name, password } = readCredentials(req.body)
  if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(name)) {
    return res.status(400).json({ error: 'Името трябва да е от 3 до 30 знака: букви, цифри, _ . -' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Паролата трябва да е поне 8 знака' })
  }
  const user = await auth.createUser(name, password)
  if (!user) {
    return res.status(409).json({ error: 'Това име вече е заето' })
  }
  auth.startSession(res, user.id)
  res.status(201).json({ name: user.name })
})

app.post('/api/login', async (req, res) => {
  const { name, password } = readCredentials(req.body)
  const user = await auth.findUserByPassword(name, password)
  if (!user) {
    // One message for an unknown name and a wrong password, so it doesn't reveal which names exist.
    return res.status(401).json({ error: 'Грешно име или парола' })
  }
  auth.startSession(res, user.id)
  res.json({ name: user.name })
})

app.post('/api/logout', (req, res) => {
  auth.endSession(req, res)
  res.sendStatus(204)
})

app.get('/api/me', auth.requireUser, (req, res) => {
  res.json({ name: req.user.name })
})

// Everything under /api/habits needs a logged-in user, and every query below is limited to req.user.
app.use('/api/habits', auth.requireUser)

function findHabit(userId, id) {
  return db.prepare('SELECT id, name FROM habits WHERE id = ? AND user_id = ?').get(id, userId)
}

// Only called for habits that already passed the user check.
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
  const habits = db.prepare('SELECT id, name FROM habits WHERE user_id = ? ORDER BY id').all(req.user.id)
  res.json({ date: today, habits: habits.map(habit => describeHabit(habit, checkinDates(habit.id), today)) })
})

app.post('/api/habits', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name) {
    return res.status(400).json({ error: 'Name is required' })
  }
  const { lastInsertRowid } = db.prepare('INSERT INTO habits (user_id, name) VALUES (?, ?)').run(req.user.id, name)
  res.status(201).json(describeHabit({ id: lastInsertRowid, name }, [], todayInBulgaria()))
})

app.put('/api/habits/:id/today', (req, res) => {
  const habit = findHabit(req.user.id, req.params.id)
  if (!habit) {
    return res.status(404).json({ error: 'Habit not found' })
  }
  const today = todayInBulgaria()
  db.prepare('INSERT OR IGNORE INTO checkins (habit_id, date) VALUES (?, ?)').run(habit.id, today)
  res.json(describeHabit(habit, checkinDates(habit.id), today))
})

app.delete('/api/habits/:id/today', (req, res) => {
  const habit = findHabit(req.user.id, req.params.id)
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
