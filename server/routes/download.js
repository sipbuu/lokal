
const router = require('express').Router()
const { spawn } = require('child_process')
const { getDB } = require('../../electron/ipc/db')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')

const activeDownloads = new Map()

router.get('/search', async (req, res) => {
  const { q } = req.query
  if (!q) return res.json([])
  const proc = spawn('yt-dlp', [`ytsearch10:${q}`, '--dump-json', '--no-playlist', '--flat-playlist', '--skip-download', '--quiet'])
  let buf = ''
  proc.stdout.on('data', d => { buf += d.toString() })
  proc.on('close', () => {
    const results = buf.trim().split('\n').filter(Boolean).map(line => {
      try {
        const j = JSON.parse(line)
        return { id: j.id, title: j.title, channel: j.channel || j.uploader, duration: j.duration, thumbnail: j.thumbnail, url: j.webpage_url || `https://www.youtube.com/watch?v=${j.id}` }
      } catch { return null }
    }).filter(Boolean)
    res.json(results)
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
