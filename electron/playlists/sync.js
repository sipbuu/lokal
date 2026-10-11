// A Lokal playlist linked to a playlist on Spotify, Tidal, Apple Music or
// Qobuz (anything a SpotiFLAC addon's link handler reads). Syncing is never
// automatic unless asked for: each sync adds the songs added there since the
// last one, in the library already or as ghost songs the caller then
// downloads from the playback sources. Nothing is removed: a song deleted
// there, or removed here, stays as it is (songs once seen are remembered).

const PLATFORMS = [
  { id: 'spotify', label: 'Spotify', hosts: /(^|\.)spotify\.com$/, addon: 'Spotify Web' },
  { id: 'tidal', label: 'Tidal', hosts: /(^|\.)tidal\.com$/, addon: 'Tidal' },
  { id: 'apple', label: 'Apple Music', hosts: /^music\.apple\.com$/, addon: 'Apple Music' },
  { id: 'qobuz', label: 'Qobuz', hosts: /(^|\.)qobuz\.com$/, addon: 'Qobuz' },
  { id: 'deezer', label: 'Deezer', hosts: /(^|\.)deezer\.com$|^deezer\.page\.link$/, addon: 'Deezer' },
]

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS playlist_sync (playlist_id TEXT PRIMARY KEY, url TEXT NOT NULL, platform TEXT NOT NULL, title TEXT, synced_at INTEGER, seen_json TEXT NOT NULL DEFAULT \'[]\', error TEXT)')
}

function platformOf(raw) {
  let url
  try { url = new URL(String(raw || '').trim()) } catch { return null }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  const platform = PLATFORMS.find(p => p.hosts.test(host))
  return platform && /playlist/i.test(url.pathname) ? { ...platform, url: url.href } : null
}

/** The installed, enabled SpotiFLAC addon whose link handler reads this link. */
function addonFor(packages, url) {
  const host = new URL(url).hostname.toLowerCase()
  return packages.list().filter(addon => addon.enabled).map(addon => packages.find(addon.key)).find(addon => {
    const handler = addon?.manifest?.urlHandler
    return handler?.enabled && (handler.patterns || []).some(pattern => {
      const value = String(pattern).toLowerCase()
      return !value.includes(':') && (host === value || host.endsWith(`.${value}`))
    })
  }) || null
}

function link(db, playlistId, rawUrl) {
  ensure(db)
  const platform = platformOf(rawUrl)
  if (!platform) return { error: 'Paste the link of a playlist on Spotify, Tidal, Apple Music, Qobuz or Deezer.' }
  if (!db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId)) return { error: 'Playlist not found' }
  db.prepare('INSERT OR REPLACE INTO playlist_sync (playlist_id, url, platform, title, synced_at, seen_json, error) VALUES (?, ?, ?, NULL, NULL, \'[]\', NULL)').run(playlistId, platform.url, platform.id)
  return status(db, playlistId)
}

function unlink(db, playlistId) {
  ensure(db)
  db.prepare('DELETE FROM playlist_sync WHERE playlist_id = ?').run(playlistId)
  return { ok: true }
}

function status(db, playlistId) {
  ensure(db)
  const row = db.prepare('SELECT * FROM playlist_sync WHERE playlist_id = ?').get(playlistId)
  if (!row) return { linked: false }
  const platform = PLATFORMS.find(p => p.id === row.platform)
  return { linked: true, url: row.url, platform: row.platform, platformLabel: platform?.label || row.platform, title: row.title, syncedAt: row.synced_at, error: row.error }
}

function linked(db) {
  ensure(db)
  return db.prepare('SELECT playlist_id FROM playlist_sync').all().map(row => row.playlist_id)
}

const plain = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const songKey = (title, artist) => `${plain(title)}\0${plain(String(artist || '').split(/\s*,\s*/)[0])}`

/**
 * Sync one linked playlist. `packages`: the SpotiFLAC PackageService.
 * `helpers`: { findTrack, createGhostTrack } from the playlist IPC.
 * Returns { added, matched, ghosts: [track], total, title }.
 */
async function sync(db, playlistId, { packages, helpers, userId = 'guest' }) {
  ensure(db)
  const row = db.prepare('SELECT * FROM playlist_sync WHERE playlist_id = ?').get(playlistId)
  if (!row) return { error: 'This playlist is not linked to a streaming playlist.' }
  const platform = PLATFORMS.find(p => p.id === row.platform)
  const fail = message => { db.prepare('UPDATE playlist_sync SET error = ? WHERE playlist_id = ?').run(message, playlistId); return { error: message } }
  const addon = addonFor(packages, row.url)
  if (!addon) return fail(`To sync ${platform?.label || 'this'} playlists, install the ${platform?.addon || 'matching'} addon in Settings → Addons.`)
  const runtime = await packages.runtime(addon.key)
  let result
  try { result = await runtime.invoke('handleUrl', [row.url]) } catch (error) { return fail(error.message) }
  if (result?.success === false || result?.error) {
    const message = String(result?.error || 'The addon could not read this playlist.')
    return fail(/VERIFY_REQUIRED/i.test(message) ? `${addon.manifest.displayName} needs verifying first: Settings → Addons → Verify access.` : message)
  }
  const remote = (result?.playlist?.tracks || result?.tracks || []).filter(track => track && (track.name || track.title))
  if (!remote.length) return fail('The playlist is empty, or the addon could not read its songs.')
  const seen = new Set(JSON.parse(row.seen_json || '[]'))
  const existing = new Set(db.prepare('SELECT t.title, t.artist FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id WHERE pt.playlist_id = ?').all(playlistId).map(track => songKey(track.title, track.artist)))
  const insert = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
  let position = Number(db.prepare('SELECT MAX(position) AS m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId)?.m) || 0
  const ghosts = []
  let matched = 0
  for (const track of remote) {
    const artist = Array.isArray(track.artists) ? track.artists.map(a => typeof a === 'string' ? a : a?.name).filter(Boolean).join(', ') : String(track.artists || track.artist || '')
    const title = String(track.name || track.title)
    const key = `${row.platform}:${track.id || songKey(title, artist)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (existing.has(songKey(title, artist))) continue
    existing.add(songKey(title, artist))
    const entry = { title, artist, album: track.album_name || track.album || null, duration: Number(track.duration_ms) > 0 ? Math.round(Number(track.duration_ms) / 1000) : null, isrc: track.isrc || null, year: Number(String(track.release_date || '').slice(0, 4)) || null }
    let found = helpers.findTrack(db, entry)
    if (found) matched++
    else { found = helpers.createGhostTrack(db, entry, row.platform, playlistId); ghosts.push(found) }
    insert.run(playlistId, found.id, ++position, userId, Date.now())
  }
  const title = String(result?.name || result?.playlist?.name || row.title || '').slice(0, 300) || null
  db.prepare('UPDATE playlist_sync SET seen_json = ?, synced_at = ?, title = ?, error = NULL WHERE playlist_id = ?').run(JSON.stringify([...seen]), Date.now(), title, playlistId)
  return { ok: true, added: matched + ghosts.length, matched, ghosts, total: remote.length, title, firstSync: !row.synced_at }
}

module.exports = { PLATFORMS, platformOf, addonFor, link, unlink, status, linked, sync }
