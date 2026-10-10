// Downloaded music videos. A local file is much more reliable than keeping a
// <video> element attached to YouTube's short-lived, range-sensitive URL.

const fs = require('fs')
const path = require('path')
const { once } = require('events')
const youtube = require('./youtube')
const cache = require('../cache')
const os = require('os')
const crypto = require('crypto')

const HEIGHTS = [1080, 720, 480]
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const STALL_TIMEOUT_MS = 60 * 1000
const VIDEO_ID = /^[\w-]{11}$/
const jobs = new Map()

function heightOf(value) {
  return HEIGHTS.includes(Number(value)) ? Number(value) : 1080
}

function extensionOf(mime) {
  return String(mime || '').toLowerCase().includes('webm') ? 'webm' : 'mp4'
}

function cachePath(cacheDir, videoId, height, ext) {
  return path.join(cacheDir, `${videoId}-${height}.${ext}`)
}

function safePart(value, fallback) {
  const text = String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').trim().slice(0, 100).replace(/[. ]+$/, '')
  const name = text || fallback
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name
}

function videosDir(options = {}) {
  if (options.videosDir) return options.videosDir
  try { return require('electron').app.getPath('videos') } catch { return path.join(os.homedir(), 'Videos') }
}

function durablePath(dir, artist, title, videoId, height, ext) {
  if (!VIDEO_ID.test(String(videoId || '')) || !['mp4', 'webm'].includes(ext) || !HEIGHTS.includes(Number(height))) throw new Error('Invalid music video path')
  return path.join(dir, safePart(artist, 'Unknown Artist'), `${safePart(title, 'Music Video')} - ${videoId} - ${height}.${ext}`)
}

function durableCandidates(options, videoId, height) {
  const dir = path.join(videosDir(options), safePart(options.artist, 'Unknown Artist'))
  try {
    return fs.readdirSync(dir).filter(name => new RegExp(` - ${videoId} - ${height}(?: \\(\\d+\\))?\\.(?:mp4|webm)$`, 'i').test(name)).map(name => path.join(dir, name))
  } catch { return [] }
}

function existingFile(cacheDir, videoId, height, touch = true) {
  for (const ext of ['mp4', 'webm']) {
    const file = cachePath(cacheDir, videoId, height, ext)
    try {
      const stat = fs.statSync(file)
      if (stat.isFile() && stat.size > 0) {
        const now = new Date()
        if (touch) fs.utimesSync(file, now, now)
        return file
      }
    } catch {}
  }
  return null
}

function peekCachedVideoFile(videoId, options = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) return null
  const cacheDir = options.cacheDir || cache.cacheDir('musicVideo')
  if (!cacheDir) return null
  return existingFile(cacheDir, videoId, heightOf(options.videoHeight), options.touch !== false)
}

function peekDurableVideoFile(videoId, options = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) return null
  const candidates = durableCandidates(options, videoId, heightOf(options.videoHeight))
  for (const file of candidates) {
    try { if (fs.statSync(file).isFile() && fs.statSync(file).size > 0) return file } catch {}
  }
  return null
}

function ensureDownloadsTable(db) {
  db.exec('CREATE TABLE IF NOT EXISTS downloaded_music_videos (video_id TEXT NOT NULL, height INTEGER NOT NULL, file_path TEXT NOT NULL, video_json TEXT NOT NULL, downloaded_at INTEGER NOT NULL, PRIMARY KEY (video_id, height))')
}

function rememberVideoFile(db, video, file, height) {
  ensureDownloadsTable(db)
  db.prepare('INSERT OR REPLACE INTO downloaded_music_videos (video_id, height, file_path, video_json, downloaded_at) VALUES (?, ?, ?, ?, ?)')
    .run(video.videoId, heightOf(height), file, JSON.stringify(video), Date.now())
}

function recordedVideoFile(db, videoId, height) {
  ensureDownloadsTable(db)
  const rows = db.prepare('SELECT file_path FROM downloaded_music_videos WHERE video_id = ? ORDER BY CASE WHEN height = ? THEN 0 ELSE 1 END, height DESC').all(videoId, heightOf(height))
  return rows.map(row => row.file_path).find(file => { try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0 } catch { return false } }) || null
}

function replacePath(value, from, to) {
  if (typeof value === 'string') return value === from ? to : value
  if (Array.isArray(value)) return value.map(entry => replacePath(entry, from, to))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replacePath(entry, from, to)]))
  return value
}

function updateVideoReferences(db, from, to, video, dir) {
  ensureDownloadsTable(db)
  db.transaction(() => {
    rememberVideoFile(db, video, to, video.videoHeight)
    for (const row of db.prepare('SELECT id, data FROM download_jobs').all()) {
      const data = replacePath(JSON.parse(row.data || '{}'), from, to)
      if (data.opts?.videoId === video.videoId) {
        data.opts = { ...data.opts, durable: true, videosDir: dir, artist: data.opts?.artist || video.artist }
        delete data.opts.cacheDir
      }
      db.prepare('UPDATE download_jobs SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), Date.now(), row.id)
    }
    for (const row of db.prepare('SELECT track_id, video_json FROM saved_music_videos').all()) db.prepare('UPDATE saved_music_videos SET video_json = ? WHERE track_id = ?').run(JSON.stringify(replacePath(JSON.parse(row.video_json), from, to)), row.track_id)
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      let value = row.value === from ? to : row.value
      try { value = JSON.stringify(replacePath(JSON.parse(value), from, to)) } catch {}
      if (value !== row.value) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(value, row.key)
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('video_download_folder', dir)
  })()
}

function deleteVideoFiles(db, videoId) {
  ensureDownloadsTable(db)
  const rows = db.prepare('SELECT file_path FROM downloaded_music_videos WHERE video_id = ?').all(videoId)
  for (const row of rows) {
    try { fs.unlinkSync(row.file_path) } catch (error) { if (error.code !== 'ENOENT') throw error }
    db.prepare('DELETE FROM downloaded_music_videos WHERE video_id = ? AND file_path = ?').run(videoId, row.file_path)
  }
  return rows.length
}

function digest(file) {
  const hash = crypto.createHash('sha256')
  const fd = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    let count
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { fs.closeSync(fd) }
}

function exclusiveDestination(file, source, matchExisting = false) {
  const ext = path.extname(file)
  for (let n = 0; ; n++) {
    const target = n ? `${file.slice(0, -ext.length)} (${n})${ext}` : file
    try {
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL)
      return target
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (matchExisting && digest(target) === digest(source)) return target
    }
  }
}

async function writeResponse(res, temp, { signal, timeoutMs = DOWNLOAD_TIMEOUT_MS, onProgress } = {}) {
  if (!res?.ok || !res.body?.getReader) throw new Error(`Music video download failed (HTTP ${res?.status || 0})`)
  const expected = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const output = fs.createWriteStream(temp)
  let outputError = null
  output.on('error', error => { outputError = error })
  let bytes = 0
  let timer
  let stalled
  let closed = false
  let interrupted = false
  const abort = () => { interrupted = true; reader.cancel().catch(() => {}) }
  const resetStall = () => {
    clearTimeout(stalled)
    stalled = setTimeout(() => abort(), STALL_TIMEOUT_MS)
  }
  const close = () => new Promise((resolve, reject) => {
    if (closed) return resolve()
    if (outputError) return reject(outputError)
    closed = true
    output.once('error', reject)
    output.end(resolve)
  })
  try {
    if (signal?.aborted) throw new Error('Music video download cancelled')
    signal?.addEventListener?.('abort', abort, { once: true })
    timer = setTimeout(() => abort(), timeoutMs)
    resetStall()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      bytes += value.byteLength
      resetStall()
      onProgress?.(bytes, expected)
      if (!output.write(Buffer.from(value))) await once(output, 'drain')
    }
    clearTimeout(stalled)
    await close()
    if (interrupted) throw new Error(signal?.aborted ? 'Music video download cancelled' : 'Music video download timed out')
    if (outputError) throw outputError
    if (!bytes || (expected > 0 && bytes < expected)) throw new Error(`Music video download was incomplete (${bytes} of ${expected} bytes)`)
  } finally {
    clearTimeout(timer)
    clearTimeout(stalled)
    signal?.removeEventListener?.('abort', abort)
    if (!closed) output.destroy()
  }
}

/** Resolve and download one video, re-resolving once if its URL is refused. */
async function downloadVideo(videoId, options = {}) {
  if (!VIDEO_ID.test(String(videoId || ''))) throw new Error('Not a YouTube video id')
  const { onProgress, fetchImpl = fetch, fetchStream = youtube.fetchStream } = options
  const height = heightOf(options.videoHeight)
  const directory = path.join(videosDir(options), safePart(options.artist, 'Unknown Artist'))
  if (!directory) throw new Error('Video download folder is unavailable')
  fs.mkdirSync(directory, { recursive: true })
  const key = `${directory}\n${videoId}\n${height}`
  const found = peekDurableVideoFile(videoId, options)
  if (found) { options.onFile?.(found); return found }
  if (jobs.has(key)) return jobs.get(key)
  const job = (async () => {
    let lastReport = 0
    const reportProgress = (received, total) => {
      const now = Date.now()
      const percent = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
      if (percent !== 100 && now - lastReport < 150) return
      lastReport = now
      onProgress?.({ stage: 'downloading', percent })
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      const parentSignal = options.signal
      const abortFromParent = () => controller.abort()
      if (parentSignal?.aborted) controller.abort()
      else parentSignal?.addEventListener?.('abort', abortFromParent, { once: true })
      let temp = null
      try {
        reportProgress(0, 0)
        const { res, mime } = await fetchStream(videoId, {
          ...options, quality: 'video', videoHeight: height, force: attempt > 0,
          signal: controller.signal, fetchImpl,
        })
        const dest = durablePath(videosDir(options), options.artist, options.title, videoId, height, extensionOf(mime))
        temp = `${dest}.part`
        try { fs.unlinkSync(temp) } catch {}
        await writeResponse(res, temp, {
          signal: controller.signal,
          timeoutMs: options.timeoutMs || DOWNLOAD_TIMEOUT_MS,
          onProgress: reportProgress,
        })
        if (options.signal?.aborted) throw new Error('Music video download cancelled')
        const saved = exclusiveDestination(dest, temp)
        fs.unlinkSync(temp)
        if (options.signal?.aborted) { fs.unlinkSync(saved); throw new Error('Music video download cancelled') }
        options.onFile?.(saved)
        onProgress?.({ stage: 'downloaded', percent: 100 })
        return saved
      } catch (error) {
        try { if (temp) fs.unlinkSync(temp) } catch {}
        if (attempt || options.signal?.aborted) throw error
      } finally {
        controller.abort()
        parentSignal?.removeEventListener?.('abort', abortFromParent)
      }
    }
    return null
  })().finally(() => jobs.delete(key))
  jobs.set(key, job)
  return job
}

function migrationEntries(options = {}) {
  const oldDir = options.cacheDir || cache.cacheDir('musicVideo')
  if (!oldDir) return []
  try {
    return fs.readdirSync(oldDir).map(name => {
      const match = name.match(/^([\w-]{11})-(1080|720|480)\.(mp4|webm)$/i)
      if (!match) return null
      const file = path.join(oldDir, name)
      const stat = fs.lstatSync(file)
      return stat.isFile() && stat.size > 0 ? { file, videoId: match[1], height: Number(match[2]), ext: match[3].toLowerCase(), size: stat.size } : null
    }).filter(Boolean)
  } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

function migrationStatus(options = {}) {
  try {
    const entries = migrationEntries(options)
    return { count: entries.length, bytes: entries.reduce((n, item) => n + item.size, 0) }
  } catch (error) { return { count: 0, bytes: 0, error: `Could not read older video downloads: ${error.message}` } }
}

function migrateOldVideos({ resolve, onProgress, onMove, ...options } = {}) {
  const entries = migrationEntries(options)
  let migrated = 0
  let skipped = 0
  let bytes = 0
  const errors = []
  for (const entry of entries) {
    const info = resolve?.(entry.videoId) || {}
    const destination = durablePath(videosDir(options), info.artist, info.title, entry.videoId, entry.height, entry.ext)
    let temp
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      temp = `${destination}.${crypto.randomUUID()}.part`
      fs.copyFileSync(entry.file, temp, fs.constants.COPYFILE_EXCL)
      const sourceSize = fs.statSync(entry.file).size
      const hash = digest(entry.file)
      if (fs.statSync(temp).size !== sourceSize || digest(temp) !== hash) throw new Error('Migrated file did not match')
      const saved = exclusiveDestination(destination, temp, true)
      const fd = fs.openSync(saved, 'r+')
      try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      if (digest(saved) !== hash) throw new Error('Migrated destination did not match')
      onMove?.(entry.file, saved, { ...info, videoId: entry.videoId, videoHeight: entry.height })
      if (digest(entry.file) !== hash) throw new Error('Source changed during migration')
      fs.unlinkSync(entry.file)
      migrated++
      bytes += sourceSize
      onProgress?.({ migrated, skipped, total: entries.length })
    } catch (error) {
      skipped++
      errors.push(`${path.basename(entry.file)}: ${error.message}`)
    } finally {
      try { if (temp) fs.unlinkSync(temp) } catch {}
    }
  }
  return { migrated, skipped, total: entries.length, migratedBytes: bytes, errors, ...migrationStatus(options) }
}

module.exports = { peekCachedVideoFile, downloadVideo, writeResponse, cachePath, heightOf, videosDir, durablePath, peekDurableVideoFile, migrationEntries, migrationStatus, migrateOldVideos, ensureDownloadsTable, rememberVideoFile, recordedVideoFile, deleteVideoFiles, safePart, replacePath, updateVideoReferences }
