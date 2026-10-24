const form = document.querySelector('#new-habit')
const list = document.querySelector('#habits')
let shownDate

function renderHabit(habit) {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.checked = habit.done
  checkbox.addEventListener('change', async () => {
    checkbox.disabled = true
    try {
      const res = await fetch(`/api/habits/${habit.id}/today`, { method: checkbox.checked ? 'PUT' : 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      checkbox.checked = !checkbox.checked
    } finally {
      checkbox.disabled = false
    }
  })

  const label = document.createElement('label')
  label.append(checkbox, habit.name)
  const item = document.createElement('li')
  item.append(label)
  return item
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
