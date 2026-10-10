import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { discoverNewReleases, loadArtistReleases, recentReleases } from '../src/newReleases.js'
import { previewWindow, startVideoPreview } from '../src/videoPreview.js'
import { deleteVideoDownloads, downloadVideos, updateVideoLibrary } from '../src/videoActions.js'

const require = createRequire(import.meta.url)
const { trackFileFilter, missingTrackFile } = require('../electron/libraryTracks.js')

test('desktop IPC and web route honor ghost filtering, genre and paginated results', async t => {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec("CREATE TABLE tracks (id TEXT, file_path TEXT, artist TEXT, genre TEXT, genres TEXT); INSERT INTO tracks VALUES ('one', '/music/present.flac', 'A', 'Rock', NULL), ('two', 'ghost://youtube/online/abcdefghijk', 'A', 'Rock', NULL), ('three', 'ghost://spotify/import/one', 'A', 'Rock', NULL), ('four', '/music/absent.flac', 'B', 'Pop', NULL)")
  const load = async (file, databaseId) => {
    const filename = require.resolve(file)
    const localRequire = createRequire(filename)
    const module = { exports: {} }
    const context = vm.createContext({
      require: id => id === databaseId ? { getDB: () => db } : id === 'electron' ? {} : ['fs', 'fs-extra'].includes(id) ? { ...localRequire(id), existsSync: value => value === '/music/present.flac' } : localRequire(id),
      module, console, process, Buffer, URL, setTimeout, clearTimeout,
    })
    vm.runInContext(await readFile(filename, 'utf8'), context, { filename })
    return module.exports
  }
  const scanner = await load('../electron/ipc/scanner.js', './db')
  const handlers = new Map()
  scanner.registerScannerHandlers({ handle: (name, handler) => handlers.set(name, handler) })
  const router = await load('../server/routes/tracks.js', '../../electron/ipc/db')
  const route = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack[0].handle
  const desktop = options => handlers.get('scanner:getTracks')(null, options)
  const web = options => { let rows; route({ query: options }, { json: value => { rows = value } }); return rows }
  for (const request of [desktop, web]) {
    assert.deepEqual(Array.from(request({ sort: 'id', artistName: 'A', genre: 'Rock' }), row => row.id), ['one'])
    const rows = request({ sort: 'id', artistName: 'A', includeGhosts: true, limit: 2, offset: 1 })
    assert.deepEqual(Array.from(rows, row => row.id), ['three', 'two'])
    assert.ok(rows.every(row => row.missing === false))
    assert.equal(request({ sort: 'id', id: 'four' })[0].missing, true)
  }
})

test('shared desktop/web SQL filter includes virtual files only when requested', () => {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec("CREATE TABLE tracks (id TEXT, file_path TEXT); INSERT INTO tracks VALUES ('local', '/m/local.flac'), ('stream', 'ghost://youtube/online/abcdefghijk'), ('missing', 'ghost://spotify/import/one')")
  const rows = option => {
    const files = trackFileFilter(option)
    return db.prepare(`SELECT id FROM tracks${files ? ` WHERE ${files}` : ''} ORDER BY id`).all().map(row => row.id)
  }
  assert.deepEqual(rows(undefined), ['local'])
  assert.deepEqual(rows(false), ['local'])
  assert.deepEqual(rows('false'), ['local'])
  for (const option of [true, 'true', '1']) assert.deepEqual(rows(option), ['local', 'missing', 'stream'])
  const files = trackFileFilter(true)
  assert.deepEqual(db.prepare(`SELECT id FROM tracks${files ? ` WHERE ${files}` : ''} ORDER BY id LIMIT ? OFFSET ?`).all(1, 1).map(row => row.id), ['missing'])
  assert.equal(missingTrackFile({ file_path: 'ghost://youtube/online/abcdefghijk' }, () => false), false)
  assert.equal(missingTrackFile({ file_path: 'ghost://spotify/import/one' }, () => false), false)
  assert.equal(missingTrackFile({ file_path: '/m/deleted.flac' }, () => false), true)
  assert.equal(missingTrackFile({ file_path: '/m/local.flac' }, () => true), false)
  db.close()
})

test('artist hiding persists through settings, serializes changes and restores without deleting library data', async () => {
  let settings = { discovery_hidden_artists: '[]' }
  globalThis.discoveryTestApi = {
    getSettings: async () => ({ ...settings }),
    saveSettings: async values => { settings = { ...settings, ...values }; return { success: true } },
  }
  const source = (await readFile(new URL('../src/discoveryArtists.js', import.meta.url), 'utf8'))
    .replace("import { api } from './api'", 'const api = globalThis.discoveryTestApi')
    .replace("from 'zustand'", `from '${pathToFileURL(require.resolve('zustand')).href}'`)
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  await Promise.all([module.setDiscoveryArtistHidden(' A ', true), module.setDiscoveryArtistHidden('B', true)])
  assert.deepEqual(JSON.parse(settings.discovery_hidden_artists).sort(), ['a', 'b'])
  module.useDiscoveryArtists.setState({ hidden: new Set() })
  await module.loadDiscoveryArtists()
  assert.equal(module.useDiscoveryArtists.getState().hidden.has('a'), true)
  await module.setDiscoveryArtistHidden('A', false)
  assert.deepEqual(JSON.parse(settings.discovery_hidden_artists), ['b'])
  globalThis.discoveryTestApi.saveSettings = async () => ({ error: 'Disk unavailable' })
  await assert.rejects(module.setDiscoveryArtistHidden('C', true), /Disk unavailable/)
  assert.equal(module.useDiscoveryArtists.getState().hidden.has('c'), false)
  delete globalThis.discoveryTestApi
})

test('new releases require recent release dates, deduplicate and sort newest first', () => {
  const rows = recentReleases([
    { title: 'Old', artist: 'A', year: 2020 },
    { title: 'Future', artist: 'A', year: 2030 },
    { title: 'Upcoming this year', artist: 'A', release_date: '2026-12-01' },
    { title: 'Malformed date', artist: 'A', release_date: '2026-garbage' },
    { title: 'Undated', artist: 'A' },
    { title: 'Last year', artist: 'A', year: 2025 },
    { title: 'NEW', artist: 'b', year: 2026 },
    { title: 'New', artist: 'B', release_date: '2026-09-01' },
  ], new Date('2026-10-09'))
  assert.deepEqual(rows.map(row => row.title), ['New', 'Last year'])
})

test('local artists seed release discovery with bounded concurrency and failure isolation', async () => {
  let active = 0
  let peak = 0
  const asked = []
  const result = await discoverNewReleases([{ name: 'A' }, { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], async name => {
    asked.push(name)
    peak = Math.max(peak, ++active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    if (name === 'B') throw new Error('Offline')
    return [{ title: `${name} release`, year: 2026 }]
  }, { now: new Date('2026-10-09') })
  assert.equal(peak, 3)
  assert.deepEqual(asked, ['A', 'B', 'C', 'D'])
  assert.equal(result.items.length, 3)
  assert.equal(result.failures, 1)
})

test('cancelled release discovery starts no more requests', async () => {
  const result = await discoverNewReleases([{ name: 'A' }], () => { throw new Error('Must not run') }, { isCurrent: () => false })
  assert.deepEqual(result.items, [])
  assert.equal(result.failures, 0)
})

test('release discovery rotates its bounded batch to reach more than twelve local artists', async () => {
  const asked = []
  await discoverNewReleases(Array.from({ length: 20 }, (_, index) => ({ name: `Artist ${index}` })), async name => { asked.push(name); return [] }, { startAt: 12 })
  assert.equal(asked.length, 12)
  assert.deepEqual(asked.slice(0, 8), Array.from({ length: 8 }, (_, index) => `Artist ${index + 12}`))
})

test('release loading uses real artist catalogues and reports provider errors and timeouts', async () => {
  const client = { discoveryCatalogue: async options => {
    assert.deepEqual(options, { source: 'youtube', type: 'releases', artist: 'A' })
    return { albums: [{ title: 'New single', year: 2026 }] }
  } }
  assert.equal((await loadArtistReleases('A', client))[0].title, 'New single')
  await assert.rejects(loadArtistReleases('A', { discoveryCatalogue: async () => ({ error: 'Offline' }) }), /Offline/)
  await assert.rejects(loadArtistReleases('A', { discoveryCatalogue: () => new Promise(() => {}) }, { timeoutMs: 5 }), /timed out/)
})

test('release catalogue reads the artist albums and singles without loading extra top songs', async () => {
  const youtube = require('../electron/online/youtube.js')
  youtube.clearAccountCache()
  const endpoint = (id, type) => ({ browseEndpoint: { browseId: id, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: `MUSIC_PAGE_TYPE_${type}` } } } })
  const album = (id, title, year) => ({ musicTwoRowItemRenderer: { title: { simpleText: title }, subtitle: { simpleText: `${year} • Single` }, navigationEndpoint: endpoint(id, 'ALBUM') } })
  const calls = []
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/')) return { ok: true, text: async () => '' }
    const body = JSON.parse(init.body)
    calls.push(body)
    const contents = body.query ? [{ musicTwoRowItemRenderer: { title: { simpleText: 'A' }, navigationEndpoint: endpoint('UCartist123456789', 'ARTIST') } }]
      : [{ musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { simpleText: 'Singles & EPs' } } }, contents: [album('MPREnew', 'New single', 2026), album('MPREold', 'Old single', 2015)] } }, { musicShelfRenderer: { bottomEndpoint: endpoint('VLtopsongs', 'PLAYLIST') } }]
    return { ok: true, json: async () => ({ contents }) }
  }
  const result = await youtube.fetchCatalogue({ source: 'youtube', type: 'releases', artist: 'A' }, 'SAPISID=test; __Secure-3PSID=test', fetchImpl)
  assert.deepEqual(result.albums.map(row => [row.title, row.artist, row.year]), [['New single', 'A', 2026], ['Old single', 'A', 2015]])
  assert.equal(calls.length, 2)
  assert.deepEqual(recentReleases(result.albums, new Date('2026-10-09')).map(row => row.title), ['New single'])
})

test('bulk video saving isolates failed rows and downloads only newly saved undownloaded videos', async () => {
  const items = ['one', 'bad', 'three'].map(id => ({ track: { id }, downloaded: id === 'three' }))
  const saved = []
  const downloaded = []
  const result = await updateVideoLibrary(items, true, {
    musicVideoSave: async id => id === 'bad' ? { error: 'Disk unavailable' } : { saved: true },
    musicVideoDownload: async id => { downloaded.push(id); return { downloadId: id } },
  }, (id, value) => saved.push([id, value]))
  assert.deepEqual(saved, [['one', true], ['three', true]])
  assert.deepEqual(downloaded, ['one'])
  assert.deepEqual(result, { succeeded: 2, errors: ['Disk unavailable'] })
  const removed = await updateVideoLibrary(items, false, { musicVideoSave: async () => ({ saved: false }), musicVideoDownload: () => { throw new Error('Must not download') } })
  assert.deepEqual(removed, { succeeded: 3, errors: [] })
})

test('bulk downloads continue after a rejected provider operation', async () => {
  const asked = []
  const result = await downloadVideos(['one', 'bad', 'three'].map(id => ({ track: { id } })), { musicVideoDownload: async id => {
    asked.push(id)
    if (id === 'bad') throw new Error('Download failed')
    return { file: '/videos/artist/local.mp4' }
  } })
  assert.deepEqual(asked, ['one', 'bad', 'three'])
  assert.deepEqual(result, { succeeded: 2, errors: ['Download failed'] })
})

test('bulk deletion deletes downloaded videos only and isolates failed rows', async () => {
  const asked = []
  const items = ['one', 'bad', 'three', 'not-downloaded'].map(id => ({ track: { id }, downloaded: id !== 'not-downloaded' }))
  const result = await deleteVideoDownloads(items, {
    musicVideoDeleteDownload: async id => { asked.push(id); return id === 'bad' ? { error: 'File is locked' } : { success: true } },
    deleteTracks: () => { throw new Error('Audio must be kept') },
    musicVideoSave: () => { throw new Error('Saved entries must be kept') },
  })
  assert.deepEqual(asked, ['one', 'bad', 'three'])
  assert.deepEqual(result, { succeeded: 2, errors: ['File is locked'] })
})

test('hover previews use a five second local window and silence the element', () => {
  assert.deepEqual(previewWindow(180), { start: 60, end: 65 })
  assert.deepEqual(previewWindow(63), { start: 58, end: 63 })
  assert.deepEqual(previewWindow(3), { start: 0, end: 3 })
  const listeners = new Map()
  let pauses = 0
  const element = { duration: 180, muted: false, volume: 1, currentTime: 0,
    play: () => Promise.resolve(), pause: () => { pauses++ },
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event),
  }
  const cleanup = startVideoPreview(element)
  assert.equal(element.muted, true)
  assert.equal(element.volume, 0)
  assert.equal(element.currentTime, 60)
  element.currentTime = 65
  listeners.get('timeupdate')()
  assert.equal(pauses, 1)
  cleanup()
  assert.equal(pauses, 2)
  assert.equal(listeners.size, 0)
})

test('Videos selection supports Ctrl/Cmd, ranges, context-menu retention and plain-click playback', async () => {
  const slots = []
  let cursor = 0
  let effects = []
  let cleanups = []
  const handlers = new Map()
  const context = vm.createContext({
    useState: initial => {
      const at = cursor++
      if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial
      return [slots[at], value => { slots[at] = typeof value === 'function' ? value(slots[at]) : value }]
    },
    useRef: initial => { const at = cursor++; return slots[at] ||= { current: initial } },
    useMemo: factory => factory(),
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
    document: { querySelector: () => null },
    window: { addEventListener: (event, callback) => handlers.set(event, callback), removeEventListener: event => handlers.delete(event) },
  })
  const source = (await readFile(new URL('../src/selection.js', import.meta.url), 'utf8')).replace(/import .* from 'react'/, '').replace('export function useSelection', 'function useSelection')
  vm.runInContext(`${source}\nglobalThis.useSelection = useSelection`, context)
  const render = (keys = ['a', 'b', 'c', 'd']) => {
    cleanups.forEach(cleanup => cleanup?.())
    cursor = 0; effects = []
    const selection = context.useSelection(keys)
    cleanups = effects.map(effect => effect())
    return selection
  }
  let selection = render()
  assert.equal(selection.click('a', { ctrlKey: true }), true)
  selection = render()
  assert.equal(selection.count, 1)
  assert.equal(selection.click('c', { metaKey: true }), true)
  selection = render()
  assert.equal(selection.count, 2)
  assert.deepEqual(Array.from(selection.contextSelect('a')), ['a', 'c'])
  assert.equal(selection.click('d', { shiftKey: true }), true)
  selection = render()
  assert.deepEqual(Array.from(selection.selected), ['c', 'd'])
  assert.deepEqual(Array.from(selection.contextSelect('b')), ['b'])
  selection = render()
  assert.deepEqual(Array.from(selection.selected), ['b'])
  let prevented = false
  handlers.get('keydown')({ key: 'a', metaKey: true, preventDefault: () => { prevented = true } })
  selection = render()
  assert.equal(prevented, true)
  assert.equal(selection.count, 4)
  assert.equal(selection.click('a', {}), false)
  selection = render()
  assert.equal(selection.count, 0)
  cleanups.forEach(cleanup => cleanup?.())
})
