const form = document.querySelector('#new-habit')
const list = document.querySelector('#habits')
const rows = new Map()
let clicks = 0

function createRow(habit) {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'

  const label = document.createElement('label')
  label.append(checkbox, habit.name)

  const stats = document.createElement('span')
  stats.className = 'stats'

  checkbox.addEventListener('change', async () => {
    clicks++
    checkbox.disabled = true
    try {
      const res = await fetch(`/api/habits/${habit.id}/today`, { method: checkbox.checked ? 'PUT' : 'DELETE' })
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
  const clicksBefore = clicks
  const res = await fetch('/api/habits').catch(() => null)
  if (!res?.ok) return
  const { habits } = await res.json()
  // If this page sent a check meanwhile, the answer may predate it. Skip it; the next load catches up.
  if (clicks !== clicksBefore || list.querySelector('input:disabled')) return
  for (const habit of habits) showHabit(habit)
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const name = new FormData(form).get('name').trim()
  if (!name) return

  const res = await fetch('/api/habits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (res.ok) {
    showHabit(await res.json())
    form.reset()
  }
})

loadHabits()
setInterval(loadHabits, 30 * 1000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadHabits()
})
window.addEventListener('focus', loadHabits)
