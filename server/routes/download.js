
const router = require('express').Router()
const { spawn } = require('child_process')
const { getDB } = require('../../electron/ipc/db')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')

const activeDownloads = new Map()

router.get('/search', async (req, res) => {
  const { q, page = 1 } = req.query
  if (!q) return res.json({ results: [], page: 1, hasMore: false })
  
  const limit = 10
  const offset = (parseInt(page) - 1) * limit
  
  const proc = spawn('yt-dlp', [`ytsearch${limit}:${q}`, '--dump-json', '--no-playlist', '--flat-playlist', '--skip-download', '--quiet'])
  let buf = ''
  proc.stdout.on('data', d => { buf += d.toString() })
  proc.on('close', () => {
    const results = buf.trim().split('\n').filter(Boolean).map(line => {
      try {
        const j = JSON.parse(line)
        return { id: j.id, title: j.title, channel: j.channel || j.uploader, duration: j.duration, thumbnail: j.thumbnail, url: j.webpage_url || `https://www.youtube.com/watch?v=${j.id}` }
      } catch { return null }
    }).filter(Boolean)
    
    const paginatedResults = offset > 0 ? results.slice(offset) : results
    res.json({ results: paginatedResults, page: parseInt(page), hasMore: results.length === limit })
  })
  proc.on('error', () => res.status(500).json({ error: 'yt-dlp not found' }))
})

router.get('/artist-search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])
  
  const proc = spawn('yt-dlp', [`ytsearch20:${q} artist channel`, '--dump-json', '--flat-playlist', '--skip-download', '--quiet'])
  let buf = ''
  proc.stdout.on('data', d => { buf += d.toString() })
  proc.on('close', () => {
    const results = []
    const lines = buf.trim().split('\n').filter(Boolean)
    
    for (const line of lines) {
      try {
        const j = JSON.parse(line)
        const entryType = j.entry_type || (j.playlist_id ? 'playlist' : 'video')
        if (entryType === 'playlist' || entryType === 'channel' || j.channel_id) {
          results.push({
            id: j.id,
            title: j.title,
            channel: j.channel || j.uploader,
            type: j.playlist_id ? 'playlist' : 'channel',
            thumbnail: j.thumbnail,
            url: j.url || j.webpage_url || (j.channel_id ? `https://www.youtube.com/channel/${j.channel_id}` : j.id),
            playlistId: j.playlist_id || null,
            videoCount: j.playlist_count || j.channel_item_count || null,
          })
        }
      } catch { }
    }
    
    if (results.length === 0) {
      const fallbackProc = spawn('yt-dlp', [`ytsearch5:${q} official channel`, '--dump-json', '--flat-playlist', '--skip-download', '--quiet'])
      let fallbackBuf = ''
      fallbackProc.stdout.on('data', d => { fallbackBuf += d.toString() })
      fallbackProc.on('close', () => {
        const fallbackLines = fallbackBuf.trim().split('\n').filter(Boolean)
        for (const line of fallbackLines) {
          try {
            const j = JSON.parse(line)
            if (j.channel_id || j.playlist_id) {
              results.push({
                id: j.id,
                title: j.title,
                channel: j.channel || j.uploader,
                type: j.playlist_id ? 'playlist' : 'channel',
                thumbnail: j.thumbnail,
                url: j.channel_id ? `https://www.youtube.com/channel/${j.channel_id}` : j.webpage_url,
                playlistId: j.playlist_id || null,
              })
            }
          } catch { }
        }
        res.json(results)
      })
      fallbackProc.on('error', () => res.json(results))
    } else {
      res.json(results)
    }
  })
  proc.on('error', () => res.status(500).json({ error: 'yt-dlp not found' }))
})

router.post('/', (req, res) => {
  const { url, format = 'mp3' } = req.body
  const db = getDB()
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
  const outDir = settings.music_folder || path.join(os.homedir(), 'Music')
  fs.ensureDirSync(outDir)

  const dlId = 'dl-' + Date.now()
  const outputTemplate = path.join(outDir, '%(artist)s', '%(album)s', '%(title)s.%(ext)s')
  const proc = spawn('yt-dlp', [url, '-x', '--audio-format', format, '--audio-quality', '0', '--embed-thumbnail', '--add-metadata', '--output', outputTemplate, '--newline', '--progress'])
  activeDownloads.set(dlId, { proc, progress: 0, status: 'downloading' })

  
  res.json({ downloadId: dlId })

  proc.on('close', (code) => { if (activeDownloads.has(dlId)) activeDownloads.get(dlId).status = code === 0 ? 'done' : 'error' })
})

router.get('/queue', (req, res) => {
  res.json(Array.from(activeDownloads.entries()).map(([id, v]) => ({ id, status: v.status, progress: v.progress })))
})

module.exports = router
