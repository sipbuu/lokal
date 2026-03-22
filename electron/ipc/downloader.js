const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const { getDB, getStorageDir } = require('./db')
const { findYtDlp, findFfmpeg, findFfprobe } = require('./tools')

const downloadQueue = new Map()

function getPlaylistId(url) {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('list') || null
  } catch {
    const match = String(url || '').match(/[?&]list=([a-zA-Z0-9_-]+)/)
    return match ? match[1] : null
  }
}

function getYouTubeId(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.replace(/^\/+/, '').slice(0, 11) || null
    }
    if (parsed.searchParams.get('v')) {
      return parsed.searchParams.get('v')
    }
  } catch {}
  const match = String(url || '').match(/(?:watch\?v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

function getYouTubeThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
}

function resolveAudioQuality(format, quality) {
  if (format === 'mp3' && quality) return `${quality}K`
  return '0'
}

function createQueueEntry(data) {
  return {
    id: data.id,
    url: data.url,
    title: data.title || data.url,
    kind: data.kind || 'single',
    status: data.status || 'downloading',
    progress: data.progress ?? 0,
    speed: data.speed || null,
    eta: data.eta || null,
    message: data.message || null,
    song: data.song || null,
    output: data.output || '',
    downloadedTracks: Array.isArray(data.downloadedTracks) ? data.downloadedTracks : [],
    indexedTracks: Array.isArray(data.indexedTracks) ? data.indexedTracks : [],
    totalTracks: data.totalTracks ?? null,
    currentTrack: data.currentTrack ?? null,
    playlistId: data.playlistId ?? null,
    error: data.error || null,
    proc: data.proc || null,
    window: data.window || null,
  }
}

function snapshotQueueEntry(entry) {
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
    playlistId: entry.playlistId ?? null,
    error: entry.error || null,
  }
}

function setQueueEntry(id, patch = {}) {
  const current = downloadQueue.get(id)
  if (!current) return null
  const next = {
    ...current,
    ...patch,
    downloadedTracks: Array.isArray(patch.downloadedTracks) ? patch.downloadedTracks : current.downloadedTracks,
    indexedTracks: Array.isArray(patch.indexedTracks) ? patch.indexedTracks : current.indexedTracks,
  }
  downloadQueue.set(id, next)
  return next
}

function emitProgress(id, payload = {}) {
  const entry = downloadQueue.get(id)
  if (!entry?.window || entry.window.isDestroyed()) return
  entry.window.webContents.send('downloader:progress', {
    id,
    ...payload,
  })
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

function getVideoIdsFromArchive(archivePath) {
  const ids = new Set()
  try {
    if (!fs.existsSync(archivePath)) return ids
    const content = fs.readFileSync(archivePath, 'utf-8')
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/([a-zA-Z0-9_-]{11})/)
      if (match) ids.add(match[1])
    }
  } catch {}
  return ids
}

function getSettingsMap() {
  const db = getDB()
  return Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]))
}

function buildYtDlpBaseArgs(settings, ffmpeg) {
  const args = []
  if (settings.yt_cookies === '1') {
    args.push('--cookies-from-browser', settings.yt_cookie_browser || 'firefox')
  }
  if (ffmpeg && (ffmpeg.includes('/') || ffmpeg.includes('\\'))) {
    args.push('--ffmpeg-location', path.dirname(ffmpeg))
  }
  return args
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
        const title = parsed?.title || parsed?.playlist_title || parsed?.uploader || null
        resolve(title || null)
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

function terminateProcessTree(proc) {
  if (!proc) return
  try { proc.kill('SIGKILL') } catch {}
  if (process.platform === 'win32' && proc.pid) {
    try {
      spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
    } catch {}
  }
}

function markPlaylistIncomplete(playlistId, downloadedCount = 0, totalTracks = 0) {
  try {
    getDB().prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
      .run('incomplete', downloadedCount, totalTracks, Date.now(), playlistId)
  } catch {}
}

function markInterruptedPlaylistsIncomplete() {
  try {
    getDB().prepare('UPDATE downloaded_playlists SET status = ?, last_downloaded_at = ? WHERE status = ?')
      .run('incomplete', Date.now(), 'downloading')
  } catch {}
}

function runJsonSearch(ytdlp, searchTerm, mapper, page = 1, limit = 10) {
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

  return new Promise((resolve) => {
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

    proc.on('error', () => resolve({ error: 'Failed to run yt-dlp', results: [], page: safePage, hasMore: false }))
  })
}

async function indexDownloadedFiles(filepaths, thumbnailUrl) {
  const indexedTracks = []
  const { indexSingleFile } = require('./scanner')

  for (const filepath of filepaths) {
    try {
      if (!fs.existsSync(filepath)) continue
      const result = await indexSingleFile(filepath, { thumbnailUrl })
      if (result?.id) {
        indexedTracks.push({
          filepath,
          id: result.id,
          title: path.basename(filepath, path.extname(filepath)),
        })
      }
    } catch {}
  }

  return indexedTracks
}

async function tryIndexFile(filepath, thumbnailUrl, attempt = 0) {
  try {
    const { indexSingleFile } = require('./scanner')
    if (!filepath || !fs.existsSync(filepath)) {
      if (attempt < 10) {
        await new Promise(resolve => setTimeout(resolve, 700))
        return tryIndexFile(filepath, thumbnailUrl, attempt + 1)
      }
      return null
    }
    const result = await indexSingleFile(filepath, { thumbnailUrl })
    if (!result?.id && attempt < 10) {
      await new Promise(resolve => setTimeout(resolve, 700))
      return tryIndexFile(filepath, thumbnailUrl, attempt + 1)
    }
    return result || null
  } catch {
    if (attempt < 10) {
      await new Promise(resolve => setTimeout(resolve, 700))
      return tryIndexFile(filepath, thumbnailUrl, attempt + 1)
    }
    return null
  }
}

async function runSingleDownload(window, url, opts = {}) {
  const ytdlp = findYtDlp()
  const ffmpeg = findFfmpeg()
  const ffprobe = findFfprobe()

  if (!ffmpeg) return { error: 'ffmpeg not found. Please download it in Settings.' }
  if (!ffprobe) return { error: 'ffprobe not found. Please re-download ffmpeg in Settings (it now includes ffprobe).' }
  if (!ytdlp) return { error: 'yt-dlp not found. Go to Settings -> External Tools to download it or set a custom path.' }

  const settings = getSettingsMap()
  const outputDir = opts.outputDir || settings.music_folder || path.join(os.homedir(), 'Music')
  fs.ensureDirSync(outputDir)

  const downloadId = opts.id || `dl-${Date.now()}`
  const format = opts.format || 'mp3'
  const outputTemplate = path.join(outputDir, '%(artist)s', '%(album)s', '%(title)s.%(ext)s')
  const videoId = getYouTubeId(url)
  const thumbnailUrl = opts.thumbnailUrl || (videoId ? getYouTubeThumbnail(videoId) : null)

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
    ...buildYtDlpBaseArgs(settings, ffmpeg),
  ]

  if (videoId) {
    args.push('--convert-thumbnail', 'jpg')
  }

  return new Promise((resolve) => {
    const outputLines = []
    const filepaths = []
    const downloadedTracks = []
    const indexedTracks = []
    const indexedFilepaths = new Set()
    const proc = spawn(ytdlp, args, { windowsHide: true })

    downloadQueue.set(downloadId, createQueueEntry({
      id: downloadId,
      url,
      title: opts.title || url,
      kind: 'single',
      status: 'downloading',
      progress: 0,
      message: 'Starting...',
      window,
      proc,
    }))

    const pushUpdate = (patch = {}, eventPatch = patch) => {
      const entry = setQueueEntry(downloadId, {
        ...patch,
        output: trimOutput(outputLines),
      })
      if (!entry) return
      emitProgress(downloadId, {
        ...snapshotQueueEntry(entry),
        ...eventPatch,
      })
    }

    const indexTrackImmediately = async (filepath) => {
      if (settings.index_while_downloading !== '1') return
      if (!filepath || indexedFilepaths.has(filepath)) return
      const result = await tryIndexFile(filepath, thumbnailUrl)
      if (!result?.id) return
      indexedFilepaths.add(filepath)
      const indexed = {
        filepath,
        id: result.id,
        title: path.basename(filepath, path.extname(filepath)),
      }
      indexedTracks.push(indexed)
      pushUpdate({
        indexedTracks: [...indexedTracks],
        message: `Indexed: ${path.basename(filepath)}`,
      })
      if (window && !window.isDestroyed()) {
        window.webContents.send('library:updated', result)
      }
    }

    proc.stdout.on('data', data => {
      const lines = data.toString().split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) continue
        outputLines.push(line)

        const filepath = collectFilepath(line, filepaths, downloadedTracks)
        if (filepath) {
          pushUpdate({
            song: filepath,
            message: `Saved: ${path.basename(filepath)}`,
            downloadedTracks: [...downloadedTracks],
          })
          setImmediate(() => { indexTrackImmediately(filepath) })
          continue
        }

        const destinationMatch = line.match(/Destination:\s+(.+)/)
        if (destinationMatch) {
          pushUpdate({ message: `Downloading: ${path.basename(destinationMatch[1])}` })
          continue
        }

        const pctMatch = line.match(/(\d+(?:\.\d+)?)%/)
        if (pctMatch) {
          const speedMatch = line.match(/at\s+([^\s]+\/s)/i) || line.match(/([0-9.]+[KMG]iB\/s)/)
          const etaMatch = line.match(/ETA\s+([0-9:]+)/i)
          pushUpdate({
            progress: clampActiveProgress(parseFloat(pctMatch[1])),
            speed: speedMatch?.[1] || null,
            eta: etaMatch?.[1] || null,
            message: downloadedTracks.length ? `Downloading: ${downloadedTracks[downloadedTracks.length - 1]}` : 'Downloading...',
            downloadedTracks: [...downloadedTracks],
          })
          continue
        }

        if (/^\[(download|ffmpeg|ExtractAudio|Metadata|EmbedThumbnail)\]/.test(line)) {
          pushUpdate({ message: line.replace(/^\[[^\]]+\]\s*/, '').trim() })
        }
      }
    })

    proc.stderr.on('data', data => {
      const lines = data.toString().split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) continue
        outputLines.push(line)
      }
      pushUpdate({
        output: trimOutput(outputLines),
      }, {
        output: trimOutput(outputLines),
      })
    })

    proc.on('close', async code => {
      const entry = downloadQueue.get(downloadId)
      if (!entry) {
        resolve({ success: false, cancelled: true })
        return
      }

      if (code === 0) {
        try {
          await cleanupLeftovers(filepaths, outputDir)
        } catch {}

        const finalIndexedTracks = settings.index_while_downloading === '1'
          ? indexedTracks.length ? [...indexedTracks] : await indexDownloadedFiles(filepaths, thumbnailUrl)
          : []
        setQueueEntry(downloadId, {
          status: 'done',
          progress: 100,
          message: finalIndexedTracks.length ? `Indexed ${finalIndexedTracks.length} track(s)` : 'Download complete',
          downloadedTracks: [...downloadedTracks],
          indexedTracks: finalIndexedTracks,
        })
        emitProgress(downloadId, snapshotQueueEntry(downloadQueue.get(downloadId)))
        resolve({ success: true, downloadId, indexedTracks: finalIndexedTracks, downloadedTracks: [...downloadedTracks] })
        return
      }

      const friendlyError = getFriendlyDownloadError(outputLines, code === null ? 'Download cancelled' : 'Download failed')
      setQueueEntry(downloadId, {
        status: 'error',
        error: friendlyError,
        message: code === null ? 'Cancelled' : friendlyError,
        output: trimOutput(outputLines),
      })
      emitProgress(downloadId, snapshotQueueEntry(downloadQueue.get(downloadId)))
      resolve({ error: friendlyError, code })
    })

    proc.on('error', err => {
      setQueueEntry(downloadId, {
        status: 'error',
        error: err.message,
        message: err.message,
        output: trimOutput(outputLines),
      })
      emitProgress(downloadId, snapshotQueueEntry(downloadQueue.get(downloadId)))
      resolve({ error: err.message })
    })
  })
}

async function runPlaylistDownload(window, url, opts = {}) {
  const ytdlp = findYtDlp()
  const ffmpeg = findFfmpeg()
  const ffprobe = findFfprobe()

  if (!ytdlp) return { error: 'yt-dlp not found. Go to Settings -> External Tools to download it or set a custom path.' }
  if (!ffmpeg) return { error: 'ffmpeg not found. Please download it in Settings.' }
  if (!ffprobe) return { error: 'ffprobe not found. Please re-download ffmpeg in Settings.' }

  const resolvedTitle = opts.title || await fetchMediaTitle(ytdlp, url) || `${resolveSourceLabel(url)} Playlist`
  const db = getDB()
  const settings = getSettingsMap()
  const outputDir = opts.outputDir || settings.music_folder || path.join(os.homedir(), 'Music')
  fs.ensureDirSync(outputDir)

  const dlId = opts.id || `pl-${Date.now()}`
  const format = opts.format || 'mp3'
  const outputTemplate = path.join(outputDir, '%(playlist)s', '%(artist)s', '%(title)s.%(ext)s')
  const playlistDbId = opts.playlistId || getPlaylistId(url) || `pl-${Date.now()}`
  const archivePath = path.join(getStorageDir(), `archive-${playlistDbId}.txt`)

  db.prepare(`INSERT OR REPLACE INTO downloaded_playlists (id, url, title, archive_path, status, downloaded_count, last_downloaded_at) VALUES (?, ?, ?, ?, 'downloading', 0, ?)`)
    .run(playlistDbId, url, resolvedTitle, archivePath, Date.now())

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
    ...buildYtDlpBaseArgs(settings, ffmpeg),
  ]

  return new Promise((resolve) => {
    const outputLines = []
    const errorLines = []
    const filepaths = []
    const indexedTracks = []
    const indexedFilepaths = new Set()
    const downloadedTracks = []
    let totalTracks = 0
    let currentTrack = 0
    let currentSong = null

    const proc = spawn(ytdlp, args, { windowsHide: true })

    downloadQueue.set(dlId, createQueueEntry({
      id: dlId,
      url,
      title: resolvedTitle,
      kind: 'playlist',
      status: 'downloading',
      progress: 0,
      message: 'Starting...',
      window,
      proc,
      totalTracks: null,
      playlistId: playlistDbId,
    }))

    const pushUpdate = (patch = {}, eventPatch = patch) => {
      const entry = setQueueEntry(dlId, {
        ...patch,
        output: trimOutput(outputLines),
      })
      if (!entry) return
      emitProgress(dlId, {
        ...snapshotQueueEntry(entry),
        ...eventPatch,
      })
    }

    const indexTrackImmediately = async (filepath, attempt = 0) => {
      if (settings.index_while_downloading !== '1') return
      if (!filepath || indexedFilepaths.has(filepath)) return
      try {
        const { indexSingleFile } = require('./scanner')
        if (!fs.existsSync(filepath)) {
          if (attempt < 10) {
            setTimeout(() => { indexTrackImmediately(filepath, attempt + 1) }, 700)
          }
          return
        }
        const result = await indexSingleFile(filepath)
        if (!result?.id) {
          if (attempt < 10) {
            setTimeout(() => { indexTrackImmediately(filepath, attempt + 1) }, 700)
          }
          return
        }
        indexedFilepaths.add(filepath)
        const indexed = {
          filepath,
          id: result.id,
          title: path.basename(filepath, path.extname(filepath)),
        }
        indexedTracks.push(indexed)
        pushUpdate({
          indexedTracks: [...indexedTracks],
          message: `Indexed: ${path.basename(filepath)}`,
        })
        if (window && !window.isDestroyed()) {
          window.webContents.send('library:updated', result)
        }
      } catch {}
    }

    proc.stdout.on('data', data => {
      const lines = data.toString().split(/\r?\n/)
      for (const line of lines) {
        if (!line.trim()) continue
        outputLines.push(line)

        const filepath = collectFilepath(line, filepaths, downloadedTracks)
        if (filepath) {
          currentSong = filepath
          pushUpdate({
            song: filepath,
            message: `Saved: ${path.basename(filepath)}`,
            downloadedTracks: [...downloadedTracks],
            totalTracks: totalTracks || null,
            currentTrack: currentTrack || null,
          })
          setImmediate(() => { indexTrackImmediately(filepath) })
          continue
        }

        const videoMatch = line.match(/\[download\]\s+Downloading video\s+(\d+)\s+of\s+(\d+)/i)
        if (videoMatch) {
          currentTrack = parseInt(videoMatch[1], 10)
          totalTracks = parseInt(videoMatch[2], 10)
          const progress = totalTracks > 0 ? clampActiveProgress(((currentTrack - 1) / totalTracks) * 100) : 0
          pushUpdate({
            progress,
            message: `Track ${currentTrack} of ${totalTracks}`,
            totalTracks,
            currentTrack,
            song: currentSong,
            downloadedTracks: [...downloadedTracks],
          })
          continue
        }

        if (line.includes('has already been recorded in the archive')) {
          pushUpdate({
            message: line.replace(/^\[[^\]]+\]\s*/, '').trim(),
            totalTracks: totalTracks || null,
            currentTrack: currentTrack || null,
            downloadedTracks: [...downloadedTracks],
          })
          continue
        }

        const destinationMatch = line.match(/Destination:\s+(.+)/)
        if (destinationMatch) {
          currentSong = destinationMatch[1].trim()
          pushUpdate({
            song: currentSong,
            message: `Downloading: ${path.basename(currentSong)}`,
            totalTracks: totalTracks || null,
            currentTrack: currentTrack || null,
            downloadedTracks: [...downloadedTracks],
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
          pushUpdate({
            progress,
            speed: speedMatch?.[1] || null,
            eta: etaMatch?.[1] || null,
            message: currentSong ? `Downloading: ${path.basename(currentSong)}` : 'Downloading...',
            song: currentSong,
            totalTracks: totalTracks || null,
            currentTrack: currentTrack || null,
            downloadedTracks: [...downloadedTracks],
          })
          continue
        }

        if (/\[error\]/i.test(line)) {
          errorLines.push(line)
        } else if (/^\[(download|ffmpeg|ExtractAudio|Metadata|EmbedThumbnail)\]/.test(line)) {
          pushUpdate({
            message: line.replace(/^\[[^\]]+\]\s*/, '').trim(),
            totalTracks: totalTracks || null,
            currentTrack: currentTrack || null,
            song: currentSong,
            downloadedTracks: [...downloadedTracks],
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
      pushUpdate({
        output: trimOutput(outputLines),
        message: currentSong ? `Downloading: ${path.basename(currentSong)}` : 'Preparing download...',
      }, {
        output: trimOutput(outputLines),
      })
    })

    proc.on('close', async code => {
      const entry = downloadQueue.get(dlId)
      if (!entry) {
        resolve({ success: false, cancelled: true })
        return
      }

      if (code === 0) {
        try {
          await cleanupLeftovers(filepaths, outputDir)
        } catch {}

        const finalIndexedTracks = await indexDownloadedFiles(filepaths)
        for (const track of finalIndexedTracks) {
          if (indexedFilepaths.has(track.filepath)) continue
          indexedFilepaths.add(track.filepath)
          indexedTracks.push(track)
        }

        db.prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
          .run('completed', downloadedTracks.length, totalTracks || downloadedTracks.length, Date.now(), playlistDbId)

        setQueueEntry(dlId, {
          status: 'done',
          progress: 100,
          message: indexedTracks.length ? `Indexed ${indexedTracks.length} track(s)` : `Downloaded ${downloadedTracks.length} track(s)`,
          downloadedTracks: [...downloadedTracks],
          indexedTracks: [...indexedTracks],
          totalTracks: totalTracks || downloadedTracks.length,
          currentTrack: totalTracks || downloadedTracks.length,
        })
        emitProgress(dlId, snapshotQueueEntry(downloadQueue.get(dlId)))
        resolve({ success: true, count: downloadedTracks.length, indexedTracks: [...indexedTracks] })
        return
      }

      db.prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
        .run(code === null ? 'incomplete' : 'failed', downloadedTracks.length, totalTracks || downloadedTracks.length, Date.now(), playlistDbId)

      const friendlyError = getFriendlyDownloadError(errorLines.length ? errorLines : outputLines, code === null ? 'Cancelled' : `Failed (exit ${code})`)
      setQueueEntry(dlId, {
        status: 'error',
        error: friendlyError,
        message: friendlyError,
        downloadedTracks: [...downloadedTracks],
        indexedTracks: [...indexedTracks],
        totalTracks: totalTracks || null,
        currentTrack: currentTrack || null,
        output: trimOutput(outputLines),
      })
      emitProgress(dlId, snapshotQueueEntry(downloadQueue.get(dlId)))
      resolve({ error: friendlyError, code })
    })

    proc.on('error', err => {
      db.prepare('UPDATE downloaded_playlists SET status = ?, last_downloaded_at = ? WHERE id = ?')
        .run('failed', Date.now(), playlistDbId)

      setQueueEntry(dlId, {
        status: 'error',
        error: err.message,
        message: err.message,
        output: trimOutput(outputLines),
      })
      emitProgress(dlId, snapshotQueueEntry(downloadQueue.get(dlId)))
      resolve({ error: err.message })
    })
  })
}

function registerDownloaderHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')

  ipcMain.handle('downloader:search', async (event, query, page = 1) => {
    const ytdlp = findYtDlp()
    if (!ytdlp) {
      return { error: 'yt-dlp not found. Go to Settings -> External Tools to download it automatically or set a custom path.', results: [], page: 1, hasMore: false }
    }
    BrowserWindow.fromWebContents(event.sender)
    return runJsonSearch(ytdlp, query, mapSearchResult, page, 10)
  })

  ipcMain.handle('downloader:searchArtist', async (event, query, page = 1) => {
    const ytdlp = findYtDlp()
    if (!ytdlp) {
      return { error: 'yt-dlp not found. Go to Settings -> External Tools to download it automatically or set a custom path.', results: [], page: 1, hasMore: false }
    }
    BrowserWindow.fromWebContents(event.sender)
    const primary = await runJsonSearch(ytdlp, `${query} official artist channel`, mapArtistResult, page, 10)
    if (primary.results.length > 0 || primary.error) return primary
    return runJsonSearch(ytdlp, `${query} artist profile`, mapArtistResult, page, 10)
  })

  ipcMain.handle('downloader:download', async (event, url, opts = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return runSingleDownload(window, url, opts)
  })

  ipcMain.handle('downloader:cancel', (_, id) => {
    const entry = downloadQueue.get(id)
    if (!entry) return { success: false }
    terminateProcessTree(entry.proc)
    if (entry.kind === 'playlist' && entry.playlistId) {
      markPlaylistIncomplete(entry.playlistId, entry.downloadedTracks?.length || 0, entry.totalTracks || 0)
    }
    downloadQueue.delete(id)
    return { success: true }
  })

  ipcMain.handle('downloader:queue', () => {
    return Array.from(downloadQueue.values()).map(snapshotQueueEntry)
  })
}

function registerExtraDownloaderHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')

  ipcMain.handle('downloader:downloadPlaylist', async (event, url, opts = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return runPlaylistDownload(window, url, opts)
  })
}

function registerPlaylistArchiveHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')

  ipcMain.handle('downloader:getDownloadedPlaylists', () => {
    const db = getDB()
    return db.prepare('SELECT * FROM downloaded_playlists ORDER BY COALESCE(last_downloaded_at, created_at) DESC').all()
  })

  ipcMain.handle('downloader:deleteDownloadedPlaylist', (_, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (playlist?.archive_path) {
      try { fs.unlinkSync(playlist.archive_path) } catch {}
    }
    db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
    return { success: true }
  })

  ipcMain.handle('downloader:redownloadPlaylist', async (event, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist) return { error: 'Playlist not found' }

    if (playlist.archive_path && fs.existsSync(playlist.archive_path)) {
      try { fs.unlinkSync(playlist.archive_path) } catch {}
    }

    db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)

    const window = BrowserWindow.fromWebContents(event.sender)
    return runPlaylistDownload(window, playlist.url, {
      id: `pl-redownload-${Date.now()}`,
      playlistId,
      title: playlist.title,
    })
  })

  ipcMain.handle('downloader:getPlaylistArchiveIds', (_, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist?.archive_path) return []
    return Array.from(getVideoIdsFromArchive(playlist.archive_path))
  })

  ipcMain.handle('downloader:removeFromPlaylistArchive', (_, playlistId, videoId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist?.archive_path) return { error: 'Playlist not found' }

    try {
      if (fs.existsSync(playlist.archive_path)) {
        const content = fs.readFileSync(playlist.archive_path, 'utf-8')
        const next = content
          .split(/\r?\n/)
          .filter(line => line && !line.includes(videoId))
          .join('\n')
        fs.writeFileSync(playlist.archive_path, next)
      }
      return { success: true }
    } catch (error) {
      return { error: error.message }
    }
  })
}

module.exports = {
  registerDownloaderHandlers,
  registerExtraDownloaderHandlers,
  registerPlaylistArchiveHandlers,
  terminateProcessTree,
  markInterruptedPlaylistsIncomplete,
  markPlaylistIncomplete,
  shutdownActiveDownloads: () => {
    for (const entry of Array.from(downloadQueue.values())) {
      if (entry.kind === 'playlist' && entry.playlistId) {
        markPlaylistIncomplete(entry.playlistId, entry.downloadedTracks?.length || 0, entry.totalTracks || 0)
      }
      terminateProcessTree(entry.proc)
    }
    downloadQueue.clear()
  },
}
