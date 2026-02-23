const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')


function addArtistFallback(db, artist) {
  if (artist.image_path) return artist
  const firstTrack = db.prepare(`
    SELECT t.artwork_path FROM tracks t 
    JOIN artist_track_links atl ON atl.track_id = t.id 
    WHERE atl.artist_id = ? AND t.artwork_path IS NOT NULL 
    ORDER BY t.play_count DESC LIMIT 1
  `).get(artist.id)
  return { ...artist, image_path: firstTrack?.artwork_path || null }
}

router.get('/', (req, res) => {
  const db = getDB()
  const artists = db.prepare(`
    SELECT a.*, COUNT(t.id) as track_count FROM artists a
    JOIN tracks t ON t.artist = a.name GROUP BY a.id ORDER BY a.name
  `).all()
  
  
  const artistsWithFallback = artists.map(artist => addArtistFallback(db, artist))
  res.json(artistsWithFallback)
})

router.get('/:id', (req, res) => {
  const db = getDB()
  
  let artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(req.params.id)
  
  
  if (!artist) {
    
    const slug = req.params.id.replace(/^a-/, '')
    const name = slug.replace(/-/g, ' ')
    artist = db.prepare('SELECT * FROM artists WHERE LOWER(name) = LOWER(?)').get(name)
  }
  
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const tracks = db.prepare('SELECT * FROM tracks WHERE artist = ? ORDER BY album, track_num, title').all(artist.name)
  const topTracks = db.prepare('SELECT * FROM tracks WHERE artist = ? ORDER BY play_count DESC LIMIT 5').all(artist.name)
  const albums = db.prepare(`SELECT album as title, year, artwork_path, COUNT(*) as track_count FROM tracks WHERE artist = ? AND album IS NOT NULL GROUP BY album ORDER BY year DESC`).all(artist.name)
  
  
  const artistWithFallback = addArtistFallback(db, artist)
  
  res.json({ ...artistWithFallback, tracks, topTracks, albums })
})

router.get('/:id/albums/:album/tracks', (req, res) => {
  res.json(getDB().prepare('SELECT * FROM tracks WHERE album = ? ORDER BY track_num, title').all(req.params.album))
})

module.exports = router
