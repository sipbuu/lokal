// Qobuz as an online source (provider "qobuz"), through Qobuz's JSON API with
// the credentials the user enters in Settings → Addons & Plugins → Qobuz:
// an app id + secret, and a user auth token from signing in with their own
// account. Streaming needs a Qobuz subscription; without one, Qobuz only
// returns 30-second samples, which are flagged as previews.
//
// Qobuz specifics:
//  - Every call carries the app id (X-App-Id); account calls also carry the
//    user token (X-User-Auth-Token).
//  - Only track/getFileUrl is signed: md5(
//      "trackgetFileUrl" + sorted "name"+"value" pairs + timestamp + secret ).
//    MD5 is Node's own (crypto), no dependency.
//  - format_id: 5 = MP3 320, 6 = FLAC 16/44.1, 7 = FLAC 24/<=96, 27 = FLAC 24/<=192.
//    A track may not exist in the quality asked for: lower ones are tried.

const crypto = require('crypto')

const BASE = 'https://www.qobuz.com/api.json/0.2/'
const TRACK_ID = /^\d{1,12}$/
const ALBUM_ID = /^[\w-]{1,40}$/
const QUALITIES = [27, 7, 6, 5]
const DEFAULT_QUALITY = 6
const SEARCH_TTL_MS = 10 * 60 * 1000
const STREAM_TTL_MS = 5 * 60 * 1000
const REQUEST_TIMEOUT_MS = 20000
const MIN_GAP_MS = 150 // rate limit: at most ~6 requests a second

const FORMAT_LABELS = { 5: 'MP3 320', 6: 'FLAC 16/44.1', 7: 'FLAC 24/96', 27: 'FLAC 24/192' }

const searchCache = new Map() // key -> { at, results }
const streamCache = new Map() // id:quality -> { ...stream, expiresAt }
const resolving = new Map()   // id:quality -> Promise

const md5 = (text) => crypto.createHash('md5').update(text).digest('hex')

/** Qobuz settings from the settings table: { enabled, appId, appSecret, authToken, quality }. */
function loadConfig(db) {
  let all = {}
  try { all = Object.fromEntries(db.prepare("SELECT key, value FROM settings WHERE key LIKE 'qobuz\\_%' ESCAPE '\\'").all().map(r => [r.key, r.value])) } catch {}
  const quality = Number(all.qobuz_default_quality)
  return {
    enabled: all.qobuz_enabled === 'true',
    appId: String(all.qobuz_app_id || '').trim(),
    appSecret: String(all.qobuz_app_secret || '').trim(),
    authToken: String(all.qobuz_user_auth_token || '').trim(),
    quality: [6, 7, 27].includes(quality) ? quality : DEFAULT_QUALITY,
  }
}

const configured = (config) => !!(config?.appId && config?.appSecret)

/** "2019-03-08" or a unix time -> year, or null. */
function yearOf(album) {
  const fromDate = String(album?.release_date_original || album?.release_date_stream || '').match(/^(\d{4})/)
  if (fromDate) return Number(fromDate[1])
  return Number(album?.released_at) > 0 ? new Date(Number(album.released_at) * 1000).getUTCFullYear() : null
}

/** A Qobuz track (from search, track/get or an album's track list) in the shared online shape. */
function mapTrack(track, album = track?.album) {
  if (!track || !TRACK_ID.test(String(track.id || ''))) return null
  const artist = track.performer?.name || track.artist?.name || album?.artist?.name || ''
  const depth = Number(track.maximum_bit_depth) || 0
  const rate = Number(track.maximum_sampling_rate) || 0
  return {
    provider: 'qobuz',
    id: String(track.id),
    // "Title" + version ("Remastered 2011") like Qobuz shows it.
    title: [track.title, track.version].filter(Boolean).join(' ') || 'Unknown Track',
    artist,
    artists: [artist].filter(Boolean),
    album: album?.title || null,
    duration: Number(track.duration) || null,
    thumbnail: album?.image?.large || album?.image?.small || null,
    kind: 'song',
    year: yearOf(album),
    trackNumber: Number(track.track_number) || null,
    isrc: track.isrc || null,
    source: 'qobuz',
    // Hi-res is above CD quality: 24-bit (Qobuz also lists 44.1 kHz 24-bit).
    hires: depth >= 24,
    quality: depth >= 24 ? 'hi-res' : 'lossless',
    format: depth ? `FLAC ${depth}/${rate || 44.1}` : null,
    // Not streamable on this account's catalogue: kept so the UI can grey it out.
    streamable: track.streamable !== false,
    preview: false,
  }
}

class QobuzClient {
  /** @param config { appId, appSecret, authToken } @param fetchImpl fetch, replaceable for tests */
  constructor(config, { fetchImpl = fetch } = {}) {
    this.appId = config?.appId || ''
    this.appSecret = config?.appSecret || ''
    this.authToken = config?.authToken || ''
    this.fetch = fetchImpl
    this.nextSlot = 0
  }

  /** Space requests MIN_GAP_MS apart (all callers share one queue per client). */
  async throttle() {
    const now = Date.now()
    const slot = Math.max(now, this.nextSlot)
    this.nextSlot = slot + MIN_GAP_MS
    if (slot > now) await new Promise(r => setTimeout(r, slot - now))
  }

  /**
   * request_sig for a signed call: the endpoint without its slash, then the
   * parameters sorted by name as name+value, then the timestamp, then the
   * app secret; all MD5-hashed. (Only track/getFileUrl needs it.)
   */
  sign(endpoint, params, timestamp) {
    const sorted = Object.keys(params).sort().map(key => key + params[key]).join('')
    return md5(endpoint.replace('/', '') + sorted + timestamp + this.appSecret)
  }

  /** GET one endpoint; JSON back. Retries once after a 429. Errors carry Qobuz's own message. */
  async get(endpoint, params = {}, { signed = false, auth = true, attempt = 0 } = {}) {
    if (!this.appId) throw new Error('Qobuz needs an app ID. Add it in Settings.')
    if (signed && !this.appSecret) throw new Error('Qobuz needs an app secret to stream. Add it in Settings.')
    const query = { ...params }
    if (signed) {
      const timestamp = Math.floor(Date.now() / 1000)
      query.request_ts = timestamp
      query.request_sig = this.sign(endpoint, params, timestamp)
    }
    const headers = { 'X-App-Id': this.appId }
    if (auth && this.authToken) headers['X-User-Auth-Token'] = this.authToken
    await this.throttle()
    let res
    try {
      res = await this.fetch(`${BASE}${endpoint}?${new URLSearchParams(query)}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? 'Qobuz took too long to answer.' : `Could not reach Qobuz (${e.message})`)
    }
    if (res.status === 429 && attempt < 1) {
      await new Promise(r => setTimeout(r, Number(res.headers.get('retry-after')) * 1000 || 1500))
      return this.get(endpoint, params, { signed, auth, attempt: attempt + 1 })
    }
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      if (res.status === 400 && /app_id|application/i.test(String(body?.message))) throw new Error('Qobuz refused the app ID.')
      if (res.status === 401 || res.status === 403) throw new Error(body?.message || 'Qobuz refused the request. Check the app secret and sign in again.')
      if (res.status === 404) throw new Error('Not found on Qobuz.')
      throw new Error(String(body?.message || `Qobuz answered ${res.status}.`).slice(0, 200))
    }
    return body
  }

  /** Sign in with the user's email and password; returns { token, name }. The password is never kept. */
  async login(email, password) {
    const body = await this.get('user/login', { email, password }, { auth: false })
    if (!body?.user_auth_token) throw new Error('Qobuz did not give a login token.')
    return { token: body.user_auth_token, name: body.user?.display_name || body.user?.login || email, subscribed: !!body.user?.credential?.parameters?.lossless_streaming }
  }

  /** Songs for `query`, in the shared online shape. Cached ten minutes. */
  async search(query, { limit = 10, offset = 0 } = {}) {
    const q = String(query || '').trim()
    if (q.length < 2) return []
    const key = `${this.appId}|${q.toLowerCase()}|${limit}|${offset}`
    const cached = searchCache.get(key)
    if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results
    const body = await this.get('catalog/search', { query: q, limit: Math.max(1, Math.min(limit, 50)), offset })
    const results = (body?.tracks?.items || []).map(t => mapTrack(t)).filter(r => r && r.streamable)
    if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value)
    searchCache.set(key, { at: Date.now(), results })
    return results
  }

  /** One track's metadata. */
  async getTrack(trackId) {
    if (!TRACK_ID.test(String(trackId))) throw new Error('Not a Qobuz track id')
    return mapTrack(await this.get('track/get', { track_id: trackId }))
  }

  /** An album and its tracks ({ id, title, artist, year, artwork, tracks: [...] }). */
  async getAlbum(albumId) {
    if (!ALBUM_ID.test(String(albumId))) throw new Error('Not a Qobuz album id')
    const album = await this.get('album/get', { album_id: albumId })
    return {
      id: String(album.id), title: album.title || 'Unknown Album', artist: album.artist?.name || '',
      year: yearOf(album), artwork: album.image?.large || null,
      // Tracks inside an album don't repeat the album: hand it down.
      tracks: (album.tracks?.items || []).map(t => mapTrack(t, album)).filter(Boolean),
    }
  }

  /**
   * The direct CDN URL of a track at `quality` (5, 6, 7 or 27), lowering the
   * quality until Qobuz has it. Returns { url, mime, quality, format, preview }.
   */
  async getStreamUrl(trackId, quality = DEFAULT_QUALITY) {
    if (!TRACK_ID.test(String(trackId))) throw new Error('Not a Qobuz track id')
    const wanted = QUALITIES.includes(Number(quality)) ? Number(quality) : DEFAULT_QUALITY
    let lastError
    for (const formatId of QUALITIES.filter(q => q <= wanted)) {
      try {
        const info = await this.get('track/getFileUrl', { format_id: formatId, intent: 'stream', track_id: trackId }, { signed: true })
        if (!info?.url) throw new Error(info?.restrictions?.length ? 'Qobuz does not offer this track to your account.' : 'Qobuz gave no stream for this track.')
        return {
          url: info.url,
          headers: {},
          mime: info.mime_type || (formatId === 5 ? 'audio/mpeg' : 'audio/flac'),
          quality: info.format_id || formatId,
          format: FORMAT_LABELS[info.format_id || formatId] || null,
          // Without a subscription Qobuz only gives a 30-second sample.
          preview: !!info.sample,
        }
      } catch (e) {
        lastError = e
        // Only "this quality isn't there" is worth trying lower for.
        if (!/format|quality|restrict/i.test(e.message)) throw e
      }
    }
    throw lastError || new Error('Qobuz has no stream for this track.')
  }
}

/** Search for the shared sources.js pipeline: config comes from the settings table. */
async function searchTracks(query, { db, limit = 10, fetchImpl } = {}) {
  const config = loadConfig(db)
  if (!config.enabled || !configured(config)) throw new Error('Qobuz is not set up. Add your app ID and secret in Settings.')
  return new QobuzClient(config, { fetchImpl }).search(query, { limit })
}

/** Stream for the shared pipeline ({ url, headers, mime, expiresAt, preview }), cached a few minutes. */
async function resolveStream(id, { db, force = false, fetchImpl } = {}) {
  if (!TRACK_ID.test(String(id || ''))) throw new Error('Not a Qobuz track id')
  const config = loadConfig(db)
  if (!configured(config)) throw new Error('Qobuz is not set up. Add your app ID and secret in Settings.')
  if (!config.authToken) throw new Error('Sign in to Qobuz in Settings to stream.')
  const key = `${id}:${config.quality}`
  const cached = streamCache.get(key)
  if (!force && cached && cached.expiresAt > Date.now()) return cached
  if (!force && resolving.has(key)) return resolving.get(key)
  const job = new QobuzClient(config, { fetchImpl }).getStreamUrl(id, config.quality)
    .then(stream => {
      const entry = { ...stream, expiresAt: Date.now() + STREAM_TTL_MS }
      if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
      streamCache.set(key, entry)
      return entry
    })
    .finally(() => resolving.delete(key))
  resolving.set(key, job)
  return job
}

// ------------------------------------------------------- settings (Settings page)
// Stored in the settings table: qobuz_enabled, qobuz_app_id, qobuz_app_secret,
// qobuz_user_auth_token, qobuz_default_quality (6, 7 or 27) and qobuz_user_name.
// The secret and the token never go back to the page: only whether they're set.

function saveSettings(db, values) {
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  db.transaction(() => { for (const [key, value] of Object.entries(values)) stmt.run(key, String(value)) })()
  streamCache.clear()
  searchCache.clear()
}

/** What the page may know: { enabled, appId, hasSecret, signedIn, userName, quality }. */
function status(db) {
  const config = loadConfig(db)
  let userName = ''
  try { userName = db.prepare("SELECT value FROM settings WHERE key = 'qobuz_user_name'").get()?.value || '' } catch {}
  return { enabled: config.enabled, appId: config.appId, hasSecret: !!config.appSecret, signedIn: !!config.authToken, userName, quality: config.quality }
}

/** Save what the page sends; an empty secret keeps the stored one. */
function saveConfig(db, values = {}) {
  const out = {}
  if ('enabled' in values) out.qobuz_enabled = values.enabled ? 'true' : 'false'
  if ('appId' in values) out.qobuz_app_id = String(values.appId || '').trim().slice(0, 40)
  if (values.appSecret) out.qobuz_app_secret = String(values.appSecret).trim().slice(0, 80)
  if ('quality' in values) out.qobuz_default_quality = [6, 7, 27].includes(Number(values.quality)) ? String(Number(values.quality)) : String(DEFAULT_QUALITY)
  saveSettings(db, out)
  return status(db)
}

/** Sign in with the account's email and password; only the token is kept. */
async function signIn(db, email, password, { fetchImpl } = {}) {
  const config = loadConfig(db)
  if (!config.appId) throw new Error('Add the app ID first.')
  const { token, name } = await new QobuzClient({ appId: config.appId, appSecret: config.appSecret }, { fetchImpl }).login(String(email || '').trim(), String(password || ''))
  saveSettings(db, { qobuz_user_auth_token: token, qobuz_user_name: name })
  return status(db)
}

function signOut(db) {
  saveSettings(db, { qobuz_user_auth_token: '', qobuz_user_name: '' })
  return status(db)
}

/** Does the app id work, and (when signed in) the account and the secret? Returns { ok, message }. */
async function testConnection(db, { fetchImpl } = {}) {
  const config = loadConfig(db)
  if (!config.appId) throw new Error('Add the app ID first.')
  const client = new QobuzClient(config, { fetchImpl })
  const found = await client.search('daft punk', { limit: 1 })
  if (!found.length) throw new Error('Qobuz answered, but found nothing.')
  if (!config.appSecret) return { ok: true, message: 'The app ID works. Add the app secret to stream.' }
  if (!config.authToken) return { ok: true, message: 'The app ID works. Sign in to stream.' }
  // The signed call proves the secret and the login, and shows the quality.
  const stream = await client.getStreamUrl(found[0].id, config.quality)
  return { ok: true, message: `Connected. ${stream.format || 'Streaming'} available${stream.preview ? ', but only 30-second samples: the account has no active subscription' : ''}.` }
}

const trackUrl = (id) => `https://play.qobuz.com/track/${id}`

module.exports = { status, saveConfig, signIn, signOut, testConnection, QobuzClient, loadConfig, configured, mapTrack, searchTracks, resolveStream, trackUrl, TRACK_ID, QUALITIES }
