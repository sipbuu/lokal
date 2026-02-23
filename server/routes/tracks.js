const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')



function scoreTrack(track) {
  let score = 0
  if (track.bitrate) score += track.bitrate / 100
  if (track.artwork_path) score += 10
  if (track.album) score += 5
  if (track.year) score += 3
  if (track.genre) score += 2
  return score
}

router.get('/', (req, res) => {
  const db = getDB()
  const { sort = 'added_at DESC', limit = 500, artistName } = req.query
  let sql = 'SELECT * FROM tracks'
  const params = []
  if (artistName) { sql += ' WHERE artist = ?'; params.push(artistName) }
  sql += ` ORDER BY ${sort} LIMIT ${parseInt(limit)}`
  res.json(db.prepare(sql).all(...params))
})

router.get('/search', (req, res) => {
  const { q = '' } = req.query
  const term = `%${q}%`
  res.json(getDB().prepare('SELECT * FROM tracks WHERE title LIKE ? OR artist LIKE ? OR album LIKE ? LIMIT 60').all(term, term, term))
})

router.get('/liked', (req, res) => {
  const userId = req.query.userId || 'guest'
  res.json(getDB().prepare(`
    SELECT t.* FROM tracks t JOIN user_likes ul ON ul.track_id = t.id
    WHERE ul.user_id = ? ORDER BY ul.liked_at DESC
  `).all(userId))
})

router.get('/history', (req, res) => {
  const { userId = 'guest', limit = 30 } = req.query
  res.json(getDB().prepare(`
    SELECT t.*, ph.played_at FROM tracks t
    JOIN play_history ph ON ph.track_id = t.id
    WHERE ph.user_id = ?
    ORDER BY ph.played_at DESC LIMIT ?
  `).all(userId, parseInt(limit)))
})


router.get('/history/export', (req, res) => {
  const { userId = 'guest', format = 'json' } = req.query
  const db = getDB()
  
  try { db.exec('ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0') } catch {}
  const history = db.prepare(`
    SELECT t.title, t.artist, t.album, ph.played_at, COALESCE(ph.seconds_played, 0) as seconds_played
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    WHERE ph.user_id = ?
    ORDER BY ph.played_at DESC
  `).all(userId)
  
  if (format === 'csv') {
    const header = 'title,artist,album,played_at,seconds_played\n'
    const rows = history.map(h => 
      `"${h.title}","${h.artist}","${h.album || ''}",${h.played_at},${h.seconds_played || 0}`
    ).join('\n')
    res.type('csv').send(header + rows)
  } else {
    res.json(history)
  }
})

router.get('/suggestions', (req, res) => {
  const { userId = 'guest' } = req.query
  const db = getDB()
  const liked = db.prepare(`
    SELECT t.artist, t.genre FROM tracks t
    JOIN user_likes ul ON ul.track_id = t.id WHERE ul.user_id = ?
  `).all(userId)
  if (!liked.length) return res.json(db.prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT 20').all())
  const artists = [...new Set(liked.map(l => l.artist).filter(Boolean))].slice(0, 5)
  const genres = [...new Set(liked.map(l => l.genre).filter(Boolean))].slice(0, 5)
  let rows = []
  if (artists.length) rows = db.prepare(`SELECT * FROM tracks WHERE artist IN (${artists.map(()=>'?').join(',')}) ORDER BY RANDOM() LIMIT 20`).all(...artists)
  if (rows.length < 20 && genres.length) {
    const extra = db.prepare(`SELECT * FROM tracks WHERE genre IN (${genres.map(()=>'?').join(',')}) ORDER BY RANDOM() LIMIT 20`).all(...genres)
    const ids = new Set(rows.map(r => r.id))
    rows = [...rows, ...extra.filter(r => !ids.has(r.id))].slice(0, 20)
  }
  res.json(rows)
})


router.get('/random', (req, res) => {
  res.json(getDB().prepare('SELECT * FROM tracks ORDER BY RANDOM() LIMIT 1').get())
})


router.get('/top-genres', (req, res) => {
  res.json(getDB().prepare(`
    SELECT genre, COUNT(*) as count FROM tracks 
    WHERE genre IS NOT NULL GROUP BY genre 
    ORDER BY count DESC LIMIT 10
  `).all())
})


router.put('/:id/genre', (req, res) => {
  const { genre } = req.body
  getDB().prepare('UPDATE tracks SET genre = ? WHERE id = ?').run(genre || null, req.params.id)
  res.json({ ok: true })
})

router.post('/:id/like', (req, res) => {
  const db = getDB()
  const { userId = 'guest' } = req.body
  const exists = db.prepare('SELECT 1 FROM user_likes WHERE user_id = ? AND track_id = ?').get(userId, req.params.id)
  if (exists) { db.prepare('DELETE FROM user_likes WHERE user_id = ? AND track_id = ?').run(userId, req.params.id); return res.json({ liked: false }) }
  db.prepare('INSERT OR IGNORE INTO user_likes (user_id, track_id) VALUES (?, ?)').run(userId, req.params.id)
  res.json({ liked: true })
})

router.post('/:id/playtime', (req, res) => {
  try {
    const { userId = 'guest', seconds = 0 } = req.body
    const db = getDB()
    const secs = Math.round(seconds)
    if (secs >= 30) db.prepare('UPDATE tracks SET play_count = play_count + 1 WHERE id = ?').run(req.params.id)
    const hasSecs = db.prepare('PRAGMA table_info(play_history)').all().some(c => c.name === 'seconds_played')
    if (hasSecs) db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played) VALUES (?, ?, ?)').run(userId, req.params.id, secs)
    else db.prepare('INSERT INTO play_history (user_id, track_id) VALUES (?, ?)').run(userId, req.params.id)
    res.json({ ok: true })
  } catch (e) { res.json({ error: e.message }) }
})

router.get('/:id/related', (req, res) => {
  const { userId = 'guest' } = req.query
  const db = getDB()
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(req.params.id)
  if (!track) return res.json([])
  let related = db.prepare(`
    SELECT * FROM tracks WHERE id != ? AND (genre = ? OR artist = ?)
    AND id NOT IN (SELECT track_id FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 100)
    ORDER BY RANDOM() LIMIT 25
  `).all(req.params.id, track.genre || '', track.artist, userId)
  if (related.length < 10) {
    const extra = db.prepare('SELECT * FROM tracks WHERE id != ? ORDER BY RANDOM() LIMIT 25').all(req.params.id)
    const ids = new Set(related.map(r => r.id))
    related = [...related, ...extra.filter(r => !ids.has(r.id))].slice(0, 25)
  }
  res.json(related)
})

router.get('/duplicates', (req, res) => {
  res.json(getDB().prepare(`
    SELECT title, artist, COUNT(*) as count, GROUP_CONCAT(id) as ids, GROUP_CONCAT(file_path) as paths
    FROM tracks GROUP BY LOWER(title), LOWER(artist) HAVING count > 1
  `).all())
})

router.post('/merge', (req, res) => {
  const { keepId, removeIds = [] } = req.body
  const db = getDB()
  
  try {
    const merge = db.transaction(() => {
      const winner = db.prepare('SELECT * FROM tracks WHERE id = ?').get(keepId)
      if (winner) {
        for (const id of removeIds) {
          const loser = db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)
          if (loser) {
            if (!winner.artwork_path && loser.artwork_path) {
              db.prepare('UPDATE tracks SET artwork_path = ? WHERE id = ?').run(loser.artwork_path, keepId)
            }
            if (!winner.album && loser.album) {
              db.prepare('UPDATE tracks SET album = ? WHERE id = ?').run(loser.album, keepId)
            }
            if (!winner.year && loser.year) {
              db.prepare('UPDATE tracks SET year = ? WHERE id = ?').run(loser.year, keepId)
            }
            if (!winner.genre && loser.genre) {
              db.prepare('UPDATE tracks SET genre = ? WHERE id = ?').run(loser.genre, keepId)
            }
          }
        }
      }
      
      for (const id of removeIds) {
        db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(keepId, id)
        db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(id)
        db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(id)
        db.prepare('UPDATE play_history SET track_id = ? WHERE track_id = ?').run(keepId, id)
        db.prepare('UPDATE tracks SET play_count = play_count + (SELECT play_count FROM tracks WHERE id = ?) WHERE id = ?').run(id, keepId)
        db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(id)
        db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(id)
        db.prepare('DELETE FROM tracks WHERE id = ?').run(id)
      }
    })
    merge()
    res.json({ ok: true })
  } catch (e) {
    res.json({ error: e.message })
  }
})

router.post('/merge-all', (req, res) => {
  const db = getDB()
  
  try {
    const groups = db.prepare(`
      SELECT title, artist, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM tracks
      GROUP BY LOWER(title), LOWER(artist)
      HAVING count > 1
    `).all()
    
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
        for (const loser of losers) {
          if (!winner.artwork_path && loser.artwork_path) {
            db.prepare('UPDATE tracks SET artwork_path = ? WHERE id = ?').run(loser.artwork_path, winner.id)
          }
          if (!winner.album && loser.album) {
            db.prepare('UPDATE tracks SET album = ? WHERE id = ?').run(loser.album, winner.id)
          }
          if (!winner.year && loser.year) {
            db.prepare('UPDATE tracks SET year = ? WHERE id = ?').run(loser.year, winner.id)
          }
          if (!winner.genre && loser.genre) {
            db.prepare('UPDATE tracks SET genre = ? WHERE id = ?').run(loser.genre, winner.id)
          }
        }
        
        for (const loser of losers) {
          db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(winner.id, loser.id)
          db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(loser.id)
          db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(loser.id)
          db.prepare('UPDATE play_history SET track_id = ? WHERE track_id = ?').run(winner.id, loser.id)
          db.prepare('UPDATE tracks SET play_count = play_count + (SELECT play_count FROM tracks WHERE id = ?) WHERE id = ?').run(loser.id, winner.id)
          db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(loser.id)
          db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(loser.id)
          db.prepare('DELETE FROM tracks WHERE id = ?').run(loser.id)
        }
      })
      
      patch()
      mergedCount += losers.length
    }
    
    res.json({ merged: mergedCount, groups: groups.length })
  } catch (e) {
    res.json({ error: e.message })
  }
})

router.post('/batch-delete', (req, res) => {
  const { ids = [] } = req.body
  const db = getDB()
  for (const id of ids) {
    db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(id)
    db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(id)
    db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(id)
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(id)
    db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(id)
    db.prepare('DELETE FROM tracks WHERE id = ?').run(id)
  }
  res.json({ ok: true })
})

module.exports = router
