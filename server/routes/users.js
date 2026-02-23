const router = require('express').Router()
const bcrypt = require('bcryptjs')
const path = require('path')
const fs = require('fs-extra')
const { getDB, getStorageDir } = require('../../electron/ipc/db')

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
  res.json({ user: { id, username: username.toLowerCase(), display_name: displayName || username, avatar_path: null } })
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

router.put('/:id', async (req, res) => {
  const { displayName, avatarData } = req.body
  const db = getDB()
  const updates = []; const params = []
  if (displayName) { updates.push('display_name = ?'); params.push(displayName) }
  if (avatarData) {
    const buf = Buffer.from(avatarData.split(',')[1], 'base64')
    const avPath = path.join(getStorageDir(), 'avatars', `${req.params.id}.jpg`)
    fs.ensureDirSync(path.dirname(avPath))
    await fs.writeFile(avPath, buf)
    updates.push('avatar_path = ?'); params.push(avPath)
  }
  if (updates.length) { params.push(req.params.id); db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params) }
  const updated = db.prepare('SELECT id, username, display_name, avatar_path, created_at FROM users WHERE id = ?').get(req.params.id)
  res.json({ user: updated })
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

module.exports = router
