// Online results (YouTube Music, SoundCloud) for the desktop app: search,
// keeping songs as ghost tracks, and the lokal-stream://<provider>/<id>
// protocol the player streams from. See electron/online/sources.js.

const { getDB } = require('./db')
const { resolveTrackId } = require('../online/musicVideoReferences')
const { findYtDlp } = require('./tools')
const { cookieArgs } = require('./ytCookies')
const { runJsonSearch, mapSearchResult } = require('../download/search')
const sources = require('../online/sources')
const genres = require('../online/genres')
const youtube = require('../online/youtube')
const { createArtworkResolver } = require('../discoveryArtwork')
const { spelling } = require('../online/spelling')
const discoveryArtwork = createArtworkResolver({ getDB, isElectron: true, searchArtists: require('./artistMetadata').searchArtistMetadataCandidates, searchSongs: youtube.searchSongs })
let accountSession

const SCHEME = 'lokal-stream'

/** All settings as { key: value }. */
function settings() {
  try { return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])) } catch { return {} }
}

/** yt-dlp and the user's YouTube cookie options, for resolving streams. */
function streamOptions() {
  const all = settings()
  // Only YouTube streams go through yt-dlp with cookies.
  const cookies = cookieArgs(all, { url: 'https://music.youtube.com/' })
  return {
    db: getDB(), quality: all.online_quality === 'saver' ? 'saver' : 'best',
    // Settings -> Playback -> Music Video Quality.
    videoHeight: [1080, 720, 480].includes(Number(all.video_quality)) ? Number(all.video_quality) : 1080,
    ytdlp: findYtDlp(), cookieArgs: cookies.args, cookieBrowser: cookies.usedBrowser,
  }
}

/** Plain YouTube search through yt-dlp, for when YouTube Music can't be reached. */
async function youtubeFallback(query) {
  const ytdlp = findYtDlp()
  if (!ytdlp) throw new Error('YouTube Music could not be reached, and yt-dlp is not installed.')
  const found = await runJsonSearch(ytdlp, String(query || ''), mapSearchResult, 1, 10)
  return (found.results || []).map(r => ({
    videoId: r.id, title: r.title, artist: r.channel, artists: [r.channel], album: null,
    duration: r.duration || null, thumbnail: r.thumbnail, kind: r.topic ? 'song' : 'video', official: !!r.official, url: r.url,
  }))
}

/** Songs for `query` on a provider ('yt' YouTube Music, 'sc' SoundCloud). */
async function search(query, provider = 'yt') {
  try {
    const auth = provider === 'yt' && accountSession ? await accountSession.credentials() : {}
    return await sources.search(sources.providerOf(provider) ? provider : 'yt', query, { db: getDB(), ytdlp: findYtDlp(), fetchImpl: auth.fetchImpl, fallbackSearch: youtubeFallback })
  } catch (e) {
    return { error: e.message, results: [] }
  }
}

/** Built-in sources, then the user's enabled addons that can search and stream. */
function providers() {
  return [
    { id: 'yt', label: 'YouTube Music' },
    { id: 'sc', label: 'SoundCloud' },
    ...sources.addons.searchable(getDB()).map(a => ({ id: a.provider, label: a.name, icon: a.icon, addon: true, package: a.kind === 'spotiflac', filters: a.searchFilters, album: a.resources.includes('album'), artist: a.resources.includes('artist') })),
  ]
}

/** IPC: online:search, online:save (keep as ghost tracks), online:prepare (resolve a stream ahead of time, or get why it fails). */
function registerOnlineHandlers(ipcMain) {
  accountSession ||= require('../online/youtubeSession').createYouTubeSession({ getSettings: settings, saveSettings: values => {
    const stmt = getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    getDB().transaction(() => { for (const [key, value] of Object.entries(values)) stmt.run(key, String(value)) })()
  } })
  const accountRequest = async work => { const auth = await accountSession.credentials(); return work(auth) }
  sources.pruneOnlineTracks(getDB())
  // Streamed songs' genres (see genres.js): those already played, once the app has settled.
  setTimeout(() => genres.backfillOnlineGenres(getDB()), 20000).unref?.()
  ipcMain.handle('online:search', (_, query, provider) => search(query, provider))
  ipcMain.handle('online:save', (_, items) => {
    try {
      const rows = sources.saveOnlineTracks(getDB(), items)
      genres.fillOnlineGenres(getDB(), rows)
      return rows
    } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('online:genre', (_, trackId) => genres.trackGenre(getDB(), trackId).catch(() => null))
  // The sources the search page can switch between: built-in ones, then addons.
  ipcMain.handle('online:providers', () => providers())
  // A misspelt search ("micheal jackson"): the library's spelling, else YouTube Music's.
  ipcMain.handle('online:spelling', (_, query) => spelling(getDB(), query))
  ipcMain.handle('online:artwork', (_, items) => discoveryArtwork(items))
  ipcMain.handle('online:signIn', (event, options) => accountSession.signIn({ mode: options?.mode || 'embedded', onProgress: status => { if (!event.sender.isDestroyed()) event.sender.send('online:signInStatus', status) } }))
  ipcMain.handle('online:cancelSignIn', () => accountSession.cancelSignIn())
  ipcMain.handle('online:disconnect', () => accountSession.disconnect())
  ipcMain.handle('online:catalogue', (_, options) => accountRequest(({ cookies, fetchImpl }) => youtube.fetchCatalogue(options, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  ipcMain.handle('online:account', (_, force = false) => accountRequest(auth => youtube.fetchAccountData({ ...auth, force: !!force })).catch(e => ({ error: e.message, authenticated: false })))
  ipcMain.handle('online:accountPlaylist', (_, playlistId) => accountRequest(({ cookies, fetchImpl }) => youtube.fetchAccountPlaylist(playlistId, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  ipcMain.handle('online:radio', (_, videoId) => accountRequest(auth => youtube.fetchRadio(videoId, auth)).catch(() => []))
  ipcMain.handle('online:setAccountLiked', (_, videoId, liked) => accountRequest(({ cookies, fetchImpl }) => youtube.setAccountLiked(videoId, liked, cookies, fetchImpl)).catch(e => ({ error: e.message })))
  // Direct audio link of an addon track, for "Save to library" (the downloader fetches it).
  ipcMain.handle('online:downloadUrl', async (_, provider, id) => {
    const key = sources.addons.keyOfProvider(provider)
    if (key && sources.addons.packageService(getDB()).find(key)) return { package: true, url: `spotiflac://${key}/${encodeURIComponent(id)}` }
    try { return { url: (await sources.resolveStream(provider, id, { ...streamOptions(), force: true })).url } } catch (e) { return { error: e.message } }
  })
  // Addons' manifests are read again now and then (new resources, settings).
  sources.addons.refreshManifests(getDB()).catch(() => {})
  ipcMain.handle('addons:list', () => { sources.addons.refreshManifests(getDB()).catch(() => {}); return sources.addons.list(getDB()) })
  // An addon's album and artist pages (when its manifest offers them).
  ipcMain.handle('online:addonAlbum', async (_, provider, id) => {
    const key = sources.addons.keyOfProvider(provider)
    if (!key) return { error: 'Not an addon.' }
    try { return await sources.addons.album(getDB(), key, id) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('online:addonArtist', async (_, provider, id) => {
    const key = sources.addons.keyOfProvider(provider)
    if (!key) return { error: 'Not an addon.' }
    try { return await sources.addons.artist(getDB(), key, id) } catch (e) { return { error: e.message } }
  })
  ipcMain.handle('addons:install', async (_, url) => {
    try { return await sources.addons.install(getDB(), url) } catch (e) { return { error: e.message } }
  })
  const addonRequest = async work => { try { return await work() } catch (e) { return { error: e.message } } }
  ipcMain.handle('addons:remove', (_, key) => addonRequest(() => sources.addons.remove(getDB(), key)))
  ipcMain.handle('addons:setEnabled', (_, key, enabled) => addonRequest(() => sources.addons.setEnabled(getDB(), key, enabled)))
  ipcMain.handle('addons:setSettings', (_, key, values) => addonRequest(() => sources.addons.setSettings(getDB(), key, values)))
  ipcMain.handle('addons:packages', (event, request) => {
    if (event.senderFrame !== event.sender.mainFrame) return { error: 'Addon management requires the main application frame' }
    return addonRequest(() => require('../spotiflac/api').dispatch(getDB(), request))
  })
  const musicVideoProgress = (event, trackId) => update => {
    try { if (!event.sender.isDestroyed()) event.sender.send('musicVideo:progress', { trackId, ...update }) } catch {}
  }
  ipcMain.handle('musicVideo:find', (event, trackId) => musicVideoFor(trackId, {
    onProgress: musicVideoProgress(event, trackId),
  }).catch(() => null))
  ipcMain.handle('musicVideo:download', (_, trackId) => prepareMusicVideoFor(trackId, { download: true }).catch(e => ({ error: e.message })))
  ipcMain.handle('musicVideo:prepare', (_, trackId) => prepareMusicVideoFor(trackId).catch(e => ({ error: e.message })))
  ipcMain.handle('musicVideo:deleteDownload', async (_, trackId) => {
    try {
      const video = await musicVideoFor(trackId)
      if (!video) throw new Error('No music video found for this song')
      const manager = require('./downloader').manager()
      for (const job of [...manager.jobs.values()]) {
        if (job.kind !== 'music-video' || job.opts.videoId !== video.videoId) continue
        if (['downloading', 'queued'].includes(job.status)) { await manager.cancel(job.id); await manager.waitFor(job.id) }
      }
      const storage = require('../online/musicVideoDownloads')
      const files = [...manager.jobs.values()].filter(job => job.kind === 'music-video' && job.opts.videoId === video.videoId).flatMap(job => [job.song, ...(job.filepaths || [])]).filter(Boolean)
      const local = musicVideoFile(video, { artist: trackArtist(trackId) })
      if (local) files.push(local)
      for (const height of [1080, 720, 480]) {
        const file = storage.peekCachedVideoFile(video.videoId, { cacheDir: require('../cache').cacheDir('musicVideo'), videoHeight: height, touch: false })
        if (file) files.push(file)
      }
      storage.deleteVideoFiles(getDB(), video.videoId, { files })
      for (const job of manager.jobs.values()) {
        if (job.kind === 'music-video' && job.opts.videoId === video.videoId) manager.update(job, { song: null, filepaths: [], removed: true, message: 'Downloaded video deleted' }, { persist: true, force: true })
      }
      return { success: true }
    } catch (error) { return { error: error.message } }
  })
  ipcMain.handle('musicVideo:migrationStatus', () => require('../online/musicVideoDownloads').migrationStatus({ cacheDir: require('../cache').cacheDir('musicVideo') }))
  ipcMain.handle('musicVideo:migrate', () => {
    const rows = listMusicVideos()
    const byId = new Map(rows.map(row => [row.video.videoId, { ...row.video, artist: row.track.artist || row.video.artist, trackId: row.track.id }]))
    try {
      const metadata = JSON.parse(require('fs').readFileSync(musicVideoMetadataFile(), 'utf8'))
      for (const [key, entry] of Object.entries(metadata)) {
        if (!entry?.video?.videoId || byId.has(entry.video.videoId)) continue
        const track = getDB().prepare('SELECT id, artist FROM tracks WHERE id = ?').get(resolveTrackId(getDB(), key.split('|')[1]))
        byId.set(entry.video.videoId, { ...entry.video, ...(track ? { artist: track.artist, trackId: track.id } : {}) })
      }
    } catch {}
    const manager = require('./downloader').manager()
    if ([...manager.jobs.values()].some(job => job.kind === 'music-video' && ['queued', 'downloading'].includes(job.status))) return { error: 'Wait for video downloads to finish before moving older files.' }
    const storage = require('../online/musicVideoDownloads')
    storage.ensureDownloadsTable(getDB())
    return require('../online/musicVideoDownloads').migrateOldVideos({
      cacheDir: require('../cache').cacheDir('musicVideo'),
      videosDir: storage.videosDir(),
      resolve: id => byId.get(id) || [...manager.jobs.values()].find(job => job.kind === 'music-video' && job.opts.videoId === id)?.opts || {},
      onMove: (from, to, video) => {
        const db = getDB()
        storage.updateVideoReferences(db, from, to, video, storage.videosDir())
        const fs = require('fs')
        const metadata = musicVideoMetadataFile()
        if (fs.existsSync(metadata)) {
          const data = JSON.stringify(storage.replacePath(JSON.parse(fs.readFileSync(metadata, 'utf8')), from, to))
          fs.writeFileSync(`${metadata}.tmp`, data)
          fs.renameSync(`${metadata}.tmp`, metadata)
        }
        for (const job of manager.jobs.values()) {
          if (job.kind !== 'music-video' || job.opts.videoId !== video.videoId) continue
          job.opts = { ...job.opts, durable: true, videosDir: storage.videosDir(), artist: job.opts.artist || video.artist }
          delete job.opts.cacheDir
          if (job.song === from) job.song = to
          job.filepaths = (job.filepaths || []).map(file => file === from ? to : file)
          manager.persist(job)
          manager.emit(job, true)
        }
      },
    })
  })
  ipcMain.handle('musicVideo:list', () => listMusicVideos())
  ipcMain.handle('musicVideo:save', async (_, trackId, saved = true) => {
    try {
      trackId = resolveTrackId(getDB(), trackId)
      const video = await musicVideoFor(trackId)
      if (!video) throw new Error('No music video found for this song')
      ensureVideoLibrary()
      if (saved) getDB().prepare('INSERT OR REPLACE INTO saved_music_videos (track_id, added_at, video_json) VALUES (?, ?, ?)').run(trackId, Date.now(), JSON.stringify(video))
      else getDB().prepare('DELETE FROM saved_music_videos WHERE track_id = ?').run(trackId)
      return { saved: !!saved }
    } catch (e) { return { error: e.message } }
  })
  // Settings -> Library -> Maintenance: find every library song's music video
  // now, so they open at once later. One song at a time; cancellable.
  let videoIndexJob = null
  ipcMain.handle('musicVideo:indexAll', async (event) => {
    if (videoIndexJob) return { running: true }
    const job = { cancelled: false }
    videoIndexJob = job
    const send = (payload) => { try { if (!event.sender.isDestroyed()) event.sender.send('musicVideo:indexProgress', payload) } catch {} }
    try {
      const rows = getDB().prepare("SELECT id, title, artist, duration FROM tracks WHERE title IS NOT NULL AND artist IS NOT NULL AND duration > 30 AND file_path NOT LIKE 'ghost://%' ORDER BY artist, title").all()
      let done = 0
      let found = 0
      for (const row of rows) {
        if (job.cancelled) break
        send({ running: true, done, total: rows.length, found, title: `${row.artist} — ${row.title}` })
        const video = await prepareMusicVideoFor(row.id, { wait: true }).catch(() => null)
        if (video) found++
        done++
      }
      send({ running: false, done, total: rows.length, found, cancelled: job.cancelled })
      return { done, total: rows.length, found, cancelled: job.cancelled }
    } finally { videoIndexJob = null }
  })
  ipcMain.handle('musicVideo:cancelIndex', () => { if (videoIndexJob) videoIndexJob.cancelled = true })
  ipcMain.handle('online:prepare', async (_, provider, id, force = false) => {
    try {
      const key = sources.addons.keyOfProvider(provider)
      if (key && sources.addons.packageService(getDB()).find(key)) return require('../spotiflac/media').prepare(getDB(), key, id, { force: !!force })
      if (provider === 'yt') await accountSession.credentials()
      const stream = await sources.resolveStream(provider, id, { ...streamOptions(), force: !!force })
      return { ok: true, preview: !!stream.preview }
    } catch (e) { return { error: e.message } }
  })
}

/** Where ffmpeg reads a YouTube video's audio from; a retry gets a fresh URL in another format. */
async function youtubeAudio(videoId, attempt = 0) {
  const stream = await youtube.resolveStream(videoId, { ...streamOptions(), quality: attempt ? 'saver' : 'analysis', force: attempt > 0 })
  return { input: stream.url, headers: stream.headers }
}

/** Where ffmpeg reads a track's own audio from, for the music video check. */
function resolvedSourceAudio(provider, id, { resolve = sources.resolveStream, options = streamOptions() } = {}) {
  return async attempt => {
    const stream = await resolve(provider, id, { ...options, force: attempt > 0 })
    return { input: stream.file || stream.url, headers: stream.headers }
  }
}

function songAudioFor(track, canStream, options = {}) {
  const file = String(track?.file_path || '')
  const ref = sources.streamRef(track)
  if (ref && (ref.provider !== 'yt' || canStream)) {
    if (ref.provider === 'yt') return attempt => youtubeAudio(ref.id, attempt)
    // SoundCloud and addon streams are resolved by the shared source layer so
    // the music-video matcher receives the same fresh URL as playback.
    return resolvedSourceAudio(ref.provider, ref.id, options)
  }
  if (file && !file.startsWith('ghost://') && require('fs').existsSync(file)) return async () => ({ input: file, headers: {} })
  return null
}

/** The official music video for a track (see online/musicVideo.js), or null. */
async function musicVideoFor(trackId, { onProgress } = {}) {
  trackId = resolveTrackId(getDB(), trackId)
  const track = getDB().prepare('SELECT id, title, artist, duration, file_path FROM tracks WHERE id = ?').get(trackId)
  if (!track) return null
  const cacheFile = musicVideoMetadataFile()
  const matcher = require('../online/musicVideo')
  ensureVideoLibrary()
  const known = matcher.knownMusicVideos([track], { cacheFile, findFile: musicVideoFile, resolveTrackId: id => resolveTrackId(getDB(), id) })[0]?.video
  if (known) return { ...known, trackId }
  for (const row of getDB().prepare('SELECT video_json FROM downloaded_music_videos').all()) {
    try { const video = JSON.parse(row.video_json); if (resolveTrackId(getDB(), video.trackId) === trackId && (video.motion === 'verified' || musicVideoFile(video, track))) return { ...video, trackId } } catch {}
  }
  try {
    const saved = JSON.parse(getDB().prepare('SELECT video_json FROM saved_music_videos WHERE track_id = ?').get(trackId)?.video_json || 'null')
    if (/^[\w-]{11}$/.test(String(saved?.videoId || '')) && (saved.motion === 'verified' || musicVideoFile(saved, track))) return { ...saved, trackId }
  } catch {}
  if (accountSession) await accountSession.credentials().catch(() => {})
  const { findFfmpeg } = require('./tools')
  const options = streamOptions()
  const canStream = !!options.ytdlp
  const video = await matcher.findMusicVideo(track, {
    ffmpeg: findFfmpeg(),
    onProgress,
    songAudio: songAudioFor(track, canStream),
    videoAudio: canStream ? youtubeAudio : null,
    visualMotion: item => matcher.validateVisualMotion(findFfmpeg(), async () => {
      const storage = require('../online/musicVideoDownloads')
      const file = storage.recordedVideoFile(getDB(), item.videoId, options.videoHeight) || storage.peekCachedVideoFile(item.videoId, { cacheDir: require('../cache').cacheDir('musicVideo'), videoHeight: options.videoHeight, touch: false })
      if (file) return { input: file, headers: {} }
      if (!canStream) return null
      const media = await youtube.resolveStream(item.videoId, { ...options, quality: 'video' })
      return { input: media.url, headers: media.headers }
    }, item.duration || track.duration),
    youtubeSearch: canStream ? query => runJsonSearch(options.ytdlp, query, entry => ({
      ...entry,
      id: entry.id,
      videoId: entry.id,
      artist: entry.channel || entry.uploader || '',
      artists: [entry.channel || entry.uploader || ''].filter(Boolean),
      kind: 'video',
      official: /(?:official\s+(?:music\s+)?video|VEVO$)/i.test(`${entry.title || ''} ${entry.channel || entry.uploader || ''}`),
      url: `https://www.youtube.com/watch?v=${entry.id}`,
    }), 1, 10, undefined, { timeoutMs: 15000 }) : null,
    cacheFile,
  })
  return video ? { ...video, trackId } : video
}

function musicVideoMetadataFile() {
  return require('path').join(require('electron').app.getPath('userData'), 'music-videos.json')
}

function ensureVideoLibrary() {
  getDB().exec('CREATE TABLE IF NOT EXISTS saved_music_videos (track_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL, video_json TEXT NOT NULL)')
  require('../online/musicVideoDownloads').ensureDownloadsTable(getDB())
}

function musicVideoFile(video, track = {}) {
  const storage = require('../online/musicVideoDownloads')
  const height = storage.heightOf(settings().video_quality)
  const recorded = storage.recordedVideoFile(getDB(), video.videoId, height)
  if (recorded) return recorded
  for (const videoHeight of new Set([height, 1080, 720, 480])) {
    for (const artist of new Set([track.artist, video.artist].filter(Boolean))) {
      const file = storage.peekDurableVideoFile(video.videoId, { artist, videoHeight })
      if (file) return file
    }
    const legacy = storage.peekCachedVideoFile(video.videoId, { cacheDir: require('../cache').cacheDir('musicVideo'), videoHeight, touch: false })
    if (legacy) return legacy
  }
  return null
}

function listMusicVideos() {
  ensureVideoLibrary()
  const tracks = getDB().prepare('SELECT * FROM tracks ORDER BY artist, title').all()
  const saved = new Map(getDB().prepare('SELECT track_id, video_json FROM saved_music_videos').all().map(row => [row.track_id, row.video_json]))
  const known = new Map(require('../online/musicVideo').knownMusicVideos(tracks, { cacheFile: musicVideoMetadataFile(), findFile: musicVideoFile, resolveTrackId: id => resolveTrackId(getDB(), id) }).map(item => [item.track.id, item]))
  for (const row of getDB().prepare('SELECT video_json FROM downloaded_music_videos').all()) {
    try {
      const video = JSON.parse(row.video_json)
      const track = tracks.find(track => track.id === resolveTrackId(getDB(), video.trackId))
      if (track && !known.has(track.id)) known.set(track.id, { track, video })
    } catch {}
  }
  // Saved videos keep their metadata even when discovery expires or the file
  // is evicted. Disk-cache membership isn't library membership.
  for (const track of tracks) {
    if (known.has(track.id) || !saved.has(track.id)) continue
    try {
      const video = JSON.parse(saved.get(track.id))
      if (/^[\w-]{11}$/.test(String(video?.videoId || ''))) known.set(track.id, { track, video })
    } catch {}
  }
  return [...known.values()].sort((a, b) => String(a.track.artist || '').localeCompare(String(b.track.artist || '')) || String(a.track.title || '').localeCompare(String(b.track.title || ''))).map(({ track, video }) => {
    const file = musicVideoFile(video, track)
    return {
      track, video: { ...video, file, thumbnail: `https://i.ytimg.com/vi/${video.videoId}/mqdefault.jpg` },
      saved: saved.has(track.id), downloaded: !!file,
    }
  })
}

async function prepareMusicVideoFor(trackId, { wait = false, download = false } = {}) {
  trackId = resolveTrackId(getDB(), trackId)
  const video = await musicVideoFor(trackId)
  if (!video) return null
  const { peekDurableVideoFile, recordedVideoFile, heightOf } = require('../online/musicVideoDownloads')
  const options = { videoHeight: heightOf(settings().video_quality), artist: trackArtist(trackId) || video.artist, title: video.title, trackId }
  const file = musicVideoFile(video, { artist: options.artist })
  const durable = recordedVideoFile(getDB(), video.videoId, options.videoHeight) || peekDurableVideoFile(video.videoId, options)
  if (durable || (file && !download)) return { ...video, file: durable || file }
  if (!download) {
    const manager = require('./downloader').manager()
    const active = [...manager.jobs.values()].find(job => job.kind === 'music-video' && job.opts.videoId === video.videoId && ['queued', 'downloading'].includes(job.status))
    return { ...video, file: null, ...(active ? { downloadId: active.id } : { needsDownload: true }) }
  }
  const { queueMusicVideo, waitForDownload } = require('./downloader')
  const queued = queueMusicVideo(video, options)
  if (queued.error) throw new Error(queued.error)
  if (!wait) return { ...video, downloadId: queued.downloadId }
  const job = await waitForDownload(queued.downloadId)
  const downloaded = peekDurableVideoFile(video.videoId, options)
  if (!downloaded || job?.status !== 'done') throw new Error(job?.error || 'Could not download the music video')
  return { ...video, file: downloaded }
}

function trackArtist(trackId) {
  trackId = resolveTrackId(getDB(), trackId)
  try { return getDB().prepare('SELECT artist FROM tracks WHERE id = ?').get(trackId)?.artist } catch { return null }
}

/** Must run before the app is ready: lets <audio> stream (and seek) from lokal-stream://. */
function registerStreamScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

/** lokal-stream://<provider>/<id>: a song's audio (YouTube, SoundCloud), with Range support for seeking. */
function registerStreamProtocol(protocol, net) {
  protocol.handle(SCHEME, async (request) => {
    let provider = ''
    let id = ''
    try {
      const url = new URL(request.url)
      provider = url.hostname
      id = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {}
    try {
      if (provider === 'yt' && accountSession) await accountSession.credentials()
      // Electron doesn't fire request.signal when the player drops a stream
      // (next song, seek); it cancels the response body. The request to the
      // media server must be aborted then, or its connection stays open: after
      // six (Chromium's limit per server) every new stream from that server
      // waits forever, and songs stop playing until Lokal restarts.
      const upstream = new AbortController()
      request.signal?.addEventListener?.('abort', () => upstream.abort(), { once: true })
      const fetchImpl = (u, init) => net.fetch(u, init)
      const range = request.headers.get('Range')
      // ytv: a music video's picture (musicVideo.js).
      const { res, mime } = provider === 'ytv'
        ? await youtube.fetchStream(id, { ...streamOptions(), quality: 'video', range, signal: upstream.signal, fetchImpl })
        : await sources.fetchStream(provider, id, { ...streamOptions(), range, signal: upstream.signal, fetchImpl })
      const headers = new Headers()
      for (const name of PASS_HEADERS) { const v = res.headers.get(name); if (v) headers.set(name, v) }
      if (!headers.has('content-type')) headers.set('content-type', mime)
      return new Response(sources.cancellableBody(res.body, () => upstream.abort()), { status: res.status, headers })
    } catch (e) {
      return new Response(String(e.message || e), { status: 502, headers: { 'content-type': 'text/plain' } })
    }
  })
}

module.exports = { registerOnlineHandlers, registerStreamScheme, registerStreamProtocol, search, streamOptions, providers, songAudioFor, resolvedSourceAudio, listMusicVideos, prepareMusicVideoFor }
