import assert from 'node:assert/strict'
import { test } from 'node:test'
import discovery from '../electron/lastfmDiscovery.js'

const { loadLastfmDiscovery, quickPicksFromHistory } = discovery
const now = 1_800_000_000_000
const seconds = now / 1000
const settings = { lastfm_api_key: 'test-key', lastfm_username: 'listener' }
const event = (name, artist, timestamp = seconds - 60) => ({ name, artist: { '#text': artist }, date: { uts: String(timestamp) } })
const recent = (tracks, totalPages = 1) => ({ recenttracks: { track: tracks, '@attr': { totalPages: String(totalPages) } } })

function provider(overrides = {}) {
  const calls = []
  const call = async (method, params) => {
    calls.push({ method, params })
    if (overrides[method]) return overrides[method](params)
    if (method === 'user.getRecentTracks') return recent([event('Seed', 'Artist')])
    if (method === 'user.getTopTracks') return { toptracks: { track: [event('Monthly Seed', 'Artist')] } }
    if (method === 'user.getTopArtists') return { topartists: { artist: Array.from({ length: 35 }, (_, i) => ({ name: `Artist ${i}` })) } }
    if (method === 'user.getTopAlbums') return { topalbums: { album: Array.from({ length: 35 }, (_, i) => ({ name: `Album ${i}`, artist: { name: `Artist ${i}` } })) } }
    if (method === 'track.getSimilar') return { similartracks: { track: Array.from({ length: 40 }, (_, i) => event(`Similar ${params.track} ${i}`, 'Discovery Artist')) } }
    if (method === 'artist.getTopTracks') return { toptracks: { track: Array.from({ length: 30 }, (_, i) => event(`Catalogue ${params.page} ${i}`, params.artist)) } }
    throw new Error(`Unexpected method ${method}`)
  }
  return { call, calls }
}

test('weekly aggregation excludes old/future/now-playing entries and ranks by count then recency', () => {
  const track = (title, age, artist = 'Artist') => ({ title, artist, scrobbledAt: seconds - age })
  const result = quickPicksFromHistory([
    track('Frequent', 30), track('frequent', 60, 'ARTIST'), track('Frequent', 120),
    track('Recent', 10), track('Older', 20), track('Boundary', 7 * 86400),
    track('Too old', 7 * 86400 + 1), track('Future', -60), { title: 'Playing', artist: 'Artist' },
  ], now)
  assert.deepEqual(result.map(t => [t.title, t.scrobbleCount]), [['Frequent', 3], ['Recent', 1], ['Older', 1], ['Boundary', 1]])
})

test('Quick Picks count the full seven-day window while History keeps 100 completed scrobbles', async () => {
  const { call, calls } = provider({
    'user.getRecentTracks': params => {
      if (!params.from) return recent([
        { ...event('Now playing', 'Artist'), '@attr': { nowplaying: 'true' } },
        ...Array.from({ length: 101 }, (_, i) => event(`History ${i}`, 'Artist', seconds - i - 1)),
      ])
      if (params.page === '1') return recent(Array.from({ length: 200 }, (_, i) => event(i < 100 ? 'First page' : `Other ${i}`, 'Artist', seconds - i - 1)), 2)
      return recent(Array.from({ length: 150 }, (_, i) => event('Beyond history', 'Other Artist', seconds - i - 1000)), 2)
    },
  })
  const result = await loadLastfmDiscovery(settings, call, { now })
  assert.deepEqual(result.quickPicks.slice(0, 2).map(t => [t.title, t.scrobbleCount]), [['Beyond history', 150], ['First page', 100]])
  assert.equal(result.history.length, 100)
  assert.equal(result.history[0].title, 'History 0')
  assert.equal(result.history.at(-1).title, 'History 99')
  const weeklyCalls = calls.filter(c => c.method === 'user.getRecentTracks' && c.params.from)
  assert.deepEqual(weeklyCalls.map(c => c.params.page), ['1', '2'])
  for (const { params } of weeklyCalls) {
    assert.equal(params.from, String(seconds - 7 * 86400))
    assert.equal(params.to, String(seconds))
  }
  assert.ok(!calls.some(c => c.method === 'user.getTopTracks' && c.params.period === '7day'))
})

test('monthly account shelves are capped at 30; refresh changes the provider candidate pool', async () => {
  const { call, calls } = provider()
  const first = await loadLastfmDiscovery(settings, call, { now, page: 0 })
  const next = await loadLastfmDiscovery(settings, call, { now, page: 1 })
  assert.equal(first.artists.length, 30)
  assert.equal(first.albums.length, 30)
  assert.equal(first.freshFinds.length, 30)
  for (const { params } of calls.filter(c => ['user.getTopArtists', 'user.getTopAlbums'].includes(c.method))) {
    assert.equal(params.period, '1month')
    assert.equal(params.limit, '30')
  }
  assert.ok(calls.some(c => c.method === 'artist.getTopTracks' && c.params.page === '2'))
  assert.notDeepEqual(next.freshFinds, first.freshFinds)
  assert.ok(next.candidates.some(t => !first.candidates.some(previous => previous.title === t.title)))
})

test('a failed weekly page reports unavailable counts rather than a partial chart; empty shelves clear', async () => {
  const { call } = provider({
    'user.getRecentTracks': params => !params.from ? recent([]) : params.page === '1'
      ? recent([event('Partial', 'Artist')], 2) : { error: 29, message: 'Rate limited' },
    'user.getTopArtists': () => ({ topartists: { artist: [] } }),
    'user.getTopAlbums': () => ({ error: 11, message: 'Unavailable' }),
  })
  const result = await loadLastfmDiscovery(settings, call, { now })
  assert.equal(result.quickPicks, null)
  assert.equal(result.albums, null)
  assert.deepEqual(result.history, [])
  assert.deepEqual(result.artists, [])
  assert.ok(result.warnings.some(message => message.includes('Rate limited')))
})

test('disabled Last.fm does not make provider calls', async () => {
  const { call, calls } = provider()
  const result = await loadLastfmDiscovery({ ...settings, lastfm_enabled: '0' }, call)
  assert.ok(result.error)
  assert.equal(calls.length, 0)
})
