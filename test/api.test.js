const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { tempDir, startServer, Client } = require('./helpers')

const PASSWORD = 'тайна-парола-1'
const names = res => res.body.habits.map(habit => habit.name)
const squares = habit => habit.week.map(day => (day.done ? '■' : '□')).join('')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

describe('accounts', () => {
  let dir, dbFile, server, anon, martin, ivan

  before(async () => {
    dir = tempDir()
    dbFile = path.join(dir, 'habits.db')
    server = await startServer({ dbFile })
    anon = new Client(server)
    martin = new Client(server)
    ivan = new Client(server)
  })

  after(async () => {
    await server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('without logging in, the habits API answers 401', async () => {
    const calls = [
      ['GET', '/api/habits'], ['POST', '/api/habits'], ['PUT', '/api/habits/1/today'],
      ['DELETE', '/api/habits/1/today'], ['GET', '/api/me'],
    ]
    for (const [method, url] of calls) {
      assert.equal((await anon.request(method, url)).status, 401, `${method} ${url}`)
    }
  })

  test('registration checks the name and the password', async () => {
    assert.equal((await anon.request('POST', '/api/register', { name: 'ab', password: PASSWORD })).status, 400)
    assert.equal((await anon.request('POST', '/api/register', { name: 'с интервал', password: PASSWORD })).status, 400)
    assert.equal((await anon.request('POST', '/api/register', { name: 'кратка', password: '1234567' })).status, 400)
    assert.equal(anon.cookie, '', 'a failed registration sets no cookie')
  })

  test('registering logs you in with an httpOnly cookie; names ignore letter case', async () => {
    const res = await martin.request('POST', '/api/register', { name: '  Мартин ', password: PASSWORD })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body, { name: 'мартин' })
    assert.match(martin.setCookie, /HttpOnly/)
    assert.match(martin.setCookie, /SameSite=Lax/)
    assert.match(martin.setCookie, /Max-Age=2592000/)
    assert.deepEqual((await martin.request('GET', '/api/me')).body, { name: 'мартин' })
    assert.equal((await anon.request('POST', '/api/register', { name: 'МАРТИН', password: 'друга-парола' })).status, 409)
    assert.equal((await ivan.request('POST', '/api/register', { name: 'ivan', password: PASSWORD })).status, 201)
  })

  test('two registrations of the same name at once: one gets 201, the other 409', async () => {
    const statuses = await Promise.all([1, 2].map(async () =>
      (await new Client(server).request('POST', '/api/register', { name: 'twins', password: PASSWORD })).status))
    assert.deepEqual(statuses.sort(), [201, 409])
  })

  test('each account sees only its own habits, and the list says whose they are', async () => {
    assert.equal((await martin.request('POST', '/api/habits', { name: 'Чета 20 минути' })).status, 201)
    assert.equal((await ivan.request('POST', '/api/habits', { name: 'Бягане' })).status, 201)
    const martins = await martin.request('GET', '/api/habits')
    const ivans = await ivan.request('GET', '/api/habits')
    assert.deepEqual([martins.body.user, names(martins)], ['мартин', ['Чета 20 минути']])
    assert.deepEqual([ivans.body.user, names(ivans)], ['ivan', ['Бягане']])
  })

  test('adding needs a name; checking twice is the same as once', async () => {
    assert.equal((await martin.request('POST', '/api/habits', { name: '   ' })).status, 400)
    assert.equal((await martin.request('POST', '/api/habits', { name: 42 })).status, 400)
    const [habit] = (await martin.request('GET', '/api/habits')).body.habits
    for (let i = 0; i < 2; i++) {
      const res = await martin.request('PUT', `/api/habits/${habit.id}/today`)
      assert.deepEqual([res.status, res.body.done, res.body.streak], [200, true, 1])
    }
    assert.equal((await martin.request('PUT', '/api/habits/9999/today')).status, 404)
  })

  test("someone else's habit answers 404 even with its id, and stays as it was", async () => {
    const martinsId = (await martin.request('GET', '/api/habits')).body.habits[0].id
    const ivansId = (await ivan.request('GET', '/api/habits')).body.habits[0].id
    assert.equal((await ivan.request('DELETE', `/api/habits/${martinsId}/today`)).status, 404)
    assert.equal((await ivan.request('PUT', `/api/habits/${martinsId}/today`)).status, 404)
    assert.equal((await martin.request('PUT', `/api/habits/${ivansId}/today`)).status, 404)
    assert.equal((await martin.request('GET', '/api/habits')).body.habits[0].done, true)
    assert.equal((await ivan.request('GET', '/api/habits')).body.habits[0].done, false)
  })

  test('a wrong password and an unknown name get the same answer, in about the same time', async t => {
    const wrongPassword = await anon.request('POST', '/api/login', { name: 'мартин', password: 'грешна-парола' })
    const unknownName = await anon.request('POST', '/api/login', { name: 'никой', password: 'грешна-парола' })
    assert.deepEqual([wrongPassword.status, wrongPassword.body], [401, { error: 'Грешно име или парола' }])
    assert.deepEqual([unknownName.status, unknownName.body], [wrongPassword.status, wrongPassword.body])

    const times = { wrongPassword: [], unknownName: [] }
    for (let i = 0; i < 7; i++) {
      times.wrongPassword.push((await anon.request('POST', '/api/login', { name: 'мартин', password: 'x' })).ms)
      times.unknownName.push((await anon.request('POST', '/api/login', { name: 'никой', password: 'x' })).ms)
    }
    const [known, unknown] = [median(times.wrongPassword), median(times.unknownName)]
    t.diagnostic(`median: wrong password ${known.toFixed(1)} ms, unknown name ${unknown.toFixed(1)} ms`)
    assert.ok(unknown > known * 0.6 && unknown < known * 1.6, 'an unknown name must not answer noticeably faster or slower')
  })

  test('the database has no passwords and no session tokens in it', () => {
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const users = db.prepare('SELECT salt, password_hash FROM users').all()
    db.close()
    assert.ok(users.every(user => /^[0-9a-f]{32}$/.test(user.salt) && /^[0-9a-f]{128}$/.test(user.password_hash)))
    assert.equal(new Set(users.map(user => user.salt)).size, users.length, 'a salt of its own for every user')
    assert.equal(new Set(users.map(user => user.password_hash)).size, users.length, 'same password, different hashes')
    const raw = fs.readFileSync(dbFile)
    assert.equal(raw.includes(Buffer.from(PASSWORD)), false, 'the password is nowhere in the file')
    for (const client of [martin, ivan]) {
      const token = client.cookie.slice('session='.length)
      assert.equal(raw.includes(Buffer.from(token)), false, 'no session token in the file')
    }
  })

  test('after a server restart you are still logged in', async () => {
    await server.stop()
    server = await startServer({ dbFile })
    for (const client of [anon, martin, ivan]) client.server = server
    assert.deepEqual((await martin.request('GET', '/api/me')).body, { name: 'мартин' })
    assert.deepEqual(names(await martin.request('GET', '/api/habits')), ['Чета 20 минути'])
    assert.deepEqual(names(await ivan.request('GET', '/api/habits')), ['Бягане'])
  })

  test('logging out ends only that session', async () => {
    const otherDevice = new Client(server)
    assert.equal((await otherDevice.request('POST', '/api/login', { name: 'МАРТИН', password: PASSWORD })).status, 200)
    const cookie = martin.cookie
    assert.equal((await martin.request('POST', '/api/logout')).status, 204)
    assert.equal(martin.cookie, '', 'the cookie is cleared')
    martin.cookie = cookie
    assert.equal((await martin.request('GET', '/api/habits')).status, 401, 'the old token no longer works')
    assert.equal((await otherDevice.request('GET', '/api/me')).status, 200, 'the other device is still logged in')
  })
})

describe('a database from before accounts', () => {
  test('is moved to habits-before-accounts.db, and a new one is started', async () => {
    const dir = tempDir()
    const dbFile = path.join(dir, 'habits.db')
    const old = new DatabaseSync(dbFile)
    old.exec(`
      CREATE TABLE habits (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE checkins (habit_id INTEGER NOT NULL REFERENCES habits(id), date TEXT NOT NULL, PRIMARY KEY (habit_id, date));
      INSERT INTO habits (name) VALUES ('Стар навик');
      INSERT INTO checkins VALUES (1, '2026-10-24');
    `)
    old.close()

    let server = await startServer({ dbFile })
    try {
      assert.match(server.output(), /Found a database from before accounts/)
      const backup = new DatabaseSync(path.join(dir, 'habits-before-accounts.db'), { readOnly: true })
      assert.deepEqual(backup.prepare('SELECT name FROM habits').all().map(row => row.name), ['Стар навик'])
      assert.equal(backup.prepare('SELECT COUNT(*) AS n FROM checkins').get().n, 1)
      backup.close()
      const fresh = new DatabaseSync(dbFile, { readOnly: true })
      assert.equal(fresh.prepare('PRAGMA user_version').get().user_version, 1)
      assert.ok(fresh.prepare("SELECT 1 FROM pragma_table_info('habits') WHERE name = 'user_id'").get())
      assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM habits').get().n, 0)
      fresh.close()

      await server.stop()
      server = await startServer({ dbFile })
      assert.doesNotMatch(server.output(), /Found a database/, 'the next start leaves the new database alone')
    } finally {
      await server.stop()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('days, on a fake server clock', () => {
  let dir, server, client

  before(async () => {
    dir = tempDir()
    server = await startServer({ dbFile: path.join(dir, 'habits.db'), now: '2026-10-23T09:00:00Z' })
    client = new Client(server)
    await client.request('POST', '/api/register', { name: 'tester', password: PASSWORD })
  })

  after(async () => {
    await server.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('a check right after midnight counts for the new day in Bulgaria, not the UTC one', async () => {
    const { id } = (await client.request('POST', '/api/habits', { name: 'Полунощ' })).body
    // summer time (UTC+3), then winter time (UTC+2)
    for (const [now, date] of [['2026-10-24T22:30:00Z', '2026-10-25'], ['2026-11-15T22:30:00Z', '2026-11-16']]) {
      await server.setNow(now)
      const habit = (await client.request('PUT', `/api/habits/${id}/today`)).body
      assert.equal(habit.week.at(-1).date, date, `${now} is already ${date} in Bulgaria`)
      assert.equal((await client.request('GET', '/api/habits')).body.date, date)
    }
  })

  test('the streak and the 7 days follow calendar dates, also through 25.10, which has 25 hours', async () => {
    await server.setNow('2026-10-23T09:00:00Z')
    const { id } = (await client.request('POST', '/api/habits', { name: 'Чета' })).body
    const check = async now => {
      await server.setNow(now)
      return (await client.request('PUT', `/api/habits/${id}/today`)).body
    }
    const look = async now => {
      await server.setNow(now)
      return (await client.request('GET', '/api/habits')).body.habits.find(habit => habit.id === id)
    }
    assert.equal((await check('2026-10-23T09:00:00Z')).streak, 1)
    assert.equal((await check('2026-10-24T09:00:00Z')).streak, 2)
    const late = await check('2026-10-25T21:30:00Z') // 23:30, after the clocks went back
    assert.deepEqual([late.streak, squares(late)], [3, '□□□□■■■'])
    assert.deepEqual(late.week.map(day => day.date),
      ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
    const nextDay = await look('2026-10-26T10:00:00Z')
    assert.deepEqual([nextDay.done, nextDay.streak, squares(nextDay)], [false, 3, '□□□■■■□'], 'today not checked yet: the streak holds')
    const dayAfter = await look('2026-10-27T10:00:00Z')
    assert.deepEqual([dayAfter.streak, squares(dayAfter)], [0, '□□■■■□□'], 'a whole day missed: the streak is broken')
  })

  test('31.10 -> 1.11', async () => {
    const { id } = (await client.request('POST', '/api/habits', { name: 'Разходка' })).body
    await server.setNow('2026-10-31T10:00:00Z')
    await client.request('PUT', `/api/habits/${id}/today`)
    await server.setNow('2026-11-01T10:00:00Z')
    const habit = (await client.request('PUT', `/api/habits/${id}/today`)).body
    assert.equal(habit.streak, 2)
    assert.deepEqual(habit.week.slice(-3).map(day => day.date), ['2026-10-30', '2026-10-31', '2026-11-01'])
  })

  test('a session expires after 30 days', async () => {
    await server.setNow('2026-11-02T10:00:00Z')
    const later = new Client(server)
    assert.equal((await later.request('POST', '/api/login', { name: 'tester', password: PASSWORD })).status, 200)
    await server.setNow('2026-12-01T10:00:00Z')
    assert.equal((await later.request('GET', '/api/me')).status, 200, 'day 29: still logged in')
    await server.setNow('2026-12-03T10:00:00Z')
    assert.equal((await later.request('GET', '/api/me')).status, 401, 'day 31: logged out')
  })
})
