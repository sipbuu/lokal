// Helpers for online songs (YouTube Music, SoundCloud), which live in the
// library as ghost tracks: ghost://youtube/online/<videoId> or
// ghost://soundcloud/online/<trackId>, or any ghost track whose source link is
// a YouTube video or a SoundCloud track (e.g. an imported playlist entry).

import { api } from './api.js'

export const PROVIDER_LABELS = { yt: 'YouTube', sc: 'SoundCloud' }

/** Is `provider` a user-installed addon ("a-<key>")? */
export function isAddonProvider(provider) {
  return /^a-[0-9a-f]{10}$/.test(String(provider || ''))
}

/** Label of a provider: YouTube, SoundCloud, or "Addon". */
export function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || (isAddonProvider(provider) ? 'Addon' : 'the web')
}

/** A placeholder track with no file (imported or online). */
export function isGhostTrack(track) {
  return String(track?.file_path || '').startsWith('ghost://')
}

/** Where a ghost track can be streamed from: { provider: 'yt' | 'sc', id }, or null. */
export function streamRef(track) {
  const path = String(track?.file_path || '')
  const fromAddon = path.match(/^ghost:\/\/addon\/([0-9a-f]{10})\/(.+)$/)
  if (fromAddon) {
    try { return { provider: `a-${fromAddon[1]}`, id: decodeURIComponent(fromAddon[2]) } } catch { return null }
  }
  const own = path.match(/^ghost:\/\/(youtube|soundcloud)\/online\/([\w-]+)$/)
  if (own) return { provider: own[1] === 'youtube' ? 'yt' : 'sc', id: own[2] }
  if (!path.startsWith('ghost://')) return null
  const url = String(track?.source_url || '')
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)
  if (yt) return { provider: 'yt', id: yt[1] }
  const sc = url.match(/api\.soundcloud\.com\/tracks\/(?:soundcloud(?:%3A|:)tracks(?:%3A|:))?(\d+)/i)
  return sc ? { provider: 'sc', id: sc[1] } : null
}

/** Same online song? (a track, or a search result { provider, id }) */
export function sameStream(track, item) {
  const ref = streamRef(track)
  return !!ref && !!item && ref.provider === item.provider && ref.id === String(item.id)
}

/** Streamed rather than played from a file. */
export function isStreamed(track) {
  return !!streamRef(track)
}

/** "YouTube" / "SoundCloud" for a streamed track, else null. */
export function streamLabel(track) {
  const ref = streamRef(track)
  return ref ? providerLabel(ref.provider) : null
}

/**
 * An online song, the same whichever link it's reached by: "yt:<id>",
 * "sc:<id>", "a-<key>:<id>" (a download keeps it as its sourceRef).
 */
export function sourceRefKey(ref) {
  return ref?.provider && ref?.id ? `${ref.provider}:${ref.id}` : null
}

// Where a downloaded song came from (tracks.download_source).
const DOWNLOAD_SOURCE_LABELS = { yt: 'YouTube', sc: 'SoundCloud', soulseek: 'Soulseek', web: 'Web' }
let addonNames = null

/** The installed addons' names ({ 'a-<key>': name }), loaded once. */
export function loadAddonNames() {
  if (!addonNames) {
    addonNames = Promise.resolve(api.onlineProviders?.())
      .then(list => Object.fromEntries((Array.isArray(list) ? list : []).filter(p => isAddonProvider(p?.id)).map(p => [p.id, p.label])))
      .catch(() => ({}))
  }
  return addonNames
}

/** "YouTube", "SoundCloud", an addon's name, "Soulseek", "Web"; null for the music folder's own files. */
export function downloadSourceLabel(source, names = {}) {
  if (!source) return null
  return DOWNLOAD_SOURCE_LABELS[source] || (isAddonProvider(source) ? (names[source] || 'Addon') : null)
}

/** Can the player play it: a file, or a ghost that can be streamed. */
export function isPlayable(track) {
  return !!track && (!isGhostTrack(track) || isStreamed(track))
}

/** Cover to show for a track: its artwork file, or an online song's remote cover. */
export function trackArtURL(track) {
  if (!track) return null
  if (track.artwork_path) return api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)
  return track.artwork_url || null
}

/** Where the player gets the audio: the file, or the stream of an online song; null if neither. */
export function audioSrcFor(track) {
  if (!track?.file_path) return null
  const ref = streamRef(track)
  if (ref) return api.onlineStreamURL(ref.provider, ref.id)
  if (isGhostTrack(track)) return null
  return api.isElectron
    ? `file://${track.file_path.replace(/\\/g, '/').split('/').map(s => encodeURIComponent(s)).join('/').replace(/%3A/g, ':')}`
    : api.streamURL(track)
}

/** The URL the downloader fetches a streamed song from. */
export function downloadUrlFor(track) {
  const ref = streamRef(track)
  if (!ref || isAddonProvider(ref.provider)) return null // addons: resolved when saving
  return ref.provider === 'sc' ? `https://api.soundcloud.com/tracks/${ref.id}` : `https://music.youtube.com/watch?v=${ref.id}`
}

/**
 * Save a streamed song to the library with the usual downloader. Once the
 * file is in, it takes the ghost track's place in playlists, likes and history.
 */
export async function saveToLibrary(track) {
  const ref = streamRef(track)
  let url = downloadUrlFor(track)
  if (ref && isAddonProvider(ref.provider)) {
    // An addon's link is only known once asked for (and may expire): get it now.
    const got = await api.onlineDownloadUrl(ref.provider, ref.id)
    if (!got?.url) return { error: got?.error || 'The addon gave no download link' }
    url = got.url
  }
  if (!url) return { error: 'Not a streamed song' }
  return api.downloadYT(url, {
    title: [track.artist, track.title].filter(Boolean).join(' - ') || undefined,
    thumbnail: track.artwork_url || undefined,
    from: ref && isAddonProvider(ref.provider) ? 'Addon' : 'Streaming',
    replaceTrackId: isGhostTrack(track) ? track.id : undefined,
    // An addon's link expires: the downloader asks the addon for a fresh one
    // each time the job starts (queued, restarted or retried).
    addonSource: ref && isAddonProvider(ref.provider) ? { provider: ref.provider, id: ref.id } : undefined,
    // An addon's file is a bare audio link, without tags: name and tag it
    // from what the addon said (only where the file has nothing).
    tags: ref && isAddonProvider(ref.provider)
      ? { title: track.title || undefined, artist: track.artist || undefined, album: track.album || undefined, cover: /^https:\/\//.test(String(track.artwork_url || '')) ? track.artwork_url : undefined }
      : undefined,
  })
}
