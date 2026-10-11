// An artist's releases with their exact dates, for Home → Releases. YouTube
// Music's artist page only gives a year, so Deezer's public catalogue (no
// account; already used for artwork and artist details) is asked first, and
// YouTube Music answers when Deezer doesn't know the artist.

const plain = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const TYPES = { album: 'album', single: 'single', ep: 'ep', compile: 'album' }

async function getJson(url, fetchImpl, timeoutMs = 12000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Deezer answered HTTP ${res.status}`)
    const body = await res.json()
    if (body?.error) throw new Error(body.error.message || 'Deezer error')
    return body
  } finally { clearTimeout(timer) }
}

/** { albums } from Deezer for an artist with exactly this name, or null when it has none. */
async function deezerReleases(artist, fetchImpl = fetch) {
  const wanted = plain(artist)
  if (!wanted) return null
  const found = await getJson(`https://api.deezer.com/search/artist?q=${encodeURIComponent(artist)}&limit=10`, fetchImpl)
  const match = (found?.data || []).filter(item => plain(item.name) === wanted).sort((a, b) => (b.nb_fan || 0) - (a.nb_fan || 0))[0]
  if (!match?.id) return null
  const page = await getJson(`https://api.deezer.com/artist/${match.id}/albums?limit=100`, fetchImpl)
  const albums = (page?.data || []).filter(item => item?.title && /^\d{4}-\d{2}-\d{2}$/.test(String(item.release_date || ''))).map(item => ({
    title: String(item.title),
    artist: match.name,
    release_date: item.release_date,
    year: Number(item.release_date.slice(0, 4)),
    release_type: TYPES[item.record_type] || 'album',
    artwork_url: item.cover_xl || item.cover_big || item.cover_medium || null,
    source: 'deezer',
  }))
  return albums.length ? { albums } : null
}

/** Releases for Home → Releases: Deezer when it knows the artist, else `fallback()` (YouTube Music). */
async function releaseCatalogue(options, fallback, fetchImpl = fetch) {
  try {
    const dated = await deezerReleases(options?.artist, fetchImpl)
    if (dated) return dated
  } catch {}
  return fallback()
}

module.exports = { deezerReleases, releaseCatalogue }
