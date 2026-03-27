
const router = require('express').Router()
const fs = require('fs-extra')
const path = require('path')
const { getDB, getStorageDir } = require('../../electron/ipc/db')

function parseCsvLine(line) {
  const result = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result.map(s => s.trim().replace(/^"|"$/g, ''))
}

function parseM3U(fileContent) {
  const lines = fileContent.split(/\r?\n/)
  const entries = []
  let currentMeta = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#EXTM3U')) continue
    if (trimmed.startsWith('#EXTINF:')) {
      const match = trimmed.match(/#EXTINF:(-?\d+),(.+)/)
      if (match) {
        const duration = parseInt(match[1], 10)
        const meta = match[2].trim()
        const dashIndex = meta.lastIndexOf(' - ')
        if (dashIndex > 0) {
          currentMeta = { artist: meta.substring(0, dashIndex).trim(), title: meta.substring(dashIndex + 3).trim(), duration }
        } else {
          currentMeta = { title: meta, artist: null, duration }
        }
      }
      continue
    }
    if (trimmed.startsWith('#') || !trimmed) continue
    entries.push({ file_path: trimmed, title: currentMeta?.title || null, artist: currentMeta?.artist || null, duration: currentMeta?.duration || null })
    currentMeta = null
  }
  return entries
}

function parseCSV(fileContent) {
  const lines = fileContent.split(/\r?\n/).filter(l => l.trim())
  const entries = []
  if (lines.length < 1) return entries
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const findCol = names => headers.findIndex(h => names.some(n => h === n || h.includes(n)))
  const titleCol = findCol(['track name', 'trackname', 'song title', 'title', 'name'])
  const artistCol = findCol(['artist name', 'artist', 'performer'])
  const albumCol = findCol(['album name', 'album'])
  const durationCol = findCol(['duration_ms', 'duration ms', 'duration'])
  const urlCol = findCol(['track url', 'url', 'spotify uri', 'uri', 'apple music url', 'youtube url'])
  if (titleCol === -1) return entries
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const title = values[titleCol]
    const artist = artistCol !== -1 ? values[artistCol].replace(/\s*;\s*/g, ', ') : null
    const album = albumCol !== -1 ? values[albumCol] : null
    const duration = durationCol !== -1 ? values[durationCol] : null
    const sourceUrl = urlCol !== -1 ? values[urlCol] : null
    if (title) entries.push({ title, artist, album, duration, source_url: sourceUrl })
  }
  return entries
}

function parseJSON(fileContent) {
  try {
    const json = JSON.parse(fileContent)
    if (Array.isArray(json)) {
      return json.map(t => ({
        title: t.title || t.name || null,
        artist: t.artist || t.artistName || t.performer || null,
        album: t.album || t.albumName || null,
        file_path: t.file_path || t.path || null,
        duration: t.duration || t.duration_ms || null,
        source_url: t.source_url || t.url || t.uri || null,
      })).filter(t => t.title || t.file_path)
    }
    if (Array.isArray(json.tracks)) {
      return json.tracks.map(t => ({
        title: t.title || t.name || null,
        artist: t.artist || t.artistName || null,
        album: t.album || t.albumName || null,
        file_path: t.file_path || t.path || null,
        duration: t.duration || t.duration_ms || null,
        source_url: t.source_url || t.url || t.uri || null,
      })).filter(t => t.title || t.file_path)
    }
  } catch {}
  return []
}

function parseImportEntries(fileContent, fileType) {
  if (fileType === 'm3u' || fileType === 'm3u8') return parseM3U(fileContent)
  if (fileType === 'csv') return parseCSV(fileContent)
  if (fileType === 'json') return parseJSON(fileContent)
  return []
}

function normalizeMatchValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(?:feat|ft|featuring|remaster(?:ed)?|deluxe|radio edit|explicit|clean|version|mix)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findTrack(db, entry) {
  let track = null
  const primaryArtist = String(entry.artist || '').split(/\s*;\s*|\s*,\s*/).map(s => s.trim()).filter(Boolean)[0] || null
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
  if (!track && entry.title && primaryArtist) {
    track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? AND (LOWER(artist) = ? OR LOWER(artist) LIKE ?) LIMIT 1').get(entry.title.toLowerCase(), primaryArtist.toLowerCase(), `%${primaryArtist.toLowerCase()}%`)
  }
  if (!track && entry.title) {
    track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(entry.title.toLowerCase())
  }
  if (!track && entry.title && entry.artist) {
    const titleNorm = normalizeMatchValue(entry.title)
    const artistNorm = normalizeMatchValue(entry.artist)
    const candidates = db.prepare('SELECT id, title, artist FROM tracks WHERE LOWER(title) LIKE ? LIMIT 50').all(`%${entry.title.toLowerCase().slice(0, 18)}%`)
    let best = null
    let bestScore = 0
    for (const candidate of candidates) {
      const candidateTitle = normalizeMatchValue(candidate.title)
      const candidateArtist = normalizeMatchValue(candidate.artist)
      let score = 0
      if (candidateTitle === titleNorm) score += 70
      else if (candidateTitle.includes(titleNorm) || titleNorm.includes(candidateTitle)) score += 45
      if (candidateArtist === artistNorm) score += 30
      else if (candidateArtist.includes(artistNorm) || artistNorm.includes(candidateArtist)) score += 18
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (best && bestScore >= 72) track = { id: best.id }
  }
  return track
}

function createGhostTrack(db, entry, sourcePlatform = 'generic', playlistId = 'import') {
  const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const safePlatform = String(sourcePlatform || 'generic').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'generic'
  const title = String(entry.title || 'Unknown Track').trim() || 'Unknown Track'
  const artist = String(entry.artist || 'Unknown Artist').trim() || 'Unknown Artist'
  const filePath = `ghost://${safePlatform}/${playlistId}/${id}`
  db.prepare(`
    INSERT INTO tracks
    (id, file_path, file_hash, title, artist, album, album_artist, track_num, year, genre, duration, artwork_path, bitrate, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    filePath,
    id,
    title,
    artist,
    entry.album || null,
    entry.artist || null,
    null,
    null,
    null,
    entry.duration ? Number(entry.duration) : null,
    null,
    null,
    Date.now()
  )
  return { id, title, artist, album: entry.album || null, file_path: filePath, source_url: entry.source_url || null, isGhost: true }
}

function buildImportPreview(db, entries = []) {
  const rows = []
  let matched = 0
  for (const entry of entries) {
    const track = findTrack(db, entry)
    if (track) matched++
    rows.push({
      title: entry.title || path.basename(entry.file_path || '').replace(/\.[^.]+$/, '') || 'Unknown Track',
      artist: entry.artist || 'Unknown Artist',
      album: entry.album || null,
      status: track ? 'Matched' : 'Ghost Song',
      action: track ? 'Already in library' : 'Try auto-match, download, or pick a local file',
    })
  }
  return { total: entries.length, matched, ghostable: Math.max(entries.length - matched, 0), rows: rows.slice(0, 12) }
}

function resolveGhostTrack(db, ghostTrackId, targetTrackId) {
  const ghost = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path LIKE 'ghost://%'").get(ghostTrackId)
  const target = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path NOT LIKE 'ghost://%'").get(targetTrackId)
  if (!ghost) return { error: 'Ghost track not found' }
  if (!target) return { error: 'Target track not found' }

  const run = db.transaction(() => {
    db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(targetTrackId, ghostTrackId)
    db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM lyrics_translations WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM tracks WHERE id = ?').run(ghostTrackId)
  })

  run()
  return { ok: true, track: target }
}

async function writePlaylistCover(playlistId, imageData) {
  if (!imageData) return null
  const base64 = String(imageData).split(',')[1] || ''
  const mime = String(imageData).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i)?.[1] || 'image/jpeg'
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  const coverPath = path.join(getStorageDir(), 'artwork', `playlist-${playlistId}.${ext}`)
  await fs.writeFile(coverPath, Buffer.from(base64, 'base64'))
  return coverPath
}

router.get('/', (req, res) => {
  const uid = req.query.userId || 'guest'
  res.json(getDB().prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY name').all(uid))
})

router.post('/', (req, res) => {
  const { name, userId = 'guest' } = req.body
  const id = 'pl-' + Date.now()
  getDB().prepare('INSERT INTO playlists (id, name, user_id, cover_path) VALUES (?, ?, ?, ?)').run(id, name, userId, null)
  res.json(getDB().prepare('SELECT * FROM playlists WHERE id = ?').get(id))
})

router.put('/:id', async (req, res) => {
  const db = getDB()
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id)
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })
  const { name, description, coverData, clearCover } = req.body || {}
  if (name !== undefined) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, req.params.id)
  if (description !== undefined) db.prepare('UPDATE playlists SET description = ? WHERE id = ?').run(description, req.params.id)
  if (coverData) {
    if (playlist.cover_path && fs.existsSync(playlist.cover_path)) {
      try { fs.removeSync(playlist.cover_path) } catch {}
    }
    const coverPath = await writePlaylistCover(req.params.id, coverData)
    db.prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(coverPath, req.params.id)
  }
  if (clearCover) {
    if (playlist.cover_path && fs.existsSync(playlist.cover_path)) {
      try { fs.removeSync(playlist.cover_path) } catch {}
    }
    db.prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(null, req.params.id)
  }
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id))
})

router.get('/:id/cover', (req, res) => {
  const playlist = getDB().prepare('SELECT cover_path FROM playlists WHERE id = ?').get(req.params.id)
  if (!playlist?.cover_path || !fs.existsSync(playlist.cover_path)) return res.status(404).end()
  res.sendFile(path.resolve(playlist.cover_path))
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

router.post('/external-import-preview', (req, res) => {
  const { fileContent = '', fileType = 'csv' } = req.body || {}
  const db = getDB()
  const entries = parseImportEntries(fileContent, fileType)
  res.json({ ok: true, fileType, ...buildImportPreview(db, entries) })
})

router.post('/external-import', (req, res) => {
  const { name, fileContent = '', fileType = 'csv', userId = 'guest', sourcePlatform = 'generic' } = req.body || {}
  const db = getDB()
  const playlistId = 'pl-' + Date.now()
  const uid = userId || 'guest'
  const entries = parseImportEntries(fileContent, fileType)
  db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid)
  let matched = 0
  let ghosted = 0
  const unresolved = []
  for (const entry of entries) {
    let track = findTrack(db, entry)
    if (!track) {
      track = createGhostTrack(db, entry, sourcePlatform, playlistId)
      ghosted++
      unresolved.push({
        title: track.title,
        artist: track.artist,
        album: track.album,
        status: 'Ghost Song',
        action: 'Search YouTube, download, pick local file, or skip',
      })
    } else {
      matched++
    }
    const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId)
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(playlistId, track.id, (max?.m || 0) + 1, uid, Date.now())
  }
  res.json({ ok: true, playlistId, name, total: entries.length, matched, ghosted, unresolved: unresolved.slice(0, 50) })
})

router.post('/resolve-ghost', (req, res) => {
  try {
    res.json(resolveGhostTrack(getDB(), req.body.ghostTrackId, req.body.targetTrackId))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
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
  const playlist = db.prepare('SELECT cover_path FROM playlists WHERE id = ?').get(req.params.id)
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(req.params.id)
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id)
  if (playlist?.cover_path && fs.existsSync(playlist.cover_path)) {
    try { fs.removeSync(playlist.cover_path) } catch {}
  }
  res.json({ ok: true })
})

module.exports = router
