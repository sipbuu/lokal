// Addons: online sources the user adds by pasting a manifest URL, using the
// same HTTP protocol as Eclipse Music addons (eclipsemusic.app/docs), itself
// modelled on Stremio's. Lokal ships none and hosts nothing: it only talks
// to the addons the user installed, like a browser talks to the sites the
// user opens.
//
// Supported (v1): tracks; albums and artists when the manifest lists them.
//   GET <base>/manifest.json      id, name, version, resources, icon, settings
//   GET <base>/search?q=...       { tracks: [{ id, title, artist, artists: [{ id, name }], album, albumId,
//                                   trackNumber, discNumber, year, isrc, duration, artworkURL, format }] }
//   GET <base>/stream/<id>        { url, format, expiresAt, ... }
//   GET <base>/album/<id>         { id, title, artist, artistId, artworkURL, year, releaseType, tracks: [...] }   ("album")
//   GET <base>/artist/<id>        { id, name, artworkURL, albums: [{ id, title, year, releaseType, artworkURL,
//                                   trackCount }], topTracks: [...] }                                          ("artist")
// The manifest is read again now and then (refreshManifests), so an addon
// that gains resources needn't be installed again.
// <base> is the manifest URL without "/manifest.json" (it may carry the
// user's token, e.g. https://addon.example/<token>/manifest.json). The
// addon's settings (declared in its manifest, edited in Settings → Addons)
// are sent as query parameters on every request.
//
// Stored in the settings table as JSON under "addons".

const crypto = require('crypto')
const net = require('net')

const SETTINGS_KEY = 'addons'
const TIMEOUT_MS = { manifest: 10000, search: 10000, stream: 15000, catalogue: 15000 }
const CATALOGUE_TTL_MS = 30 * 60 * 1000
const MANIFEST_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MAX_BYTES = 2 * 1024 * 1024
const SEARCH_TTL_MS = 5 * 60 * 1000
const STREAM_TTL_MS = 20 * 60 * 1000
const ADAPTIVE = /\.(mpd|m3u8)(?:$|[?#])/i

// Lokal says who it is (like BitChord's "BitChord"), so an addon's author can
// allow it; it never pretends to be another app.
let USER_AGENT = 'Lokal'
try { USER_AGENT = `Lokal/${require('../../package.json').version}` } catch {}

const searchCache = new Map() // `${key}\n${query}` -> { at, results }
const catalogueCache = new Map() // `${key}\n${path}` -> { at, value }
const streamCache = new Map() // `${key}\n${id}` -> stream
const resolving = new Map()

/** Short stable key for an addon (from its manifest id), used in track ids and URLs. */
function addonKey(manifestId) {
  return crypto.createHash('sha1').update(String(manifestId)).digest('hex').slice(0, 10)
}

/** The provider id an addon's results carry: "a-<key>". */
function providerFor(key) {
  return `a-${key}`
}

/** "a-<key>" -> "<key>", or null. */
function keyOfProvider(provider) {
  const m = String(provider || '').match(/^a-([0-9a-f]{10})$/)
  return m ? m[1] : null
}

function isLocalHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (net.isIPv4(h)) { const [a, b] = h.split('.').map(Number); return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) }
  return h === '::1'
}

/** An addon URL must be https (plain http only for addons on this machine or network). */
function checkUrl(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { throw new Error('That is not a valid URL.') }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error('Addons must use https:// (plain http is only allowed on this computer or your local network).')
  }
  url.hash = ''
  return url
}

const MAX_REDIRECTS = 5
const REDIRECT = new Set([301, 302, 303, 307, 308])

/**
 * GET `url`, following redirects one by one: each target is resolved against
 * the current URL and checked with checkUrl() before it is requested, so a
 * redirect can't lead to plain http on the internet (or anything else the
 * addon URL itself couldn't be).
 */
async function fetchChecked(url, { fetchImpl = fetch, signal, headers = { Accept: 'application/json' } } = {}) {
  let current = checkUrl(url)
  for (let hop = 0; ; hop++) {
    const res = await fetchImpl(current.toString(), { headers: { 'User-Agent': USER_AGENT, ...headers }, redirect: 'manual', signal })
    if (!REDIRECT.has(res.status)) return res
    const location = res.headers?.get?.('location')
    try { await res.body?.cancel?.() } catch {}
    if (!location) throw new Error(`The addon redirected without saying where (HTTP ${res.status}).`)
    if (hop >= MAX_REDIRECTS) throw new Error('The addon redirected too many times.')
    let next
    try { next = new URL(location, current) } catch { throw new Error('The addon redirected to an invalid URL.') }
    try { current = checkUrl(next.toString()) } catch (e) { throw new Error(`The addon redirected to a URL Lokal won't use: ${e.message}`) }
  }
}

/** GET a JSON document from an addon, with a timeout and a size limit. */
async function getJson(url, { timeoutMs, fetchImpl = fetch } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs || 10000)
  try {
    const res = await fetchChecked(url, { fetchImpl, signal: controller.signal })
    const text = await res.text()
    if (text.length > MAX_BYTES) throw new Error('The addon sent too much data.')
    let json = null
    try { json = JSON.parse(text) } catch {}
    if (!res.ok) {
      // Say that the addon refused, and how: its own words plus the status.
      const said = String(json?.error || json?.message || '').slice(0, 200)
      const why = res.status === 401 || res.status === 403
        ? 'refused the request (its access may be restricted, or the link / token may no longer be valid)'
        : res.status === 429 ? 'is limiting requests right now' : `answered with an error`
      const e = new Error(`The addon ${why}${said ? `: "${said}"` : ''} (HTTP ${res.status}).`)
      e.status = res.status
      throw e
    }
    if (!json || typeof json !== 'object') throw new Error('The addon did not answer with JSON.')
    return json
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The addon took too long to answer.')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------- storage

function readAll(db) {
  try {
    const raw = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY)?.value
    const list = JSON.parse(raw || '[]')
    return Array.isArray(list) ? list.filter(a => a && a.key && a.baseUrl && a.manifest) : []
  } catch { return [] }
}

function writeAll(db, list) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTINGS_KEY, JSON.stringify(list))
  searchCache.clear()
  streamCache.clear()
}

/** Settings values for an addon: its manifest defaults, overridden by the user's. */
function effectiveSettings(addon) {
  const values = {}
  for (const field of Array.isArray(addon.manifest?.settings) ? addon.manifest.settings : []) {
    if (!field?.key) continue
    const v = addon.settings?.[field.key] ?? field.default
    if (v !== undefined && v !== null && v !== '') values[field.key] = String(v)
  }
  return values
}

/** What the UI may see about an addon (no base URL: it can contain the user's token). */
function publicView(addon) {
  const m = addon.manifest
  return {
    key: addon.key,
    provider: providerFor(addon.key),
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description || '',
    icon: /^https:\/\//.test(String(m.icon || '')) ? m.icon : null,
    resources: m.resources,
    settingsSchema: Array.isArray(m.settings) ? m.settings : [],
    settings: effectiveSettings(addon),
    enabled: addon.enabled !== false,
    host: (() => { try { return new URL(addon.baseUrl).host } catch { return '' } })(),
    installedAt: addon.installedAt || null,
  }
}

/** Installed addons, as the UI sees them. */
function list(db) {
  return readAll(db).map(publicView)
}

/** Enabled addons that can search and stream (for the source switch in search). */
function searchable(db) {
  return list(db).filter(a => a.enabled && a.resources.includes('search') && a.resources.includes('stream'))
}

function findByKey(db, key) {
  return readAll(db).find(a => a.key === key) || null
}

/**
 * Install (or update) an addon from its manifest URL.
 * @returns the installed addon (public view)
 */
async function install(db, manifestUrl, { fetchImpl } = {}) {
  const url = checkUrl(manifestUrl)
  if (!/\/manifest\.json$/i.test(url.pathname)) url.pathname = `${url.pathname.replace(/\/+$/, '')}/manifest.json`
  const manifest = await getJson(freshUrl(url), { timeoutMs: TIMEOUT_MS.manifest, fetchImpl })
  return saveManifest(db, url, manifest)
}

/**
 * The manifest URL with a throwaway parameter: a CDN in front of an addon
 * (Cloudflare) can keep serving an old manifest for hours, so a new version
 * (new resources) would go unseen. Only the fetch uses it, never the saved URL.
 */
function freshUrl(url) {
  const fresh = new URL(url.toString())
  fresh.searchParams.set('lokal_fresh', String(Date.now()))
  return fresh.toString()
}

function saveManifest(db, url, manifest) {
  const resources = Array.isArray(manifest.resources) ? manifest.resources.filter(r => typeof r === 'string') : []
  if (!manifest.id || !manifest.name || !manifest.version) throw new Error('This is not an addon manifest (id, name and version are required).')
  if (!resources.includes('search') || !resources.includes('stream')) throw new Error('This addon cannot search and stream tracks, so Lokal cannot use it.')
  const clean = {
    id: String(manifest.id).slice(0, 200),
    name: String(manifest.name).slice(0, 100),
    version: String(manifest.version).slice(0, 40),
    description: String(manifest.description || '').slice(0, 500),
    icon: String(manifest.icon || '').slice(0, 1000),
    resources,
    types: Array.isArray(manifest.types) ? manifest.types.slice(0, 10) : [],
    settings: Array.isArray(manifest.settings) ? manifest.settings.slice(0, 30) : [],
  }
  const key = addonKey(clean.id)
  const baseUrl = url.toString().replace(/\/manifest\.json(?:\?.*)?$/i, '')
  const all = readAll(db)
  const existing = all.find(a => a.key === key)
  const addon = { key, baseUrl, manifest: clean, enabled: existing ? existing.enabled !== false : true, settings: existing?.settings || {}, installedAt: existing?.installedAt || Date.now(), manifestAt: Date.now() }
  // Updating keeps its place among the addons (the playback order lists them).
  writeAll(db, existing ? all.map(a => (a.key === key ? addon : a)) : [...all, addon])
  return publicView(addon)
}

const refreshing = new Set()
/**
 * Read installed addons' manifests again when the copy is older than
 * `maxAgeMs` (new resources, settings, name), keeping the user's settings.
 * Failures are quiet: the saved manifest stays.
 */
async function refreshManifests(db, { fetchImpl, maxAgeMs = MANIFEST_MAX_AGE_MS } = {}) {
  const due = readAll(db).filter(a => !refreshing.has(a.key) && !(Date.now() - (a.manifestAt || 0) < maxAgeMs))
  await Promise.all(due.map(async addon => {
    refreshing.add(addon.key)
    try {
      const url = new URL(`${addon.baseUrl}/manifest.json`)
      const manifest = await getJson(freshUrl(url), { timeoutMs: TIMEOUT_MS.manifest, fetchImpl })
      // The same addon only: a manifest that changed its id is a different one.
      if (addonKey(String(manifest?.id || '').slice(0, 200)) === addon.key) saveManifest(db, url, manifest)
    } catch {} finally { refreshing.delete(addon.key) }
  }))
  return list(db)
}

function remove(db, key) {
  writeAll(db, readAll(db).filter(a => a.key !== key))
  return { ok: true }
}

function setEnabled(db, key, enabled) {
  writeAll(db, readAll(db).map(a => (a.key === key ? { ...a, enabled: !!enabled } : a)))
  return { ok: true }
}

/** Save the user's values for an addon's settings (only keys its manifest declares). */
function setSettings(db, key, values = {}) {
  writeAll(db, readAll(db).map(a => {
    if (a.key !== key) return a
    const allowed = new Set((a.manifest.settings || []).map(f => f?.key).filter(Boolean))
    const next = {}
    for (const [k, v] of Object.entries(values || {})) if (allowed.has(k)) next[k] = typeof v === 'boolean' || typeof v === 'number' ? v : String(v ?? '').slice(0, 500)
    return { ...a, settings: next }
  }))
  return { ok: true }
}

/** <base><path>?<addon settings>&<extra> */
function endpoint(addon, path, extra = {}) {
  const url = new URL(`${addon.baseUrl}${path}`)
  for (const [k, v] of Object.entries(effectiveSettings(addon))) url.searchParams.set(k, v)
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v)
  return url.toString()
}

// ---------------------------------------------------------------- search & stream

/** Seconds from an addon track (duration in s, or durationMs). */
function durationOf(t) {
  if (Number(t.durationMs) > 0) return Math.round(Number(t.durationMs) / 1000)
  const d = Number(t.duration)
  if (!(d > 0)) return null
  return d > 36000 ? Math.round(d / 1000) : Math.round(d) // some send ms in "duration"
}

const idOf = value => (value == null || value === '' ? null : String(value).slice(0, 300))
const positive = value => (Number(value) > 0 ? Math.floor(Number(value)) : null)
const httpsImage = value => (/^https:\/\//.test(String(value || '')) ? String(value).slice(0, 1000) : null)
const RELEASE_TYPES = new Set(['album', 'single', 'ep', 'compilation', 'live'])

/** One addon track, as Lokal's online results carry it. */
function trackOf(t, provider) {
  const name = artist => String(typeof artist === 'object' ? artist?.name || '' : artist || '').slice(0, 500)
  const artistList = Array.isArray(t.artists) ? t.artists.filter(a => name(a)) : []
  const artists = artistList.map(name)
  if (!artists.length && name(t.artist)) artists.push(name(t.artist))
  return {
    provider,
    id: String(t.id).slice(0, 300),
    title: String(t.title).slice(0, 500),
    artist: name(t.artist) || artists.join(', '),
    artists,
    // The addon's ids: its artists (told apart from namesakes) and album.
    artistIds: artistList.length ? artistList.map(a => (typeof a === 'object' ? idOf(a.id) : null)) : [],
    album: t.album ? String(typeof t.album === 'object' ? t.album.title || '' : t.album).slice(0, 500) || null : null,
    albumId: idOf(t.albumId ?? (typeof t.album === 'object' ? t.album?.id : null)),
    track_num: positive(t.trackNumber),
    disc_num: positive(t.discNumber),
    year: positive(t.year),
    isrc: t.isrc ? String(t.isrc).slice(0, 20) : null,
    genre: typeof t.genre === 'string' && t.genre.trim() ? t.genre.trim().slice(0, 100) : null,
    duration: durationOf(t),
    thumbnail: httpsImage(t.artworkURL || t.artwork),
    quality: t.format ? String(t.format).slice(0, 40) : null,
    kind: 'song',
  }
}

/** Tracks from an addon's /search. */
async function search(db, key, query, { fetchImpl, limit = 20 } = {}) {
  const addon = findByKey(db, key)
  if (!addon || addon.enabled === false) throw new Error('This addon is not installed or is turned off.')
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const cacheKey = `${key}\n${q.toLowerCase()}`
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, limit)
  const json = await getJson(endpoint(addon, '/search', { q }), { timeoutMs: TIMEOUT_MS.search, fetchImpl })
  const provider = providerFor(key)
  const results = (Array.isArray(json.tracks) ? json.tracks : [])
    .filter(t => t && t.id != null && t.title)
    .map(t => {
      return trackOf(t, provider)
    })
  if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value)
  searchCache.set(cacheKey, { at: Date.now(), results })
  return results.slice(0, limit)
}

/** A cached catalogue request (/album, /artist) of an addon that declares `resource`. */
async function catalogue(db, key, resource, id, { fetchImpl } = {}) {
  const addon = findByKey(db, key)
  if (!addon || addon.enabled === false) throw new Error('This addon is not installed or is turned off.')
  if (!addon.manifest.resources.includes(resource)) throw new Error(`This addon has no ${resource} pages.`)
  const path = `/${resource}/${encodeURIComponent(String(id || '').slice(0, 300))}`
  const cacheKey = `${key}\n${path}`
  const cached = catalogueCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CATALOGUE_TTL_MS) return cached.value
  const json = await getJson(endpoint(addon, path), { timeoutMs: TIMEOUT_MS.catalogue, fetchImpl })
  if (catalogueCache.size > 100) catalogueCache.delete(catalogueCache.keys().next().value)
  catalogueCache.set(cacheKey, { at: Date.now(), value: json })
  return json
}

/** An album, its tracks in order: { id, title, artist, artistId, artwork_url, year, release_type, tracks }. */
async function album(db, key, id, options = {}) {
  const json = await catalogue(db, key, 'album', id, options)
  const provider = providerFor(key)
  const artwork = httpsImage(json.artworkURL || json.artwork)
  const tracks = (Array.isArray(json.tracks) ? json.tracks : [])
    .filter(t => t && t.id != null && t.title)
    .map(t => {
      const track = trackOf(t, provider)
      return { ...track, album: track.album || String(json.title || '').slice(0, 500), albumId: track.albumId || idOf(json.id), thumbnail: track.thumbnail || artwork }
    })
    .sort((a, b) => (a.disc_num || 1) - (b.disc_num || 1) || (a.track_num || 1e4) - (b.track_num || 1e4))
  return {
    provider, id: idOf(json.id) || String(id), title: String(json.title || '').slice(0, 500), artist: String(json.artist || '').slice(0, 500),
    artistId: idOf(json.artistId), artwork_url: artwork, year: positive(json.year),
    release_type: RELEASE_TYPES.has(json.releaseType) ? json.releaseType : 'album', tracks,
  }
}

/** An artist: { id, name, image, albums: [{ albumId, title, year, release_type, artwork_url, track_count }], tracks }. */
async function artist(db, key, id, options = {}) {
  const json = await catalogue(db, key, 'artist', id, options)
  const provider = providerFor(key)
  const name = String(json.name || '').slice(0, 500)
  return {
    provider, id: idOf(json.id) || String(id), name, image: httpsImage(json.artworkURL || json.artwork),
    albums: (Array.isArray(json.albums) ? json.albums : []).filter(a => a && a.id != null && a.title).slice(0, 300).map(a => ({
      provider, albumId: idOf(a.id), title: String(a.title).slice(0, 500), artist: name, year: positive(a.year),
      release_type: RELEASE_TYPES.has(a.releaseType) ? a.releaseType : 'album', artwork_url: httpsImage(a.artworkURL || a.artwork), track_count: positive(a.trackCount),
    })),
    tracks: (Array.isArray(json.topTracks) ? json.topTracks : []).filter(t => t && t.id != null && t.title).slice(0, 50).map(t => trackOf(t, provider)),
  }
}

const MIME = { flac: 'audio/flac', mp3: 'audio/mpeg', aac: 'audio/aac', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' }

/** The audio URL for an addon track (from its /stream), cached until it expires. */
async function resolveStream(db, key, id, { fetchImpl, force = false } = {}) {
  const addon = findByKey(db, key)
  if (!addon || addon.enabled === false) throw new Error('This addon is not installed or is turned off.')
  const cacheKey = `${key}\n${id}`
  const cached = streamCache.get(cacheKey)
  if (!force && cached && cached.expiresAt > Date.now()) return cached
  if (!force && resolving.has(cacheKey)) return resolving.get(cacheKey)
  const job = getJson(endpoint(addon, `/stream/${encodeURIComponent(id)}`), { timeoutMs: TIMEOUT_MS.stream, fetchImpl })
    .then(json => {
      let url
      try { url = checkUrl(json.url).toString() } catch { throw new Error('The addon gave no playable link for this track.') }
      if (ADAPTIVE.test(url) || json.manifest) throw new Error('This addon streams in a format Lokal cannot play yet (DASH/HLS).')
      const format = String(json.format || '').toLowerCase()
      const expires = Number(json.expiresAt) > 0 ? Number(json.expiresAt) * (Number(json.expiresAt) < 1e12 ? 1000 : 1) - 60000 : Date.now() + STREAM_TTL_MS
      const stream = { url, headers: {}, mime: MIME[format] || 'audio/*', expiresAt: Math.max(Date.now() + 30000, expires), format: format || null, quality: json.quality || null }
      if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
      streamCache.set(cacheKey, stream)
      return stream
    })
    .finally(() => resolving.delete(cacheKey))
  resolving.set(cacheKey, job)
  return job
}

module.exports = {
  addonKey, providerFor, keyOfProvider, checkUrl, getJson, fetchChecked,
  list: db => [...list(db), ...(optionalPackages(db)?.list() || [])],
  searchable: db => [...searchable(db), ...(optionalPackages(db)?.list() || []).filter(a => a.enabled && !a.linksOnly && a.resources.includes('search'))],
  install: (db, url, options) => /\.(sflx|spotiflac-ext)(?:[?#]|$)/i.test(String(url)) ? packageService(db).install({ url }) : install(db, url, options),
  remove: (db, key) => optionalPackages(db)?.find(key) ? packageService(db).remove(key) : remove(db, key),
  setEnabled: (db, key, enabled) => optionalPackages(db)?.find(key) ? packageService(db).setEnabled(key, enabled) : setEnabled(db, key, enabled),
  setSettings: (db, key, values) => optionalPackages(db)?.find(key) ? packageService(db).setSettings(key, values) : setSettings(db, key, values),
  refreshManifests,
  search: (db, key, query, options) => optionalPackages(db)?.find(key) ? packageService(db).search(key, query, options) : search(db, key, query, options),
  resolveStream: (db, key, id, options) => optionalPackages(db)?.find(key) ? require('../spotiflac/media').resolve(db, key, id, options) : resolveStream(db, key, id, options),
  findByKey: (db, key) => findByKey(db, key) || optionalPackages(db)?.find(key),
  album: (db, key, id, options) => optionalPackages(db)?.find(key) ? packageService(db).album(key, id) : album(db, key, id, options),
  artist: (db, key, id, options) => optionalPackages(db)?.find(key) ? packageService(db).artist(key, id) : artist(db, key, id, options),
  trackOf, packageService,
}

function packageService(db) { return require('../spotiflac/packages').service(db) }
function optionalPackages(db) { return typeof db?.exec === 'function' ? packageService(db) : null }
