const mixCache = {
  daily: { data: null, timestamp: 0 },
  weekly: { data: null, timestamp: 0 },
  recent: { data: null, timestamp: 0 },
  top: { data: null, timestamp: 0 }
}
const CACHE_DURATION_DAILY = 24 * 60 * 60 * 1000 
const CACHE_DURATION_WEEKLY = 7 * 24 * 60 * 60 * 1000

function registerMixesHandlers(ipcMain) {
  const { getDB } = require('./db')

  ipcMain.handle('scanner:getMixes', (_, userId) => {
    const db = getDB()
    const uid = userId || 'guest'
    const mixes = []
    const now = Date.now()

    if (!mixCache.daily.data || (now - mixCache.daily.timestamp) > CACHE_DURATION_DAILY) {
      const likedTracks = db.prepare(`
        SELECT t.* FROM tracks t
        INNER JOIN user_likes ul ON ul.track_id = t.id AND ul.user_id = ?
        ORDER BY ul.liked_at DESC LIMIT 50
      `).all(uid)
      
      if (likedTracks.length >= 3) {
        const shuffled = likedTracks.sort(() => Math.random() - 0.5).slice(0, 30)
        mixCache.daily = { data: { id: 'daily', name: 'Daily Mix', type: 'daily', tracks: shuffled }, timestamp: now }
      } else {
        const fallback = db.prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT 30').all()
        if (fallback.length >= 3) {
          mixCache.daily = { data: { id: 'daily', name: 'Daily Mix', type: 'daily', tracks: fallback }, timestamp: now }
        }
      }
    }
    if (mixCache.daily.data) mixes.push(mixCache.daily.data)

    if (!mixCache.recent.data || (now - mixCache.recent.timestamp) > CACHE_DURATION_DAILY) {
      const recentTracks = db.prepare(`
        SELECT * FROM tracks 
        WHERE added_at IS NOT NULL 
        ORDER BY added_at DESC 
        LIMIT 50
      `).all()
      
      if (recentTracks.length >= 3) {
        const shuffled = recentTracks.sort(() => Math.random() - 0.5).slice(0, 30)
        mixCache.recent = { data: { id: 'recent', name: 'New Arrivals', type: 'recent', tracks: shuffled }, timestamp: now }
      }
    }
    if (mixCache.recent.data) mixes.push(mixCache.recent.data)

    if (!mixCache.top.data || (now - mixCache.top.timestamp) > CACHE_DURATION_DAILY) {
      const topTracks = db.prepare(`
        SELECT t.*, COUNT(ph.id) as play_count FROM tracks t
        LEFT JOIN play_history ph ON ph.track_id = t.id AND ph.user_id = ?
        GROUP BY t.id
        HAVING play_count > 0
        ORDER BY play_count DESC
        LIMIT 50
      `).all(uid)
      
      if (topTracks.length >= 3) {
        const shuffled = topTracks.sort(() => Math.random() - 0.5).slice(0, 30)
        mixCache.top = { data: { id: 'top', name: 'Most Played', type: 'top', tracks: shuffled }, timestamp: now }
      }
    }
    if (mixCache.top.data) mixes.push(mixCache.top.data)

    if (!mixCache.weekly.data || (now - mixCache.weekly.timestamp) > CACHE_DURATION_WEEKLY) {
      const discovery = db.prepare(`
        SELECT * FROM tracks WHERE id NOT IN (SELECT track_id FROM play_history WHERE user_id = ?)
        ORDER BY RANDOM() LIMIT 30
      `).all(uid)
      if (discovery.length >= 3) {
        mixCache.weekly = { data: { id: 'discovery', name: 'Discovery Weekly', type: 'discovery', tracks: discovery }, timestamp: now }
      }
    }
    if (mixCache.weekly.data) mixes.push(mixCache.weekly.data)

    const liked = db.prepare(`SELECT t.genre, t.artist FROM tracks t JOIN user_likes ul ON ul.track_id = t.id WHERE ul.user_id = ? LIMIT 50`).all(uid)
    const history = db.prepare(`SELECT t.genre, t.artist FROM tracks t JOIN play_history ph ON ph.track_id = t.id WHERE ph.user_id = ? ORDER BY ph.played_at DESC LIMIT 50`).all(uid)
    const combined = [...liked, ...history]
    const genreCounts = {}; const artistCounts = {}
    for (const r of combined) { if (r.genre) genreCounts[r.genre] = (genreCounts[r.genre] || 0) + 1; if (r.artist) artistCounts[r.artist] = (artistCounts[r.artist] || 0) + 1 }
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g]) => g)
    const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a)
    
    for (const genre of topGenres) { const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 30').all(genre); if (tracks.length >= 3) mixes.push({ id: `mix-g-${genre}`, name: `${genre} Mix`, type: 'genre', tracks }) }
    for (const artist of topArtists) { const tracks = db.prepare(`SELECT * FROM tracks WHERE artist LIKE ? ORDER BY RANDOM() LIMIT 25`).all(`%${artist}%`); if (tracks.length >= 3) mixes.push({ id: `mix-a-${artist}`, name: `${artist}`, type: 'artist', tracks }) }
    
    if (mixes.length === 0) { const genres = db.prepare(`SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL ORDER BY RANDOM() LIMIT 4`).all(); for (const { genre } of genres) { const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 25').all(genre); if (tracks.length >= 3) mixes.push({ id: `mix-g-${genre}`, name: `${genre} Mix`, type: 'genre', tracks }) } }
    return mixes
  })
}

module.exports = { registerMixesHandlers }
