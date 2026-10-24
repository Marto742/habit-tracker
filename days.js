// Today's date in Bulgaria as YYYY-MM-DD (the sv-SE locale formats dates that way).
// toISOString() would give the UTC date, which is still yesterday for the first 2-3 hours after midnight here.
function todayInBulgaria(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Sofia' })
}

// The calendar day before `date`, both YYYY-MM-DD. This steps back one date instead of
// subtracting 24 hours: it counts in UTC, where every day has exactly 24 hours, so a day
// like 25.10 (25 hours long in Bulgaria) can't make it repeat or skip a date.
function previousDay(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

// The last `count` days up to and including `today`, oldest first.
function lastDays(today, count) {
  const days = [today]
  while (days.length < count) days.unshift(previousDay(days[0]))
  return days
}

// How many days in a row the habit was checked, up to today. If today isn't checked yet,
// the streak isn't broken, because the day isn't over: then it counts back from yesterday.
function streak(dates, today) {
  const checked = new Set(dates)
  let day = checked.has(today) ? today : previousDay(today)
  let count = 0
  while (checked.has(day)) {
    count++
    day = previousDay(day)
  }
  return count
}

module.exports = { todayInBulgaria, previousDay, lastDays, streak }
