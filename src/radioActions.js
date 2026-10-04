import { api } from './api.js'
import { streamRef } from './onlineTracks.js'
import { mapLimited, playbackSources, playableRecommendation, recommendationKey, resolveRecommendationTracks, songKey, timed } from './recommendations.js'

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function uniqueTracks(tracks) {
  return (Array.isArray(tracks) ? tracks : [])
    .filter(playableRecommendation)
    .filter((track, index, list) => list.findIndex(item => item.id === track.id || songKey(item) === songKey(track)) === index)
    .slice(0, 50)
}

function artistMatches(artist, result) {
  const wanted = recommendationKey(artist)
  return wanted && [result?.artist, ...(result?.artists || [])]
    .some(name => recommendationKey(name).replace(/ topic$/, '') === wanted)
}

async function searchAndSaveArtistSongs(artists, client) {
  const sources = await playbackSources(client)
  const searches = await mapLimited(artists, async artist => {
    for (const source of sources) {
      try {
        const result = await timed(() => client.onlineSearch(artist, source.id))
        const matches = (Array.isArray(result?.results) ? result.results : [])
          .filter(item => item.title && artistMatches(artist, item))
          .filter(item => item.kind !== 'video' || item.official).slice(0, 2)
        if (!matches.length) continue
        const saved = await timed(() => client.onlineSave(matches.map(item => ({ ...item, provider: source.id }))))
        const tracks = (Array.isArray(saved) ? saved : []).filter(playableRecommendation)
        if (tracks.length) return tracks
      } catch { /* Try the next configured playback provider. */ }
    }
    return []
  })
  return searches.flat()
}

export async function buildRadio(seed, userId, client = api) {
  if (!seed?.artist && !seed?.title) return []
  const mode = seed.type || (!seed.title || normalize(seed.title) === normalize(seed.artist) ? 'artist' : 'track')
  const stream = streamRef(seed)
  let providerSeed = stream ? seed : null

  // A library track has no provider id. Resolve that exact song first so the
  // provider can generate its own radio instead of falling back to local
  // related tracks.
  if (!providerSeed && mode === 'track' && seed.title && seed.artist) {
    const [saved] = await resolveRecommendationTracks([seed], client, { searchLocal: false, reusePlayable: false })
    providerSeed = saved || null
  }

  const provider = streamRef(providerSeed)
  const radio = provider?.provider === 'yt' ? await timed(() => client.youtubeRadio(provider.id)).catch(() => []) : []
  const providerRadio = await resolveRecommendationTracks(Array.isArray(radio) ? radio : [], client)
  const similar = await timed(() => client.lastfmSimilar(seed.artist, mode === 'track' ? seed.title : null, 32)).catch(() => null)
  const similarTracks = mode === 'track' && Array.isArray(similar?.tracks) ? similar.tracks : []
  const similarArtists = mode !== 'track' && Array.isArray(similar?.artists)
    ? similar.artists.map(artist => artist.name).filter(Boolean)
    : []
  const lastfmSongs = similarTracks.length
    ? await resolveRecommendationTracks(similarTracks, client)
    : await searchAndSaveArtistSongs(similarArtists, client)

  // All recommendations here come from YouTube Music radio or Last.fm
  // similar results. The local library is only the optional seed.
  return uniqueTracks([...(seed.id ? [seed] : []), ...providerRadio, ...lastfmSongs])
}

export async function openRadio(navigate, seed, userId) {
  const tracks = await buildRadio(seed, userId)
  if (!tracks.length) return false
  navigate('/radio', {
    state: {
      tracks,
      name: `${seed.title || seed.artist} Radio`,
      seed,
    },
  })
  return true
}
