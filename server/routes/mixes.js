const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')

router.get('/', (req, res) => {
  const { userId = 'guest' } = req.query
  const db = getDB()
  const mixes = []

  
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

  
  if (!mixes.length) {
    const allGenres = db.prepare('SELECT DISTINCT genre FROM tracks WHERE genre IS NOT NULL ORDER BY RANDOM() LIMIT 4').all()
    for (const g of allGenres) {
      const tracks = db.prepare('SELECT * FROM tracks WHERE genre = ? ORDER BY RANDOM() LIMIT 30').all(g.genre)
      if (tracks.length >= 3) mixes.push({ id: `genre-${g.genre}`, name: g.genre, type: 'genre', tracks })
    }
  }

  
  const discovery = db.prepare(`
    SELECT * FROM tracks WHERE id NOT IN (SELECT track_id FROM play_history WHERE user_id = ?)
    ORDER BY RANDOM() LIMIT 30
  `).all(userId)
  if (discovery.length >= 3) mixes.push({ id: 'discovery', name: 'Discovery Weekly', type: 'discovery', tracks: discovery })

  res.json(mixes)
})

module.exports = router
