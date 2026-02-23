const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')

router.get('/', (req, res) => {
  res.json(getDB().prepare(`
    SELECT album as title, album_artist, year, artwork_path, COUNT(*) as track_count,
           GROUP_CONCAT(DISTINCT artist) as artists
    FROM tracks WHERE album IS NOT NULL
    GROUP BY LOWER(album) ORDER BY year DESC, album ASC
  `).all())
})

router.get('/search', (req, res) => {
  const term = `%${req.query.q || ''}%`
  res.json(getDB().prepare(`
    SELECT album as title, album_artist, year, artwork_path, COUNT(*) as track_count
    FROM tracks WHERE album LIKE ? OR album_artist LIKE ?
    GROUP BY LOWER(album) ORDER BY album ASC LIMIT 40
  `).all(term, term))
})

module.exports = router
