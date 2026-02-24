const path = require('path')
const fs = require('fs-extra')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const mm = require('music-metadata')
const { getDB, getStorageDir } = require('./db')

const DEFAULT_MUSIC_PATH = 'C:\\Users\\sipbuu\\Music'
const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus', '.wma', '.alac', '.ape'])
const MIN_DURATION_SECONDS = 60
const DRUM_KIT_PATTERNS = /\b(kick|snare|808|hi[- ]?hat|hihat|rimshot|clap|crash|cymbal|drum( kit| loop| sample)?|sample pack|loop kit|one[- ]?shot|fx[- ]?sound|bass[- ]?drum|perc(ussion)?|stem[s]?|acapella)\b/i

let scanStatus = { scanning: false, total: 0, done: 0, errors: 0, skipped: 0 }
let mainWindow = null

function emit(channel, data) {
  if (mainWindow) mainWindow.webContents.send(channel, data)
}

function hashFile(fp, stat) {
  return crypto.createHash('sha256').update(fp + stat.size + stat.mtimeMs).digest('hex').slice(0, 16)
}

function slugify(str) {
  return (str || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

function getKeepCommaArtists() {
  const keepComma = new Set([
    'tyler, the creator', 'earth, wind & fire', 'crosby, stills & nash',
    'crosby, stills, nash & young', 'simon & garfunkel', 'emerson, lake & palmer',
    'syd barrett', 'pete & bas', 'pe & ne',
  ])
  try {
    const db = getDB()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'keep_comma_artists'").get()
    if (setting?.value) {
      const userDefined = JSON.parse(setting.value)
      userDefined.forEach(a => keepComma.add(a.toLowerCase().trim()))
    }
  } catch {}
  return keepComma
}

function splitArtists(raw) {
  if (!raw) return []
  const lower = raw.toLowerCase().trim()
  const KEEP_COMMA_ARTISTS = getKeepCommaArtists()
  for (const known of KEEP_COMMA_ARTISTS) {
    if (lower === known || lower.startsWith(known + ' ') || lower.endsWith(' ' + known)) return [raw.trim()]
  }
  const commaLowerPattern = /,\s+[a-z]/
  if (commaLowerPattern.test(raw)) return [raw.trim()]
  let artists = [raw]
  artists = artists.flatMap(a => a.split(/\s+(?:feat\.|ft\.|featuring)\s+/i))
  artists = artists.flatMap(a => a.split(/,\s+(?=[A-Z])/))
  artists = artists.flatMap(a => a.split(/\s+(?:&|x|vs\.?)\s+/i))
  return [...new Set(artists.map(a => a.trim()).filter(Boolean))]
}

async function extractArtwork(metadata, trackId) {
  const pic = metadata.common.picture?.[0]
  if (!pic) return null
  const artPath = path.join(getStorageDir(), 'artwork', `${trackId}.jpg`)
  if (!fs.existsSync(artPath)) await fs.writeFile(artPath, pic.data)
  return artPath
}

function walkDir(dir, files = []) {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walkDir(full, files)
      else if (AUDIO_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(full)
    }
  } catch {}
  return files
}

function isDrumKit(title, album, genre) {
  if (DRUM_KIT_PATTERNS.test(title)) return true
  if (album && DRUM_KIT_PATTERNS.test(album)) return true
  if (genre && /drum|percussion|sample|sfx/i.test(genre)) return true
  return false
}

async function scanFolder(folderPath) {
  const db = getDB()
  try { db.exec("ALTER TABLE tracks ADD COLUMN replaygain TEXT") } catch {}
  scanStatus = { scanning: true, total: 0, done: 0, errors: 0, skipped: 0 }
  const files = walkDir(folderPath)
  scanStatus.total = files.length
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_folder', ?)").run(folderPath)

  const upsertArtist = db.prepare(`INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)`)
  const linkArtist = db.prepare(`INSERT OR IGNORE INTO artist_track_links (artist_id, track_id) VALUES (?, ?)`)
  const upsertTrack = db.prepare(`
    INSERT OR REPLACE INTO tracks
    (id, file_path, file_hash, title, artist, album, album_artist, track_num, year, genre, duration, artwork_path, bitrate, last_modified, replaygain)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertBatch = db.transaction((batch) => {
    for (const item of batch) {
      upsertTrack.run(item.id, item.file_path, item.file_hash, item.title, item.artist, item.album, item.album_artist, item.track_num, item.year, item.genre, item.duration, item.artwork_path, item.bitrate, item.last_modified, item.replaygain)
      const artistNames = splitArtists(item.artist)
      for (const name of artistNames) {
        const aid = 'a-' + slugify(name)
        upsertArtist.run(aid, name)
        linkArtist.run(aid, item.id)
      }
    }
  })

  const BATCH = 20
  let batch = []

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath)
      const trackId = 't-' + hashFile(filePath, stat)
      const existing = db.prepare('SELECT last_modified FROM tracks WHERE id = ?').get(trackId)
      if (existing && existing.last_modified === stat.mtimeMs) {
        scanStatus.done++; emit('scanner:progress', { ...scanStatus }); continue
      }
      const meta = await mm.parseFile(filePath, { duration: true, skipCovers: false })
      const c = meta.common
      const title = c.title?.trim()
      const artist = (c.artist || c.albumartist)?.trim()
      const duration = meta.format.duration || 0
      if (!title || !artist) { scanStatus.skipped++; scanStatus.done++; emit('scanner:progress', { ...scanStatus }); continue }
      if (duration < MIN_DURATION_SECONDS) { scanStatus.skipped++; scanStatus.done++; emit('scanner:progress', { ...scanStatus }); continue }
      if (isDrumKit(title, c.album, c.genre?.[0])) { scanStatus.skipped++; scanStatus.done++; emit('scanner:progress', { ...scanStatus }); continue }
      const artwork = await extractArtwork(meta, trackId)
      const replaygain = c.replaygain_track_gain || null
      batch.push({ id: trackId, file_path: filePath, file_hash: trackId, title, artist, album: c.album?.trim() || null, album_artist: c.albumartist?.trim() || null, track_num: c.track?.no || null, year: c.year || null, genre: c.genre?.[0] || null, duration, artwork_path: artwork, bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null, last_modified: stat.mtimeMs, replaygain })
      if (batch.length >= BATCH) { insertBatch(batch); batch = [] }
    } catch { scanStatus.errors++ }
    scanStatus.done++; emit('scanner:progress', { ...scanStatus })
  }
  if (batch.length > 0) insertBatch(batch)
  scanStatus.scanning = false; emit('scanner:progress', { ...scanStatus, complete: true })
  return scanStatus
}

function addArtistFallback(db, artist) {
  if (artist.image_path) return artist
  const firstTrack = db.prepare(`SELECT t.artwork_path FROM tracks t JOIN artist_track_links atl ON atl.track_id = t.id WHERE atl.artist_id = ? AND t.artwork_path IS NOT NULL ORDER BY t.play_count DESC LIMIT 1`).get(artist.id)
  return { ...artist, image_path: firstTrack?.artwork_path || null }
}

function scoreTrack(track) {
  let score = 0
  if (track.bitrate) score += track.bitrate / 100
  if (track.artwork_path) score += 10
  if (track.album) score += 5
  if (track.year) score += 3
  if (track.genre) score += 2
  return score
}

function registerScannerHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')
  ipcMain.handle('scanner:scan', async (e, folder) => { mainWindow = BrowserWindow.fromWebContents(e.sender); return scanFolder(folder || DEFAULT_MUSIC_PATH) })
  ipcMain.handle('scanner:status', () => scanStatus)
  ipcMain.handle('scanner:getTracks', (_, opts = {}) => {
    const db = getDB()
    let sql = 'SELECT * FROM tracks'
    const where = []; const params = []
    if (opts.artistName) { where.push('artist = ?'); params.push(opts.artistName) }
    if (opts.artistId) { where.push('id IN (SELECT track_id FROM artist_track_links WHERE artist_id = ?)'); params.push(opts.artistId) }
    if (where.length) sql += ' WHERE ' + where.join(' AND ')
    sql += ` ORDER BY ${opts.sort || 'added_at DESC'} LIMIT ${opts.limit || 500}`
    return db.prepare(sql).all(...params)
  })
  ipcMain.handle('scanner:getArtists', () => {
    const db = getDB()
    const artists = db.prepare(`SELECT a.*, COUNT(DISTINCT atl.track_id) as track_count FROM artists a LEFT JOIN artist_track_links atl ON atl.artist_id = a.id GROUP BY a.id HAVING track_count > 0 ORDER BY a.name`).all()
    return artists.map(artist => addArtistFallback(db, artist))
  })
  ipcMain.handle('scanner:getArtist', (_, id) => {
    const db = getDB()
    
    let artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id)
    
    
    if (!artist) {
      
      const slug = id.replace(/^a-/, '')
      const name = slug.replace(/-/g, ' ')
      artist = db.prepare('SELECT * FROM artists WHERE LOWER(name) = LOWER(?)').get(name)
    }
    
    if (!artist) return null
    const tracks = db.prepare(`SELECT t.* FROM tracks t JOIN artist_track_links atl ON atl.track_id = t.id WHERE atl.artist_id = ? ORDER BY t.album, t.track_num, t.title`).all(artist.id)
    const topTracks = db.prepare(`SELECT t.* FROM tracks t JOIN artist_track_links atl ON atl.track_id = t.id WHERE atl.artist_id = ? ORDER BY t.play_count DESC LIMIT 5`).all(artist.id)
    const albums = db.prepare(`SELECT album as title, year, artwork_path, COUNT(*) as track_count FROM tracks t JOIN artist_track_links atl ON atl.track_id = t.id WHERE atl.artist_id = ? AND album IS NOT NULL GROUP BY album ORDER BY year DESC`).all(artist.id)
    const artistWithFallback = addArtistFallback(db, artist)
    return { ...artistWithFallback, tracks, topTracks, albums }
  })
  ipcMain.handle('scanner:getAlbumTracks', (_, albumTitle) => getDB().prepare('SELECT * FROM tracks WHERE album = ? ORDER BY track_num, title').all(albumTitle))
  ipcMain.handle('scanner:search', (_, q) => {
    const db = getDB()
    const term = `%${q}%`
    const artists = db.prepare(`SELECT a.*, COUNT(atl.track_id) as track_count FROM artists a JOIN artist_track_links atl ON atl.artist_id = a.id WHERE a.name LIKE ? GROUP BY a.id LIMIT 5`).all(term)
    const artistsWithFallback = artists.map(artist => addArtistFallback(db, artist))
    const tracks = db.prepare(`SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? LIMIT 40`).all(term, term, term)
    return { artists: artistsWithFallback, tracks }
  })
  ipcMain.handle('scanner:toggleLike', (_, trackId, userId) => {
    const db = getDB(); const uid = userId || 'guest'
    const exists = db.prepare('SELECT 1 FROM user_likes WHERE user_id = ? AND track_id = ?').get(uid, trackId)
    if (exists) { db.prepare('DELETE FROM user_likes WHERE user_id = ? AND track_id = ?').run(uid, trackId); return false }
    db.prepare('INSERT OR IGNORE INTO user_likes (user_id, track_id) VALUES (?, ?)').run(uid, trackId); return true
  })
  ipcMain.handle('scanner:getLikedTracks', (_, userId) => getDB().prepare(`SELECT t.* FROM tracks t JOIN user_likes ul ON ul.track_id = t.id WHERE ul.user_id = ? ORDER BY ul.liked_at DESC`).all(userId || 'guest'))
  ipcMain.handle('scanner:incrementPlay', (_, trackId, userId) => { const db = getDB(); const uid = userId || 'guest'; db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(trackId); db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (?, ?)').run(uid, trackId) })
  ipcMain.handle('scanner:getHistory', (_, userId, limit) => getDB().prepare(`SELECT t.*, ph.played_at FROM tracks t JOIN play_history ph ON ph.track_id = t.id WHERE ph.user_id = ? ORDER BY ph.played_at DESC LIMIT ?`).all(userId || 'guest', limit || 30))
  ipcMain.handle('scanner:getSuggestions', (_, userId) => {
    const db = getDB(); const uid = userId || 'guest'
    const liked = db.prepare(`SELECT t.genre, t.artist FROM tracks t JOIN user_likes ul ON ul.track_id = t.id WHERE ul.user_id = ? LIMIT 20`).all(uid)
    const genres = [...new Set(liked.map(t => t.genre).filter(Boolean))]
    const artists = [...new Set(liked.map(t => t.artist).filter(Boolean))]
    if (!genres.length && !artists.length) return db.prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT 20').all()
    return db.prepare(`SELECT * FROM tracks WHERE genre IN (${genres.map(() => '?').join(',') || "''"}) OR artist IN (${artists.map(() => '?').join(',') || "''"}) ORDER BY RANDOM() LIMIT 20`).all(...genres, ...artists)
  })
  ipcMain.handle('scanner:getPlaylists', (_, userId) => getDB().prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY name').all(userId || 'guest'))
  ipcMain.handle('scanner:createPlaylist', (_, name, userId, description) => { const db = getDB(); const id = 'pl-' + Date.now(); const uid = userId || 'guest'; db.prepare('INSERT INTO playlists (id, name, user_id, description) VALUES (?, ?, ?, ?)').run(id, name, uid, description || null); return { id, name, description } })
  ipcMain.handle('scanner:updatePlaylist', (_, plId, data) => { const db = getDB(); if (data.name) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(data.name, plId); if (data.description !== undefined) db.prepare('UPDATE playlists SET description = ? WHERE id = ?').run(data.description, plId) })
  ipcMain.handle('scanner:addToPlaylist', (_, plId, trackId, userId) => { 
    const db = getDB() 
    const uid = userId || 'guest'
    const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(plId)
    
    db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(plId, trackId, (max?.m || 0) + 1, uid, Date.now()) 
  })
  ipcMain.handle('scanner:removeFromPlaylist', (_, plId, rowId) => {
    
    getDB().prepare('DELETE FROM playlist_tracks WHERE id = ?').run(rowId)
  })
  ipcMain.handle('scanner:getPlaylistTracks', (_, plId) => getDB().prepare(`SELECT t.*, pt.id as playlist_track_id, pt.added_by, pt.added_at FROM tracks t JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? ORDER BY pt.position`).all(plId))
  ipcMain.handle('scanner:deletePlaylist', (_, plId) => { const db = getDB(); db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(plId); db.prepare('DELETE FROM playlists WHERE id = ?').run(plId) })
  ipcMain.handle('scanner:reorderPlaylist', (_, plId, trackIds) => {
    const db = getDB()
    if (!Array.isArray(trackIds)) return { error: 'trackIds must be an array' }
    const stmt = db.prepare('UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?')
    trackIds.forEach((trackId, index) => {
      stmt.run(index + 1, plId, trackId)
    })
    return { ok: true }
  })
  ipcMain.handle('artist:updateBio', (_, artistId, bio) => getDB().prepare('UPDATE artists SET bio = ? WHERE id = ?').run(bio, artistId))
  ipcMain.handle('artist:setImage', async (_, artistId, imageData) => { const buf = Buffer.from(imageData.split(',')[1], 'base64'); const imgPath = path.join(getStorageDir(), 'artwork', `artist-${artistId}.jpg`); await fs.writeFile(imgPath, buf); getDB().prepare('UPDATE artists SET image_path = ? WHERE id = ?').run(imgPath, artistId); return imgPath })
  ipcMain.handle('artist:rename', (_, artistId, newName) => { const db = getDB(); const newId = 'a-' + newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); db.prepare('UPDATE tracks SET artist = ? WHERE artist = (SELECT name FROM artists WHERE id = ?)').run(newName, artistId); db.prepare('UPDATE artists SET id = ?, name = ? WHERE id = ?').run(newId, newName, artistId); db.prepare('UPDATE artist_track_links SET artist_id = ? WHERE artist_id = ?').run(newId, artistId) })
  ipcMain.handle('artist:merge', (_, sourceId, targetId) => { const db = getDB(); const target = db.prepare('SELECT name FROM artists WHERE id = ?').get(targetId); if (!target) return; db.prepare('UPDATE tracks SET artist = ? WHERE artist = (SELECT name FROM artists WHERE id = ?)').run(target.name, sourceId); db.prepare('UPDATE artist_track_links SET artist_id = ? WHERE artist_id = ?').run(targetId, sourceId); db.prepare('DELETE FROM artists WHERE id = ?').run(sourceId) })
  ipcMain.handle('artist:delete', (_, artistId) => { const db = getDB(); db.prepare('DELETE FROM artist_track_links WHERE artist_id = ?').run(artistId); db.prepare('DELETE FROM artists WHERE id = ?').run(artistId) })
  ipcMain.handle('track:setArtwork', async (_, trackId, imageData) => { const buf = Buffer.from(imageData.split(',')[1], 'base64'); const artPath = path.join(getStorageDir(), 'artwork', `${trackId}.jpg`); await fs.writeFile(artPath, buf); getDB().prepare('UPDATE tracks SET artwork_path = ? WHERE id = ?').run(artPath, trackId); return artPath })
  ipcMain.handle('track:setGenre', (_, trackId, genre) => getDB().prepare('UPDATE tracks SET genre = ? WHERE id = ?').run(genre || null, trackId))
  ipcMain.handle('scanner:getTopGenres', () => getDB().prepare(`SELECT genre, COUNT(*) as count FROM tracks WHERE genre IS NOT NULL GROUP BY genre ORDER BY count DESC LIMIT 10`).all())
  ipcMain.handle('scanner:getRandomTrack', () => getDB().prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT 1').get())
  ipcMain.handle('db:clearTracks', () => { const db = getDB(); db.prepare('DELETE FROM artist_track_links').run(); db.prepare('DELETE FROM playlist_tracks').run(); db.prepare('DELETE FROM user_likes').run(); db.prepare('DELETE FROM play_history').run(); db.prepare('DELETE FROM lyrics_cache').run(); db.prepare('DELETE FROM tracks').run(); db.prepare('DELETE FROM artists').run() })
  ipcMain.handle('db:clearLyrics', () => getDB().prepare('DELETE FROM lyrics_cache').run())
  ipcMain.handle('settings:get', () => { const rows = getDB().prepare('SELECT key, value FROM settings').all(); return Object.fromEntries(rows.map(r => [r.key, r.value])) })
  ipcMain.handle('settings:save', (_, s) => { const stmt = getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'); for (const [k, v] of Object.entries(s)) stmt.run(k, String(v)) })
  ipcMain.handle('settings:getKeepCommaArtists', () => { try { const db = getDB(); const setting = db.prepare("SELECT value FROM settings WHERE key = 'keep_comma_artists'").get(); return setting?.value ? JSON.parse(setting.value) : [] } catch { return [] } })
ipcMain.handle('settings:setKeepCommaArtists', (_, artists) => getDB().prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('keep_comma_artists', ?)").run(JSON.stringify(artists)))

  ipcMain.handle('settings:getTheme', () => {
    const db = getDB()
    const theme = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get()
    const overrides = db.prepare("SELECT value FROM settings WHERE key = 'theme_overrides'").get()
    return {
      theme: theme?.value || 'dark',
      overrides: overrides?.value ? JSON.parse(overrides.value) : {}
    }
  })

  ipcMain.handle('settings:saveTheme', (_, { theme, overrides }) => {
    const db = getDB()
    if (theme !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', ?)").run(theme)
    }
    if (overrides !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('theme_overrides', ?)").run(JSON.stringify(overrides))
    }
  })
  
  function parseM3U(content) {
    const lines = content.split(/\r?\n/)
    const entries = []
    let currentMeta = null
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('#EXTM3U')) continue
      if (trimmed.startsWith('#EXTINF:')) {
        const match = trimmed.match(/#EXTINF:(\d+),(.+)/)
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
      entries.push({ file_path: trimmed, title: currentMeta?.title || null, artist: currentMeta?.artist || null })
      currentMeta = null
    }
    return entries
  }

  
  function parseCSV(content) {
    const lines = content.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''))
    const findCol = (names) => headers.findIndex(h => names.some(n => h.includes(n)))
    const titleCol = findCol(['track name', 'trackname', 'title', 'name', 'track'])
    const artistCol = findCol(['artist name', 'artist', 'performer'])
    if (titleCol === -1) return []
    const entries = []
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      const title = values[titleCol]
      const artist = artistCol !== -1 ? values[artistCol] : null
      if (title) entries.push({ title, artist })
    }
    return entries
  }

  
  function findTrack(db, entry) {
    if (entry.file_path) {
      const track = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(entry.file_path)
      if (track) return track
      const filename = path.basename(entry.file_path, path.extname(entry.file_path)).toLowerCase()
      const t = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(filename)
      if (t) return t
    }
    if (entry.title && entry.artist) {
      const track = db.prepare(`SELECT id FROM tracks WHERE LOWER(title) = ? AND LOWER(artist) = ? LIMIT 1`).get(entry.title.toLowerCase(), entry.artist.toLowerCase())
      if (track) return track
    }
    if (entry.title) {
      const track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(entry.title.toLowerCase())
      if (track) return track
    }
    return null
  }

  
  ipcMain.handle('playlist:importFile', async (_, name, fileContent, fileType, userId = 'guest') => {
    const db = getDB()
    const playlistId = 'pl-' + Date.now()
    const uid = userId || 'guest'
    db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid)
    let entries = []
    if (fileType === 'm3u' || fileType === 'm3u8') entries = parseM3U(fileContent)
    else if (fileType === 'csv') entries = parseCSV(fileContent)
    else if (fileType === 'json') { try { const json = JSON.parse(fileContent); if (json.tracks) entries = json.tracks.map(t => ({ title: t.title, artist: t.artist, file_path: t.file_path })) } catch {} }
    let matched = 0, unmatched = []
    for (const entry of entries) {
      const track = findTrack(db, entry)
      if (track) { const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId); db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(playlistId, track.id, (max?.m || 0) + 1, uid, Date.now()); matched++ }
      else unmatched.push({ title: entry.title, artist: entry.artist })
    }
    return { created: name, matched, total: entries.length, unmatched, playlistId }
  })

  
  ipcMain.handle('playlist:import', async (_, name, entries, userId = 'guest') => {
    const db = getDB()
    const playlistId = 'pl-' + Date.now()
    const uid = userId || 'guest'
    db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid)
    let matched = 0
    for (const entry of entries) {
      let track = null
      if (entry.file_path) track = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(entry.file_path)
      if (!track && entry.title && entry.artist) track = db.prepare(`SELECT id FROM tracks WHERE LOWER(title) = ? AND LOWER(artist) = ? LIMIT 1`).get(entry.title.toLowerCase(), entry.artist.toLowerCase())
      if (!track && entry.title) track = db.prepare(`SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1`).get(entry.title.toLowerCase())
      if (track) { const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId); db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(playlistId, track.id, (max?.m || 0) + 1, uid, Date.now()); matched++ }
    }
    return { playlistId, name, matched, total: entries.length }
  })
  ipcMain.handle('history:export', async (_, userId, format) => {
    const db = getDB()
    const uid = userId || 'guest'
    
    try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
    const history = db.prepare(`SELECT t.title, t.artist, t.album, ph.played_at, COALESCE(ph.seconds_played, 0) as seconds_played FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ph.user_id = ? ORDER BY ph.played_at DESC`).all(uid)
    if (format === 'csv') {
      const header = 'title,artist,album,played_at,seconds_played\n'
      const rows = history.map(h => `"${h.title}","${h.artist}","${h.album || ''}",${h.played_at},${h.seconds_played || 0}`).join('\n')
      return header + rows
    }
    return JSON.stringify(history, null, 2)
  })
}

async function fetchExternalArtwork(title, artist, trackId) {
  const db = getDB()
  try {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'fetch_online_artwork'").get()
    if (setting?.value === '0') return null
  } catch { return null }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(title + ' ' + artist)}&entity=song&limit=5`
    const itunesRes = await fetch(itunesUrl, { signal: controller.signal })
    const itunesData = await itunesRes.json()

    if (itunesData.results && itunesData.results.length > 0) {
      let artworkUrl = itunesData.results[0].artworkUrl100
      if (artworkUrl) {
        artworkUrl = artworkUrl.replace('100x100bb', '600x600bb')
        const artPath = path.join(getStorageDir(), 'artwork', `t-${trackId}.jpg`)
        try {
          await downloadImageWithTimeout(artworkUrl, artPath, 5000)
          clearTimeout(timeout)
          return artPath
        } catch {}
      }
    }
  } catch {}

  clearTimeout(timeout)
  const controller2 = new AbortController()
  const timeout2 = setTimeout(() => controller2.abort(), 5000)

  try {
    const mbQuery = `https://musicbrainz.org/ws/2/recording/?query=recording:"${title}" AND artist:"${artist}"&fmt=json&limit=3`
    const mbRes = await fetch(mbQuery, {
      signal: controller2.signal,
      headers: { 'User-Agent': 'Lokal/4.0 (lokalmusic@email.com)' }
    })
    const mbData = await mbRes.json()

    if (mbData.releases && mbData.releases[0]?.id) {
      const releaseId = mbData.releases[0].id
      const coverUrl = `https://coverartarchive.org/release/${releaseId}/front-500`
      const artPath = path.join(getStorageDir(), 'artwork', `t-${trackId}.jpg`)
      try {
        await downloadImageWithTimeout(coverUrl, artPath, 5000)
        clearTimeout(timeout2)
        return artPath
      } catch {}
    }
  } catch {}

  clearTimeout(timeout2)
  return null
}

function downloadImageWithTimeout(url, dest, timeoutMs) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const timeout = setTimeout(() => { reject(new Error('Download timeout')) }, timeoutMs)
    const file = fs.createWriteStream(dest)
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        clearTimeout(timeout)
        return downloadImageWithTimeout(res.headers.location, dest, timeoutMs).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        clearTimeout(timeout)
        fs.unlink(dest, () => {})
        reject(new Error('HTTP ' + res.statusCode))
        return
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        clearTimeout(timeout)
        resolve(dest)
      })
    }).on('error', (err) => {
      clearTimeout(timeout)
      fs.unlink(dest, () => {})
      reject(err)
    })
  })
}

async function indexSingleFile(filePath, opts = {}) {
  const db = getDB()
  const stat = fs.statSync(filePath)
  const trackId = 't-' + hashFile(filePath, stat)
  const existing = db.prepare('SELECT * FROM tracks WHERE file_hash = ? OR file_path = ?').get(trackId, filePath)
  if (existing) return { skipped: true, id: existing.id }
  let meta
  try {
    const parsePromise = mm.parseFile(filePath, { duration: true, skipCovers: false })
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Metadata parsing timeout')), 30000))
    meta = await Promise.race([parsePromise, timeoutPromise])
  } catch { return { error: 'Failed to parse metadata' } }
  const c = meta.common
  const title = c.title?.trim()
  const artist = (c.artist || c.albumartist)?.trim()
  const duration = meta.format.duration || 0
  if (!title || !artist) return { error: 'Missing title/artist' }
  if (duration < MIN_DURATION_SECONDS) return { error: 'Too short' }
  if (isDrumKit(title, c.album, c.genre?.[0])) return { error: 'Filtered drumkit' }
  
  let artwork = await extractArtwork(meta, trackId)
  
  const thumbnailUrl = opts.thumbnailUrl
  if (!artwork && thumbnailUrl) {
    try {
      const artPath = path.join(getStorageDir(), 'artwork', `t-${trackId}.jpg`)
      await downloadImageWithTimeout(thumbnailUrl, artPath, 5000)
      artwork = artPath
    } catch {}
  }

  if (!artwork) {
    const externalArt = await fetchExternalArtwork(title, artist, trackId)
    if (externalArt) artwork = externalArt
  }

  const replaygain = c.replaygain_track_gain || null
  const dupe = db.prepare('SELECT * FROM tracks WHERE LOWER(title) = ? AND LOWER(artist) = ? AND (album IS NULL OR album = ? OR ? IS NULL OR album IS NULL) AND ABS(duration - ?) < 2').get(title.toLowerCase(), artist.toLowerCase(), c.album?.trim() || null, c.album?.trim() || null, duration)
  if (dupe) return { duplicate: true, id: dupe.id }
  
  const insertTransaction = db.transaction(() => {
    const upsertArtist = db.prepare(`INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)`)
    const linkArtist = db.prepare(`INSERT OR IGNORE INTO artist_track_links (artist_id, track_id) VALUES (?, ?)`)
    try { db.exec("ALTER TABLE tracks ADD COLUMN replaygain TEXT") } catch {}
    

    const existingByPath = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(filePath)
    if (existingByPath) {
      db.prepare(`UPDATE tracks SET file_hash = ?, title = ?, artist = ?, album = ?, album_artist = ?, track_num = ?, year = ?, genre = ?, duration = ?, artwork_path = ?, bitrate = ?, last_modified = ?, replaygain = ? WHERE file_path = ?`)
        .run(trackId, title, artist, c.album?.trim() || null, c.albumartist?.trim() || null, c.track?.no || null, c.year || null, c.genre?.[0] || null, duration, artwork, meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null, stat.mtimeMs, replaygain, filePath)
    } else {
      db.prepare(`INSERT INTO tracks (id, file_path, file_hash, title, artist, album, album_artist, track_num, year, genre, duration, artwork_path, bitrate, last_modified, replaygain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(trackId, filePath, trackId, title, artist, c.album?.trim() || null, c.albumartist?.trim() || null, c.track?.no || null, c.year || null, c.genre?.[0] || null, duration, artwork, meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null, stat.mtimeMs, replaygain)
    }
    db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(trackId)
    const artistNames = splitArtists(artist)
    for (const name of artistNames) { 
      const aid = 'a-' + slugify(name); 
      upsertArtist.run(aid, name); 
      linkArtist.run(aid, trackId) 
    }
  })
  
  insertTransaction()
  return { success: true, id: trackId }
}

module.exports = { registerScannerHandlers, scanFolder, DEFAULT_MUSIC_PATH, indexSingleFile }


function registerExtraHandlers(ipcMain) {
  ipcMain.handle('artist:setImageUrl', async (_, artistId, url) => { const db = getDB(); const imgPath = path.join(getStorageDir(), 'artwork', `artist-${artistId}.jpg`); await downloadToFile(url, imgPath); db.prepare('UPDATE artists SET image_path = ? WHERE id = ?').run(imgPath, artistId); return imgPath })
  ipcMain.handle('album:setImageUrl', async (_, albumTitle, url) => { const db = getDB(); const safeTitle = albumTitle.replace(/[^a-z0-9]+/gi, '-'); const imgPath = path.join(getStorageDir(), 'artwork', `album-${safeTitle}.jpg`); await downloadToFile(url, imgPath); db.prepare('UPDATE tracks SET artwork_path = ? WHERE album = ?').run(imgPath, albumTitle); return imgPath })
  ipcMain.handle('artist:importPhotosDir', async (_, photosDir) => {
    const db = getDB()
    const dir = photosDir || path.join(process.cwd(), 'src', 'photos')
    if (!fs.existsSync(dir)) return { error: 'Photos dir not found: ' + dir }
    const imgExts = new Set(['.jpg','.jpeg','.png','.webp'])
    const files = fs.readdirSync(dir).filter(f => imgExts.has(path.extname(f).toLowerCase()))
    const artists = db.prepare('SELECT * FROM artists').all()
    let matched = 0
    for (const file of files) {
      const nameWithoutExt = path.basename(file, path.extname(file)).toLowerCase()
      const artist = artists.find(a => { const n = a.name.toLowerCase(); return n === nameWithoutExt || n.replace(/[^a-z0-9]/g, '') === nameWithoutExt.replace(/[^a-z0-9]/g, '') })
      if (artist) { const dest = path.join(getStorageDir(), 'artwork', `artist-${artist.id}.jpg`); fs.copyFileSync(path.join(dir, file), dest); db.prepare('UPDATE artists SET image_path = ? WHERE id = ?').run(dest, artist.id); matched++ }
    }
    return { matched, total: files.length }
  })
  ipcMain.handle('scanner:checkDuplicates', () => getDB().prepare(`SELECT title, artist, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(file_path) as paths FROM tracks GROUP BY LOWER(title), LOWER(artist) HAVING count > 1`).all())
  ipcMain.handle('scanner:deleteTrack', (_, trackId) => { const db = getDB(); db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(trackId); db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(trackId); db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(trackId); db.prepare('DELETE FROM play_history WHERE track_id = ?').run(trackId); db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(trackId); db.prepare('DELETE FROM tracks WHERE id = ?').run(trackId) })
}

function downloadToFile(url, dest) {
  const fs = require('fs-extra')
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) { file.close(); return downloadToFile(res.headers.location, dest).then(resolve).catch(reject) }
      res.pipe(file)
      file.on('finish', () => { file.close(); resolve(dest) })
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err) })
  })
}

module.exports.registerExtraHandlers = registerExtraHandlers

function registerV4Handlers(ipcMain) {
  const { getDB } = require('./db')
  ipcMain.handle('scanner:getRelated', (_, trackId, userId) => {
    const db = getDB()
    const uid = userId || 'guest'
    const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
    if (!track) return db.prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT 20').all()
    const related = db.prepare(`SELECT * FROM tracks WHERE id != ? AND (genre = ? OR artist = ?) AND id NOT IN (SELECT track_id FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 100) ORDER BY RANDOM() LIMIT 25`).all(trackId, track.genre || '', track.artist || '', uid)
    if (related.length < 10) { const extra = db.prepare(`SELECT * FROM tracks WHERE id != ? ORDER BY RANDOM() LIMIT 25`).all(trackId); const ids = new Set(related.map(t => t.id)); for (const t of extra) { if (!ids.has(t.id)) related.push(t) } }
    return related.slice(0, 25)
  })
  ipcMain.handle('scanner:incrementPlayTime', (_, trackId, userId, seconds) => {
    try {
      const db = getDB()
      const uid = userId || 'guest'
      const thresholdSetting = db.prepare("SELECT value FROM settings WHERE key = 'scrobble_threshold'").get()
      const threshold = thresholdSetting ? parseInt(thresholdSetting.value) : 30
      try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
      const track = db.prepare('SELECT duration FROM tracks WHERE id = ?').get(trackId)
      const minSeconds = track ? Math.max(30, (track.duration || 0) * (threshold / 100)) : 30
      if (seconds >= minSeconds) db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(trackId)
      db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played) VALUES (?, ?, ?)').run(uid, trackId, Math.round(seconds || 0))
    } catch(e) { console.warn('incrementPlayTime:', e.message) }
  })
  ipcMain.handle('scanner:getAllAlbums', () => getDB().prepare(`SELECT album as title, album_artist, year, artwork_path, COUNT(*) as track_count, GROUP_CONCAT(DISTINCT artist) as artists FROM tracks WHERE album IS NOT NULL GROUP BY LOWER(album) ORDER BY year DESC, album ASC`).all())
  ipcMain.handle('scanner:searchAlbums', (_, q) => { const term = `%${q}%`; return getDB().prepare(`SELECT album as title, album_artist, year, artwork_path, COUNT(*) as track_count, GROUP_CONCAT(DISTINCT artist) as artists FROM tracks WHERE album LIKE ? OR album_artist LIKE ? GROUP BY LOWER(album) ORDER BY album`).all(term, term) })
  ipcMain.handle('scanner:deleteTracks', (_, ids) => { const db = getDB(); const del = db.transaction((ids) => { for (const id of ids) { db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(id); db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(id); db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(id); db.prepare('DELETE FROM play_history WHERE track_id = ?').run(id); db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(id); db.prepare('DELETE FROM tracks WHERE id = ?').run(id) } }); del(ids) })
  ipcMain.handle('scanner:getMixes', (_, userId) => {
    const db = getDB()
    const uid = userId || 'guest'
    const liked = db.prepare(`SELECT t.genre, t.artist FROM tracks t JOIN user_likes ul ON ul.track_id = t.id WHERE ul.user_id = ? LIMIT 50`).all(uid)
    const history = db.prepare(`SELECT t.genre, t.artist FROM tracks t JOIN play_history ph ON ph.track_id = t.id WHERE ph.user_id = ? ORDER BY ph.played_at DESC LIMIT 50`).all(uid)
    const combined = [...liked, ...history]
    const genreCounts = {}; const artistCounts = {}
    for (const r of combined) { if (r.genre) genreCounts[r.genre] = (genreCounts[r.genre] || 0) + 1; if (r.artist) artistCounts[r.artist] = (artistCounts[r.artist] || 0) + 1 }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g)
    const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a)
    const mixes = []
    for (const genre of topGenres) { const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 30').all(genre); if (tracks.length >= 3) mixes.push({ id: `mix-g-${genre}`, name: `${genre} Mix`, type: 'genre', tracks }) }
    for (const artist of topArtists) { const tracks = db.prepare(`SELECT * FROM tracks WHERE artist LIKE ? ORDER BY RANDOM() LIMIT 25`).all(`%${artist}%`); if (tracks.length >= 3) mixes.push({ id: `mix-a-${artist}`, name: `${artist}`, type: 'artist', tracks }) }
    const discovery = db.prepare(`SELECT t.* FROM tracks t WHERE t.id NOT IN (SELECT track_id FROM user_likes WHERE user_id = ?) ORDER BY RANDOM() LIMIT 30`).all(uid)
    if (discovery.length >= 5) mixes.push({ id: 'mix-discovery', name: 'Discover Weekly', type: 'discovery', tracks: discovery })
    if (mixes.length === 0) { const genres = db.prepare(`SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL ORDER BY RANDOM() LIMIT 4`).all(); for (const { genre } of genres) { const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 25').all(genre); if (tracks.length >= 3) mixes.push({ id: `mix-g-${genre}`, name: `${genre} Mix`, type: 'genre', tracks }) } }
    return mixes
  })
  ipcMain.handle('scanner:mergeDuplicates', (_, keepId, removeIds) => {
    const db = getDB()
    const merge = db.transaction(() => {
      const winner = db.prepare('SELECT * FROM tracks WHERE id = ?').get(keepId)
      if (winner) { for (const id of removeIds) { const loser = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id); if (loser) { if (!winner.artwork_path && loser.artwork_path) db.prepare('UPDATE tracks SET artwork_path = ? WHERE id = ?').run(loser.artwork_path, keepId); if (!winner.album && loser.album) db.prepare('UPDATE tracks SET album = ? WHERE id = ?').run(loser.album, keepId); if (!winner.year && loser.year) db.prepare('UPDATE tracks SET year = ? WHERE id = ?').run(loser.year, keepId); if (!winner.genre && loser.genre) db.prepare('UPDATE tracks SET genre = ? WHERE id = ?').run(loser.genre, keepId) } } }
      for (const id of removeIds) { db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(keepId, id); db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(id); db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(id); db.prepare('UPDATE play_history SET track_id = ? WHERE track_id = ?').run(keepId, id); db.prepare('UPDATE tracks SET play_count = play_count + (SELECT play_count FROM tracks WHERE id = ?) WHERE id = ?').run(id, keepId); db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(id); db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(id); db.prepare('DELETE FROM tracks WHERE id = ?').run(id) }
    })
    merge()
  })
  ipcMain.handle('scanner:mergeAllDuplicates', () => {
    const db = getDB()
    const groups = db.prepare(`SELECT title, artist, COUNT(*) as count, GROUP_CONCAT(id) as ids FROM tracks GROUP BY LOWER(title), LOWER(artist) HAVING count > 1`).all()
    let mergedCount = 0
    for (const group of groups) {
      const ids = group.ids.split(',')
      if (ids.length < 2) continue
      const tracks = ids.map(id => db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)).filter(Boolean)
      if (tracks.length < 2) continue
      const scored = tracks.map(t => ({ track: t, score: scoreTrack(t) }))
      scored.sort((a, b) => b.score - a.score)
      const winner = scored[0].track
      const losers = scored.slice(1).map(s => s.track)
      const patch = db.transaction(() => {
        for (const loser of losers) { if (!winner.artwork_path && loser.artwork_path) db.prepare('UPDATE tracks SET artwork_path = ? WHERE id = ?').run(loser.artwork_path, winner.id); if (!winner.album && loser.album) db.prepare('UPDATE tracks SET album = ? WHERE id = ?').run(loser.album, winner.id); if (!winner.year && loser.year) db.prepare('UPDATE tracks SET year = ? WHERE id = ?').run(loser.year, winner.id); if (!winner.genre && loser.genre) db.prepare('UPDATE tracks SET genre = ? WHERE id = ?').run(loser.genre, winner.id) }
        for (const loser of losers) { db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(winner.id, loser.id); db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(loser.id); db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(loser.id); db.prepare('UPDATE play_history SET track_id = ? WHERE track_id = ?').run(winner.id, loser.id); db.prepare('UPDATE tracks SET play_count = play_count + (SELECT play_count FROM tracks WHERE id = ?) WHERE id = ?').run(loser.id, winner.id); db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(loser.id); db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(loser.id); db.prepare('DELETE FROM tracks WHERE id = ?').run(loser.id) }
      })
      patch(); mergedCount += losers.length
    }
    return { merged: mergedCount, groups: groups.length }
  })
  ipcMain.handle('user:getStats', (_, userId) => {
    const db = getDB()
    const uid = userId || 'guest'
    try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
    const totalPlays = db.prepare(`SELECT COUNT(*) as c FROM play_history WHERE user_id = ? AND COALESCE(seconds_played, 999) >= 30`).get(uid)?.c || 0
    const totalSecs = db.prepare(`SELECT SUM(COALESCE(seconds_played, 0)) as s FROM play_history WHERE user_id = ?`).get(uid)?.s || 0
    const topArtists = db.prepare(`SELECT t.artist, COUNT(*) as plays FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ph.user_id = ? AND COALESCE(ph.seconds_played, 999) >= 30 GROUP BY t.artist ORDER BY plays DESC LIMIT 5`).all(uid)
    const topTracks = db.prepare(`SELECT t.*, COUNT(*) as plays FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ph.user_id = ? AND COALESCE(ph.seconds_played, 999) >= 30 GROUP BY t.id ORDER BY plays DESC LIMIT 5`).all(uid)
    const topGenres = db.prepare(`SELECT t.genre, COUNT(*) as plays FROM play_history ph JOIN tracks t ON t.id = ph.track_id WHERE ph.user_id = ? AND t.genre IS NOT NULL AND COALESCE(ph.seconds_played, 999) >= 30 GROUP BY t.genre ORDER BY plays DESC LIMIT 5`).all(uid)
    const likedCount = db.prepare('SELECT COUNT(*) as c FROM user_likes WHERE user_id = ?').get(uid)?.c || 0
    const weeklyPlays = db.prepare(`SELECT COUNT(*) as c FROM play_history WHERE user_id = ? AND played_at > unixepoch() - 604800 AND COALESCE(seconds_played, 999) >= 30`).get(uid)?.c || 0
    return { totalPlays, totalMinutes: Math.round(totalSecs / 60), topArtists, topTracks, topGenres, likedCount, weeklyPlays }
  })
}

module.exports.registerV4Handlers = registerV4Handlers
