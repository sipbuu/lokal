const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')

const mixCache = {
  daily: { data: null, timestamp: 0 },
  weekly: { data: null, timestamp: 0 },
  recent: { data: null, timestamp: 0 },
  top: { data: null, timestamp: 0 }
}

const CACHE_DURATION_DAILY = 24 * 60 * 60 * 1000 // 24 hours for daily
const CACHE_DURATION_WEEKLY = 7 * 24 * 60 * 60 * 1000 // 7 days for weekly

router.get('/', (req, res) => {
  const { userId = 'guest' } = req.query
  const db = getDB()
  const mixes = []

  const now = Date.now()
  if (!mixCache.daily.data || (now - mixCache.daily.timestamp) > CACHE_DURATION_DAILY) {
    const likedTracks = db.prepare(`
      SELECT t.* FROM tracks t
      INNER JOIN user_likes ul ON ul.track_id = t.id AND ul.user_id = ?
      ORDER BY ul.liked_at DESC LIMIT 50
    `).all(userId)
    
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
    `).all(userId)
    
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
    `).all(userId)
    if (discovery.length >= 3) {
      mixCache.weekly = { data: { id: 'discovery', name: 'Discovery Weekly', type: 'discovery', tracks: discovery }, timestamp: now }
    }
  }
  if (mixCache.weekly.data) mixes.push(mixCache.weekly.data)

  const genres = db.prepare(`
    SELECT t.genre, COUNT(*) as cnt FROM tracks t
    LEFT JOIN user_likes ul ON ul.track_id = t.id AND ul.user_id = ?
    LEFT JOIN play_history ph ON ph.track_id = t.id AND ph.user_id = ?
    WHERE t.genre IS NOT NULL AND (ul.track_id IS NOT NULL OR ph.track_id IS NOT NULL)
    GROUP BY t.genre ORDER BY cnt DESC LIMIT 4
  `).all(userId, userId)

  for (const g of genres) {
    const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 30').all(g.genre)
    if (tracks.length >= 3) mixes.push({ id: `genre-${g.genre}`, name: g.genre, type: 'genre', tracks })
  }

  if (!mixes.some(m => m.type === 'genre')) {
    const allGenres = db.prepare('SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL ORDER BY RANDOM() LIMIT 4').all()
    for (const g of allGenres) {
      const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 30').all(g.genre)
      if (tracks.length >= 3) mixes.push({ id: `genre-${g.genre}`, name: g.genre, type: 'genre', tracks })
    }
  }

  res.json(mixes)
})

module.exports = router
