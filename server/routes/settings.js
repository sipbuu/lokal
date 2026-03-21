const router = require('express').Router()
const { getDB, importAppData, resetAppData } = require('../../electron/ipc/db')
const { scanFolder, DEFAULT_MUSIC_PATH } = require('../../electron/ipc/scanner')
const fs = require('fs-extra')
const path = require('path')

function toDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  const ext = path.extname(filePath).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

function exportAppData() {
  const db = getDB()
  const theme = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get()?.value || 'dark'
  let themeOverrides = {}
  try {
    const raw = db.prepare("SELECT value FROM settings WHERE key = 'theme_overrides'").get()?.value
    themeOverrides = raw ? JSON.parse(raw) : {}
  } catch {}
  const users = db.prepare('SELECT id, username, display_name, avatar_path, bio, created_at, password_hash FROM users ORDER BY created_at DESC').all().map((user) => ({
    ...user,
    avatar_data: toDataUrl(user.avatar_path),
  }))
  return {
    exported_at: Date.now(),
    version: 1,
    theme,
    theme_overrides: themeOverrides,
    settings: Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value])),
    users,
    user_settings: db.prepare('SELECT user_id, key, value FROM user_settings ORDER BY user_id, key').all(),
    playlists: db.prepare('SELECT * FROM playlists ORDER BY created_at DESC').all(),
    playlist_tracks: db.prepare('SELECT * FROM playlist_tracks ORDER BY playlist_id, position, id').all(),
    user_likes: db.prepare('SELECT * FROM user_likes ORDER BY user_id, liked_at DESC').all(),
    play_history: db.prepare('SELECT * FROM play_history ORDER BY played_at DESC').all(),
    artists: db.prepare('SELECT * FROM artists ORDER BY name').all(),
    artist_track_links: db.prepare('SELECT * FROM artist_track_links ORDER BY artist_id, track_id').all(),
    tracks: db.prepare('SELECT * FROM tracks ORDER BY added_at DESC').all(),
  }
}

router.get('/', (req, res) => {
  const rows = getDB().prepare('SELECT key, value FROM settings').all()
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])))
})

router.put('/', (req, res) => {
  const stmt = getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  for (const [k, v] of Object.entries(req.body)) stmt.run(k, String(v))
  res.json({ ok: true })
})

router.get('/theme', (req, res) => {
  const db = getDB()
  const theme = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get()
  const overrides = db.prepare("SELECT value FROM settings WHERE key = 'theme_overrides'").get()
  let parsedOverrides = {}
  try { parsedOverrides = overrides?.value ? JSON.parse(overrides.value) : {} } catch {}
  res.json({
    theme: theme?.value || 'dark',
    overrides: parsedOverrides,
  })
})

router.put('/theme', (req, res) => {
  const db = getDB()
  const { theme, overrides } = req.body || {}
  if (theme !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(String(theme))
  }
  if (overrides !== undefined) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme_overrides', ?)").run(JSON.stringify(overrides || {}))
  }
  res.json({ ok: true })
})

router.get('/export-all', (req, res) => {
  res.json(exportAppData())
})

router.post('/import-all', (req, res) => {
  try {
    res.json(importAppData(req.body))
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.post('/factory-reset', (req, res) => {
  try {
    res.json(resetAppData())
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

router.get('/keep-comma-artists', (req, res) => {
  try {
    const db = getDB()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'keep_comma_artists'").get()
    res.json(setting?.value ? JSON.parse(setting.value) : [])
  } catch {
    res.json([])
  }
})

router.put('/keep-comma-artists', (req, res) => {
  const { artists = [] } = req.body
  getDB().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('keep_comma_artists', ?)").run(JSON.stringify(artists))
  res.json({ ok: true })
})

router.post('/scan', async (req, res) => {
  const { folder } = req.body
  const target = folder || DEFAULT_MUSIC_PATH
  res.json({ scanning: true, folder: target })
  scanFolder(target).catch(console.error)
})

router.post('/clear-tracks', (req, res) => {
  const db = getDB()
  db.prepare('DELETE FROM artist_track_links').run()
  db.prepare('DELETE FROM playlist_tracks').run()
  db.prepare('DELETE FROM user_likes').run()
  db.prepare('DELETE FROM play_history').run()
  db.prepare('DELETE FROM lyrics_cache').run()
  db.prepare('DELETE FROM tracks').run()
  db.prepare('DELETE FROM artists').run()
  res.json({ ok: true })
})

module.exports = router
