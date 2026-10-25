const authForm = document.querySelector('#auth-form')
const authError = document.querySelector('#auth-error')
const account = document.querySelector('#account')
const userName = document.querySelector('#user-name')
const form = document.querySelector('#new-habit')
const list = document.querySelector('#habits')
const rows = new Map()
let shownUser = null
// Bumped by everything this page changes on its own: a click, logging in, logging out.
let changes = 0

// Also clears the habits, so whoever logs in next in this tab doesn't see them.
function showLogin() {
  changes++
  shownUser = null
  rows.clear()
  list.replaceChildren()
  account.hidden = true
  authForm.hidden = false
}

// Shows the habits view of `name`. If the page showed another account (another tab logged in
// as someone else), its habits are cleared first, so the two never mix.
function showAccount(name) {
  if (name !== shownUser) {
    changes++
    shownUser = name
    userName.textContent = name
    rows.clear()
    list.replaceChildren()
  }
  authForm.hidden = true
  account.hidden = false
}

// fetch for changing habits. 401 means logged out, 404 that the habit isn't this account's:
// either way another tab may have logged out or switched accounts, so sync to find out.
async function api(path, options) {
  const res = await fetch(path, options)
  if (res.status === 401 || res.status === 404) sync()
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

// Brings the page in line with the server: who is logged in (another tab may have logged out,
// in, or as someone else), checks made on another device, and the new day after midnight.
async function sync() {
  const changesBefore = changes
  const res = await fetch('/api/habits').catch(() => null)
  const data = res?.ok ? await res.json() : null
  // If this page changed something meanwhile, the answer may be out of date. Skip it; the next sync catches up.
  if (changes !== changesBefore || list.querySelector('input:disabled')) return
  if (res?.status === 401) return showLogin()
  if (!data) return
  showAccount(data.user)
  for (const habit of data.habits) showHabit(habit)
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
  showAccount(body.name)
  sync()
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

sync()
setInterval(() => {
  if (!account.hidden) sync()
}, 30 * 1000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sync()
})
window.addEventListener('focus', sync)
