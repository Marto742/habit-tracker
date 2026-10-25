const crypto = require('node:crypto')
const { promisify } = require('node:util')
const db = require('./db')

const scrypt = promisify(crypto.scrypt)
const SESSION_MS = 30 * 24 * 60 * 60 * 1000
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }

// scrypt with a random salt per user: the database keeps only the salt and the hash,
// and two users with the same password still get different hashes.
async function hashPassword(password, salt) {
  return (await scrypt(password, salt, 64)).toString('hex')
}

// Returns the new user, or undefined if the name is taken.
async function createUser(name, password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const passwordHash = await hashPassword(password, salt)
  const { changes, lastInsertRowid } = db.prepare('INSERT OR IGNORE INTO users (name, salt, password_hash) VALUES (?, ?, ?)')
    .run(name, salt, passwordHash)
  return changes ? { id: lastInsertRowid, name } : undefined
}

// Stands in for names that don't exist, so a wrong name takes as long as a wrong password.
const nobody = { salt: crypto.randomBytes(16).toString('hex'), password_hash: '0'.repeat(128) }

async function findUserByPassword(name, password) {
  const user = db.prepare('SELECT id, name, salt, password_hash FROM users WHERE name = ?').get(name)
  const { salt, password_hash } = user ?? nobody
  const hash = await hashPassword(password, salt)
  const matches = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(password_hash, 'hex'))
  return user && matches ? { id: user.id, name: user.name } : undefined
}

// The cookie holds a random token and the database only its hash,
// so a leaked database doesn't let anyone log in as someone else.
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex')

function sessionToken(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)session=([^;]+)/)?.[1]
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, now + SESSION_MS)
  res.cookie('session', token, { ...cookieOptions, maxAge: SESSION_MS })
}

function endSession(req, res) {
  const token = sessionToken(req)
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
  res.clearCookie('session', cookieOptions)
}

// For routes that need a logged-in user: sets req.user, or answers 401.
function requireUser(req, res, next) {
  const token = sessionToken(req)
  req.user = token && db.prepare(`
    SELECT users.id, users.name FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Date.now())
  if (!req.user) {
    return res.status(401).json({ error: 'Not logged in' })
  }
  next()
}

module.exports = { createUser, findUserByPassword, startSession, endSession, requireUser }
