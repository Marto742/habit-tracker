// Browser tests (npm run test:browser): puppeteer-core drives an installed Chrome or Edge, or the
// browser in BROWSER_PATH. Without one, they are skipped.
const { describe, test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { tempDir, startServer, Client } = require('../helpers')

let puppeteer
try {
  puppeteer = require('puppeteer-core')
} catch {}

const browserPath = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(file => file && fs.existsSync(file))

const skip = !puppeteer ? 'puppeteer-core is not installed: run npm install'
  : !browserPath ? 'no Chrome or Edge found: set BROWSER_PATH'
  : false

const PASSWORD = 'тайна-парола-1'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let browser

before(async () => {
  if (!skip) browser = await puppeteer.launch({ executablePath: browserPath, headless: true })
})

after(async () => {
  await browser?.close()
})

// Page setups that run before app.js, to test one way of syncing at a time.
// onlyTimer: no syncing on focus or visibility, and the 30 s timer sped up to 0.5 s.
function onlyTimer() {
  const addEventListener = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type !== 'focus' && type !== 'visibilitychange') return addEventListener.call(this, type, ...rest)
  }
  const setInterval = window.setInterval
  window.setInterval = (fn, ms) => setInterval(fn, Math.min(ms, 500))
}
// noTimer: syncing only on load, focus and visibility.
function noTimer() {
  window.setInterval = () => 0
}
// noSync: no syncing on focus, visibility or timer; only on load and after a failed change.
function noSync() {
  const addEventListener = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type !== 'focus' && type !== 'visibilitychange') return addEventListener.call(this, type, ...rest)
  }
  window.setInterval = () => 0
}

// Opens the app in a new tab of `context` and collects the errors the page runs into.
async function openTab(context, server, { setup, onRequest } = {}) {
  const page = await context.newPage()
  page.errors = []
  page.on('pageerror', error => page.errors.push(String(error)))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const url = message.location()?.url ?? ''
    // The browser reports expected answers as errors too: 401 (logged out), 409 (name taken),
    // 404 for a habit of another account, and the missing favicon.
    const expected = /status of (401|409)/.test(message.text()) || url.endsWith('/favicon.ico') ||
      (/status of 404/.test(message.text()) && url.includes('/api/habits/'))
    if (!expected) page.errors.push(`${message.text()} ${url}`)
  })
  if (onRequest) {
    await page.setRequestInterception(true)
    page.on('request', onRequest)
  }
  await page.evaluateOnNewDocument(() => {
    // What the tab shows: whose habits (null on the login form) and their names.
    window.__view = () => {
      const account = document.querySelector('#account')
      const login = document.querySelector('#auth-form')
      return {
        user: !account.hidden ? document.querySelector('#user-name').textContent : login.hidden ? 'loading' : null,
        habits: [...document.querySelectorAll('#habits li label')].map(label => label.textContent),
      }
    }
    // The nth habit row: checkbox, streak, the 7 squares, and the date of the last square.
    window.__row = n => {
      const item = document.querySelector(`#habits li:nth-child(${n})`)
      if (!item) return null
      const days = [...item.querySelectorAll('.day')]
      return {
        checked: item.querySelector('input').checked,
        streak: item.querySelector('.streak').textContent,
        week: days.map(day => (day.classList.contains('done') ? '■' : '□')).join(''),
        today: days.at(-1).title,
      }
    }
  })
  if (setup) await page.evaluateOnNewDocument(setup)
  await page.goto(server.url)
  return page
}

const view = page => page.evaluate(() => window.__view())
const row = (page, n) => page.evaluate(n => window.__row(n), n)

// Both bring the tab to the front first (puppeteer can only wait in a visible tab), which also
// makes the page sync, like a user switching to it. On a timeout the assertion shows the difference.
async function waitForView(page, expected) {
  await page.bringToFront()
  await page.waitForFunction(expected => JSON.stringify(window.__view()) === JSON.stringify(expected), { timeout: 5000 }, expected)
    .catch(async () => assert.deepEqual(await view(page), expected))
}

async function waitForRow(page, n, expected) {
  await page.bringToFront()
  await page.waitForFunction((n, expected) => JSON.stringify(window.__row(n)) === JSON.stringify(expected), { timeout: 5000 }, n, expected)
    .catch(async () => assert.deepEqual(await row(page, n), expected))
}

async function submitAuth(page, button, name, password) {
  await page.bringToFront()
  await page.$eval('#auth-form', form => form.reset())
  await page.type('#auth-form [name=name]', name)
  await page.type('#auth-form [name=password]', password)
  await page.click(`#auth-form button[value=${button}]`)
}

async function authError(page) {
  await page.waitForFunction(() => document.querySelector('#auth-error').textContent !== '')
  const text = await page.$eval('#auth-error', element => element.textContent)
  await page.$eval('#auth-error', element => { element.textContent = '' })
  return text
}

async function addHabit(page, name) {
  await page.bringToFront()
  const count = (await page.$$('#habits li')).length
  await page.type('#new-habit [name=name]', name)
  await page.click('#new-habit button')
  await page.waitForFunction(n => document.querySelectorAll('#habits li').length === n, {}, count + 1)
}

async function clickHabit(page, n, method) {
  await page.bringToFront()
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/today') && response.request().method() === method),
    page.click(`#habits li:nth-child(${n}) input`),
  ])
  await page.waitForFunction(n => !document.querySelector(`#habits li:nth-child(${n}) input`).disabled, {}, n)
}

describe('accounts in the browser', { skip }, () => {
  let dir, dbFile, server, windowA, windowB, a, b

  before(async () => {
    dir = tempDir()
    dbFile = path.join(dir, 'habits.db')
    server = await startServer({ dbFile })
    windowA = await browser.createBrowserContext() // like a normal window
    windowB = await browser.createBrowserContext() // like an incognito one, with cookies of its own
  })

  after(async () => {
    await windowA?.close()
    await windowB?.close()
    await server?.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('two accounts in two windows see different habits', async () => {
    a = await openTab(windowA, server)
    await waitForView(a, { user: null, habits: [] })
    await submitAuth(a, 'register', 'Мартин', PASSWORD)
    await waitForView(a, { user: 'мартин', habits: [] })
    await addHabit(a, 'Чета 20 минути')

    b = await openTab(windowB, server)
    await submitAuth(b, 'register', 'ivan', PASSWORD)
    await waitForView(b, { user: 'ivan', habits: [] })
    await addHabit(b, 'Бягане')

    await a.reload()
    await waitForView(a, { user: 'мартин', habits: ['Чета 20 минути'] })
    await waitForView(b, { user: 'ivan', habits: ['Бягане'] })
    assert.deepEqual([...a.errors, ...b.errors], [])
  })

  test('a wrong password and an unknown name show the same message', async () => {
    const context = await browser.createBrowserContext()
    const page = await openTab(context, server)
    await submitAuth(page, 'login', 'мартин', 'грешна-парола')
    const wrongPassword = await authError(page)
    await submitAuth(page, 'login', 'никой', 'грешна-парола')
    assert.equal(wrongPassword, 'Грешно име или парола')
    assert.equal(await authError(page), wrongPassword)
    await submitAuth(page, 'register', 'мартин', 'друга-парола')
    assert.equal(await authError(page), 'Това име вече е заето')
    assert.deepEqual(page.errors, [])
    await context.close()
  })

  test('after a server restart both windows are still logged in', async () => {
    await server.stop()
    server = await startServer({ dbFile })
    for (const page of [a, b]) await page.goto(server.url)
    await waitForView(a, { user: 'мартин', habits: ['Чета 20 минути'] })
    await waitForView(b, { user: 'ivan', habits: ['Бягане'] })
  })

  test('a tab follows a logout, a login and a switch of account made in another tab', async () => {
    const a2 = await openTab(windowA, server)
    await waitForView(a2, { user: 'мартин', habits: ['Чета 20 минути'] })

    // Tab 1 logs out and in as ivan. Tab 2 must neither stay on martin nor mix the two accounts.
    await a.bringToFront()
    await a.click('#logout')
    await waitForView(a, { user: null, habits: [] })
    await submitAuth(a, 'login', 'ivan', PASSWORD)
    await waitForView(a, { user: 'ivan', habits: ['Бягане'] })
    assert.deepEqual(await view(a2), { user: 'мартин', habits: ['Чета 20 минути'] }, 'tab 2 has not synced yet')
    await waitForView(a2, { user: 'ivan', habits: ['Бягане'] })

    // Tab 2 logs out: tab 1 shows the login form once it is in front.
    await a2.click('#logout')
    await waitForView(a2, { user: null, habits: [] })
    await waitForView(a, { user: null, habits: [] })

    // Tab 2 logs in as martin: tab 1, sitting on the login form, follows as well.
    await submitAuth(a2, 'login', 'мартин', PASSWORD)
    await waitForView(a2, { user: 'мартин', habits: ['Чета 20 минути'] })
    await waitForView(a, { user: 'мартин', habits: ['Чета 20 минути'] })
    assert.deepEqual([...a.errors, ...a2.errors], [])
    await a2.close()
  })

  test("clicking a habit of the account the tab still shows makes the tab catch up", async () => {
    const stale = await openTab(windowA, server, { setup: noSync })
    await waitForView(stale, { user: 'мартин', habits: ['Чета 20 минути'] })
    const other = await openTab(windowA, server)
    await other.click('#logout')
    await waitForView(other, { user: null, habits: [] })
    await submitAuth(other, 'login', 'ivan', PASSWORD)
    await waitForView(other, { user: 'ivan', habits: ['Бягане'] })

    await stale.bringToFront()
    assert.deepEqual(await view(stale), { user: 'мартин', habits: ['Чета 20 минути'] }, 'this tab cannot sync by itself')
    await stale.click('#habits li input') // martin's habit, but the browser is ivan's now: 404
    await waitForView(stale, { user: 'ivan', habits: ['Бягане'] })
    assert.deepEqual([...stale.errors, ...other.errors], [])
  })
})

describe('days and syncing in the browser', { skip }, () => {
  let dir, server, context, phone

  before(async () => {
    dir = tempDir()
    server = await startServer({ dbFile: path.join(dir, 'habits.db'), now: '2026-10-24T20:59:00Z' }) // 23:59 on 24.10
    context = await browser.createBrowserContext()
    phone = new Client(server) // the same account on another device, talking to the API directly
    await phone.request('POST', '/api/register', { name: 'tester', password: PASSWORD })
    const page = await openTab(context, server)
    await submitAuth(page, 'login', 'tester', PASSWORD)
    await waitForView(page, { user: 'tester', habits: [] })
    await page.close()
  })

  after(async () => {
    await context?.close()
    await server?.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('a click updates the streak and the squares without a reload', async () => {
    await server.setNow('2026-10-24T20:59:00Z')
    const page = await openTab(context, server)
    await waitForView(page, { user: 'tester', habits: [] })
    await addHabit(page, 'Чета 20 минути')
    assert.deepEqual(await row(page, 1), { checked: false, streak: '🔥 0', week: '□□□□□□□', today: '24.10' })
    await clickHabit(page, 1, 'PUT')
    assert.deepEqual(await row(page, 1), { checked: true, streak: '🔥 1', week: '□□□□□□■', today: '24.10' })
    await page.reload()
    await waitForRow(page, 1, { checked: true, streak: '🔥 1', week: '□□□□□□■', today: '24.10' })
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  test('at midnight a tab in front moves to the new day by itself', async () => {
    await server.setNow('2026-10-24T20:59:00Z')
    const page = await openTab(context, server, { setup: onlyTimer })
    await waitForRow(page, 1, { checked: true, streak: '🔥 1', week: '□□□□□□■', today: '24.10' })
    await server.setNow('2026-10-24T21:00:05Z') // 00:00:05 on 25.10
    await waitForRow(page, 1, { checked: false, streak: '🔥 1', week: '□□□□□■□', today: '25.10' })
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  test('a tab left in the background over midnight catches up when it comes to the front', async () => {
    await server.setNow('2026-10-24T20:59:00Z')
    const page = await openTab(context, server, { setup: noTimer })
    await waitForRow(page, 1, { checked: true, streak: '🔥 1', week: '□□□□□□■', today: '24.10' })
    const other = await context.newPage()
    await server.setNow('2026-10-24T21:00:05Z')
    await sleep(500)
    assert.equal((await row(page, 1)).today, '24.10', 'nothing happens while it is in the background')
    await other.close()
    await waitForRow(page, 1, { checked: false, streak: '🔥 1', week: '□□□□□■□', today: '25.10' })
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  test('a check made on another device shows up by itself, and the focused checkbox keeps focus', async () => {
    await server.setNow('2026-10-25T09:00:00Z') // 12:00 on 25.10
    const page = await openTab(context, server, { setup: onlyTimer })
    await addHabit(page, 'Разходка')
    await page.focus('#habits li:nth-child(1) input')
    const walk = (await phone.request('GET', '/api/habits')).body.habits[1]
    assert.equal((await phone.request('PUT', `/api/habits/${walk.id}/today`)).status, 200)
    await waitForRow(page, 2, { checked: true, streak: '🔥 1', week: '□□□□□□■', today: '25.10' })
    const focused = await page.evaluate(() => document.activeElement === document.querySelector('#habits li:nth-child(1) input'))
    assert.equal(focused, true)
    assert.deepEqual(page.errors, [])
    await page.close()
  })

  test('an answer that left the server before a click does not undo the click', async () => {
    await server.setNow('2026-10-25T09:00:00Z')
    let holdNext = false
    let held
    const page = await openTab(context, server, {
      setup: noTimer,
      onRequest: request => {
        if (holdNext && request.method() === 'GET' && request.url().endsWith('/api/habits')) {
          holdNext = false
          held = request
        } else {
          request.continue()
        }
      },
    })
    const reading = (await phone.request('GET', '/api/habits')).body.habits[0]
    await phone.request('PUT', `/api/habits/${reading.id}/today`)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await waitForRow(page, 1, { checked: true, streak: '🔥 2', week: '□□□□□■■', today: '25.10' })

    const before = await (await fetch(`${server.url}/api/habits`, { headers: { Cookie: phone.cookie } })).text()
    holdNext = true
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    while (!held) await sleep(10)
    await clickHabit(page, 1, 'DELETE')
    assert.deepEqual(await row(page, 1), { checked: false, streak: '🔥 1', week: '□□□□□■□', today: '25.10' })
    await held.respond({ status: 200, contentType: 'application/json', body: before })
    await sleep(300)
    assert.deepEqual(await row(page, 1), { checked: false, streak: '🔥 1', week: '□□□□□■□', today: '25.10' })
    assert.deepEqual(page.errors, [])
    await page.close()
  })
})
