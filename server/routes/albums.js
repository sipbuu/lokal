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

function albumRowsQuery(where = '') {
  return `
    SELECT
      album as title,
      COALESCE(NULLIF(album_artist, ''), artist) as album_artist,
      year,
      artwork_path,
      COUNT(*) as track_count,
      GROUP_CONCAT(DISTINCT artist) as artists
    FROM tracks
    WHERE album IS NOT NULL
      AND file_path NOT LIKE 'ghost://%'
      ${where}
    GROUP BY LOWER(album), LOWER(COALESCE(NULLIF(album_artist, ''), artist))
  `
}

router.get('/', (req, res) => {
  const rows = getDB().prepare(`${albumRowsQuery()} ORDER BY year DESC, album ASC`).all()
  res.json(enrichAlbumRows(rows))
})

router.get('/search', (req, res) => {
  const term = `%${req.query.q || ''}%`
  const rows = getDB().prepare(`${albumRowsQuery('AND (album LIKE ? OR album_artist LIKE ? OR artist LIKE ?)')} ORDER BY album ASC LIMIT 40`).all(term, term, term)
  res.json(enrichAlbumRows(rows))
})

module.exports = router
