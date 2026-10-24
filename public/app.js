const form = document.querySelector('#new-habit')
const list = document.querySelector('#habits')
let shownDate

function renderHabit(habit) {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = habit.done

  const label = document.createElement('label')
  label.append(checkbox, habit.name)

  const stats = document.createElement('span')
  stats.className = 'stats'
  renderStats(stats, habit)

  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true
    try {
      const res = await fetch(`/api/habits/${habit.id}/today`, { method: checkbox.checked ? 'PUT' : 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      renderStats(stats, await res.json())
    } catch {
      checkbox.checked = !checkbox.checked
    } finally {
      checkbox.disabled = false
    }
  })

  const item = document.createElement('li')
  item.append(label, stats)
  return item
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

// The list shows one day's checks. Re-render only when the server's date has changed,
// so a page left open past midnight doesn't keep showing yesterday's checks as today's.
async function loadHabits() {
  const res = await fetch('/api/habits')
  const { date, habits } = await res.json()
  if (date === shownDate) return
  shownDate = date
  list.replaceChildren(...habits.map(renderHabit))
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
    list.append(renderHabit(await res.json()))
    form.reset()
  }
})

loadHabits()
setInterval(loadHabits, 60 * 1000)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadHabits()
})
