const router = require('express').Router()
const fs = require('fs-extra')
const path = require('path')
const { getDB } = require('../../electron/ipc/db')
const { cacheArtistMetadata, searchArtistMetadataCandidates, applyArtistMetadataSelection, clearArtistImageOverride } = require('../../electron/ipc/artistMetadata')


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

function findArtistById(db, id) {
  let artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(id)
  if (!artist) {
    const slug = id.replace(/^a-/, '')
    const name = slug.replace(/-/g, ' ')
    artist = db.prepare('SELECT * FROM artists WHERE LOWER(name) = LOWER(?)').get(name)
  }
  return artist || null
}

async function saveArtistImageFromData(artistId, imageData) {
  const { getStorageDir } = require('../../electron/ipc/db')
  const imgPath = path.join(getStorageDir(), 'artwork', `artist-${artistId}.jpg`)
  const buf = Buffer.from(String(imageData || '').split(',')[1] || '', 'base64')
  await fs.writeFile(imgPath, buf)
  return imgPath
}

router.get('/', (req, res) => {
  const db = getDB()
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
  const hasPaging = !!search || req.query.limit !== undefined || req.query.offset !== undefined
  const limit = hasPaging ? Math.max(1, Math.min(200, parseInt(req.query.limit, 10) || 60)) : null
  const offset = hasPaging ? Math.max(0, parseInt(req.query.offset, 10) || 0) : 0
  const params = []
  const where = search ? 'WHERE a.name LIKE ?' : ''
  const having = 'HAVING COUNT(DISTINCT atl.track_id) > 0'

  if (search) {
    params.push(`%${search}%`)
  }

  const baseSql = `
    FROM artists a
    LEFT JOIN artist_track_links atl ON atl.artist_id = a.id
    GROUP BY a.id
  `
  const selectSql = `
    SELECT a.*, COUNT(t.id) as track_count FROM artists a
    JOIN tracks t ON t.artist = a.name GROUP BY a.id ORDER BY a.name
  `

  if (!hasPaging) {
    const artists = db.prepare(selectSql).all()
    const artistsWithFallback = artists.map(artist => addArtistFallback(db, artist))
    res.json(artistsWithFallback)
    return
  }

  const rows = db.prepare(`
    SELECT a.*, COUNT(DISTINCT atl.track_id) as track_count
    ${baseSql}
    ${where}
    ${having}
    ORDER BY a.name
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)
  const totalRow = db.prepare(`
    SELECT COUNT(*) as total
    FROM (
      SELECT a.id
      ${baseSql}
      ${where}
      ${having}
    ) grouped_artists
  `).get(...params)

  res.json({
    items: rows.map(artist => addArtistFallback(db, artist)),
    total: totalRow?.total || 0,
    limit,
    offset,
    hasMore: offset + rows.length < (totalRow?.total || 0),
  })
})

router.get('/metadata/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  res.json(await searchArtistMetadataCandidates(q))
})

router.get('/:id', (req, res) => {
  const db = getDB()
  let artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const tracks = db.prepare('SELECT * FROM tracks WHERE artist = ? ORDER BY album, track_num, title').all(artist.name)
  const topTracks = db.prepare('SELECT * FROM tracks WHERE artist = ? ORDER BY play_count DESC LIMIT 5').all(artist.name)
  const albums = db.prepare(`SELECT album as title, year, artwork_path, COUNT(*) as track_count FROM tracks WHERE artist = ? AND album IS NOT NULL GROUP BY album ORDER BY year DESC`).all(artist.name)
  const artistWithFallback = addArtistFallback(db, artist)
  res.json({ ...artistWithFallback, tracks, topTracks, albums })
})

router.post('/:id/refresh-metadata', async (req, res) => {
  const db = getDB()
  const artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const force = req.body?.force === true
  if (!force) {
    const enabled = db.prepare("SELECT value FROM settings WHERE key = 'auto_fetch_artist_metadata'").get()?.value === '1'
    if (!enabled) return res.json(addArtistFallback(db, artist))
  }
  const refreshed = await cacheArtistMetadata(db, artist)
  res.json(addArtistFallback(db, refreshed))
})

router.put('/:id/bio', (req, res) => {
  const db = getDB()
  const artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  db.prepare('UPDATE artists SET bio = ?, bio_source = ?, bio_fetched_at = ? WHERE id = ?').run(req.body?.bio || '', 'manual', Date.now(), artist.id)
  res.json({ ok: true })
})

router.put('/:id/image', async (req, res) => {
  const db = getDB()
  const artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const imageData = req.body?.imageData
  if (!imageData) return res.status(400).json({ error: 'imageData is required' })
  const imgPath = await saveArtistImageFromData(artist.id, imageData)
  db.prepare('UPDATE artists SET image_path = ?, image_source = ?, image_fetched_at = ? WHERE id = ?').run(imgPath, 'manual', Date.now(), artist.id)
  res.json({ ok: true, path: imgPath })
})

router.put('/:id/image-url', async (req, res) => {
  const db = getDB()
  const artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const url = req.body?.url
  if (!url) return res.status(400).json({ error: 'url is required' })
  const imgPath = path.join(require('../../electron/ipc/db').getStorageDir(), 'artwork', `artist-${artist.id}.jpg`)
  await fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    await fs.writeFile(imgPath, Buffer.from(arrayBuffer))
  })
  db.prepare('UPDATE artists SET image_path = ?, image_source = ?, image_fetched_at = ? WHERE id = ?').run(imgPath, 'manual', Date.now(), artist.id)
  res.json({ ok: true, path: imgPath })
})

router.post('/:id/metadata-selection', async (req, res) => {
  const db = getDB()
  const artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const updated = await applyArtistMetadataSelection(db, artist.id, req.body?.selection || null, { mode: req.body?.mode || 'both' })
  res.json(updated ? addArtistFallback(db, updated) : { error: 'Unable to apply selection' })
})

router.post('/:id/image/fallback', (req, res) => {
  const db = getDB()
  const artist = findArtistById(db, req.params.id)
  if (!artist) return res.status(404).json({ error: 'Not found' })
  const updated = clearArtistImageOverride(db, artist.id)
  res.json(updated ? addArtistFallback(db, updated) : { error: 'Unable to clear image override' })
})

router.get('/:id/albums/:album/tracks', (req, res) => {
  res.json(getDB().prepare('SELECT * FROM tracks WHERE album = ? ORDER BY track_num, title').all(req.params.album))
})

module.exports = router
