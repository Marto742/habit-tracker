const authForm = document.querySelector('#auth-form')
const authError = document.querySelector('#auth-error')
const account = document.querySelector('#account')
const userName = document.querySelector('#user-name')
const form = document.querySelector('#new-habit')
const list = document.querySelector('#habits')
const rows = new Map()
// Bumped by everything this page changes on its own: a click, logging in, logging out.
let changes = 0

// Also clears the habits, so whoever logs in next in this tab doesn't see them.
function showLogin() {
  changes++
  rows.clear()
  list.replaceChildren()
  account.hidden = true
  authForm.hidden = false
}

function showHabits(user) {
  changes++
  userName.textContent = user.name
  authForm.hidden = true
  account.hidden = false
  loadHabits()
}

// fetch, but if the session is gone (logged out in another tab, or expired), back to the login form.
async function api(path, options) {
  const res = await fetch(path, options)
  if (res.status === 401) showLogin()
  return res
}

function createRow(habit) {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'

  const label = document.createElement('label')
  label.append(checkbox, habit.name)

  const stats = document.createElement('span')
  stats.className = 'stats'

  checkbox.addEventListener('change', async () => {
    changes++
    checkbox.disabled = true
    try {
      const res = await api(`/api/habits/${habit.id}/today`, { method: checkbox.checked ? 'PUT' : 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      showHabit(await res.json())
    } catch {
      checkbox.checked = !checkbox.checked
    } finally {
      checkbox.disabled = false
    }
  })

  const item = document.createElement('li')
  item.append(label, stats)
  return { item, checkbox, stats }
}

// Shows a habit. A row that is already on the page is updated in place,
// so a focused checkbox keeps its focus.
function showHabit(habit) {
  let row = rows.get(habit.id)
  if (!row) {
    row = createRow(habit)
    rows.set(habit.id, row)
    list.append(row.item)
  }
  row.checkbox.checked = habit.done
  renderStats(row.stats, habit)
}

// The last 7 days as squares (oldest first, today last) and the streak.
function renderStats(stats, habit) {
  const week = document.createElement('span')
  week.className = 'week'
  for (const day of habit.week) {
    const square = document.createElement('span')
    square.className = day.done ? 'day done' : 'day'
    const [, month, dayOfMonth] = day.date.split('-')
    square.title = `${dayOfMonth}.${month}`
    week.append(square)
  }

  const streak = document.createElement('span')
  streak.className = habit.streak ? 'streak' : 'streak zero'
  streak.title = 'Поредни дни'
  streak.textContent = `🔥 ${habit.streak}`

  stats.replaceChildren(week, streak)
}

// Brings the page in line with the server: checks made on another device or in another tab,
// and the new day after midnight.
async function loadHabits() {
  if (account.hidden) return
  const changesBefore = changes
  const res = await api('/api/habits').catch(() => null)
  if (!res?.ok) return
  const { habits } = await res.json()
  // If this page changed something meanwhile, the answer may be out of date. Skip it; the next load catches up.
  if (changes !== changesBefore || list.querySelector('input:disabled')) return
  for (const habit of habits) showHabit(habit)
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const action = event.submitter?.value === 'register' ? 'register' : 'login'
  const { name, password } = Object.fromEntries(new FormData(authForm))
  const res = await fetch(`/api/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  })
  const body = await res.json()
  if (!res.ok) {
    authError.textContent = body.error
    return
  }
  authForm.reset()
  authError.textContent = ''
  showHabits(body)
})

document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' })
  showLogin()
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const name = new FormData(form).get('name').trim()
  if (!name) return

  const res = await api('/api/habits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (res.ok) {
    showHabit(await res.json())
    form.reset()
  }
})

async function start() {
  const res = await fetch('/api/me').catch(() => null)
  if (res?.ok) showHabits(await res.json())
  else showLogin()
}

start()
setInterval(loadHabits, 30 * 1000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadHabits()
})
window.addEventListener('focus', loadHabits)
