const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const { scanFolder, DEFAULT_MUSIC_PATH } = require('../../electron/ipc/scanner')

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
