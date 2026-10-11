const artistKey = value => String(value || '').normalize('NFKC').trim().toLowerCase()
const releaseDate = release => String(release.release_date || release.releaseDate || release.year || '')

export function recentReleases(releases, now = new Date()) {
  const seen = new Set()
  return releases.slice().sort((a, b) => releaseDate(b).localeCompare(releaseDate(a))).filter(release => {
    const date = releaseDate(release)
    const year = Number(date.slice(0, 4))
    if (!release.title || !release.artist || !year || year < now.getFullYear() - 1 || year > now.getFullYear()) return false
    if (date.length > 4 && (!Number.isFinite(Date.parse(date)) || Date.parse(date) > now.getTime())) return false
    const key = `${artistKey(release.artist)}\0${artistKey(release.title)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function loadArtistReleases(artist, client, { timeoutMs = 12000 } = {}) {
  let timer
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => client.discoveryCatalogue({ type: 'releases', artist, source: 'youtube' })),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Artist release lookup timed out.')), timeoutMs) }),
    ])
    if (result?.error) throw new Error(result.error)
    if (!Array.isArray(result?.albums)) throw new Error('Artist release catalogue unavailable.')
    return result.albums
  } finally { clearTimeout(timer) }
}

export async function discoverNewReleases(artists, loadAlbums, { isCurrent = () => true, onItems = () => {}, now = new Date(), startAt = 0 } = {}) {
  const unique = [...new Map(artists.filter(artist => artist?.name).map(artist => [artistKey(artist.name), artist.name])).values()]
  const offset = unique.length ? startAt % unique.length : 0
  const names = [...unique.slice(offset), ...unique.slice(0, offset)].slice(0, 12)
  const groups = new Array(names.length)
  let index = 0
  let failures = 0
  await Promise.all(Array.from({ length: Math.min(3, names.length) }, async () => {
    while (isCurrent() && index < names.length) {
      const at = index++
      try {
        const albums = await loadAlbums(names[at])
        groups[at] = (albums || []).map(album => ({ ...album, artist: album.artist || names[at], seedArtist: names[at] }))
      } catch { failures++; groups[at] = [] }
      if (isCurrent()) onItems(recentReleases(groups.flat().filter(Boolean), now).slice(0, 36))
    }
  }))
  return { items: recentReleases(groups.flat().filter(Boolean), now).slice(0, 36), failures }
}

// ---------------------------------------------------------------- Releases tab

const RELEASES_KEY = 'lokal:releases'
export const RELEASE_LIMIT = 100

/** The last check's releases (Home → Releases), or null. */
export function savedReleases(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(RELEASES_KEY) || 'null')
    return saved && Array.isArray(saved.items) ? saved : null
  } catch { return null }
}

function saveReleases(value, storage = globalThis.localStorage) {
  try { storage?.setItem(RELEASES_KEY, JSON.stringify(value)) } catch {}
}

export const releaseKey = release => `${artistKey(release.artist)}\0${artistKey(release.title)}`

/**
 * The newest releases first, at most `limit`: no year cut-off, only nothing
 * dated in the future. A catalogue lists each artist's releases newest first,
 * so releases with the same date keep that order (`rank`).
 */
export function latestReleases(releases, { now = new Date(), limit = RELEASE_LIMIT } = {}) {
  const seen = new Set()
  return releases
    .filter(release => release?.title && release?.artist && Number(releaseDate(release).slice(0, 4)))
    .filter(release => {
      const date = releaseDate(release)
      if (Number(date.slice(0, 4)) > now.getFullYear()) return false
      return !(date.length > 4 && Number.isFinite(Date.parse(date)) && Date.parse(date) > now.getTime())
    })
    .sort((a, b) => releaseDate(b).localeCompare(releaseDate(a)) || (a.rank ?? 0) - (b.rank ?? 0))
    .filter(release => {
      const key = releaseKey(release)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

/**
 * Check every library artist's catalogue (a few at a time) and keep the
 * newest `limit` releases. Releases not in the previous check are marked
 * `isNew`. Saved for the next visit; `onProgress({ done, total, items })`.
 */
export async function checkReleases(artists, loadAlbums, { isCurrent = () => true, onProgress = () => {}, concurrency = 4, now = new Date(), storage = globalThis.localStorage, previous = savedReleases(storage) } = {}) {
  const names = [...new Map(artists.filter(artist => artist?.name).map(artist => [artistKey(artist.name), artist.name])).values()]
  const known = new Set((previous?.items || []).map(releaseKey))
  const firstCheck = !previous?.items?.length
  const found = []
  let done = 0
  let failures = 0
  let next = 0
  const current = () => latestReleases(found, { now }).map(release => ({ ...release, isNew: !firstCheck && !known.has(releaseKey(release)) }))
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, async () => {
    while (isCurrent() && next < names.length) {
      const name = names[next++]
      try {
        const albums = await loadAlbums(name)
        ;(albums || []).forEach((album, rank) => found.push({ ...album, artist: album.artist || name, seedArtist: name, rank }))
      } catch { failures++ }
      done++
      if (isCurrent()) onProgress({ done, total: names.length, items: current() })
    }
  }))
  const result = { items: current(), checkedAt: now.getTime(), artists: names.length, failures }
  if (isCurrent()) saveReleases(result, storage)
  return result
}
