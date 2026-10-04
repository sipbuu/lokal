// Account shelves shared by Electron and web mode. Recommendation metadata is
// independent of playback resolution: a failed YouTube search must not remove
// an item from the user's Last.fm charts or listening history.
const list = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : []
const nameOf = value => typeof value === 'string' ? value : value?.name || value?.['#text'] || ''
const key = value => String(value || '').normalize('NFKC').trim().toLowerCase()
const songKey = track => `${key(track.artist)}\0${key(track.title)}`

function imageOf(images) {
  const usable = list(images).filter(image => image?.['#text'] && !/2a96cbd8|default_album|noimage/i.test(image['#text']))
  return String((usable.find(image => image.size === 'extralarge') || usable.find(image => image.size === 'large') || usable[0])?.['#text'] || '').replace(/^http:/, 'https:')
}

function trackOf(track) {
  return {
    title: track?.name || track?.title || '', artist: nameOf(track?.artist),
    album: nameOf(track?.album), artwork_url: imageOf(track?.image), url: track?.url || '',
    playcount: Number(track?.playcount) || 0, scrobbledAt: Number(track?.date?.uts) || null,
    source: 'lastfm',
  }
}

function unique(items, identify = songKey) {
  const seen = new Set()
  return items.filter(item => { const id = identify(item); if (seen.has(id)) return false; seen.add(id); return true })
}

function quickPicksFromHistory(history, now = Date.now()) {
  const end = Math.floor(now / 1000)
  const cutoff = end - 7 * 24 * 60 * 60
  const grouped = new Map()
  for (const track of Array.isArray(history) ? history : []) {
    const scrobbledAt = Number(track?.scrobbledAt) || 0
    if (scrobbledAt <= 0 || scrobbledAt < cutoff || scrobbledAt > end || !track?.title || !track?.artist) continue
    const id = songKey(track)
    const current = grouped.get(id)
    if (current) {
      current.scrobbleCount++
      if (scrobbledAt > current.track.scrobbledAt) current.track = track
    } else {
      grouped.set(id, { track, scrobbleCount: 1 })
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.scrobbleCount - a.scrobbleCount || (b.track.scrobbledAt || 0) - (a.track.scrobbledAt || 0))
    .map(({ track, scrobbleCount }) => ({ ...track, scrobbleCount, reason: 'Scrobbled most often · past week' }))
}

const scrobbles = root => list(root?.recenttracks?.track)
  .filter(track => String(track?.['@attr']?.nowplaying) !== 'true' && Number(track?.date?.uts) > 0)
  .map(trackOf).filter(track => track.title && track.artist)

async function weeklyScrobbles(ask, username, now, warnings) {
  const to = Math.floor(now / 1000)
  const params = { user: username, from: String(to - 7 * 86400), to: String(to), limit: '200', extended: '1' }
  const events = []
  // A fixed upper time bound keeps pagination stable while new plays arrive.
  // Do not present incomplete counts as a full week's listening.
  for (let page = 1; page <= 50; page++) {
    const response = await ask('user.getRecentTracks', { ...params, page: String(page) })
    if (!response) return null
    events.push(...scrobbles(response))
    const totalPages = Number(response.recenttracks?.['@attr']?.totalPages)
    if (totalPages > 0 ? page >= totalPages : list(response.recenttracks?.track).length < 200) return events
  }
  warnings.push('Quick Picks: the seven-day scrobble window exceeded the page limit.')
  return null
}

function weave(groups) {
  const result = []
  for (let i = 0; i < Math.max(0, ...groups.map(group => group.length)); i++) {
    for (const group of groups) if (group[i]) result.push(group[i])
  }
  return result
}

async function mapLimited(items, callback) {
  const out = new Array(items.length)
  let index = 0
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (index < items.length) { const at = index++; out[at] = await callback(items[at], at) }
  }))
  return out
}

async function loadLastfmDiscovery(settings, call, options = {}) {
  const username = String(settings.lastfm_username || '').trim()
  if (!settings.lastfm_api_key || !username || settings.lastfm_enabled === '0') return { error: 'Connect Last.fm in Integrations to load your account shelves.' }
  const now = options.now ?? Date.now()
  const warnings = []
  const ask = async (method, params) => {
    try {
      const answer = await call(method, params, settings.lastfm_api_key, null)
      if (!answer || answer.error) throw new Error(answer?.message || String(answer?.error || 'Empty response'))
      return answer
    } catch (error) {
      warnings.push(`${method}: ${error.message}`)
      return null
    }
  }
  const [week, month, recent, artists, albums] = await Promise.all([
    weeklyScrobbles(ask, username, now, warnings),
    ask('user.getTopTracks', { user: username, period: '1month', limit: '60' }),
    ask('user.getRecentTracks', { user: username, limit: '101', extended: '1' }),
    ask('user.getTopArtists', { user: username, period: '1month', limit: '30' }),
    ask('user.getTopAlbums', { user: username, period: '1month', limit: '30' }),
  ])
  if (![week, month, recent, artists, albums].some(Boolean)) return { error: warnings[0] || 'Last.fm did not answer.' }
  const tracks = root => list(root).map(trackOf).filter(track => track.title && track.artist)
  const history = scrobbles(recent).slice(0, 100)
  const weekly = quickPicksFromHistory(week, now)
  const monthly = tracks(month?.toptracks?.track)
  const topArtists = list(artists?.topartists?.artist).filter(artist => artist?.name).map(artist => ({
    name: artist.name, image: imageOf(artist.image), playcount: Number(artist.playcount) || 0,
    url: artist.url || '', source: 'lastfm', reason: 'Your most played artists · past month',
  })).slice(0, 30)
  const topAlbums = list(albums?.topalbums?.album).map(album => ({
    title: album.name || '', artist: nameOf(album.artist), artwork_url: imageOf(album.image),
    playcount: Number(album.playcount) || 0, url: album.url || '', source: 'lastfm',
    reason: 'Your most played albums · past month',
  })).filter(album => album.title && album.artist).slice(0, 30)

  // Spread seeds across account artists. Previously taking the first N songs
  // before diversifying let a single soundtrack occupy the entire shelf.
  const seedPool = unique(weave([weekly, history, monthly]))
  const page = Math.min(1000, Math.max(0, Math.trunc(Number(options.page) || 0)))
  const byArtist = new Map()
  for (const track of seedPool) {
    const id = key(track.artist)
    if (!byArtist.has(id)) byArtist.set(id, [])
    byArtist.get(id).push(track)
  }
  const artistSeeds = [...byArtist.values()].map(songs => songs[page % songs.length])
  const offset = artistSeeds.length ? page * 8 % artistSeeds.length : 0
  const seeds = [...artistSeeds.slice(offset), ...artistSeeds.slice(0, offset)].slice(0, 12)
  const groups = await mapLimited(seeds, async seed => {
    const result = await ask('track.getSimilar', { artist: seed.artist, track: seed.title, autocorrect: '1', limit: '40' })
    const similar = tracks(result?.similartracks?.track)
    const start = similar.length ? page * 5 % similar.length : 0
    return [...similar.slice(start), ...similar.slice(0, start)].map(track => ({ ...track, reason: `Similar to ${seed.artist} — ${seed.title}`, seedArtist: seed.artist }))
  })
  // Sparse track.getSimilar coverage is common for new/regional music. Use
  // the actual account artists' Last.fm catalogues to extend the pool, never
  // generic YouTube searches or global charts.
  const catalogArtists = unique([...topArtists.map(artist => artist.name), ...seeds.map(seed => seed.artist)], key)
  const artistOffset = catalogArtists.length ? page * 6 % catalogArtists.length : 0
  const selectedArtists = [...catalogArtists.slice(artistOffset), ...catalogArtists.slice(0, artistOffset)].slice(0, 12)
  const catalogs = await mapLimited(selectedArtists, async artist => {
    const result = await ask('artist.getTopTracks', { artist, autocorrect: '1', limit: '30', page: String(1 + page) })
    return tracks(result?.toptracks?.track).map(track => ({ ...track, reason: `More from ${artist} on Last.fm`, seedArtist: artist }))
  })
  const heard = new Set([...history, ...weekly].map(songKey))
  const pool = unique(weave([unique(weave(groups)), unique(weave(catalogs))]))
  const fresh = pool.filter(track => !heard.has(songKey(track)))
  const result = {
    source: 'lastfm', account: username, fetchedAt: Date.now(), page,
    warnings: [...new Set(warnings)],
    // Failed sections are null so clients retain their last successful data.
    quickPicks: week ? weekly.slice(0, 12) : null,
    history: recent ? history : null,
    artists: artists ? topArtists : null,
    albums: albums ? topAlbums : null,
    freshFinds: groups.some(group => group.length) || catalogs.some(group => group.length) ? fresh.slice(0, 30) : warnings.length ? null : [],
    candidates: pool,
  }
  return result
}

module.exports = { loadLastfmDiscovery, quickPicksFromHistory }
