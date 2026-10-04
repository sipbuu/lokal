import { api } from './api.js'
import { DEFAULT_PLAYBACK_SOURCES, orderedPlaybackSources } from './playbackSources.js'
import { isPlayable } from './onlineTracks.js'

export const recommendationKey = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
export const songKey = track => `${recommendationKey(track?.artist)}\0${recommendationKey(track?.title)}`
export const sourceName = source => source === 'youtube' ? 'YouTube Music' : 'Last.fm'

export async function mapLimited(items, callback, concurrency = 4) {
  const out = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) { const at = index++; out[at] = await callback(items[at], at) }
  }))
  return out
}

export function uniqueSongs(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).filter(track => {
    if (!track?.title || !track?.artist) return false
    const key = songKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const titleKey = title => recommendationKey(String(title || '').replace(/\s*[([](?:official (?:audio|video)|lyrics?|audio)[)\]]/gi, ''))

export function recommendationMatch(candidate, results) {
  const title = titleKey(candidate?.title)
  const artist = recommendationKey(candidate?.artist)
  if (!title || !artist) return null
  // Require both title and artist. A catalogue search is playback resolution,
  // not a second recommendation engine. Covers/remixes must not replace songs.
  return (Array.isArray(results) ? results : []).find(result => {
    if (titleKey(result?.title) !== title) return false
    const artists = Array.isArray(result.artists) ? result.artists : [result.artist]
    return artists.some(name => recommendationKey(name).replace(/ topic$/, '') === artist)
      || recommendationKey(result.artist).replace(/ topic$/, '') === artist
  }) || null
}

export async function timed(work, ms = 15000) {
  let timer
  try {
    return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Provider lookup timed out')), ms) })])
  } finally { clearTimeout(timer) }
}

export async function playbackSources(client = api, timeoutMs = 15000) {
  const [settings, available] = await Promise.all([
    timed(() => client.getSettings(), timeoutMs).catch(() => ({})),
    timed(() => client.onlineProviders(), timeoutMs).catch(() => DEFAULT_PLAYBACK_SOURCES),
  ])
  return orderedPlaybackSources(settings?.playback_search_order, Array.isArray(available) && available.length ? available : DEFAULT_PLAYBACK_SOURCES)
}

export const playableRecommendation = track => !!(track?.id && track.file_path && isPlayable(track))

export async function resolveRecommendationTracks(candidates, client = api, { searchLocal = true, reusePlayable = true, isCurrent = () => true, timeoutMs = 15000 } = {}) {
  if (!Array.isArray(candidates) || !candidates.length || !isCurrent()) return []
  const sources = await playbackSources(client, timeoutMs)
  return (await mapLimited(uniqueSongs(candidates), async candidate => {
    if (!isCurrent()) return null
    if (reusePlayable && playableRecommendation(candidate)) return candidate
    try {
      const local = searchLocal ? await timed(() => client.searchTracks(candidate.title), timeoutMs).catch(() => null) : null
      const rows = Array.isArray(local) ? local : Array.isArray(local?.tracks) ? local.tracks : []
      // Imported ghosts and previously cached streams must not override a newly
      // configured provider order. Only a real library file takes precedence.
      let row = rows.find(track => playableRecommendation(track) && !track.file_path.startsWith('ghost://') && songKey(track) === songKey(candidate))
      if (!row) {
        for (const source of sources) {
          if (!isCurrent()) return null
          try {
            const direct = source.id === 'yt' && candidate.videoId
            const response = direct ? null : await timed(() => client.onlineSearch(`${candidate.artist} ${candidate.title}`, source.id), timeoutMs)
            const match = direct ? { ...candidate, provider: 'yt', id: candidate.videoId } : recommendationMatch(candidate, response?.results)
            if (!match || !isCurrent()) continue
            const saved = await timed(() => client.onlineSave([{ ...match, provider: source.id }]), timeoutMs)
            // saveOnlineTracks preserves order, including nulls, for all
            // providers (addon row IDs are hashed by the backend).
            row = Array.isArray(saved) && playableRecommendation(saved[0]) ? saved[0] : null
            if (row) break
          } catch { /* A failed provider must allow the next source to try. */ }
        }
      }
      return row && isCurrent() ? {
        ...row, title: candidate.title, artist: candidate.artist,
        album: candidate.album || row.album,
        artwork_url: candidate.artwork_url || row.artwork_url,
        source: candidate.source || 'lastfm', reason: candidate.reason,
        scrobbledAt: candidate.scrobbledAt, scrobbleCount: candidate.scrobbleCount,
      } : null
    } catch { return null }
  })).filter(Boolean)
}

// Build until the requested count, trying additional provider pages and
// skipping failed playback matches. Previous songs are considered only after
// new recommendations; there is no shuffle of the previous eight-song shelf.
export async function buildRecommendationMix({ size, previous = [], loadPage, resolve = resolveRecommendationTracks, isCurrent = () => true }) {
  const target = [24, 32, 40].includes(Number(size)) ? Number(size) : 32
  const previousKeys = new Set(previous.map(songKey))
  const tried = new Set()
  const ids = new Set()
  const tracks = []
  const repeats = []
  async function consume(pool) {
    const candidates = uniqueSongs(pool).filter(track => !tried.has(songKey(track)))
    for (let at = 0; at < candidates.length && tracks.length < target && isCurrent(); at += 8) {
      const batch = candidates.slice(at, at + 8)
      batch.forEach(track => tried.add(songKey(track)))
      const resolved = await resolve(batch)
      if (!isCurrent()) throw new Error('Mix request superseded')
      for (const track of resolved) {
        if (!track?.id || ids.has(track.id) || tracks.length >= target) continue
        ids.add(track.id)
        tracks.push(track)
      }
    }
  }
  for (let page = 0; page < 3 && tracks.length < target && isCurrent(); page++) {
    const data = await loadPage(page)
    if (!isCurrent()) throw new Error('Mix request superseded')
    if (data?.error) throw new Error(data.error)
    const pool = uniqueSongs(data?.candidates)
    repeats.push(...pool.filter(track => previousKeys.has(songKey(track))))
    await consume(pool.filter(track => !previousKeys.has(songKey(track))).slice(0, 120))
  }
  if (tracks.length < target) await consume(repeats)
  if (!isCurrent()) throw new Error('Mix request superseded')
  if (tracks.length !== target) throw new Error(`Found ${tracks.length} playable matches for ${target} requested tracks. Try again when more recommendations are available.`)
  if (previous.length && tracks.every(track => previousKeys.has(songKey(track)))) throw new Error('The provider returned the same songs. Your existing mix has been kept; try again after more listening.')
  return tracks
}

export async function loadRecommendationPage(source, page = 0, client = api) {
  if (source !== 'youtube') return client.lastfmDiscovery(page)
  const account = await client.youtubeAccount(true)
  if (account?.error) return account
  const tracks = uniqueSongs((account?.home || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail })))
  const allPlaylists = account?.homePlaylists || []
  const start = allPlaylists.length ? page * 2 % allPlaylists.length : 0
  const playlists = [...allPlaylists.slice(start), ...allPlaylists.slice(0, start)].slice(0, 2)
  const expanded = await Promise.all(playlists.map(item => client.youtubeAccountPlaylist(item.id).catch(() => null)))
  const candidates = uniqueSongs([...tracks, ...expanded.flatMap(data => data?.tracks || []).map(track => ({ ...track, source: 'youtube', artwork_url: track.thumbnail }))])
  return {
    source: 'youtube', fetchedAt: Date.now(), candidates,
    freshFinds: candidates.slice(0, 30), quickPicks: tracks.slice(0, 12), history: null,
    artists: [...new Map(tracks.flatMap(track => (track.artists || [track.artist]).map(name => ({ name, source: 'youtube' }))).map(artist => [recommendationKey(artist.name), artist])).values()].slice(0, 30),
    albums: [...new Map(tracks.filter(track => track.album).map(track => [`${track.artist}\0${track.album}`, { title: track.album, artist: track.artist, artwork_url: track.thumbnail }])).values()].slice(0, 30),
    warnings: account.homeError ? [account.homeError] : [],
  }
}
