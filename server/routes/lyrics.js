const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const https = require('https')

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'LokalMusic/2.0' } }, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    }).on('error', () => resolve(null))
  })
}

function parseLRC(lrc) {
  if (!lrc) return []
  const lines = []
  for (const raw of lrc.split('\n')) {
    const match = raw.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
    if (match) lines.push({ time: parseInt(match[1]) * 60 + parseFloat(match[2]), text: match[3].trim() })
  }
  return lines.sort((a, b) => a.time - b.time)
}


try {
  const db = getDB()
  db.exec("ALTER TABLE lyrics_cache ADD COLUMN fetched_at INTEGER DEFAULT 0")
} catch (e) {
  
}

router.get('/:trackId', async (req, res) => {
  const db = getDB()
  const { trackId } = req.params
  const { title, artist, album, duration } = req.query

  const cached = db.prepare('SELECT * FROM lyrics_cache WHERE track_id = ?').get(trackId)
  if (cached) {
    try { return res.json({ type: cached.lyrics_type, lines: JSON.parse(cached.content), source: cached.source }) } catch {}
  }

  if (!title || !artist) return res.json(null)

  const keepCommaSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('keep_comma_artists')
  let keepCommaArtists = []
  try {
    const val = keepCommaSetting?.value || ""
    keepCommaArtists = val.startsWith('[') ? JSON.parse(val) : val.split('\n').map(s => s.trim())
  } catch (e) {
    keepCommaArtists = []
  }

  const isProtected = keepCommaArtists.some(a => a.toLowerCase() === artist.toLowerCase())
  
  const searchArtist = isProtected 
    ? artist 
    : artist.split(/,| feat\.?| & | ft\.?|;/i)[0].trim()


  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
  const source = settings.lyrics_source || 'lrclib'

  let result = null

  async function tryLRCLIB() {
    const q = new URLSearchParams({ track_name: title, artist_name: searchArtist })
    if (album) q.set('album_name', album)
    if (duration) q.set('duration', Math.round(duration))
    const r = await get(`https://lrclib.net/api/get?${q}`)
    if (!r) return null
    if (r.syncedLyrics) return { type: 'synced', lines: parseLRC(r.syncedLyrics), source: 'lrclib' }
    if (r.plainLyrics) return { type: 'unsynced', lines: r.plainLyrics.split('\n').filter(l => l.trim()).map(t => ({ time: null, text: t })), source: 'lrclib' }
    return null
  }

  async function tryOVH() {
    const r = await get(`https://api.lyrics.ovh/v1/${encodeURIComponent(searchArtist)}/${encodeURIComponent(title)}`)
    if (!r?.lyrics) return null
    return { type: 'unsynced', lines: r.lyrics.split('\n').filter(l => l.trim()).map(t => ({ time: null, text: t })), source: 'lyrics.ovh' }
  }

  if (source === 'lrclib' || source === 'both') result = await tryLRCLIB()
  if (!result && (source === 'lyricsovh' || source === 'both')) result = await tryOVH()
  if (!result && source === 'lrclib') result = await tryOVH()
  if (!result && source === 'lyricsovh') result = await tryLRCLIB()

  if (result) {
    db.prepare('INSERT OR REPLACE INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at) VALUES (?, ?, ?, ?, ?)').run(trackId, result.type, JSON.stringify(result.lines), result.source, Date.now())
  }
  
  res.json(result)
})

router.delete('/:trackId', (req, res) => {
  getDB().prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(req.params.trackId)
  res.json({ ok: true })
})

module.exports = router
