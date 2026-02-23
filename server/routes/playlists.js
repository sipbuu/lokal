
const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')

router.get('/', (req, res) => {
  const uid = req.query.userId || 'guest'
  res.json(getDB().prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY name').all(uid))
})

router.post('/', (req, res) => {
  const { name, userId = 'guest' } = req.body
  const id = 'pl-' + Date.now()
  getDB().prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(id, name, userId)
  res.json({ id, name })
})


router.post('/import', (req, res) => {
  const { name, entries = [], userId = 'guest' } = req.body
  const db = getDB()
  const playlistId = 'pl-' + Date.now()
  const uid = userId || 'guest'
  
  
  db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid)
  
  let matched = 0
  for (const entry of entries) {
    let track = null
    
    
    if (entry.file_path) {
      track = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(entry.file_path)
    }
    
    
    if (!track && entry.title && entry.artist) {
      track = db.prepare(`
        SELECT id FROM tracks 
        WHERE LOWER(title) = ? AND LOWER(artist) = ?
        LIMIT 1
      `).get(entry.title.toLowerCase(), entry.artist.toLowerCase())
    }
    
    
    if (!track && entry.title) {
      track = db.prepare(`
        SELECT id FROM tracks 
        WHERE LOWER(title) = ?
        LIMIT 1
      `).get(entry.title.toLowerCase())
    }
    
    if (track) {
      const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId)
      db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)').run(playlistId, track.id, (max?.m || 0) + 1)
      matched++
    }
  }
  
  res.json({ playlistId, name, matched, total: entries.length })
})


router.post('/import-file', (req, res) => {
  const { name, fileContent, fileType, userId = 'guest' } = req.body
  const db = getDB()
  const playlistId = 'pl-' + Date.now()
  const uid = userId || 'guest'
  
  db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid)
  
  let entries = []
  
  if (fileType === 'm3u' || fileType === 'm3u8') {
    const lines = fileContent.split(/\r?\n/)
    let currentMeta = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#EXTM3U')) continue
      if (trimmed.startsWith('#EXTINF:')) {
        const match = trimmed.match(/#EXTINF:(\d+),(.+)/)
        if (match) {
          const meta = match[2].trim()
          const dashIndex = meta.lastIndexOf(' - ')
          if (dashIndex > 0) {
            currentMeta = { artist: meta.substring(0, dashIndex).trim(), title: meta.substring(dashIndex + 3).trim() }
          } else {
            currentMeta = { title: meta, artist: null }
          }
        }
        continue
      }
      if (trimmed.startsWith('#') || !trimmed) continue
      entries.push({ file_path: trimmed, title: currentMeta?.title || null, artist: currentMeta?.artist || null })
      currentMeta = null
    }
  } else if (fileType === 'csv') {
    const lines = fileContent.split(/\r?\n/).filter(l => l.trim())
    if (lines.length >= 2) {
      const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
      const findCol = (names) => headers.findIndex(h => names.some(n => h.includes(n)))
      const titleCol = findCol(['track name', 'trackname', 'title', 'name', 'track'])
      const artistCol = findCol(['artist name', 'artist', 'performer'])
      if (titleCol !== -1) {
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
          const title = values[titleCol]
          const artist = artistCol !== -1 ? values[artistCol] : null
          if (title) entries.push({ title, artist })
        }
      }
    }
  } else if (fileType === 'json') {
    try {
      const json = JSON.parse(fileContent)
      if (json.tracks) {
        entries = json.tracks.map(t => ({ title: t.title, artist: t.artist, file_path: t.file_path }))
      }
    } catch {}
  }
  
  let matched = 0
  const unmatched = []
  
  for (const entry of entries) {
    let track = null
    if (entry.file_path) {
      track = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(entry.file_path)
      if (!track) {
        const filename = entry.file_path.split(/[/\\]/).pop().replace(/\.[^.]+$/, '').toLowerCase()
        track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(filename)
      }
    }
    if (!track && entry.title && entry.artist) {
      track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? AND LOWER(artist) = ? LIMIT 1').get(entry.title.toLowerCase(), entry.artist.toLowerCase())
    }
    if (!track && entry.title) {
      track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(entry.title.toLowerCase())
    }
    if (track) {
      const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId)
      db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(playlistId, track.id, (max?.m || 0) + 1, uid, Date.now())
      matched++
    } else {
      unmatched.push({ title: entry.title, artist: entry.artist })
    }
  }
  
  res.json({ created: name, matched, total: entries.length, unmatched, playlistId })
})

router.get('/:id/tracks', (req, res) => {
  res.json(getDB().prepare(`
    SELECT t.*, pt.added_by, pt.added_at FROM tracks t 
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ? 
    ORDER BY pt.position
  `).all(req.params.id))
})

router.post('/:id/tracks', (req, res) => {
  const db = getDB()
  const { trackId, addedBy = 'guest' } = req.body
  const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(req.params.id)
  db.prepare('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(req.params.id, trackId, (max?.m || 0) + 1, addedBy, Date.now())
  res.json({ ok: true })
})

router.delete('/:id/tracks/:trackId', (req, res) => {
  getDB().prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(req.params.id, req.params.trackId)
  res.json({ ok: true })
})


router.put('/:id/reorder', (req, res) => {
  const db = getDB()
  const { trackIds } = req.body
  
  if (!Array.isArray(trackIds)) {
    return res.status(400).json({ error: 'trackIds must be an array' })
  }
  
  const playlistId = req.params.id
  const stmt = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?')
  
  trackIds.forEach((trackId, index) => {
    stmt.run(index + 1, playlistId, trackId)
  })
  
  res.json({ ok: true })
})

router.delete('/:id', (req, res) => {
  const db = getDB()
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(req.params.id)
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
