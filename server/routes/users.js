const router = require('express').Router()
const bcrypt = require('bcryptjs')
const path = require('path')
const fs = require('fs-extra')
const { getDB, getStorageDir } = require('../../electron/ipc/db')
const { listUsers, deleteUserData } = require('../../electron/ipc/users')

router.post('/register', async (req, res) => {
  const { username, displayName, password } = req.body
  if (!username?.trim() || !password) return res.status(400).json({ error: 'Username and password required' })
  const db = getDB()
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase())) {
    return res.status(409).json({ error: 'Username already taken' })
  }
  const id = 'u-' + Date.now()
  const hash = bcrypt.hashSync(password, 10)
  db.prepare('INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)')
    .run(id, username.toLowerCase(), displayName?.trim() || username, hash)
  res.json({ user: { id, username: username.toLowerCase(), display_name: displayName || username, avatar_path: null, bio: null } })
})

router.post('/login', (req, res) => {
  const { username, password } = req.body
  const db = getDB()
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username?.toLowerCase())
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  const { password_hash, ...safe } = user
  res.json({ user: safe })
})

router.get('/', (req, res) => {
  const db = getDB()
  res.json(listUsers(db))
})

router.put('/:id', async (req, res) => {
  const payload = req.body || {}
  const displayName = payload.displayName ?? payload.display_name
  const avatarData = payload.avatarData ?? payload.avatar
  const bio = payload.bio
  const db = getDB()
  const updates = []; const params = []
  if (Object.prototype.hasOwnProperty.call(payload, 'displayName') || Object.prototype.hasOwnProperty.call(payload, 'display_name')) {
    updates.push('display_name = ?'); params.push(displayName)
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'bio')) {
    updates.push('bio = ?'); params.push(bio)
  }
  if (avatarData) {
    const buf = Buffer.from(avatarData.split(',')[1], 'base64')
    const avPath = path.join(getStorageDir(), 'avatars', `${req.params.id}.jpg`)
    fs.ensureDirSync(path.dirname(avPath))
    await fs.writeFile(avPath, buf)
    updates.push('avatar_path = ?'); params.push(avPath)
  }
  if (updates.length) { params.push(req.params.id); db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params) }
  const updated = db.prepare('SELECT id, username, display_name, avatar_path, bio, created_at FROM users WHERE id = ?').get(req.params.id)
  res.json({ user: updated ? { ...updated, avatar_updated_at: avatarData ? Date.now() : undefined } : updated })
})

router.delete('/:id', async (req, res) => {
  const db = getDB()
  const result = await deleteUserData(db, req.params.id)
  if (result?.error) return res.status(404).json(result)
  res.json(result)
})

router.get('/:id/settings', (req, res) => {
  const rows = getDB().prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(req.params.id)
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])))
})

router.put('/:id/settings', (req, res) => {
  const stmt = getDB().prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)')
  for (const [k, v] of Object.entries(req.body)) stmt.run(req.params.id, k, String(v))
  res.json({ ok: true })
})

router.get('/:id/recap', (req, res) => {
  const db = getDB()
  const uid = req.params.id || 'guest'
  try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
  const qualified = 'ph.user_id = ? AND COALESCE(ph.seconds_played, 999) >= 30'
  const totalPlays = db.prepare(`SELECT COUNT(*) as c FROM play_history ph WHERE ${qualified}`).get(uid)?.c || 0
  const totalSecs = db.prepare(`SELECT SUM(COALESCE(ph.seconds_played, 0)) as s FROM play_history ph WHERE ${qualified}`).get(uid)?.s || 0
  const uniqueArtists = db.prepare(`SELECT COUNT(DISTINCT t.artist) as c FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ${qualified}`).get(uid)?.c || 0
  const uniqueAlbums = db.prepare(`SELECT COUNT(DISTINCT COALESCE(NULLIF(t.album, ''), t.id)) as c FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ${qualified}`).get(uid)?.c || 0
  const uniqueTracks = db.prepare(`SELECT COUNT(DISTINCT t.id) as c FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ${qualified}`).get(uid)?.c || 0
  const topArtists = db.prepare(`SELECT t.artist, COUNT(*) as plays FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ${qualified} GROUP BY t.artist ORDER BY plays DESC LIMIT 10`).all(uid)
  const topTracks = db.prepare(`SELECT t.*, COUNT(*) as plays FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ${qualified} GROUP BY t.id ORDER BY plays DESC LIMIT 50`).all(uid)
  const topGenres = db.prepare(`SELECT t.genre, COUNT(*) as plays FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ${qualified} AND t.genre IS NOT NULL AND t.genre != '' GROUP BY t.genre ORDER BY plays DESC LIMIT 8`).all(uid)
  const peakHour = db.prepare(`SELECT CAST(strftime('%H', ph.played_at, 'unixepoch', 'localtime') AS INTEGER) as hour, COUNT(*) as plays FROM play_history ph WHERE ${qualified} GROUP BY hour ORDER BY plays DESC LIMIT 1`).get(uid) || null
  const topDay = db.prepare(`SELECT strftime('%Y-%m-%d', ph.played_at, 'unixepoch', 'localtime') as day, COUNT(*) as plays FROM play_history ph WHERE ${qualified} GROUP BY day ORDER BY plays DESC LIMIT 1`).get(uid) || null
  const latestPlay = db.prepare(`SELECT MAX(ph.played_at) as playedAt FROM play_history ph WHERE ${qualified}`).get(uid)?.playedAt || null
  const likedCount = db.prepare('SELECT COUNT(*) as c FROM user_likes WHERE user_id = ?').get(uid)?.c || 0
  res.json({
    scope: 'all-time-dev',
    totalPlays,
    totalMinutes: Math.round(totalSecs / 60),
    uniqueArtists,
    uniqueAlbums,
    uniqueTracks,
    topArtists,
    topTracks,
    topGenres,
    peakHour,
    topDay,
    likedCount,
    latestPlay,
  })
})

module.exports = router
