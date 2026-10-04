import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRecommendationMix, loadRecommendationPage, recommendationMatch, resolveRecommendationTracks, songKey } from '../src/recommendations.js'
import { orderedPlaybackSources } from '../src/playbackSources.js'
import { buildRadio } from '../src/radioActions.js'

const song = i => ({ title: `Song ${i}`, artist: `Artist ${i}` })
const playable = item => ({ ...item, id: `${item.artist}-${item.title}`, file_path: '/music/song.flac' })
const songs = (count, offset = 0) => Array.from({ length: count }, (_, i) => song(i + offset))
const addon = 'a-0123456789'

function clientMock(overrides = {}) {
  const searches = []
  const saved = []
  const client = {
    getSettings: async () => ({ playback_search_order: JSON.stringify(['sc', addon, 'yt']) }),
    onlineProviders: async () => [{ id: 'yt' }, { id: 'sc' }, { id: addon, addon: true }],
    searchTracks: async () => [],
    onlineSearch: async (query, source) => { searches.push(source); return { results: [{ ...song(1), id: 'abcdefghijk', provider: source }] } },
    onlineSave: async items => { saved.push(...items); return items.map(item => ({ ...item, id: `${item.provider}-${item.id}`, file_path: item.provider === 'sc' ? 'ghost://soundcloud/online/123' : item.provider === addon ? 'ghost://addon/0123456789/item' : 'ghost://youtube/online/abcdefghijk' })) },
    ...overrides,
  }
  return { client, searches, saved }
}

test('saved priority excludes removed addons and includes newly available providers once', () => {
  assert.deepEqual(orderedPlaybackSources(JSON.stringify(['sc', 'removed', 'sc']), [{ id: 'yt' }, { id: 'sc' }, { id: addon }]).map(p => p.id), ['sc', 'yt', addon])
  assert.deepEqual(orderedPlaybackSources('bad json').map(p => p.id), ['yt', 'sc'])
})

test('matching requires the exact title and artist and preserves version differences', () => {
  const target = { title: 'Song', artist: 'Artist' }
  for (const result of [{ title: 'Song', artist: 'Cover Artist' }, { title: 'Song (Live)', artist: 'Artist' }, { title: 'Other Song', artist: 'Artist' }]) {
    assert.equal(recommendationMatch(target, [result]), null)
  }
  assert.ok(recommendationMatch(target, [{ title: 'Song (Official Audio)', artist: 'Artist - Topic' }]))
})

test('playback follows SoundCloud/addon/YouTube order and survives a local lookup failure', async () => {
  const { client, searches, saved } = clientMock({
    searchTracks: async () => { throw new Error('Local search unavailable') },
  })
  client.onlineSearch = async (query, provider) => {
    searches.push(provider)
    if (provider === 'sc') throw new Error('Offline')
    return { results: [{ ...song(1), id: 'remote-id', artist: provider === addon ? 'Wrong Artist' : 'Artist 1' }] }
  }
  const result = await resolveRecommendationTracks([song(1)], client)
  assert.deepEqual(searches, ['sc', addon, 'yt'])
  assert.equal(result.length, 1)
  assert.equal(saved[0].provider, 'yt')
})

test('addon matches are saved without assuming the backend row ID format', async () => {
  const { client, searches } = clientMock()
  client.getSettings = async () => ({ playback_search_order: JSON.stringify([addon, 'sc', 'yt']) })
  client.onlineSave = async items => items.map(item => ({ ...item, id: 'hashed-row-id', file_path: 'ghost://addon/0123456789/track' }))
  const result = await resolveRecommendationTracks([song(1)], client)
  assert.deepEqual(searches, [addon])
  assert.equal(result[0].id, 'hashed-row-id')
})

test('ghost placeholders and cached streams do not bypass changed priority', async () => {
  const { client, searches } = clientMock({ searchTracks: async () => [
    { ...song(1), id: 'imported', file_path: 'ghost://spotify/track' },
    { ...song(1), id: 'cached-youtube', file_path: 'ghost://youtube/online/abcdefghijk' },
  ] })
  const result = await resolveRecommendationTracks([song(1)], client)
  assert.deepEqual(searches, ['sc'])
  assert.equal(result[0].provider, 'sc')
})

test('a stalled provider times out and an invalid saved row falls through', async () => {
  const { client, searches } = clientMock()
  client.onlineSearch = async (query, source) => {
    searches.push(source)
    if (source === 'sc') return new Promise(() => {})
    return { results: [{ ...song(1), id: 'abcdefghijk' }] }
  }
  const save = client.onlineSave
  client.onlineSave = items => items[0].provider === addon ? Promise.resolve([{ id: 'unplayable' }]) : save(items)
  const result = await resolveRecommendationTracks([song(1)], client, { timeoutMs: 15 })
  assert.deepEqual(searches, ['sc', addon, 'yt'])
  assert.equal(result.length, 1)
})

for (const size of [24, 32, 40]) {
  test(`mix contains exactly ${size} unique playable matches across provider pages`, async () => {
    const pages = []
    const mix = await buildRecommendationMix({
      size,
      loadPage: async page => { pages.push(page); return { candidates: songs(24, page * 24) } },
      resolve: async items => items.filter(item => Number(item.title.split(' ')[1]) % 3 !== 0).map(playable),
    })
    assert.equal(mix.length, size)
    assert.equal(new Set(mix.map(songKey)).size, size)
    assert.ok(pages.length > 1)
  })
}

test('regeneration consumes fresh songs before repeats and rejects an unchanged mix', async () => {
  const previous = songs(24).map(playable)
  const mix = await buildRecommendationMix({ size: 24, previous, loadPage: async () => ({ candidates: [...songs(24), ...songs(24, 24)] }), resolve: async items => items.map(playable) })
  assert.ok(mix.every(track => !previous.some(old => songKey(old) === songKey(track))))
  await assert.rejects(buildRecommendationMix({ size: 24, previous, loadPage: async () => ({ candidates: songs(24) }), resolve: async items => items.map(playable) }), /same songs/)
})

test('insufficient matches and cancellation reject without mutating the previous mix', async () => {
  const previous = songs(24).map(playable)
  const original = structuredClone(previous)
  await assert.rejects(buildRecommendationMix({ size: 40, previous, loadPage: async () => ({ candidates: songs(10, 100) }), resolve: async items => items.map(playable) }), /Found 10 playable matches for 40/)
  assert.deepEqual(previous, original)
  let current = true
  await assert.rejects(buildRecommendationMix({ size: 24, isCurrent: () => current, loadPage: async () => { current = false; return { candidates: songs(40) } } }), /superseded/)
})

test('provider refresh passes the Last.fm page and forces YouTube account refresh', async () => {
  const pages = []
  const forced = []
  const playlists = []
  const client = {
    lastfmDiscovery: async page => { pages.push(page); return { candidates: [] } },
    youtubeAccount: async force => { forced.push(force); return { home: [], homePlaylists: ['a', 'b', 'c'].map(id => ({ id })) } },
    youtubeAccountPlaylist: async id => { playlists.push(id); return { tracks: [song(id)] } },
  }
  await loadRecommendationPage('lastfm', 3, client)
  await loadRecommendationPage('youtube', 2, client)
  assert.deepEqual(pages, [3])
  assert.deepEqual(forced, [true])
  assert.deepEqual(playlists, ['b', 'c'])
})

test('local-track radio and Last.fm candidates use configured playback sources', async () => {
  const { client, searches } = clientMock({ lastfmSimilar: async () => ({ tracks: [song(1)] }) })
  const result = await buildRadio(playable(song(1)), 'guest', client)
  assert.deepEqual(searches, ['sc', 'sc'])
  assert.equal(result.length, 1, 'seed and matching provider song are deduplicated')
})

test('artist radio uses provider priority and rejects a similarly named wrong artist', async () => {
  const { client, searches } = clientMock({ lastfmSimilar: async () => ({ artists: [{ name: 'Artist 1' }] }) })
  client.onlineSearch = async (query, source) => {
    searches.push(source)
    return { results: [{ ...song(1), id: 'track', artist: source === 'sc' ? 'Artist 10' : 'Artist 1' }] }
  }
  const result = await buildRadio({ artist: 'Seed Artist', type: 'artist' }, 'guest', client)
  assert.deepEqual(searches, ['sc', addon])
  assert.equal(result.length, 1)
  assert.equal(result[0].provider, addon)
})
