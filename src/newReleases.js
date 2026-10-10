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
