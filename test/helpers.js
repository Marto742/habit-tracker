const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const root = path.join(__dirname, '..')

// A new empty folder in the system's temp dir, for a test's own database.
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'habit-tracker-test-'))
}

// Starts index.js on a free port with the given database file. With `now`, the server runs on a
// fake clock that starts there and keeps ticking; setNow() moves it.
function startServer({ dbFile, now }) {
  const args = now ? ['--require', path.join(__dirname, 'fake-clock.cjs'), 'index.js'] : ['index.js']
  const env = { ...process.env, PORT: '0', DB_FILE: dbFile, FAKE_NOW: now ?? '' }
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = ''
  let started = false
  return new Promise((resolve, reject) => {
    child.stdout.on('data', data => {
      output += data
      const url = output.match(/listening on (http:\/\/localhost:\d+)/)?.[1]
      if (!url || started) return
      started = true
      resolve({
        url,
        output: () => output,
        setNow: time => new Promise(done => {
          child.once('message', done)
          child.send({ now: time })
        }),
        stop: () => stop(child),
      })
    })
    child.stderr.on('data', data => { output += data })
    child.on('exit', code => reject(new Error(`server exited (${code}): ${output}`)))
  })
}

function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    child.removeAllListeners('exit')
    child.on('exit', resolve)
    child.kill()
  })
}

// Talks to the server like one browser would: keeps the session cookie between requests.
class Client {
  constructor(server) {
    this.server = server
    this.cookie = ''
  }

  async request(method, path, body) {
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (this.cookie) headers.Cookie = this.cookie
    const started = performance.now()
    const res = await fetch(this.server.url + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const ms = performance.now() - started
    const [setCookie] = res.headers.getSetCookie()
    if (setCookie) {
      this.setCookie = setCookie
      const pair = setCookie.split(';')[0]
      this.cookie = pair === 'session=' ? '' : pair
    }
    return { status: res.status, body: text ? JSON.parse(text) : undefined, ms }
  }
}

module.exports = { tempDir, startServer, Client }
