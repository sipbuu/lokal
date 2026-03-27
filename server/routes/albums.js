const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')

function classifyAlbumRow(row) {
  const trackCount = Number(row?.track_count || 0)
  if (trackCount <= 1) return 'single'
  if (trackCount <= 6) return 'ep'
  return 'album'
}

function enrichAlbumRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    release_type: classifyAlbumRow(row),
  }))
}

router.get('/', (req, res) => {
  const rows = getDB().prepare(`
    SELECT album as title, album_artist, year, artwork_path, COUNT(*) as track_count,
           GROUP_CONCAT(DISTINCT artist) as artists
    FROM tracks WHERE album IS NOT NULL AND file_path NOT LIKE 'ghost://%'
    GROUP BY LOWER(album) ORDER BY year DESC, album ASC
  `).all()
  res.json(enrichAlbumRows(rows))
})

router.get('/search', (req, res) => {
  const term = `%${req.query.q || ''}%`
  const rows = getDB().prepare(`
    SELECT album as title, album_artist, year, artwork_path, COUNT(*) as track_count, GROUP_CONCAT(DISTINCT artist) as artists
    FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND (album LIKE ? OR album_artist LIKE ?)
    GROUP BY LOWER(album) ORDER BY album ASC LIMIT 40
  `).all(term, term)
  res.json(enrichAlbumRows(rows))
})

module.exports = router
