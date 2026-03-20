const router = require('express').Router()
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const { getDB, getStorageDir } = require('../../electron/ipc/db')

const activeDownloads = new Map()

function findBinary(name) {
  const candidates = process.platform === 'win32' ? [`${name}.exe`, name] : [name]
  for (const candidate of candidates) {
    try {
      require('child_process').execSync(`${candidate} --version`, { stdio: 'ignore' })
      return candidate
    } catch {}
  }
  return null
}

function getPlaylistId(url) {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('list') || null
  } catch {
    const match = String(url || '').match(/[?&]list=([a-zA-Z0-9_-]+)/)
    return match ? match[1] : null
  }
}

function resolveAudioQuality(format, quality) {
  if (format === 'mp3' && quality) return `${quality}K`
  return '0'
}

function snapshot(entry) {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    kind: entry.kind,
    status: entry.status,
    progress: entry.progress ?? 0,
    speed: entry.speed || null,
    eta: entry.eta || null,
    message: entry.message || null,
    song: entry.song || null,
    output: entry.output || '',
    downloadedTracks: Array.isArray(entry.downloadedTracks) ? entry.downloadedTracks : [],
    indexedTracks: Array.isArray(entry.indexedTracks) ? entry.indexedTracks : [],
    totalTracks: entry.totalTracks ?? null,
    currentTrack: entry.currentTrack ?? null,
    error: entry.error || null,
  }
}

function setActiveEntry(id, patch = {}) {
  const current = activeDownloads.get(id)
  if (!current) return null
  const next = {
    ...current,
    ...patch,
    downloadedTracks: Array.isArray(patch.downloadedTracks) ? patch.downloadedTracks : current.downloadedTracks,
    indexedTracks: Array.isArray(patch.indexedTracks) ? patch.indexedTracks : current.indexedTracks,
  }
  activeDownloads.set(id, next)
  return next
}

function trimOutput(lines, limit = 50) {
  return lines.slice(-limit).join('\n')
}

function collectFilepath(line, filepaths, downloadedTracks) {
  if (!line.startsWith('filepath:')) return null
  const filepath = line.slice('filepath:'.length).trim()
  if (!filepath) return null
  if (!filepaths.includes(filepath)) filepaths.push(filepath)
  const basename = path.basename(filepath)
  if (!downloadedTracks.includes(basename)) downloadedTracks.push(basename)
  return filepath
}

function getSettingsMap() {
  const db = getDB()
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]))
}

function buildBaseArgs(settings) {
  const args = []
  if (settings.yt_cookies === '1') {
    args.push('--cookies-from-browser', settings.yt_cookie_browser || 'firefox')
  }
  return args
}

async function cleanupLeftovers(filepaths, outputDir) {
  const audioExts = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus'])
  const junkExts = new Set(['.webp', '.webm', '.ytdl', '.part', '.jpg.part', '.temp', '.mhtml', '.info.json'])

  for (const fp of filepaths) {
    const dir = path.dirname(fp)
    const base = path.basename(fp, path.extname(fp))
    try {
      const siblings = fs.readdirSync(dir)
      for (const file of siblings) {
        const ext = path.extname(file).toLowerCase()
        const fullPath = path.join(dir, file)
        if (!file.startsWith(base)) continue
        if (audioExts.has(ext)) continue
        if (junkExts.has(ext)) {
          try { fs.unlinkSync(fullPath) } catch {}
          continue
        }
        if (ext === '.jpg') {
          try {
            const stat = fs.statSync(fullPath)
            if (stat.size < 51200) fs.unlinkSync(fullPath)
          } catch {}
        }
      }
    } catch {}
  }

  try {
    const topLevel = fs.readdirSync(outputDir)
    for (const file of topLevel) {
      if (path.extname(file).toLowerCase() === '.webp') {
        try { fs.unlinkSync(path.join(outputDir, file)) } catch {}
      }
    }
  } catch {}
}

function mapSearchResult(entry) {
  return {
    id: entry.id,
    title: entry.title,
    channel: entry.channel || entry.uploader,
    duration: entry.duration,
    thumbnail: entry.thumbnail,
    url: entry.webpage_url || (entry.id ? `https://www.youtube.com/watch?v=${entry.id}` : entry.url),
  }
}

function mapArtistResult(entry) {
  const channelId = entry.channel_id || entry.id
  const type = entry.playlist_id ? 'playlist' : 'channel'
  let url = entry.webpage_url || entry.url || null
  if (!url && type === 'channel' && channelId) {
    url = `https://www.youtube.com/channel/${channelId}`
  }
  return {
    id: entry.playlist_id || channelId || entry.id,
    title: entry.title || entry.uploader || entry.channel,
    channel: entry.uploader || entry.channel,
    type,
    thumbnail: entry.thumbnail,
    url,
    playlistId: entry.playlist_id || null,
    videoCount: entry.playlist_count || entry.channel_item_count || null,
  }
}

function clampActiveProgress(value) {
  const rounded = Math.round(value || 0)
  if (rounded >= 100) return 99
  if (rounded < 0) return 0
  return rounded
}

function resolveSourceLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube'
    if (host.includes('soundcloud')) return 'SoundCloud'
    if (host.includes('bandcamp')) return 'Bandcamp'
    if (host.includes('mixcloud')) return 'Mixcloud'
    return host
  } catch {
    return 'Source'
  }
}

function fetchMediaTitle(ytdlp, url) {
  return new Promise(resolve => {
    const args = [
      url,
      '--dump-single-json',
      '--flat-playlist',
      '--playlist-items', '1',
      '--quiet',
      '--no-warnings',
    ]
    const proc = spawn(ytdlp, args, { windowsHide: true })
    let stdout = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.on('close', () => {
      try {
        const parsed = JSON.parse(stdout)
        resolve(parsed?.title || parsed?.playlist_title || parsed?.uploader || null)
      } catch {
        resolve(null)
      }
    })

    proc.on('error', () => resolve(null))
  })
}

function getFriendlyDownloadError(outputLines, fallback) {
  const text = Array.isArray(outputLines) ? outputLines.join('\n') : String(outputLines || '')
  if (/Requested format is not available/i.test(text)) {
    return 'yt-dlp could not fetch the requested format. Try updating or re-downloading yt-dlp in Settings and then retry.'
  }
  return fallback
}

function runJsonSearch(searchTerm, mapper, page = 1, limit = 10) {
  const ytdlp = findBinary('yt-dlp')
  if (!ytdlp) {
    return Promise.resolve({ error: 'yt-dlp not found', results: [], page: 1, hasMore: false })
  }

  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const fetchCount = safePage * limit + 1
  const args = [
    `ytsearch${fetchCount}:${searchTerm}`,
    '--dump-json',
    '--flat-playlist',
    '--skip-download',
    '--quiet',
    '--no-warnings',
  ]

  return new Promise(resolve => {
    const proc = spawn(ytdlp, args, { windowsHide: true })
    let stdout = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.on('close', () => {
      const rows = stdout
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line)
          } catch {
            return null
          }
        })
        .filter(Boolean)

      const mapped = []
      const seen = new Set()

      for (const row of rows) {
        const item = mapper(row)
        if (!item?.id || !item?.url) continue
        const key = `${item.type || 'item'}:${item.id}:${item.url}`
        if (seen.has(key)) continue
        seen.add(key)
        mapped.push(item)
      }

      const start = (safePage - 1) * limit
      const end = start + limit
      resolve({
        results: mapped.slice(start, end),
        page: safePage,
        hasMore: mapped.length > end,
      })
    })

    proc.on('error', () => resolve({ error: 'yt-dlp not found', results: [], page: safePage, hasMore: false }))
  })
}

function startSingleDownload(url, opts = {}) {
  const ytdlp = findBinary('yt-dlp')
  if (!ytdlp) return { error: 'yt-dlp not found' }

  const settings = getSettingsMap()
  const outDir = settings.music_folder || path.join(os.homedir(), 'Music')
  fs.ensureDirSync(outDir)

  const id = opts.id || `dl-${Date.now()}`
  const format = opts.format || 'mp3'
  const outputTemplate = path.join(outDir, '%(artist)s', '%(album)s', '%(title)s.%(ext)s')
  const args = [
    url,
    '-x',
    '--audio-format', format,
    '--audio-quality', resolveAudioQuality(format, opts.quality),
    '--embed-thumbnail',
    '--add-metadata',
    '--embed-metadata',
    '--print', 'after_move:filepath:%(filepath)s',
    '--output', outputTemplate,
    '--newline',
    '--progress',
    '--no-warnings',
    ...buildBaseArgs(settings),
  ]

  const outputLines = []
  const filepaths = []
  const downloadedTracks = []
  const proc = spawn(ytdlp, args, { windowsHide: true })

  activeDownloads.set(id, {
    id,
    url,
    title: opts.title || url,
    kind: 'single',
    status: 'downloading',
    progress: 0,
    message: 'Starting...',
    song: null,
    output: '',
    downloadedTracks: [],
    indexedTracks: [],
    proc,
  })

  proc.stdout.on('data', data => {
    const lines = data.toString().split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      outputLines.push(line)

      const filepath = collectFilepath(line, filepaths, downloadedTracks)
      if (filepath) {
        setActiveEntry(id, {
          song: filepath,
          message: `Saved: ${path.basename(filepath)}`,
          downloadedTracks: [...downloadedTracks],
          output: trimOutput(outputLines),
        })
        continue
      }

      const pctMatch = line.match(/(\d+(?:\.\d+)?)%/)
      if (pctMatch) {
        const speedMatch = line.match(/at\s+([^\s]+\/s)/i) || line.match(/([0-9.]+[KMG]iB\/s)/)
        const etaMatch = line.match(/ETA\s+([0-9:]+)/i)
        setActiveEntry(id, {
          progress: clampActiveProgress(parseFloat(pctMatch[1])),
          speed: speedMatch?.[1] || null,
          eta: etaMatch?.[1] || null,
          message: downloadedTracks.length ? `Downloading: ${downloadedTracks[downloadedTracks.length - 1]}` : 'Downloading...',
          downloadedTracks: [...downloadedTracks],
          output: trimOutput(outputLines),
        })
        continue
      }

      if (/^\[(download|ffmpeg|ExtractAudio|Metadata|EmbedThumbnail)\]/.test(line)) {
        setActiveEntry(id, {
          message: line.replace(/^\[[^\]]+\]\s*/, '').trim(),
          output: trimOutput(outputLines),
        })
      }
    }
  })

  proc.stderr.on('data', data => {
    const lines = data.toString().split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      outputLines.push(line)
    }
    setActiveEntry(id, { output: trimOutput(outputLines) })
  })

  proc.on('close', async code => {
    if (!activeDownloads.has(id)) return

    if (code === 0) {
      try {
        await cleanupLeftovers(filepaths, outDir)
      } catch {}
      setActiveEntry(id, {
        status: 'done',
        progress: 100,
        message: downloadedTracks.length ? `Downloaded ${downloadedTracks.length} track(s)` : 'Download complete',
        downloadedTracks: [...downloadedTracks],
        output: trimOutput(outputLines),
      })
      return
    }

    const friendlyError = getFriendlyDownloadError(outputLines, code === null ? 'Cancelled' : 'Download failed')
    setActiveEntry(id, {
      status: 'error',
      error: friendlyError,
      message: friendlyError,
      output: trimOutput(outputLines),
    })
  })

  proc.on('error', err => {
    setActiveEntry(id, {
      status: 'error',
      error: err.message,
      message: err.message,
      output: trimOutput(outputLines),
    })
  })

  return { downloadId: id }
}

function startPlaylistDownload(url, opts = {}) {
  const ytdlp = findBinary('yt-dlp')
  if (!ytdlp) return { error: 'yt-dlp not found' }

  const resolvedTitlePromise = fetchMediaTitle(ytdlp, url)
  const db = getDB()
  const settings = getSettingsMap()
  const outDir = settings.music_folder || path.join(os.homedir(), 'Music')
  fs.ensureDirSync(outDir)

  const id = opts.id || `pl-${Date.now()}`
  const format = opts.format || 'mp3'
  const outputTemplate = path.join(outDir, '%(playlist)s', '%(artist)s', '%(title)s.%(ext)s')
  const playlistDbId = opts.playlistId || getPlaylistId(url) || `pl-${Date.now()}`
  const archivePath = path.join(getStorageDir(), `archive-${playlistDbId}.txt`)

  const args = [
    url,
    '--download-archive', archivePath,
    '-x',
    '--audio-format', format,
    '--audio-quality', resolveAudioQuality(format, opts.quality),
    '--embed-thumbnail',
    '--add-metadata',
    '--embed-metadata',
    '--print', 'after_move:filepath:%(filepath)s',
    '--output', outputTemplate,
    '--newline',
    '--progress',
    '--yes-playlist',
    '--ignore-errors',
    '--no-warnings',
    ...buildBaseArgs(settings),
  ]

  const outputLines = []
  const errorLines = []
  const filepaths = []
  const downloadedTracks = []
  let totalTracks = 0
  let currentTrack = 0
  let currentSong = null
  const proc = spawn(ytdlp, args, { windowsHide: true })

  activeDownloads.set(id, {
    id,
    url,
    title: opts.title || `${resolveSourceLabel(url)} Playlist`,
    kind: 'playlist',
    status: 'downloading',
    progress: 0,
    message: 'Starting...',
    song: null,
    output: '',
    downloadedTracks: [],
    indexedTracks: [],
    totalTracks: null,
    currentTrack: null,
    proc,
  })

  resolvedTitlePromise.then(resolvedTitle => {
    const finalTitle = opts.title || resolvedTitle || `${resolveSourceLabel(url)} Playlist`
    db.prepare(`INSERT OR REPLACE INTO downloaded_playlists (id, url, title, archive_path, status, downloaded_count, last_downloaded_at) VALUES (?, ?, ?, ?, 'downloading', 0, ?)`)
      .run(playlistDbId, url, finalTitle, archivePath, Date.now())
    setActiveEntry(id, { title: finalTitle })
  })

  proc.stdout.on('data', data => {
    const lines = data.toString().split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      outputLines.push(line)

      const filepath = collectFilepath(line, filepaths, downloadedTracks)
      if (filepath) {
        currentSong = filepath
        setActiveEntry(id, {
          song: filepath,
          message: `Saved: ${path.basename(filepath)}`,
          downloadedTracks: [...downloadedTracks],
          totalTracks: totalTracks || null,
          currentTrack: currentTrack || null,
          output: trimOutput(outputLines),
        })
        continue
      }

      const videoMatch = line.match(/\[download\]\s+Downloading video\s+(\d+)\s+of\s+(\d+)/i)
      if (videoMatch) {
        currentTrack = parseInt(videoMatch[1], 10)
        totalTracks = parseInt(videoMatch[2], 10)
        const progress = totalTracks > 0 ? clampActiveProgress(((currentTrack - 1) / totalTracks) * 100) : 0
        setActiveEntry(id, {
          progress,
          message: `Track ${currentTrack} of ${totalTracks}`,
          totalTracks,
          currentTrack,
          song: currentSong,
          downloadedTracks: [...downloadedTracks],
          output: trimOutput(outputLines),
        })
        continue
      }

      if (line.includes('has already been recorded in the archive')) {
        setActiveEntry(id, {
          message: line.replace(/^\[[^\]]+\]\s*/, '').trim(),
          totalTracks: totalTracks || null,
          currentTrack: currentTrack || null,
          downloadedTracks: [...downloadedTracks],
          output: trimOutput(outputLines),
        })
        continue
      }

      const pctMatch = line.match(/(\d+(?:\.\d+)?)%/)
      if (pctMatch) {
        const raw = parseFloat(pctMatch[1])
        const progress = totalTracks > 0 && currentTrack > 0
          ? clampActiveProgress((((currentTrack - 1) + raw / 100) / totalTracks) * 100)
          : clampActiveProgress(raw)
        const speedMatch = line.match(/at\s+([^\s]+\/s)/i) || line.match(/([0-9.]+[KMG]iB\/s)/)
        const etaMatch = line.match(/ETA\s+([0-9:]+)/i)
        setActiveEntry(id, {
          progress,
          speed: speedMatch?.[1] || null,
          eta: etaMatch?.[1] || null,
          message: currentSong ? `Downloading: ${path.basename(currentSong)}` : 'Downloading...',
          song: currentSong,
          totalTracks: totalTracks || null,
          currentTrack: currentTrack || null,
          downloadedTracks: [...downloadedTracks],
          output: trimOutput(outputLines),
        })
        continue
      }

      if (/error/i.test(line)) {
        errorLines.push(line)
      } else if (/^\[(download|ffmpeg|ExtractAudio|Metadata|EmbedThumbnail)\]/.test(line)) {
        setActiveEntry(id, {
          message: line.replace(/^\[[^\]]+\]\s*/, '').trim(),
          song: currentSong,
          totalTracks: totalTracks || null,
          currentTrack: currentTrack || null,
          downloadedTracks: [...downloadedTracks],
          output: trimOutput(outputLines),
        })
      }
    }
  })

  proc.stderr.on('data', data => {
    const lines = data.toString().split(/\r?\n/)
    for (const line of lines) {
      if (!line.trim()) continue
      outputLines.push(line)
      if (/error/i.test(line) && !line.includes('Deleting original file')) {
        errorLines.push(line)
      }
    }
    setActiveEntry(id, {
      output: trimOutput(outputLines),
      message: currentSong ? `Downloading: ${path.basename(currentSong)}` : 'Preparing download...',
    })
  })

  proc.on('close', async code => {
    if (!activeDownloads.has(id)) return

    if (code === 0) {
      try {
        await cleanupLeftovers(filepaths, outDir)
      } catch {}

      db.prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
        .run('completed', downloadedTracks.length, totalTracks || downloadedTracks.length, Date.now(), playlistDbId)

      setActiveEntry(id, {
        status: 'done',
        progress: 100,
        message: `Downloaded ${downloadedTracks.length} track(s)`,
        downloadedTracks: [...downloadedTracks],
        totalTracks: totalTracks || downloadedTracks.length,
        currentTrack: totalTracks || downloadedTracks.length,
        output: trimOutput(outputLines),
      })
      return
    }

    db.prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
      .run(code === null ? 'incomplete' : 'failed', downloadedTracks.length, totalTracks || downloadedTracks.length, Date.now(), playlistDbId)

    const friendlyError = getFriendlyDownloadError(errorLines.length ? errorLines : outputLines, code === null ? 'Cancelled' : `Failed (exit ${code})`)
    setActiveEntry(id, {
      status: 'error',
      error: friendlyError,
      message: friendlyError,
      downloadedTracks: [...downloadedTracks],
      totalTracks: totalTracks || null,
      currentTrack: currentTrack || null,
      output: trimOutput(outputLines),
    })
  })

  proc.on('error', err => {
    db.prepare('UPDATE downloaded_playlists SET status = ?, last_downloaded_at = ? WHERE id = ?')
      .run('failed', Date.now(), playlistDbId)

    setActiveEntry(id, {
      status: 'error',
      error: err.message,
      message: err.message,
      output: trimOutput(outputLines),
    })
  })

  return { downloadId: id, playlistId: playlistDbId }
}

router.get('/search', async (req, res) => {
  const { q, page = 1 } = req.query
  if (!q) return res.json({ results: [], page: 1, hasMore: false })
  const result = await runJsonSearch(q, mapSearchResult, page, 10)
  res.status(result.error ? 500 : 200).json(result)
})

router.get('/artist-search', async (req, res) => {
  const { q, page = 1 } = req.query
  if (!q) return res.json({ results: [], page: 1, hasMore: false })
  const primary = await runJsonSearch(`${q} official artist channel`, mapArtistResult, page, 10)
  if (primary.results.length > 0 || primary.error) {
    return res.status(primary.error ? 500 : 200).json(primary)
  }
  const fallback = await runJsonSearch(`${q} artist profile`, mapArtistResult, page, 10)
  res.status(fallback.error ? 500 : 200).json(fallback)
})

router.post('/', (req, res) => {
  const { url, ...opts } = req.body || {}
  if (!url) return res.status(400).json({ error: 'URL is required' })
  const result = startSingleDownload(url, opts)
  if (result.error) return res.status(500).json(result)
  res.json(result)
})

router.post('/playlist', (req, res) => {
  const { url, ...opts } = req.body || {}
  if (!url) return res.status(400).json({ error: 'URL is required' })
  const result = startPlaylistDownload(url, opts)
  if (result.error) return res.status(500).json(result)
  res.json(result)
})

router.post('/cancel', (req, res) => {
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id is required' })
  const entry = activeDownloads.get(id)
  if (!entry) return res.json({ success: false })
  try {
    entry.proc?.kill()
  } catch {}
  activeDownloads.delete(id)
  res.json({ success: true })
})

router.get('/queue', (req, res) => {
  res.json(Array.from(activeDownloads.values()).map(snapshot))
})

router.get('/playlists', (req, res) => {
  const db = getDB()
  res.json(db.prepare('SELECT * FROM downloaded_playlists ORDER BY COALESCE(last_downloaded_at, created_at) DESC').all())
})

router.delete('/playlist', (req, res) => {
  const { playlistId } = req.body || {}
  if (!playlistId) return res.status(400).json({ error: 'playlistId is required' })
  const db = getDB()
  const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (playlist?.archive_path) {
    try { fs.unlinkSync(playlist.archive_path) } catch {}
  }
  db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
  res.json({ success: true })
})

router.post('/playlist/redownload', (req, res) => {
  const { playlistId } = req.body || {}
  if (!playlistId) return res.status(400).json({ error: 'playlistId is required' })
  const db = getDB()
  const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (!playlist) return res.status(404).json({ error: 'Playlist not found' })

  if (playlist.archive_path && fs.existsSync(playlist.archive_path)) {
    try { fs.unlinkSync(playlist.archive_path) } catch {}
  }

  db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
  const result = startPlaylistDownload(playlist.url, {
    id: `pl-redownload-${Date.now()}`,
    playlistId,
    title: playlist.title,
  })
  if (result.error) return res.status(500).json(result)
  res.json(result)
})

router.get('/playlist/archive-ids', (req, res) => {
  const { playlistId } = req.query
  if (!playlistId) return res.status(400).json({ error: 'playlistId is required' })
  const db = getDB()
  const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (!playlist?.archive_path || !fs.existsSync(playlist.archive_path)) return res.json([])
  const ids = fs.readFileSync(playlist.archive_path, 'utf-8')
    .split(/\r?\n/)
    .map(line => {
      const match = line.match(/([a-zA-Z0-9_-]{11})/)
      return match ? match[1] : null
    })
    .filter(Boolean)
  res.json(Array.from(new Set(ids)))
})

router.post('/playlist/remove-archive', (req, res) => {
  const { playlistId, videoId } = req.body || {}
  if (!playlistId || !videoId) return res.status(400).json({ error: 'playlistId and videoId are required' })
  const db = getDB()
  const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
  if (!playlist?.archive_path) return res.status(404).json({ error: 'Playlist not found' })

  try {
    if (fs.existsSync(playlist.archive_path)) {
      const content = fs.readFileSync(playlist.archive_path, 'utf-8')
      const next = content
        .split(/\r?\n/)
        .filter(line => line && !line.includes(videoId))
        .join('\n')
      fs.writeFileSync(playlist.archive_path, next)
    }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
