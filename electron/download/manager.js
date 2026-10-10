// The download queue, shared by the desktop app and the web server (which run
// in the same process in the desktop app, so there is exactly one of these).
//
// Modelled on BitChord's DownloadService/Downloads:
//   - a real queue: a few downloads at a time (Settings → Library), the rest
//     wait their turn instead of every click starting its own yt-dlp;
//   - automatic retry, with a back-off, for failures that are worth retrying
//     (rate limits, dropped connections), never for ones that aren't (private
//     or removed videos); a manual Retry for everything else;
//   - unreadable browser cookies (Chrome/Edge on Windows) retry at once without
//     cookies;
//   - the queue is kept in SQLite: after a restart, unfinished downloads pick up
//     where they left off (yt-dlp resumes its .part files, playlists skip what
//     their archive already has) and finished ones stay listed until cleared;
//   - each file is finished (lyrics, cover, title) and indexed as it lands,
//     while yt-dlp carries on with the next one.

const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs-extra')
const { buildArgs, resolveFormat, isYouTube } = require('./args')
const { finishFile } = require('./postprocess')
const { isCookieError, markUnreadable, COOKIE_FAILURE_MESSAGE } = require('../ipc/ytCookies')
const { jsRuntimeRefused } = require('../online/jsRuntime')
const slskd = require('./slskd')
const { sourceIdentity, onlineTrackId, streamedTwins, sourceRefOf, sourceRefOfTrack } = require('../online/sources')
const { readInfo, coverThumbnail, imageThumbnail } = require('./tagger')
const { makePlayable } = require('./convert')

const ACTIVE = new Set(['queued', 'downloading'])
const RETRY_DELAYS_MS = [5000, 20000]
const HISTORY_LIMIT = 150
const EMIT_INTERVAL_MS = 200

// Worth another go.
const TRANSIENT = /HTTP Error (?:429|5\d\d)|Too Many Requests|timed? ?out|Connection (?:reset|aborted|refused)|Remote end closed|Temporary failure in name resolution|getaddrinfo|ECONNRESET|ETIMEDOUT|EAI_AGAIN|IncompleteRead|Unable to download (?:webpage|API page|JSON metadata|video data)|fragment \d+ not found|The read operation timed out|SSL: /i
// YouTube refusing this yt-dlp (it changes its player every few weeks and
// yt-dlp follows): a newer yt-dlp, or another player client, usually fixes it.
const YOUTUBE_BLOCKED = /HTTP Error 403|Requested format is not available|nsig extraction failed|Signature extraction failed|n challenge solving failed|Only images are available/i
// Player clients that have been getting through when the default ones are refused.
const FALLBACK_CLIENTS = ['--extractor-args', 'youtube:player_client=default,visionos,web_embedded,mweb']
const TOOL_UPDATE_COOLDOWN_MS = 6 * 60 * 60 * 1000

// Retrying won't change anything.
const PERMANENT = /Video unavailable|Private video|members[- ]only|Sign in to confirm your age|confirm you.re not a bot|copyright|not available in your country|has been removed|account .* terminated|Unsupported URL|is not a valid URL|Requested format is not available|No video formats found|Premieres in|live event will begin/i

function friendlyError(lines, fallback) {
  const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '')
  if (isCookieError(text)) return COOKIE_FAILURE_MESSAGE
  if (/HTTP Error 403|Requested format is not available|nsig extraction failed|Signature extraction failed|n challenge solving failed/i.test(text)) {
    return 'YouTube refused the download (it blocks older yt-dlp versions). Update yt-dlp in Settings → External Tools, then retry.'
  }
  if (/confirm you.re not a bot/i.test(text)) return 'YouTube asked to confirm you are not a bot. Set your YouTube cookie in Settings → Library → Use YouTube Cookies.'
  if (/Sign in to confirm your age/i.test(text)) return 'This video is age-restricted. Turn on YouTube cookies in Settings → Library to download it.'
  if (/Private video/i.test(text)) return 'This video is private.'
  if (/Video unavailable|has been removed/i.test(text)) return 'This video is unavailable.'
  if (/not available in your country/i.test(text)) return 'This video is not available in your country.'
  if (/HTTP Error 429|Too Many Requests/i.test(text)) return 'YouTube is rate-limiting downloads. Try again in a while, or turn on YouTube cookies.'
  const last = (Array.isArray(lines) ? lines : text.split('\n')).filter(l => /ERROR:/.test(l)).pop()
  return last ? last.replace(/^.*?ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[^:]*:\s*/, '').slice(0, 240) || fallback : fallback
}

function youTubeId(url) {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') return parsed.pathname.replace(/^\/+/, '').slice(0, 11) || null
    if (parsed.searchParams.get('v')) return parsed.searchParams.get('v')
  } catch {}
  const match = String(url || '').match(/(?:watch\?v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}

function playlistIdOf(url) {
  try { return new URL(url).searchParams.get('list') || null } catch {}
  const match = String(url || '').match(/[?&]list=([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function isHttpUrl(url) {
  try {
    const u = new URL(url)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname
  } catch { return false }
}

/** Playlist ids end up in a file name (the download archive): keep them tame. */
function safePlaylistId(id) {
  const value = String(id || '')
  return /^[\w.-]{1,120}$/.test(value) && !/^\.+$/.test(value) ? value : null
}

function sourceLabel(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.includes('youtube') || host === 'youtu.be') return 'YouTube'
    if (host.includes('soundcloud')) return 'SoundCloud'
    if (host.includes('bandcamp')) return 'Bandcamp'
    if (host.includes('mixcloud')) return 'Mixcloud'
    return host
  } catch { return 'Source' }
}

const GENERIC_TITLE = /^(?:download|playlist \/ album|(?:youtube|soundcloud|bandcamp|mixcloud)(?: music)? (?:playlist|download|track|release|channel)(?: [\w-]{1,12})?)$/i

// yt-dlp runs in a process group of its own (outside Windows), so stopping
// it also stops what it started: ffmpeg, and the real yt-dlp behind the
// standalone build's launcher. Killing only the launcher left those running
// (a playlist kept downloading after Cancel) and holding the output open, so
// the job never heard it had ended.
const OWN_GROUP = process.platform !== 'win32'

function signalTree(proc, signal) {
  if (proc.lokalGroup && proc.pid) {
    try { process.kill(-proc.pid, signal); return } catch {}
  }
  try { proc.kill(signal) } catch {}
}

function terminate(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve() } }
    const timer = setTimeout(() => {
      // Still not closed: stop waiting for its output (something it started may still hold it).
      try { proc.stdout?.destroy(); proc.stderr?.destroy() } catch {}
      finish()
    }, 8000)
    proc.once('close', finish)
    proc.once('error', finish)
    signalTree(proc, 'SIGTERM')
    if (process.platform === 'win32' && proc.pid) {
      try {
        const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true })
        killer.once('error', () => {})
      } catch {}
    } else {
      setTimeout(() => signalTree(proc, 'SIGKILL'), 1500)
    }
  })
}

/**
 * The online song a single download is ("yt:<id>", "sc:<id>", "a-<key>:<id>"),
 * the same whichever link it came from; null for anything else.
 */
function jobSourceRef(kind, url, opts = {}) {
  if (kind === 'music-video' && opts?.videoId) return `music-video:${opts.videoId}:${opts.videoHeight || 1080}`
  if (kind !== 'single') return null
  const addon = opts?.addonSource
  if (addon?.provider && addon?.id) return sourceRefOf(addon.provider, addon.id)
  return sourceIdentity(url)
}

/** Where a download's files come from, kept on their tracks: yt, sc, an addon (a-<key>), soulseek or web. */
// Quality tiers, worst to best, for deciding whether a new download is an upgrade.
const TIER_RANK = { unknown: 0, low: 1, high: 2, lossless: 3, hires: 4 }
const TIER_NAME = { low: 'low-quality', high: 'high-quality', lossless: 'lossless', hires: 'hi-res' }

function jobSourceLabel(job) {
  if (job.kind === 'soulseek') return 'soulseek'
  if (job.opts?.addonSource?.provider) return job.opts.addonSource.provider
  const identity = sourceIdentity(job.url)
  if (identity) return identity.split(':')[0]
  if (isYouTube(job.url)) return 'yt'
  if (/(^|\.)soundcloud\.com$/i.test((() => { try { return new URL(job.url).hostname } catch { return '' } })())) return 'sc'
  return 'web'
}

class DownloadManager {
  constructor() {
    this.jobs = new Map()
    this.deps = {}
    this.depPriority = {}
    this.running = 0
    this.suspended = false
    this.initialized = false
    this.looseProcs = new Set()
    this.cancellingAll = false
  }

  /** Later callers with a higher priority win per dependency (desktop over web server). */
  configure(deps = {}, priority = 0) {
    for (const [key, value] of Object.entries(deps)) {
      if (value === undefined) continue
      if ((this.depPriority[key] ?? -1) > priority) continue
      this.deps[key] = value
      this.depPriority[key] = priority
    }
    return this
  }

  db() { return this.deps.getDB() }

  settings() {
    try {
      return Object.fromEntries(this.db().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
    } catch { return {} }
  }

  concurrency(settings = this.settings()) {
    const n = parseInt(settings.download_concurrency, 10)
    return Number.isFinite(n) ? Math.max(1, Math.min(6, n)) : 3
  }

  // ------------------------------------------------------------- persistence

  ensureTable() {
    this.db().exec(`CREATE TABLE IF NOT EXISTS download_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      data TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )`)
  }

  persist(job) {
    if (this.jobs.get(job.id) !== job) return // removed while its files were still being finished
    try {
      this.db().prepare('INSERT OR REPLACE INTO download_jobs (id, kind, url, status, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(job.id, job.kind, job.url, job.status, JSON.stringify({ ...this.snapshot(job), opts: job.opts, attempt: job.attempt, pendingIndex: job.pendingIndex || [] }), job.createdAt, Date.now())
    } catch {}
  }

  unpersist(id) {
    try { this.db().prepare('DELETE FROM download_jobs WHERE id = ?').run(id) } catch {}
  }

  /** Loads the saved queue once: finished jobs as history, unfinished ones back in line. */
  init() {
    if (this.initialized) return
    try { this.ensureTable() } catch { return } // DB not ready yet: try again on the next call
    this.initialized = true
    let rows = []
    try { rows = this.db().prepare('SELECT * FROM download_jobs ORDER BY created_at ASC').all() } catch {}
    let resumed = 0
    for (const row of rows) {
      let data = {}
      try { data = JSON.parse(row.data || '{}') } catch {}
      const job = this.makeJob(row.kind, row.url, data.opts || {}, { id: row.id, createdAt: row.created_at })
      if (job.kind === 'music-video') {
        delete job.opts.cacheDir
        job.opts.videosDir ||= require('../online/musicVideoDownloads').videosDir()
      }
      Object.assign(job, {
        title: data.title || job.title,
        from: data.from || job.from,
        thumbnail: data.thumbnail || job.thumbnail,
        status: row.status,
        error: data.error || null,
        message: data.message || null,
        playlistId: data.playlistId ?? job.playlistId,
        pendingIndex: Array.isArray(data.pendingIndex) ? data.pendingIndex : [],
        downloadedTracks: data.downloadedTracks || [],
        indexedTracks: data.indexedTracks || [],
        libraryFailures: data.libraryFailures || 0,
        lyricsCount: data.lyricsCount || 0,
        totalTracks: data.totalTracks ?? null,
        currentTrack: data.currentTrack ?? null,
        progress: data.progress || 0,
        finishedAt: data.finishedAt || null,
        output: data.output || '',
        song: data.song || null,
        filepaths: Array.isArray(data.filepaths) ? data.filepaths : [],
        seen: data.seen !== false,
        removed: !!data.removed,
      })
      if (ACTIVE.has(row.status)) {
        job.status = 'queued'
        job.message = 'Resuming after restart'
        job.seen = false
        resumed++
      }
      this.jobs.set(job.id, job)
    }
    this.trimHistory()
    this.repairGhostIndexed()
    if (resumed) setTimeout(() => this.pump(), 4000)
    setTimeout(() => this.backfillSources(), 7000)
    setTimeout(() => this.indexLeftovers(), 6000)
  }

  /** The library track downloaded from the online song `ref`, or null. */
  libraryTrackWithRef(ref) {
    try {
      const track = this.db().prepare("SELECT id, title, file_path FROM tracks WHERE source_ref = ? AND file_path NOT LIKE 'ghost://%' LIMIT 1").get(ref)
      return track && fs.existsSync(track.file_path) ? track : null
    } catch { return null }
  }

  /** Is `trackId` a streamed (ghost) track of the online song `ref`? */
  isStreamedCopyOf(trackId, ref) {
    try {
      const ghost = this.db().prepare("SELECT id, file_path, source_url FROM tracks WHERE id = ? AND file_path LIKE 'ghost://%'").get(trackId)
      return !!ghost && sourceRefOfTrack(ghost) === ref
    } catch { return false }
  }

  /**
   * Downloads that were taken for the streamed (ghost) copy of their song
   * instead of being added to the library (the duplicate check matched the
   * ghost): their files are added again (indexLeftovers), and until then the
   * download doesn't count as saved.
   */
  repairGhostIndexed() {
    try {
      const isGhost = this.db().prepare("SELECT 1 FROM tracks WHERE id = ? AND file_path LIKE 'ghost://%'")
      const untag = this.db().prepare("UPDATE tracks SET download_source = NULL WHERE id = ? AND file_path LIKE 'ghost://%'")
      for (const job of this.jobs.values()) {
        // Jobs resuming after a restart too: their pendingIndex is added when they finish.
        if (!job.indexedTracks?.length) continue
        const ghosts = job.indexedTracks.filter(t => t?.id && isGhost.get(t.id))
        if (!ghosts.length) continue
        for (const t of ghosts) untag.run(t.id)
        const files = ghosts.map(t => t.filepath).filter(fp => { try { return fp && fs.existsSync(fp) } catch { return false } })
        const indexedTracks = job.indexedTracks.filter(t => !ghosts.includes(t))
        this.update(job, {
          indexedTracks,
          pendingIndex: [...new Set([...(job.pendingIndex || []), ...files])],
          // (A resuming job still shows as saving, not as never saved.)
          removed: !ACTIVE.has(job.status) && indexedTracks.length === 0,
        }, { persist: true })
      }
    } catch {}
  }

  /** Songs downloaded before sources were kept: their source, from the download history. */
  backfillSources() {
    try {
      const tag = this.db().prepare("UPDATE tracks SET download_source = ?, source_ref = COALESCE(source_ref, ?) WHERE id = ? AND download_source IS NULL")
      for (const job of this.jobs.values()) {
        if (job.status !== 'done' || !job.indexedTracks?.length) continue
        const label = jobSourceLabel(job)
        for (const track of job.indexedTracks) tag.run(label, job.sourceRef || null, track.id)
      }
    } catch {}
  }

  /** Files a previous session downloaded but never got to add to the library. */
  async indexLeftovers() {
    for (const job of [...this.jobs.values()]) {
      if (ACTIVE.has(job.status) || !job.pendingIndex?.length || !this.deps.index) continue
      const files = job.pendingIndex.filter(fp => { try { return fs.existsSync(fp) } catch { return false } })
      job.pendingIndex = []
      // A file stays pending until it's in the library, so a failed attempt
      // is tried again next time.
      for (const fp of files) {
        const before = job.indexedTracks.length
        await this.indexOne(job, fp)
        if (job.indexedTracks.length === before) job.pendingIndex.push(fp)
      }
      this.persist(job)
    }
  }

  trimHistory() {
    const finished = [...this.jobs.values()].filter(j => !ACTIVE.has(j.status)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
    for (const job of finished.slice(HISTORY_LIMIT)) { this.jobs.delete(job.id); this.unpersist(job.id) }
  }

  // ------------------------------------------------------------- jobs

  makeJob(kind, url, opts = {}, { id, createdAt } = {}) {
    const videoId = youTubeId(url)
    return {
      id: id || opts.id || `${kind === 'playlist' ? 'pl' : kind === 'music-video' ? 'mv' : 'dl'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      url,
      opts: { ...opts, id: undefined },
      title: opts.title || url,
      from: opts.from || (kind === 'soulseek' ? `Soulseek · ${opts.username || 'user'}` : kind === 'playlist' ? `${sourceLabel(url)} playlist` : sourceLabel(url)),
      thumbnail: opts.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null),
      status: 'queued',
      progress: 0,
      speed: null,
      eta: null,
      message: 'Queued',
      song: null,
      outputLines: [],
      output: '',
      error: null,
      downloadedTracks: [],
      indexedTracks: [],
      libraryFailures: 0,
      filepaths: [],
      lyricsCount: 0,
      totalTracks: null,
      currentTrack: null,
      playlistId: kind === 'playlist' ? (safePlaylistId(opts.playlistId) || safePlaylistId(playlistIdOf(url)) || `pl-${Date.now()}`) : null,
      attempt: 0,
      createdAt: createdAt || Date.now(),
      startedAt: null,
      finishedAt: null,
      proc: null,
      stop: null,
      retryTimer: null,
      retryAt: null,
      withoutCookies: false,
      post: Promise.resolve(),
      sourceRef: jobSourceRef(kind, url, opts),
      lastEmit: 0,
      seen: false,
    }
  }

  snapshot(job) {
    return {
      id: job.id,
      url: job.url,
      kind: job.kind,
      title: job.title,
      from: job.from,
      thumbnail: job.thumbnail,
      status: job.status,
      progress: job.progress ?? 0,
      speed: job.speed || null,
      eta: job.eta || null,
      message: job.message || null,
      song: job.song || null,
      filepaths: job.filepaths || [],
      output: job.outputLines.length ? job.outputLines.slice(-60).join('\n') : (job.output || ''),
      error: job.error || null,
      downloadedTracks: job.downloadedTracks,
      indexedTracks: job.indexedTracks,
      libraryFailures: job.libraryFailures || 0,
      lyricsCount: job.lyricsCount || 0,
      totalTracks: job.totalTracks ?? null,
      currentTrack: job.currentTrack ?? null,
      playlistId: job.playlistId ?? null,
      attempt: job.attempt || 0,
      retryAt: job.retryAt || null,
      format: job.opts?.format || null,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null,
      seen: !!job.seen,
      removed: !!job.removed,
      sourceRef: job.sourceRef || null,
    }
  }

  emit(job, force = false) {
    if (this.jobs.get(job.id) !== job) return
    const now = Date.now()
    if (!force && now - job.lastEmit < EMIT_INTERVAL_MS) {
      if (!job.emitTimer) job.emitTimer = setTimeout(() => { job.emitTimer = null; this.emit(job, true) }, EMIT_INTERVAL_MS)
      return
    }
    job.lastEmit = now
    if (job.emitTimer) { clearTimeout(job.emitTimer); job.emitTimer = null }
    try { this.deps.emit?.(this.snapshot(job)) } catch {}
  }

  update(job, patch, { persist = false, force = false } = {}) {
    Object.assign(job, patch)
    if (persist) this.persist(job)
    this.emit(job, force || persist)
  }

  list() {
    this.init()
    const rank = { downloading: 0, queued: 1 }
    return [...this.jobs.values()]
      .sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2) || (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))
      .map(job => this.snapshot(job))
  }

  /** Wait for a queued job to finish without tying its lifetime to a renderer. */
  waitFor(id) {
    this.init()
    return new Promise(resolve => {
      const check = () => {
        const job = this.jobs.get(id)
        if (!job || !ACTIVE.has(job.status)) { resolve(job ? this.snapshot(job) : null); return }
        setTimeout(check, 250)
      }
      check()
    })
  }

  checkTools() {
    const tools = this.deps.findTools?.() || {}
    if (!tools.ytdlp) return { error: 'yt-dlp not found. Go to Settings -> External Tools to download it or set a custom path.' }
    if (this.deps.requireFfmpeg) {
      if (!tools.ffmpeg) return { error: 'ffmpeg not found. Please download it in Settings.' }
      if (!tools.ffprobe) return { error: 'ffprobe not found. Please re-download ffmpeg in Settings (it now includes ffprobe).' }
    }
    return { tools }
  }

  /** Adds a download to the queue. Returns at once; progress arrives as events. */
  enqueue(kind, url, opts = {}) {
    this.init()
    if (!url || typeof url !== 'string') return { error: 'URL is required' }
    const packageSource = kind === 'single' && this.isPackageSource(opts.addonSource)
    if (kind !== 'soulseek' && !packageSource && !isHttpUrl(url)) return { error: 'Only http(s) links can be downloaded.' }
    // Soulseek downloads go through slskd, not yt-dlp.
    const check = kind === 'soulseek' || kind === 'music-video' || packageSource
      ? { tools: this.deps.findTools?.() || {} }
      : this.checkTools()
    if (check.error) return check
    if (kind === 'music-video' && !check.tools.ytdlp) return { error: 'yt-dlp not found. Go to Settings → External Tools to download it.' }
    if (kind === 'soulseek' && (!opts.username || !opts.filename)) return { error: 'Pick a file from the Soulseek results.' }
    // Merge all playlist requests even when they use exactly the same URL.
    // Addon identities take precedence: a shared endpoint can serve different songs.
    const ref = jobSourceRef(kind, url, opts)
    const running = [...this.jobs.values()].find(j => ACTIVE.has(j.status) && !j.stop &&
      (ref ? j.sourceRef === ref : j.url === url && j.kind === kind))
    if (running) {
      if (opts.replaceTrackId && opts.replaceTrackId !== running.opts.replaceTrackId) {
        if (!running.opts.replaceTrackId) running.opts.replaceTrackId = opts.replaceTrackId
        else running.opts.alsoReplace = [...new Set([...(running.opts.alsoReplace || []), opts.replaceTrackId])]
      }
      if (opts.replaceImported?.length) {
        running.opts.replaceImported = [...new Set([...(running.opts.replaceImported || []), ...opts.replaceImported])]
      }
      // Approval belongs to the individual playlist row, not the shared job.
      if (opts.confirmedImported?.length) {
        running.opts.confirmedImported = [...new Set([...(running.opts.confirmedImported || []), ...opts.confirmedImported.filter(id => opts.replaceImported?.includes(id))])]
      }
      if (opts.manuallySelectedImported?.length) {
        running.opts.manuallySelectedImported = [...new Set([...(running.opts.manuallySelectedImported || []), ...opts.manuallySelectedImported.filter(id => opts.replaceImported?.includes(id))])]
      }
      this.persist(running)
      return { downloadId: running.id, playlistId: running.playlistId, duplicate: true }
    }
    if (ref && kind !== 'music-video') {
      const owned = this.libraryTrackWithRef(ref)
      if (owned) {
        try {
          const db = this.db()
          const { resolveGhostTrack } = require('../../server/routes/playlists')
          db.transaction(() => {
            for (const ghostId of new Set(opts.replaceImported || [])) {
              const swapped = resolveGhostTrack(db, ghostId, owned.id, null, { requireMetadataMatch: !opts.manuallySelectedImported?.includes(ghostId), dedupePlaylist: true, allowDurationMismatch: opts.confirmedImported?.includes(ghostId) === true })
              if (!swapped?.ok) throw new Error(swapped?.error || 'Could not resolve imported track')
            }
          })()
          if (opts.replaceImported?.length) this.deps.onLibraryUpdated?.({ id: owned.id })
        } catch (error) {
          return { error: `Library copy could not replace the requested playlist tracks: ${error.message}` }
        }
        // Only a streamed copy of this very song takes the library copy's place.
        if (opts.replaceTrackId && this.isStreamedCopyOf(opts.replaceTrackId, ref)) {
          try {
            const { resolveGhostTrack } = require('../../server/routes/playlists')
            if (resolveGhostTrack(this.db(), opts.replaceTrackId, owned.id, null)?.ok) this.deps.onLibraryUpdated?.({ id: owned.id })
          } catch {}
        }
        return { alreadyInLibrary: true, trackId: owned.id, error: `Already in your library: ${owned.title || 'this song'}` }
      }
    }
    const existing = opts.id ? this.jobs.get(opts.id) : null
    if (existing) { this.jobs.delete(existing.id); this.unpersist(existing.id) }
    const job = this.makeJob(kind, url, opts)
    this.jobs.set(job.id, job)
    this.persist(job)
    this.emit(job, true)
    // Named after its link ("YouTube Track"): ask the source for the real name.
    if (!packageSource && (kind === 'playlist' || kind === 'single') && (!opts.title || GENERIC_TITLE.test(String(opts.title).trim()))) this.lookUpTitle(job, check.tools.ytdlp)
    this.pump()
    return { downloadId: job.id, playlistId: job.playlistId, queued: true }
  }

  lookUpTitle(job, ytdlp) {
    const proc = spawn(ytdlp, ['--dump-single-json', '--flat-playlist', '--playlist-items', '1', '--quiet', '--no-warnings', '--', job.url], { windowsHide: true })
    this.looseProcs.add(proc)
    let stdout = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    const done = () => {
      this.looseProcs.delete(proc)
      try {
        const parsed = JSON.parse(stdout)
        const title = parsed?.title || parsed?.playlist_title || parsed?.uploader
        if (title && this.jobs.get(job.id) === job) {
          if (job.kind !== 'playlist') { this.update(job, { title }, { persist: true }); return }
          this.update(job, { title, from: `${sourceLabel(job.url)} playlist` }, { persist: true })
          try { this.db().prepare('UPDATE downloaded_playlists SET title = ? WHERE id = ?').run(title, job.playlistId) } catch {}
        }
      } catch {}
    }
    proc.on('close', done)
    proc.on('error', () => this.looseProcs.delete(proc))
  }

  pump() {
    if (this.suspended || this.cancellingAll) return
    const limit = this.concurrency()
    const waiting = [...this.jobs.values()]
      .filter(j => j.status === 'queued' && !j.retryTimer && !j.waitingForTools)
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const job of waiting) {
      // slskd queues Soulseek transfers itself (often in the uploader's queue
      // for a while), so they don't take one of yt-dlp's slots.
      if (job.kind === 'soulseek') { this.startSoulseek(job); continue }
      if (this.running >= limit) continue
      this.start(job)
    }
  }

  cancel(id) {
    const job = this.jobs.get(id)
    if (!job) return Promise.resolve({ success: false, status: 'missing' })
    if (job.status === 'queued') {
      if (job.retryTimer) { clearTimeout(job.retryTimer); job.retryTimer = null }
      this.update(job, { status: 'cancelled', message: 'Cancelled', finishedAt: Date.now(), retryAt: null }, { persist: true })
      this.markPlaylist(job, 'incomplete')
      return Promise.resolve({ success: true, status: 'cancelled' })
    }
    if (job.status !== 'downloading') return Promise.resolve({ success: true, status: job.status })
    if (job.packageAbort) { job.stop = 'cancelled'; job.packageAbort.abort(); this.update(job, { message: 'Stopping…' }, { force: true }); return Promise.resolve({ success: true, status: 'cancelled' }) }
    if (job.kind === 'music-video') {
      job.stop = 'cancelled'
      job.videoAbort?.abort()
      this.update(job, { message: 'Stopping…' }, { force: true })
      return Promise.resolve({ success: true, status: 'cancelled' })
    }
    if (job.resolvingUrl) {
      // Still asking the addon for a link: nothing is running yet.
      job.stop = 'cancelled'
      this.update(job, { status: 'cancelled', message: 'Cancelled', finishedAt: Date.now() }, { persist: true })
      return Promise.resolve({ success: true, status: 'cancelled' })
    }
    if (job.kind === 'soulseek' && !job.exited) {
      job.stop = 'cancelled'
      if (job.transferId) slskd.cancelTransfer(job.settings || this.settings(), job.opts.username, job.transferId)
      this.update(job, { status: 'cancelled', message: 'Cancelled', speed: null, eta: null, finishedAt: Date.now() }, { persist: true })
      return Promise.resolve({ success: true, status: 'cancelled' })
    }
    // yt-dlp already finished. Stop the remaining postprocessing too: without
    // marking the job, Cancel all appeared to do nothing while lyrics,
    // conversion and indexing continued and the next queued jobs could start.
    if (job.exited) {
      const status = job.kind === 'playlist' ? 'incomplete' : 'cancelled'
      job.stop = status
      this.update(job, { status, message: 'Stopping...', speed: null, eta: null, finishedAt: Date.now() }, { persist: true, force: true })
      return Promise.resolve({ success: true, status: job.stop })
    }
    job.stop = job.kind === 'playlist' ? 'incomplete' : 'cancelled'
    this.update(job, { message: 'Stopping...' }, { force: true })
    return terminate(job.proc).then(() => ({ success: true, status: job.stop }))
  }

  async cancelAll() {
    if (this.cancellingAll) return { success: true, count: 0 }
    this.cancellingAll = true
    const ids = [...this.jobs.values()].filter(j => ACTIVE.has(j.status)).map(j => j.id)
    try {
      await Promise.all(ids.map(id => this.cancel(id)))
      return { success: true, count: ids.length }
    } finally {
      this.cancellingAll = false
    }
  }

  async remove(id) {
    const job = this.jobs.get(id)
    if (!job) return { success: true }
    if (ACTIVE.has(job.status)) await this.cancel(id)
    if (job.kind === 'music-video') {
      if (ACTIVE.has(job.status)) await this.waitFor(id)
      if (this.deps.deleteMusicVideo) {
        try { this.deps.deleteMusicVideo(job.opts.videoId) } catch (error) { return { error: error.message } }
      }
      for (const file of new Set([job.song, ...(job.filepaths || [])].filter(Boolean))) {
        try { fs.unlinkSync(file) } catch (error) { if (error.code !== 'ENOENT') return { error: error.message } }
      }
    }
    this.jobs.delete(id)
    this.unpersist(id)
    return { success: true }
  }

  /**
   * Songs deleted from the library: a finished download no longer counts as
   * saved once all of its songs are gone, so it can be downloaded again.
   */
  forgetTracks(trackIds) {
    const gone = new Set((trackIds || []).filter(Boolean))
    if (!gone.size) return 0
    let changed = 0
    for (const job of this.jobs.values()) {
      if (ACTIVE.has(job.status) || !job.indexedTracks?.some(t => gone.has(t.id))) continue
      const indexedTracks = job.indexedTracks.filter(t => !gone.has(t.id))
      const removed = indexedTracks.length === 0
      this.update(job, { indexedTracks, removed, ...(removed ? { message: 'Deleted from your library' } : {}) }, { persist: true, force: true })
      changed++
    }
    return changed
  }

  clearFinished() {
    let count = 0
    for (const job of [...this.jobs.values()]) {
      if (ACTIVE.has(job.status)) continue
      this.jobs.delete(job.id)
      this.unpersist(job.id)
      count++
    }
    return { success: true, count }
  }

  retry(id) {
    const job = this.jobs.get(id)
    if (!job) return { error: 'Download not found' }
    if (ACTIVE.has(job.status)) return { downloadId: job.id }
    if (job.kind === 'music-video') {
      if (!this.deps.findTools?.()?.ytdlp) return { error: 'yt-dlp not found. Go to Settings → External Tools to download it.' }
    } else if (job.kind !== 'soulseek' && !this.isPackageSource(job.opts?.addonSource)) {
      const check = this.checkTools()
      if (check.error) return check
    }
    this.update(job, {
      status: 'queued', message: 'Queued', error: null, progress: 0, speed: null, eta: null,
      attempt: 0, finishedAt: null, retryAt: null, withoutCookies: false, stop: null, seen: false,
      triedToolUpdate: false, triedClients: false, extraArgs: null, waitingForTools: false, removed: false,
    }, { persist: true })
    this.pump()
    return { downloadId: job.id, queued: true }
  }

  /** The user has looked at the finished downloads (the sidebar indicator can go). */
  markSeen() {
    for (const job of this.jobs.values()) {
      if (!ACTIVE.has(job.status) && !job.seen) { job.seen = true; this.persist(job) }
    }
    return { success: true }
  }

  markPlaylist(job, status) {
    if (job.kind !== 'playlist' || !job.playlistId) return
    try {
      this.db().prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, total_tracks = ?, last_downloaded_at = ? WHERE id = ?')
        .run(status, job.downloadedTracks.length, job.totalTracks || job.downloadedTracks.length, Date.now(), job.playlistId)
    } catch {}
  }

  // ------------------------------------------------------------- running

  start(job) {
    if (job.kind === 'music-video') return this.startMusicVideo(job)
    if (this.isPackageSource(job.opts?.addonSource)) return this.startPackage(job)
    // An addon download: its link expires, so ask the addon for a fresh one
    // right before yt-dlp starts (first run, restart or retry alike). The job
    // holds its slot meanwhile.
    if (job.opts?.addonSource && this.deps.resolveAddonUrl && !job.urlRefreshed) {
      job.resolvingUrl = true
      job.stop = null
      this.running++
      this.update(job, { status: 'downloading', message: 'Getting a fresh link from the addon...', error: null })
      const { provider, id } = job.opts.addonSource
      Promise.resolve(this.deps.resolveAddonUrl(provider, id)).then((url) => {
        if (!url || typeof url !== 'string') throw new Error('The addon gave no download link')
        return url
      }).then((url) => {
        job.resolvingUrl = false
        this.running--
        if (job.stop || job.status !== 'downloading') return // cancelled meanwhile
        job.url = url
        job.urlRefreshed = true
        this.start(job)
      }, (e) => {
        job.resolvingUrl = false
        this.running--
        if (job.stop || job.status !== 'downloading') return
        const message = `Couldn't get a link from the addon: ${e.message}`
        this.update(job, { status: 'error', error: message, message, finishedAt: Date.now() }, { persist: true })
        this.pump()
      })
      return
    }
    job.urlRefreshed = false // the next start (a retry) asks again
    const check = this.checkTools()
    if (check.error) {
      this.update(job, { status: 'error', error: check.error, message: check.error, finishedAt: Date.now() }, { persist: true })
      return
    }
    const { ytdlp, ffmpeg } = check.tools
    const settings = this.settings()
    const outputDir = job.opts.outputDir || settings.music_folder || path.join(os.homedir(), 'Music')
    try { fs.ensureDirSync(outputDir) } catch {}
    const format = resolveFormat(job.opts, settings)
    job.opts.format = format.format
    let archivePath = null
    if (job.kind === 'playlist') {
      archivePath = path.join(this.deps.getStorageDir(), `archive-${job.playlistId}.txt`)
      try {
        const existing = this.db().prepare('SELECT id FROM downloaded_playlists WHERE id = ?').get(job.playlistId)
        if (existing) {
          this.db().prepare("UPDATE downloaded_playlists SET status = 'downloading', url = ?, title = COALESCE(?, title), last_downloaded_at = ? WHERE id = ?")
            .run(job.url, GENERIC_TITLE.test(job.title) ? null : job.title, Date.now(), job.playlistId)
        } else {
          this.db().prepare("INSERT INTO downloaded_playlists (id, url, title, archive_path, status, downloaded_count, last_downloaded_at) VALUES (?, ?, ?, ?, 'downloading', 0, ?)")
            .run(job.playlistId, job.url, job.title, archivePath, Date.now())
        }
      } catch {}
    }

    const { args, cookies, spawnOptions } = buildArgs({ kind: job.kind, url: job.url, outputDir, settings, ffmpeg, format, archivePath, withoutCookies: job.withoutCookies, extraArgs: job.extraArgs || [], addonSource: job.opts?.addonSource })
    job.cookies = cookies
    job.errorLines = []
    job.outputLines.push(...cookies.notes)
    job.startedAt = Date.now()
    job.stop = null
    job.post = Promise.resolve()
    job.exited = false
    job.tracksAtStart = job.downloadedTracks.length
    job.settings = settings
    this.running++
    this.update(job, {
      status: 'downloading',
      message: job.attempt ? `Retrying (attempt ${job.attempt + 1})...` : 'Starting...',
      error: null,
      retryAt: null,
      seen: false,
    }, { persist: true })

    let proc
    try {
      proc = spawn(ytdlp, args, { windowsHide: true, ...spawnOptions, ...(OWN_GROUP ? { detached: true } : {}) })
      proc.lokalGroup = OWN_GROUP
    } catch (err) {
      this.running--
      this.fail(job, err.message)
      this.pump()
      return
    }
    job.proc = proc
    const buffered = { stdout: '', stderr: '' }
    const onData = (chunk, stream) => {
      const lines = (buffered[stream] + chunk.toString()).split(/\r?\n/)
      buffered[stream] = lines.pop()
      for (const line of lines) this.onLine(job, line, stream)
    }
    proc.stdout.on('data', d => onData(d, 'stdout'))
    proc.stderr.on('data', d => onData(d, 'stderr'))
    let closed = false
    const onClose = (code, err) => {
      if (closed) return
      closed = true
      for (const stream of ['stdout', 'stderr']) if (buffered[stream].trim()) this.onLine(job, buffered[stream], stream)
      job.proc = null
      job.exited = true
      job.exitCode = code
      this.running--
      this.onExit(job, code, err).catch(() => {}).finally(() => this.pump())
    }
    proc.on('close', code => onClose(code))
    proc.on('error', err => onClose(null, err))
  }

  isPackageSource(source) {
    if (!source || !/^a-[0-9a-f]{10}$/.test(source.provider) || typeof source.id !== 'string' || !source.id || source.id.length > 300 || /[\r\n]/.test(source.id)) return false
    try { return !!require('../spotiflac/packages').service(this.db()).find(source.provider.slice(2)) } catch { return false }
  }

  startPackage(job) {
    const controller = new AbortController(), runId = Symbol('package-run')
    job.packageAbort = controller; job.packageRunId = runId; job.startedAt = Date.now(); job.stop = null; job.exited = false
    job.settings = this.settings(); job.post = Promise.resolve(); this.running++
    this.update(job, { status: 'downloading', message: 'Resolving addon audio…', error: null, seen: false }, { persist: true })
    let artifact
    Promise.resolve().then(async () => {
      const { provider, id } = job.opts.addonSource
      artifact = await require('../spotiflac/packages').service(this.db()).download(provider.slice(2), id, {
        signal: controller.signal, quality: job.opts.addonQuality,
        onProgress: update => { if (job.packageRunId === runId && !job.stop) this.update(job, { progress: update.percent ?? job.progress, message: update.message || 'Downloading addon audio…' }) },
      })
      controller.signal.throwIfAborted()
      const outputDir = job.opts.outputDir || job.settings.music_folder || path.join(os.homedir(), 'Music')
      fs.ensureDirSync(outputDir)
      const title = String(job.title || 'Addon Track').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0,180)
      const ext = path.extname(artifact.file)
      let target = path.join(outputDir, `${title}${ext}`)
      for (let suffix = 1; fs.existsSync(target); suffix++) target = path.join(outputDir, `${title} (${suffix})${ext}`)
      await fs.copy(artifact.file, target, { overwrite: false, errorOnExist: true })
      if (controller.signal.aborted) { await fs.remove(target); controller.signal.throwIfAborted() }
      const meta = artifact.metadata
      job.opts.tags = { title: meta.title || meta.name, artist: meta.artist || (Array.isArray(meta.artists) ? meta.artists.join(', ') : meta.artists), album: meta.album || meta.album_name, cover: meta.cover_url, year: Number(String(meta.release_date || '').slice(0,4)) || undefined, track: meta.track_number, disc: meta.disc_number, isrc: meta.isrc, genre: meta.genre, ...job.opts.tags }
      job.filepaths.push(target); job.exited = true; job.exitCode = 0
      this.afterFile(job, target)
      await this.onExit(job, 0)
    }).catch(error => {
      if (job.stop) this.update(job, { status: job.stop === 'suspend' ? 'queued' : 'cancelled', message: job.stop === 'suspend' ? 'Resuming…' : 'Cancelled', finishedAt: job.stop === 'suspend' ? null : Date.now() }, { persist: true })
      else this.fail(job, error.message)
    }).finally(async () => {
      await artifact?.cleanup()
      if (job.packageRunId === runId) job.packageAbort = null
      this.running--; this.pump()
    })
  }

  startMusicVideo(job) {
    const controller = new AbortController()
    job.videoAbort = controller
    job.startedAt = Date.now()
    job.stop = null
    this.running++
    this.update(job, { status: 'downloading', message: 'Downloading music video…', error: null, seen: false }, { persist: true })
    Promise.resolve().then(() => this.deps.downloadMusicVideo(job.opts.videoId, {
      ...job.opts,
      signal: controller.signal,
      onProgress: progress => {
        const percent = Number.isFinite(progress?.percent) ? progress.percent : job.progress
        this.update(job, { progress: percent, message: Number.isFinite(progress?.percent) ? `Downloading music video… ${progress.percent}%` : 'Downloading music video…' })
      },
    })).then(file => {
      if (!file && !job.stop) throw new Error('Music video download produced no file')
      if (job.stop) {
        this.update(job, { status: job.stop === 'suspend' ? 'queued' : job.stop, message: job.stop === 'suspend' ? 'Resuming…' : 'Cancelled', finishedAt: job.stop === 'suspend' ? null : Date.now() }, { persist: true })
        return
      }
      this.update(job, { status: 'done', progress: 100, song: file, filepaths: [file], message: 'Music video downloaded', finishedAt: Date.now() }, { persist: true })
      this.trimHistory()
    }).catch(error => {
      if (job.stop) this.update(job, { status: job.stop === 'suspend' ? 'queued' : job.stop, message: job.stop === 'suspend' ? 'Resuming…' : 'Cancelled', finishedAt: job.stop === 'suspend' ? null : Date.now() }, { persist: true })
      else this.fail(job, error?.message || 'Music video download failed')
    }).finally(() => {
      job.videoAbort = null
      this.running--
      this.pump()
    })
  }

  onLine(job, raw, stream) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) return
    job.outputLines.push(line)
    if (job.outputLines.length > 400) job.outputLines.splice(0, job.outputLines.length - 300)

    if (stream === 'stderr' || /^ERROR:|\[error\]/i.test(line)) {
      if (/error/i.test(line) && !line.includes('Deleting original file')) job.errorLines.push(line)
      this.emit(job)
      return
    }

    if (line.startsWith('lokalmeta:')) {
      try { job.nextMeta = JSON.parse(line.slice('lokalmeta:'.length)) } catch { job.nextMeta = null }
      return
    }

    if (line.startsWith('filepath:')) {
      const filepath = line.slice('filepath:'.length).trim()
      const meta = job.nextMeta || null
      job.nextMeta = null
      if (filepath && !job.filepaths.includes(filepath)) {
        job.filepaths.push(filepath)
        this.update(job, { song: filepath, message: `Saved: ${path.basename(filepath)}` }, { force: true })
        this.afterFile(job, filepath, meta)
      }
      return
    }

    const item = line.match(/\[download\]\s+Downloading (?:video|item)\s+(\d+)\s+of\s+(\d+)/i)
    if (item) {
      const current = parseInt(item[1], 10)
      const total = parseInt(item[2], 10)
      this.update(job, {
        currentTrack: current,
        totalTracks: total,
        progress: total > 0 ? Math.min(99, Math.round(((current - 1) / total) * 100)) : 0,
        message: `Track ${current} of ${total}`,
      }, { force: true })
      return
    }

    if (line.includes('has already been recorded in the archive')) {
      this.update(job, { message: 'Already downloaded, skipping' })
      return
    }

    const destination = line.match(/Destination:\s+(.+)/)
    if (destination) {
      this.update(job, { message: `Downloading: ${path.basename(destination[1].trim())}` })
      return
    }

    const pct = line.match(/^\[download\]\s+(\d+(?:\.\d+)?)%/)
    if (pct) {
      const raw = parseFloat(pct[1])
      const total = job.totalTracks || 0
      const current = job.currentTrack || 0
      const overall = total > 0 && current > 0 ? (((current - 1) + raw / 100) / total) * 100 : raw
      const speed = line.match(/at\s+(\S+\/s)/i)
      const eta = line.match(/ETA\s+([0-9:]+)/i)
      this.update(job, {
        progress: Math.max(0, Math.min(99, Math.round(overall))),
        speed: speed?.[1] || null,
        eta: eta?.[1] || null,
        message: total > 0 ? `Track ${current} of ${total}` : 'Downloading...',
      })
      return
    }

    const step = line.match(/^\[(ExtractAudio|Metadata|EmbedThumbnail|ThumbnailsConvertor|ffmpeg|Merger)\]/)
    if (step) {
      const labels = { ExtractAudio: 'Extracting audio', Metadata: 'Writing tags', EmbedThumbnail: 'Adding cover', ThumbnailsConvertor: 'Preparing cover', ffmpeg: 'Converting', Merger: 'Merging' }
      this.update(job, { message: `${labels[step[1]] || step[1]}...` })
    }
  }

  // ------------------------------------------------------------- soulseek

  async startSoulseek(job) {
    const settings = this.settings()
    // Each run gets a token: a poll loop from an earlier run (cancel, then
    // Retry) sees a newer token and stops instead of racing this one.
    const runId = (job.runId || 0) + 1
    Object.assign(job, { runId, settings, startedAt: Date.now(), stop: null, exited: false, exitCode: null, post: Promise.resolve(), errorLines: [], pollErrors: 0 })
    this.update(job, { status: 'downloading', message: 'Asking slskd...', error: null, retryAt: null, progress: 0, seen: false }, { persist: true })
    const { username, filename, size } = job.opts
    try {
      await slskd.enqueue(settings, username, filename, size)
    } catch (e) {
      if (job.runId === runId && !job.stop) this.fail(job, e.message)
      return
    }
    if (job.runId !== runId || job.stop) return
    job.outputLines.push(`[Lokal] Asked slskd for ${filename} from ${username}`)
    this.pollSoulseek(job, 1200, runId)
  }

  pollSoulseek(job, delay = 1200, runId = job.runId) {
    const current = () => this.jobs.get(job.id) === job && job.runId === runId && job.status === 'downloading' && !job.stop
    setTimeout(async () => {
      if (!current()) return
      const { username, filename, size } = job.opts
      let transfer
      try {
        transfer = await slskd.findTransfer(job.settings, username, filename)
        if (!current()) return
        job.pollErrors = 0
      } catch (e) {
        if (!current()) return
        job.pollErrors = (job.pollErrors || 0) + 1
        if (job.pollErrors > 20) { this.fail(job, e.message); return }
        this.update(job, { message: `slskd not answering (${e.message}), still trying...` })
        this.pollSoulseek(job, 3000, runId)
        return
      }
      if (!transfer) {
        if (Date.now() - job.startedAt > 90000) { this.fail(job, `slskd has no transfer for this file any more. Try again or pick another user.`); return }
        this.pollSoulseek(job, 1200, runId)
        return
      }
      job.transferId = transfer.id
      const state = slskd.describeState(transfer.state)
      if (state.done) {
        if (state.ok) { this.finishSoulseek(job, transfer, runId).catch(e => { if (job.runId === runId) this.fail(job, e.message) }); return }
        const why = state.reason === 'Rejected'
          ? `${username} declined the download (they may only share with some users). Try another result.`
          : state.reason === 'Cancelled'
            ? 'The transfer was cancelled in slskd.'
            : `The transfer from ${username} failed (${state.reason || 'error'}${transfer.exception ? `: ${transfer.exception}` : ''}). Retry, or pick another result.`
        this.fail(job, why)
        return
      }
      if (state.active) {
        const speed = transfer.averageSpeed ? `${(transfer.averageSpeed / (1024 * 1024)).toFixed(1)}MiB/s` : null
        this.update(job, { progress: Math.max(0, Math.min(99, Math.round(transfer.percentComplete || 0))), speed, message: 'Downloading from Soulseek...' })
      } else {
        const place = transfer.placeInQueue ? ` (#${transfer.placeInQueue})` : ''
        this.update(job, { progress: 0, speed: null, message: state.remote ? `Waiting in ${username}'s queue${place}` : 'Queued in slskd' })
      }
      this.pollSoulseek(job, state.active ? 1000 : 2500, runId)
    }, delay)
  }

  /** Picks the finished file up from slskd's folder and files it like any download. */
  async finishSoulseek(job, transfer, runId = job.runId) {
    let downloadsDir = slskd.config(job.settings).downloadsDir
    if (!downloadsDir) {
      try { downloadsDir = (await slskd.status(job.settings)).downloadsDir } catch {}
    }
    if (job.runId !== runId || job.stop || this.jobs.get(job.id) !== job) return
    const found = slskd.locateDownload(downloadsDir, job.opts.filename, transfer.size || job.opts.size, job.startedAt)
    if (!found) {
      this.fail(job, `slskd finished the download, but Lokal can't find it in ${downloadsDir || "slskd's downloads folder"}. If slskd runs in Docker or on another machine, set the folder as this computer sees it in Settings → Soulseek.`)
      return
    }
    const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 120)
    const info = readInfo(found) || {}
    const musicDir = job.opts.outputDir || job.settings.music_folder || path.join(os.homedir(), 'Music')
    const artist = clean(String(info.artist || '').split(/;|\s\/\s/)[0]) || 'Unknown Artist'
    const album = clean(info.album) || clean(slskd.splitRemote(job.opts.filename).folder) || 'Singles'
    const base = path.basename(found)
    let dest = path.join(musicDir, artist, album, base)
    for (let n = 1; fs.existsSync(dest) && n < 50; n++) {
      dest = path.join(musicDir, artist, album, `${path.basename(base, path.extname(base))} (${n})${path.extname(base)}`)
    }
    try {
      fs.moveSync(found, dest)
    } catch (e) {
      this.fail(job, `Couldn't move the file into your music folder: ${e.message}`)
      return
    }
    job.outputLines.push(`[Lokal] Moved to ${dest}`)
    job.filepaths.push(dest)
    job.exited = true
    job.exitCode = 0
    this.update(job, { progress: 100, speed: null, song: dest, message: `Saved: ${base}` }, { force: true })
    this.afterFile(job, dest)
    await this.onExit(job, 0)
    this.pump()
  }

  /** Finishes and indexes one file, in the background, one at a time per job. */
  afterFile(job, filepath, meta = null) {
    job.post = job.post.then(async () => {
      let finalPath = filepath
      try {
        if (!job.stop) this.update(job, { message: `Adding lyrics: ${path.basename(filepath)}` })
        const outputDir = job.opts.outputDir || job.settings?.music_folder || path.join(os.homedir(), 'Music')
        // Apple Lossless and other codecs the player can't decode: FLAC (or AAC) first.
        const playable = await makePlayable(filepath, { ffmpeg: this.deps.findTools?.()?.ffmpeg })
        if (playable !== filepath) {
          job.outputLines.push(`[Lokal] Converted ${path.basename(filepath)} to ${path.extname(playable).slice(1).toUpperCase()} so it plays in Lokal`)
          const fileIndex = job.filepaths.indexOf(filepath)
          if (fileIndex >= 0) job.filepaths[fileIndex] = playable
          if ((job.pendingIndex || []).includes(filepath)) {
            job.pendingIndex = job.pendingIndex.map(fp => fp === filepath ? playable : fp)
            this.persist(job)
          }
          filepath = playable
          finalPath = playable
        }
        // Stopped: the files already downloaded are still tagged and added,
        // but without looking up lyrics, so stopping doesn't wait on a backlog.
        const settings = job.stop ? { ...(job.settings || {}), download_embed_lyrics: '0' } : (job.settings || {})
        const done = await finishFile(filepath, { db: this.db(), settings, url: job.url, meta, kind: job.kind, outputDir, known: job.opts?.tags || null })
        finalPath = done.filePath
        const name = path.basename(finalPath)
        if (!job.downloadedTracks.includes(name)) job.downloadedTracks.push(name)
        if (done.lyrics) job.lyricsCount = (job.lyricsCount || 0) + 1
        // The row's picture: the first finished file's own (square) cover.
        // Soulseek and playlist downloads have nothing else to show, and it
        // beats a 16:9 video frame for singles too.
        if (!String(job.thumbnail || '').startsWith('data:')) {
          const thumb = await coverThumbnail(finalPath)
          if (thumb) job.thumbnail = thumb
        }
        job.outputLines.push(done.lyrics
          ? `[Lokal] Lyrics added (${done.lyrics === 'syllable' ? 'word by word' : done.lyrics === 'line' ? 'line by line' : 'plain text'}, ${done.lyricsSource}): ${name}`
          : `[Lokal] No lyrics found for ${name}`)
      } catch {
        const name = path.basename(filepath)
        if (!job.downloadedTracks.includes(name)) job.downloadedTracks.push(name)
      }
      const index = this.deps.index
      if ((index || job.opts?.upgradeTrackId) && (job.settings?.index_while_downloading === '1' || job.kind === 'single' || job.kind === 'soulseek')) {
        await this.indexOne(job, finalPath)
      } else {
        job.pendingIndex = [...(job.pendingIndex || []), finalPath]
      }
      this.update(job, { song: finalPath }, { persist: true })
    })
  }

  async indexOne(job, filepath) {
    // "Get it in lossless": this file replaces a track's file, keeping the
    // track (playlists, likes, history). If that can't be done, it is added
    // as a track of its own below, as usual.
    if (job.opts?.upgradeTrackId && !job.upgradedTrackId) {
      const { upgradeTrackFile } = require('../quality/upgrade')
      const up = await upgradeTrackFile(this.db(), job.opts.upgradeTrackId, filepath, { storageDir: this.deps.getStorageDir?.(), allowDurationMismatch: job.opts.allowUpgradeDurationMismatch === true }).catch(e => ({ error: e.message }))
      if (up?.id) {
        job.upgradedTrackId = up.id
        try { this.db().prepare('UPDATE tracks SET download_source = ? WHERE id = ?').run(jobSourceLabel(job), up.id) } catch {}
        job.indexedTracks.push({ filepath, id: up.id, title: path.basename(filepath, path.extname(filepath)) })
        if (up.movedTo) job.outputLines.push(`[Lokal] The previous file was moved to ${up.movedTo}`)
        this.update(job, { message: `Upgraded in your library: ${path.basename(filepath)}`, removed: false }, { persist: true })
        try { this.deps.onLibraryUpdated?.({ id: up.id, upgraded: true }) } catch {}
        return
      }
      job.outputLines.push(`[Lokal] Not used as an upgrade: ${up?.error || 'unknown error'}`)
    }
    const index = this.deps.index
    if (!index) return
    try {
      const videoId = job.kind === 'single' ? youTubeId(job.url) : null
      const result = await index(filepath, {
        deferGhostResolution: true,
        thumbnailUrl: videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : undefined,
        metadata: job.opts?.tags
          ? {
              title: job.opts.tags.title,
              artist: job.opts.tags.artist,
              album: job.opts.tags.album,
              duration: job.opts.expectedDuration,
            }
          : undefined,
      }) || { error: 'Downloaded file could not be indexed' }
      if (result?.error) {
        job.libraryFailures = (job.libraryFailures || 0) + 1
        job.outputLines.push(`[Lokal] Downloaded file was not added to the library: ${result.error}`)
        this.update(job, { message: 'Downloaded, but not added to the library', removed: false }, { persist: true })
        return result
      }
      // The same song, downloaded before (from YouTube, say) and now in better
      // quality (an addon's FLAC): the new file takes the old one's place in
      // its track, which keeps its playlists, likes and history. Otherwise
      // indexing would only see a duplicate and leave the new file out of the
      // library (a later rescan then added it as a file of unknown source).
      const upgraded = result?.duplicate && result.id ? await this.replaceWorseCopy(job, result.id, filepath) : false
      if (result?.id) {
        // Where it came from: tells versions apart, and stops a second download.
        // A file already in the library (indexing gave back its track) keeps
        // the source it had, unless this download just replaced its file.
        try {
          this.db().prepare(upgraded
            ? 'UPDATE tracks SET download_source = ?, source_ref = ? WHERE id = ?'
            : 'UPDATE tracks SET download_source = COALESCE(download_source, ?), source_ref = COALESCE(source_ref, ?) WHERE id = ?')
            .run(jobSourceLabel(job), job.sourceRef || null, result.id)
        } catch {}
        // No cover inside the file (common on Soulseek, where the art is a
        // separate cover.jpg in the uploader's folder): use the one the
        // library just found for the track (online artwork), so the row in
        // the download list isn't left blank.
        if (!String(job.thumbnail || '').startsWith('data:')) {
          try {
            const row = this.db().prepare('SELECT artwork_path FROM tracks WHERE id = ?').get(result.id)
            const thumb = row?.artwork_path ? await imageThumbnail(row.artwork_path) : null
            if (thumb) this.update(job, { thumbnail: thumb }, { persist: true })
          } catch {}
        }
        // A streamed song saved to the library: the file takes the ghost
        // track's place in playlists, likes and history.
        // (Soulseek: the file the user picked for that song, so no source check.
        // Addons: their link can be anything, often a YouTube or SoundCloud
        // one, so the song is checked by the addon's own id instead.)
        const { resolveGhostTrack } = require('../../server/routes/playlists')
        const replaced = new Set()
        const replace = (ghostId, identity, options = {}) => {
          const swapped = resolveGhostTrack(this.db(), ghostId, result.id, identity, options)
          if (!swapped?.ok) {
            if (swapped?.skipped && swapped.error) {
              job.outputLines.push(`[Lokal] Kept the unresolved track (${ghostId}): ${swapped.error}`)
            }
            return
          }
          replaced.add(ghostId)
          job.outputLines.push(`[Lokal] Replaced the streamed version (${ghostId}) with this file`)
        }
        // Songs of an imported playlist (a CSV, a pasted list) this download
        // was found for: they must actually take their ghost row's place before
        // this download can count as library-added.
        let importedReplacementFailed = false
        const importedGhosts = job.kind === 'single' ? [...new Set(job.opts?.replaceImported || [])] : []
        if (importedGhosts.length) {
          try {
            const db = this.db()
            db.transaction(() => {
              for (const ghostId of importedGhosts) {
                const swapped = resolveGhostTrack(db, ghostId, result.id, null, { requireMetadataMatch: !job.opts.manuallySelectedImported?.includes(ghostId), dedupePlaylist: true, allowDurationMismatch: job.opts.confirmedImported?.includes(ghostId) === true })
                if (!swapped?.ok) throw new Error(swapped?.error || 'Could not resolve imported track')
              }
            })()
            for (const ghostId of importedGhosts) {
              replaced.add(ghostId)
              job.outputLines.push(`[Lokal] Replaced the streamed version (${ghostId}) with this file`)
            }
          } catch (error) {
            importedReplacementFailed = true
            job.outputLines.push(`[Lokal] Kept the unresolved playlist tracks: ${error.message || error}`)
          }
        }

        if (importedReplacementFailed) {
          const message = 'Downloaded audio, but it could not be matched back to the requested playlist track'
          job.outputLines.push(`[Lokal] ${message}`)
          job.libraryFailures = (job.libraryFailures || 0) + 1
          this.update(job, { message, removed: false }, { persist: true, force: true })

          // This track was newly indexed only for this failed playlist
          // resolution. Do not leave a mismatched file in the library.
          if (!result.duplicate) {
            let removeFile = false
            if (result.success === true) {
              try {
                const db = this.db()
                db.transaction(() => {
                  db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(result.id)
                  db.prepare('DELETE FROM tracks WHERE id = ?').run(result.id)
                })()
                removeFile = true
              } catch {}
            } else {
              const existing = this.db().prepare('SELECT file_path FROM tracks WHERE id = ?').get(result.id)
              removeFile = !existing || path.resolve(existing.file_path) !== path.resolve(filepath)
            }
            try { if (removeFile && fs.existsSync(filepath)) await fs.remove(filepath) } catch {}
          }
          return { ...result, error: message, libraryAdded: false }
        }

        if (job.opts?.replaceTrackId && (job.kind === 'single' || job.kind === 'soulseek')) {
          try {
            const addon = job.opts.addonSource
            // Several clicks on the same song (search list, player bar) while
            // it downloaded: each one's streamed copy.
            for (const ghostId of [job.opts.replaceTrackId, ...(job.opts.alsoReplace || [])]) {
              if (replaced.has(ghostId)) continue
              if (addon) {
                if (ghostId === onlineTrackId(addon.provider, addon.id)) replace(ghostId, null)
              } else {
                replace(ghostId, job.kind === 'single' ? sourceIdentity(job.url) : null)
              }
            }
          } catch {}
        }
        // The imported batch has committed; ordinary ISRC matching can now run.
        try { require('../ipc/playlists').resolveGhostsByIsrc(this.db(), result.id) } catch {}
        // The same song liked or added to a playlist from another source.
        try {
          const track = this.db().prepare('SELECT id, title, artist, duration FROM tracks WHERE id = ?').get(result.id)
          for (const ghostId of streamedTwins(this.db(), track)) if (!replaced.has(ghostId)) replace(ghostId, null)
        } catch {}

        // Only now does the list show the song (which refreshes the library
        // pages): once it has taken the streamed version's place, so a
        // playlist or Liked Songs doesn't reload in between.
        job.indexedTracks.push({ filepath, id: result.id, title: path.basename(filepath, path.extname(filepath)) })
        this.update(job, { message: `Added to library: ${path.basename(filepath)}`, removed: false }, { force: true })
        try { this.deps.onLibraryUpdated?.(result) } catch {}
        return { ...result, libraryAdded: true }
      }
      return result
    } catch (error) {
      job.libraryFailures = (job.libraryFailures || 0) + 1
      job.outputLines.push(`[Lokal] Could not add the download to the library: ${error.message || error}`)
      this.update(job, { message: 'Downloaded, but not added to the library', removed: false }, { persist: true })
      return { error: error.message || String(error), libraryAdded: false }
    }
  }

  /**
   * `filepath` is a song the library already has as track `trackId`. When
   * that track was itself downloaded and this file is of a better quality
   * tier (Low < High < Lossless < Hi-res), put this file in its place (the old
   * one is kept aside, like "Get it in lossless" does). Your own files are
   * never replaced. True when the file was swapped.
   */
  async replaceWorseCopy(job, trackId, filepath) {
    try {
      const quality = require('../quality')
      const track = this.db().prepare("SELECT id, file_path, download_source, lossless, bitrate, codec, sample_rate, bit_depth FROM tracks WHERE id = ? AND file_path NOT LIKE 'ghost://%'").get(trackId)
      if (!track?.download_source || path.resolve(track.file_path) === path.resolve(filepath)) return false
      const before = track.lossless === null || track.lossless === undefined
        ? (fs.existsSync(track.file_path) ? await this.fileTier(track.file_path) : 'unknown')
        : quality.tierOf(track)
      const after = await this.fileTier(filepath)
      if (!(TIER_RANK[after] > TIER_RANK[before])) return false
      const { upgradeTrackFile } = require('../quality/upgrade')
      const up = await upgradeTrackFile(this.db(), trackId, filepath, { storageDir: this.deps.getStorageDir?.() })
      if (!up?.id) {
        job.outputLines.push(`[Lokal] Not used in place of the earlier copy: ${up?.error || 'unknown error'}`)
        return false
      }
      job.outputLines.push(`[Lokal] Replaced the earlier ${TIER_NAME[before] || ''} copy with this ${TIER_NAME[after]} file${up.movedTo ? ` (the old file was moved to ${up.movedTo})` : ''}`)
      return true
    } catch (e) {
      job.outputLines.push(`[Lokal] Could not compare with the earlier copy: ${e.message}`)
      return false
    }
  }

  /** A file's quality tier (low, high, lossless, hires). */
  async fileTier(file) {
    const quality = require('../quality')
    const meta = await require('../musicMetadata').parseFile(file, { duration: false, skipCovers: true })
    return quality.tierOf({ ...quality.qualityFields(meta), bitrate: meta?.format?.bitrate ? Math.round(meta.format.bitrate / 1000) : null })
  }

  async onExit(job, code, err) {
    await job.post.catch(() => {})
    for (const fp of job.pendingIndex || []) await this.indexOne(job, fp)
    job.pendingIndex = []
    await this.cleanup(job).catch(() => {})

    if (this.jobs.get(job.id) !== job) return

    if (job.stop === 'suspend') {
      this.update(job, { status: 'queued', message: 'Paused while yt-dlp updates', speed: null, eta: null }, { persist: true })
      return
    }
    if (job.stop) {
      const status = job.stop
      this.markPlaylist(job, status)
      this.update(job, {
        status,
        message: status === 'incomplete' ? 'Stopped before finishing' : 'Cancelled',
        speed: null, eta: null, finishedAt: Date.now(),
      }, { persist: true })
      return
    }

    const partial = job.kind === 'playlist' && job.downloadedTracks.length > (job.tracksAtStart || 0)
    const failures = job.libraryFailures || 0
    const libraryWarning = failures ? ` · ${failures} not added to library` : ''
    if (code === 0 && !err) {
      this.markPlaylist(job, 'completed')
      const n = job.downloadedTracks.length
      const lyrics = job.lyricsCount ? ` · lyrics for ${job.lyricsCount}` : ''
      this.update(job, {
        status: 'done',
        progress: 100,
        speed: null, eta: null,
        message: job.kind === 'playlist'
          ? `${n} track${n === 1 ? '' : 's'} downloaded${libraryWarning}${lyrics}`
          : failures ? `Downloaded, but ${failures} not added to library${lyrics}` : `Downloaded${lyrics}`,
        currentTrack: job.totalTracks || n || null,
        totalTracks: job.totalTracks || n || null,
        finishedAt: Date.now(),
      }, { persist: true })
      this.trimHistory()
      return
    }

    const lines = job.errorLines.length ? job.errorLines : job.outputLines
    // A yt-dlp too old for --js-runtimes: straight back in line without it.
    if (!err && !partial && jsRuntimeRefused(lines.join('\n'))) {
      this.update(job, { status: 'queued', message: 'Retrying...' }, { persist: true })
      return
    }

    // Unreadable browser cookies: straight back in line without them.
    if (!err && job.cookies?.usedBrowser && !partial && isCookieError(lines)) {
      job.outputLines.push(markUnreadable(job.cookies.usedBrowser))
      job.withoutCookies = true
      this.update(job, { status: 'queued', message: 'Retrying without cookies...' }, { persist: true })
      return
    }

    // A playlist where some tracks failed but others landed: done, with a note.
    if (job.kind === 'playlist' && partial && !err) {
      this.markPlaylist(job, 'completed')
      const failed = job.errorLines.filter(l => /ERROR:/.test(l)).length
      this.update(job, {
        status: 'done',
        progress: 100,
        speed: null, eta: null,
        message: `${job.downloadedTracks.length} downloaded${failed ? `, ${failed} unavailable` : ''}${libraryWarning}`,
        finishedAt: Date.now(),
      }, { persist: true })
      return
    }

    const text = lines.join('\n')

    // YouTube refused this yt-dlp: update yt-dlp once (desktop), then try other
    // player clients, before giving up.
    if (!err && !partial && isYouTube(job.url) && YOUTUBE_BLOCKED.test(text)) {
      if (!job.triedToolUpdate && this.deps.updateTools && Date.now() - (this.toolsUpdatedAt || 0) > TOOL_UPDATE_COOLDOWN_MS) {
        job.triedToolUpdate = true
        job.waitingForTools = true
        this.update(job, { status: 'queued', message: 'YouTube refused this yt-dlp. Updating yt-dlp...', speed: null, eta: null }, { persist: true })
        this.refreshTools()
        return
      }
      if (!job.triedClients) {
        job.triedClients = true
        job.extraArgs = FALLBACK_CLIENTS
        job.outputLines.push('[Lokal] YouTube refused the download; retrying with other YouTube player clients.')
        this.update(job, { status: 'queued', message: 'Retrying with another YouTube client...', speed: null, eta: null }, { persist: true })
        return
      }
      // Signed in, yt-dlp only uses clients that need a JavaScript runtime;
      // signed out, it has one that doesn't.
      if (!job.withoutCookies && job.cookies?.args?.length) {
        job.withoutCookies = true
        job.outputLines.push('[Lokal] YouTube gave no usable format with your cookies; retrying without them.')
        this.update(job, { status: 'queued', message: 'Retrying without cookies...', speed: null, eta: null }, { persist: true })
        return
      }
    }

    if (!err && job.attempt < RETRY_DELAYS_MS.length && TRANSIENT.test(text) && !PERMANENT.test(text)) {
      const delay = RETRY_DELAYS_MS[job.attempt]
      job.attempt++
      job.retryAt = Date.now() + delay
      this.update(job, { status: 'queued', message: `Retrying in ${Math.round(delay / 1000)}s...`, speed: null, eta: null }, { persist: true })
      job.retryTimer = setTimeout(() => { job.retryTimer = null; job.retryAt = null; this.pump() }, delay)
      return
    }

    this.fail(job, err ? err.message : friendlyError(lines, code === null ? 'Download stopped' : `Download failed (exit ${code})`))
  }

  fail(job, message) {
    this.markPlaylist(job, 'failed')
    this.update(job, { status: 'error', error: message, message, speed: null, eta: null, finishedAt: Date.now() }, { persist: true })
    this.trimHistory()
  }

  /** Thumbnails and partial files yt-dlp leaves next to finished tracks. */
  async cleanup(job) {
    const junk = new Set(['.webp', '.ytdl', '.temp', '.mhtml', '.info.json'])
    for (const fp of job.filepaths) {
      const dir = path.dirname(fp)
      const base = path.basename(fp, path.extname(fp))
      let siblings = []
      try { siblings = fs.readdirSync(dir) } catch { continue }
      for (const file of siblings) {
        if (!file.startsWith(base + '.')) continue
        const ext = path.extname(file).toLowerCase()
        const full = path.join(dir, file)
        if (junk.has(ext) || file.endsWith('.jpg.part') || (ext === '.jpg' && (() => { try { return fs.statSync(full).size < 51200 } catch { return false } })())) {
          try { fs.unlinkSync(full) } catch {}
        }
      }
    }
  }

  /** Updates yt-dlp once for everything that's waiting on it, then lets them run. */
  refreshTools() {
    if (this.toolUpdate) return this.toolUpdate
    this.toolUpdate = (async () => {
      let outcome = null
      try { outcome = await this.deps.updateTools() } catch (e) { outcome = { error: e.message } }
      this.toolsUpdatedAt = Date.now()
      const note = outcome?.updated
        ? `[Lokal] Updated yt-dlp${outcome.version ? ` to ${outcome.version}` : ''}; retrying.`
        : outcome?.upToDate ? '[Lokal] yt-dlp is already the latest version; retrying.'
          : `[Lokal] Couldn't update yt-dlp${outcome?.error ? ` (${outcome.error})` : ''}; retrying anyway.`
      for (const job of this.jobs.values()) {
        if (!job.waitingForTools) continue
        job.waitingForTools = false
        job.outputLines.push(note)
        this.update(job, { message: 'Queued' }, { persist: true })
      }
    })().finally(() => { this.toolUpdate = null; this.pump() })
    return this.toolUpdate
  }

  // ------------------------------------------------------------- lifecycle

  /** Stops running downloads so yt-dlp can be replaced; they go back in line. */
  async suspend() {
    this.suspended = true
    const running = [...this.jobs.values()].filter(j => j.status === 'downloading' && !j.exited && j.kind !== 'soulseek')
    for (const job of running) { job.stop = 'suspend'; job.videoAbort?.abort(); job.packageAbort?.abort() }
    await Promise.all(running.map(j => terminate(j.proc)))
    await Promise.all([...this.looseProcs].map(p => terminate(p)))
    return { success: true, count: running.length, ids: running.map(j => j.id) }
  }

  resume() {
    if (!this.suspended) return
    this.suspended = false
    this.pump()
  }

  /** App quitting: stop everything, leave it queued so it resumes next launch. */
  shutdown() {
    this.suspended = true
    for (const job of this.jobs.values()) {
      if (job.retryTimer) { clearTimeout(job.retryTimer); job.retryTimer = null }
      if (job.status === 'downloading') {
        // Files that landed but aren't in the library yet get indexed on the next launch.
        const indexed = new Set(job.indexedTracks.map(t => t.filepath))
        job.pendingIndex = [...new Set([...(job.pendingIndex || []), ...job.filepaths])].filter(fp => !indexed.has(fp))
      }
      if (job.status === 'downloading' && job.exited && job.exitCode === 0) {
        // yt-dlp finished; only lyrics/indexing were left. Don't download it again.
        job.status = 'done'
        job.message = 'Downloaded'
        job.finishedAt = Date.now()
        this.persist(job)
      } else if (job.status === 'downloading' && !job.exited) {
        job.stop = 'suspend'
        this.markPlaylist(job, 'incomplete')
        job.status = 'queued'
        job.message = 'Resuming after restart'
        this.persist(job)
        job.videoAbort?.abort()
        job.packageAbort?.abort()
        terminate(job.proc)
      }
    }
    for (const proc of this.looseProcs) terminate(proc)
  }

  hasPlaylistRunning(playlistId, url) {
    return [...this.jobs.values()].find(j => ACTIVE.has(j.status) && j.kind === 'playlist' && (j.playlistId === playlistId || (url && j.url === url))) || null
  }
}

let instance = null
function getDownloadManager() {
  if (!instance) instance = new DownloadManager()
  return instance
}

module.exports = { getDownloadManager, DownloadManager, friendlyError, youTubeId, playlistIdOf, TRANSIENT, PERMANENT }
