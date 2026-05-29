const { getDB } = require('./db')

const QUALIFIED_SECONDS = 30
const SESSION_GAP_SECONDS = 30 * 60
const FALLBACK_GENRES = new Set(['music'])

function toUnix(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value)
  const parsed = Date.parse(String(value))
  if (Number.isNaN(parsed)) return fallback
  return Math.floor(parsed / 1000)
}

function startOfYear(year) {
  return Math.floor(new Date(Number(year), 0, 1).getTime() / 1000)
}

function endOfYear(year) {
  return Math.floor(new Date(Number(year) + 1, 0, 1).getTime() / 1000) - 1
}

function quarterRange(year, quarter) {
  const q = Math.min(4, Math.max(1, Number(quarter) || 1))
  const startMonth = (q - 1) * 3
  return {
    from: Math.floor(new Date(Number(year), startMonth, 1).getTime() / 1000),
    to: Math.floor(new Date(Number(year), startMonth + 3, 1).getTime() / 1000) - 1,
  }
}

function resolveRange(opts = {}) {
  const now = new Date()
  const currentYear = now.getFullYear()
  if (opts.scope === 'quarter') {
    const q = opts.quarter || Math.floor(now.getMonth() / 3) + 1
    return { ...quarterRange(opts.year || currentYear, q), scope: 'quarter', year: Number(opts.year || currentYear), quarter: Number(q) }
  }
  if (opts.scope === 'year') {
    const year = Number(opts.year || currentYear)
    return { from: startOfYear(year), to: endOfYear(year), scope: 'year', year }
  }
  const from = toUnix(opts.from, 0)
  const to = toUnix(opts.to, Math.floor(Date.now() / 1000))
  return { from, to, scope: 'custom' }
}

function ensureRecapTables(db = getDB()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS listening_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_type TEXT,
      source_id TEXT,
      session_id TEXT,
      seconds_played INTEGER DEFAULT 0,
      track_duration REAL,
      started_at INTEGER,
      ended_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_le_user_time ON listening_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_le_session ON listening_events(session_id);
  `)
  try { db.exec('ALTER TABLE play_history ADD COLUMN session_id TEXT') } catch {}
}

function getSessionId(db, userId, endedAt) {
  ensureRecapTables(db)
  const last = db.prepare(`
    SELECT session_id, played_at
    FROM play_history
    WHERE user_id = ? AND session_id IS NOT NULL
    ORDER BY played_at DESC
    LIMIT 1
  `).get(userId)
  if (last?.session_id && endedAt - Number(last.played_at || 0) <= SESSION_GAP_SECONDS) return last.session_id
  return `ls-${userId}-${endedAt}-${Math.random().toString(36).slice(2, 8)}`
}

function recordListeningEvent(db, payload = {}) {
  ensureRecapTables(db)
  const userId = payload.userId || payload.user_id || 'guest'
  const trackId = payload.trackId || payload.track_id
  if (!trackId) return null
  const seconds = Math.max(0, Math.round(Number(payload.secondsPlayed ?? payload.seconds_played ?? payload.seconds ?? 0) || 0))
  const endedAt = Math.floor(Number(payload.endedAt || payload.ended_at || Date.now() / 1000))
  const startedAt = Math.max(0, Math.floor(Number(payload.startedAt || payload.started_at || endedAt - seconds)))
  const eventType = payload.eventType || payload.event_type || (seconds >= QUALIFIED_SECONDS ? 'qualified_play' : 'skipped')
  const sessionId = payload.sessionId || payload.session_id || getSessionId(db, userId, endedAt)
  db.prepare(`
    INSERT INTO listening_events
    (user_id, track_id, event_type, source_type, source_id, session_id, seconds_played, track_duration, started_at, ended_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    trackId,
    eventType,
    payload.sourceType || payload.source_type || null,
    payload.sourceId || payload.source_id || null,
    sessionId,
    seconds,
    payload.trackDuration || payload.track_duration || null,
    startedAt,
    endedAt,
    endedAt
  )
  return sessionId
}

function splitGenres(track) {
  return String(track?.genres || track?.genre || '')
    .split(',')
    .map(part => part.trim())
    .filter(genre => genre && !FALLBACK_GENRES.has(genre.toLowerCase()))
}

function incrementMap(map, key, amount = 1) {
  if (!key) return
  map.set(key, (map.get(key) || 0) + amount)
}

function topFromMap(map, keyName, limit = 10) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, plays]) => ({ [keyName]: key, plays }))
}

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite)
  if (!nums.length) return null
  return nums.reduce((sum, value) => sum + value, 0) / nums.length
}

function labelSession(session) {
  const hour = new Date(session.start * 1000).getHours()
  const topGenre = session.topGenres[0]?.genre
  const topArtist = session.topArtists[0]?.artist
  const genreShare = session.trackCount ? (session.topGenres[0]?.plays || 0) / session.trackCount : 0
  const artistShare = session.trackCount ? (session.topArtists[0]?.plays || 0) / session.trackCount : 0
  const skipRate = session.trackCount ? session.skippedCount / session.trackCount : 0
  if (skipRate >= 0.45 && session.trackCount >= 5) return 'Discovery pass'
  if ((hour >= 23 || hour < 5) && Number(session.audio.energy || 0) < 0.55) return 'Late night listening'
  if (genreShare >= 0.45 && topGenre) return `${session.durationMinutes || 1}-minute ${topGenre} run`
  if (artistShare >= 0.5 && topArtist) return `${topArtist} deep dive`
  if (Number(session.audio.energy || 0) >= 0.72 || Number(session.audio.tempo || 0) >= 135) return 'High-energy streak'
  return 'Listening session'
}

function buildSessions(rows) {
  const sessions = []
  let current = null
  for (const row of rows) {
    const playedAt = Number(row.played_at || 0)
    if (!current || playedAt - current.lastPlayedAt > SESSION_GAP_SECONDS) {
      current = { start: playedAt, end: playedAt, lastPlayedAt: playedAt, rows: [] }
      sessions.push(current)
    }
    current.rows.push(row)
    current.end = Math.max(current.end, playedAt + Number(row.seconds_played || 0))
    current.lastPlayedAt = playedAt
  }
  return sessions.map((session, index) => {
    const artistMap = new Map()
    const genreMap = new Map()
    const albumMap = new Map()
    const tracks = []
    const seen = new Set()
    for (const row of session.rows) {
      incrementMap(artistMap, row.artist)
      incrementMap(albumMap, row.album)
      for (const genre of splitGenres(row)) incrementMap(genreMap, genre)
      if (!seen.has(row.id)) {
        tracks.push(row)
        seen.add(row.id)
      }
    }
    const audio = {
      energy: avg(session.rows.map(row => row.energy)),
      danceability: avg(session.rows.map(row => row.danceability)),
      valence: avg(session.rows.map(row => row.valence)),
      acousticness: avg(session.rows.map(row => row.acousticness)),
      instrumentalness: avg(session.rows.map(row => row.instrumentalness)),
      tempo: avg(session.rows.map(row => row.tempo)),
    }
    const item = {
      id: session.rows.find(row => row.session_id)?.session_id || `derived-${index}-${session.start}`,
      start: session.start,
      end: session.end,
      durationMinutes: Math.max(1, Math.round((session.end - session.start) / 60)),
      trackCount: session.rows.length,
      qualifiedCount: session.rows.filter(row => Number(row.seconds_played || 0) >= QUALIFIED_SECONDS).length,
      skippedCount: session.rows.filter(row => Number(row.seconds_played || 0) < QUALIFIED_SECONDS).length,
      totalSeconds: session.rows.reduce((sum, row) => sum + Number(row.seconds_played || 0), 0),
      topArtists: topFromMap(artistMap, 'artist', 5),
      topGenres: topFromMap(genreMap, 'genre', 5),
      topAlbums: topFromMap(albumMap, 'album', 5).filter(item => item.album),
      audio,
      tracks: tracks.slice(0, 50),
    }
    return { ...item, label: labelSession(item) }
  }).sort((left, right) => right.totalSeconds - left.totalSeconds)
}

function savePreferenceProfile(db, userId, rows) {
  const genreMap = new Map()
  const artistMap = new Map()
  const hourMap = new Map()
  const skippedGenres = new Map()
  const qualified = rows.filter(row => Number(row.seconds_played || 0) >= QUALIFIED_SECONDS)
  for (const row of rows) {
    const hour = new Date(Number(row.played_at || 0) * 1000).getHours()
    incrementMap(hourMap, String(hour), 1)
    const genres = splitGenres(row)
    if (Number(row.seconds_played || 0) >= QUALIFIED_SECONDS) {
      incrementMap(artistMap, row.artist, 1)
      for (const genre of genres) incrementMap(genreMap, genre, 1)
    } else {
      for (const genre of genres) incrementMap(skippedGenres, genre, 1)
    }
  }
  const profile = {
    updatedAt: Math.floor(Date.now() / 1000),
    favoriteGenres: topFromMap(genreMap, 'genre', 12),
    skippedGenres: topFromMap(skippedGenres, 'genre', 12),
    favoriteArtists: topFromMap(artistMap, 'artist', 12),
    favoriteHours: topFromMap(hourMap, 'hour', 6).map(item => ({ hour: Number(item.hour), plays: item.plays })),
    audio: {
      energy: avg(qualified.map(row => row.energy)),
      danceability: avg(qualified.map(row => row.danceability)),
      valence: avg(qualified.map(row => row.valence)),
      acousticness: avg(qualified.map(row => row.acousticness)),
      instrumentalness: avg(qualified.map(row => row.instrumentalness)),
      tempo: avg(qualified.map(row => row.tempo)),
    },
  }
  db.prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)').run(userId, 'listening_preferences', JSON.stringify(profile))
  return profile
}

function buildRecap(db, userId = 'guest', opts = {}) {
  ensureRecapTables(db)
  const range = resolveRange(opts)
  const now = Math.floor(Date.now() / 1000)
  if ((range.scope === 'quarter' || range.scope === 'year') && range.to >= now) {
    return { error: 'This recap period has not finished yet.' }
  }
  try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
  const rows = db.prepare(`
    SELECT t.*, ph.id as history_id, ph.played_at, COALESCE(ph.seconds_played, 0) as seconds_played, ph.session_id
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    WHERE ph.user_id = ?
      AND ph.played_at BETWEEN ? AND ?
      AND t.file_path NOT LIKE 'ghost://%'
    ORDER BY ph.played_at ASC
  `).all(userId, range.from, range.to)
  const qualified = rows.filter(row => Number(row.seconds_played || 0) >= QUALIFIED_SECONDS)
  const trackMap = new Map()
  const artistMap = new Map()
  const genreMap = new Map()
  const albumMap = new Map()
  const skippedMap = new Map()
  for (const row of qualified) {
    const existing = trackMap.get(row.id) || { ...row, plays: 0, seconds: 0 }
    existing.plays += 1
    existing.seconds += Number(row.seconds_played || 0)
    trackMap.set(row.id, existing)
    incrementMap(artistMap, row.artist)
    incrementMap(albumMap, row.album)
    for (const genre of splitGenres(row)) incrementMap(genreMap, genre)
  }
  for (const row of rows.filter(row => Number(row.seconds_played || 0) < QUALIFIED_SECONDS)) {
    const existing = skippedMap.get(row.id) || { ...row, skips: 0 }
    existing.skips += 1
    skippedMap.set(row.id, existing)
  }
  const sessions = buildSessions(rows)
  const topTracks = [...trackMap.values()].sort((left, right) => right.plays - left.plays || right.seconds - left.seconds).slice(0, 50)
  const replayQueue = topTracks.slice(0, 50)
  const totalSeconds = qualified.reduce((sum, row) => sum + Number(row.seconds_played || 0), 0)
  const preferenceProfile = savePreferenceProfile(db, userId, rows)
  const peakHour = db.prepare(`
    SELECT CAST(strftime('%H', ph.played_at, 'unixepoch', 'localtime') AS INTEGER) as hour, COUNT(*) as plays
    FROM play_history ph
    WHERE ph.user_id = ? AND ph.played_at BETWEEN ? AND ? AND COALESCE(ph.seconds_played, 0) >= ?
    GROUP BY hour
    ORDER BY plays DESC
    LIMIT 1
  `).get(userId, range.from, range.to, QUALIFIED_SECONDS) || null
  return {
    ...range,
    userId,
    totalPlays: qualified.length,
    totalSkips: rows.length - qualified.length,
    totalMinutes: Math.round(totalSeconds / 60),
    uniqueArtists: new Set(qualified.map(row => row.artist).filter(Boolean)).size,
    uniqueAlbums: new Set(qualified.map(row => row.album || row.id).filter(Boolean)).size,
    uniqueTracks: new Set(qualified.map(row => row.id)).size,
    topTracks,
    topArtists: topFromMap(artistMap, 'artist', 10),
    topGenres: topFromMap(genreMap, 'genre', 10),
    topAlbums: topFromMap(albumMap, 'album', 10).filter(item => item.album),
    skippedTracks: [...skippedMap.values()].sort((left, right) => right.skips - left.skips).slice(0, 10),
    sessions: sessions.slice(0, 12),
    longestSession: [...sessions].sort((left, right) => right.durationMinutes - left.durationMinutes)[0] || null,
    biggestSession: sessions[0] || null,
    replayQueue,
    peakHour,
    preferences: preferenceProfile,
  }
}

function registerRecapHandlers(ipcMain) {
  ipcMain.handle('recaps:get', (_, userId, opts) => buildRecap(getDB(), userId || 'guest', opts || {}))
  ipcMain.handle('recaps:getPreferences', (_, userId) => {
    const row = getDB().prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'listening_preferences'").get(userId || 'guest')
    try { return row?.value ? JSON.parse(row.value) : null } catch { return null }
  })
}

module.exports = { registerRecapHandlers, recordListeningEvent, buildRecap, ensureRecapTables }
