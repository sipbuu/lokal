import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db.js')
const { indexSingleFile } = require('../electron/ipc/scanner.js')
const { DownloadManager } = require('../electron/download/manager.js')
const mm = require('../electron/musicMetadata')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-library-sync-'))
  const previousDir = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = dir
  initDB()
  const db = getDB()
  t.after(() => {
    db.close()
    if (previousDir === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previousDir
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const filepath = path.join(dir, 'song.flac')
  fs.writeFileSync(filepath, 'synthetic audio; metadata parser mocked')
  const add = (id, file, title = 'Song', artist = 'Artist', duration = 200) => {
    db.prepare('INSERT INTO tracks (id, file_path, file_hash, title, artist, duration) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, file, id, title, artist, duration)
  }
  return { db, filepath, add }
}

for (const [stored, current, rejected] of [[100, 200, false], [200, 100, true]]) {
  test(`changed-file duration uses ${current}s instead of stored ${stored}s`, async t => {
    const { db, filepath, add } = fixture(t)
    add('existing', filepath, 'Old title', 'Artist', stored)
    const parse = t.mock.method(mm, 'parseFile', async () => ({ format: { duration: current } }))
    const result = await indexSingleFile(filepath, { metadata: { title: 'Song', duration: 200 } })
    assert.equal(parse.mock.callCount(), 1)
    if (rejected) {
      assert.match(result.error, /duration does not match/)
      assert.equal(db.prepare('SELECT title FROM tracks').get().title, 'Old title')
    } else {
      assert.equal(result.id, 'existing')
      assert.equal(result.repaired, true)
      assert.equal(db.prepare('SELECT duration FROM tracks').get().duration, current)
    }
  })
}

test('unchanged-file duration avoids parsing and artist repairs refresh links', async t => {
  const { db, filepath, add } = fixture(t)
  add('existing', filepath, 'Song', 'Old artist')
  const stat = fs.statSync(filepath)
  const hash = 't-' + crypto.createHash('sha256').update(filepath + stat.size + stat.mtimeMs).digest('hex').slice(0, 16)
  db.prepare('UPDATE tracks SET file_hash = ?').run(hash)
  db.exec("INSERT INTO artists (id, name) VALUES ('old', 'Old artist'); INSERT INTO artist_track_links VALUES ('old', 'existing')")
  const parse = t.mock.method(mm, 'parseFile', async () => { throw new Error('Unexpected parsing') })
  const result = await indexSingleFile(filepath, { metadata: { artist: 'New Artist feat. Guest', album: 'Album', duration: 200 } })
  assert.equal(result.repaired, true)
  assert.equal(parse.mock.callCount(), 0)
  assert.deepEqual(db.prepare('SELECT artist, album FROM tracks').get(), { artist: 'New Artist feat. Guest', album: 'Album' })
  assert.deepEqual(db.prepare('SELECT name FROM artists JOIN artist_track_links ON artist_id = artists.id WHERE track_id = ? ORDER BY name').all('existing').map(r => r.name), ['Guest', 'New Artist'])
  assert.equal(db.prepare("SELECT id FROM artists WHERE id = 'old'").get(), undefined)
})

test('changed-file parse failure leaves existing metadata intact', async t => {
  const { db, filepath, add } = fixture(t)
  add('existing', filepath)
  t.mock.method(mm, 'parseFile', async () => { throw new Error('Invalid audio') })
  const result = await indexSingleFile(filepath, { metadata: { title: 'Replacement', duration: 200 } })
  assert.match(result.error, /Failed to parse/)
  assert.equal(db.prepare('SELECT title FROM tracks').get().title, 'Song')
})

function downloadFixture(t, indexResult, mismatch = true) {
  const fixtureData = fixture(t)
  const { db, filepath, add } = fixtureData
  add('target', filepath)
  add('g1', 'ghost://import/list/1')
  add('g2', 'ghost://import/list/2', mismatch ? 'Different song' : 'Song')
  add('streamed', 'ghost://youtube/online/aaaaaaaaaaa')
  db.exec(`INSERT INTO playlists (id, name) VALUES ('p', 'Playlist');
    INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p', 'g1', 0), ('p', 'g2', 1), ('p', 'streamed', 2);
    INSERT INTO user_likes (user_id, track_id) VALUES ('guest', 'g1');
    INSERT INTO play_history (user_id, track_id) VALUES ('guest', 'g1');
    INSERT INTO artists (id, name) VALUES ('artist', 'Artist');
    INSERT INTO artist_track_links VALUES ('artist', 'target');
    UPDATE tracks SET source_url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa' WHERE id = 'streamed';`)
  const mgr = new DownloadManager()
  let notified = 0
  mgr.deps = { getDB: () => db, index: async () => ({ id: 'target', ...indexResult }), onLibraryUpdated: () => { notified++ } }
  mgr.update = (job, patch) => Object.assign(job, patch)
  const job = {
    kind: 'single', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
    opts: { replaceImported: ['g1', 'g2', 'g1'], replaceTrackId: 'streamed' },
    indexedTracks: [], outputLines: [], thumbnail: 'data:synthetic',
  }
  return { ...fixtureData, mgr, job, notifications: () => notified }
}

for (const indexResult of [{ success: true }, { skipped: true }, { duplicate: true }]) {
  test(`failed imported batch rolls back all references (${Object.keys(indexResult)[0]})`, async t => {
    const { db, filepath, mgr, job, notifications } = downloadFixture(t, indexResult)
    const result = await mgr.indexOne(job, filepath)
    assert.equal(result.libraryAdded, false)
    assert.equal(job.libraryFailures, 1)
    assert.equal(job.indexedTracks.length, 0)
    assert.equal(notifications(), 0)
    assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks ORDER BY position').all().map(r => r.track_id), ['g1', 'g2', 'streamed'])
    assert.equal(db.prepare('SELECT track_id FROM user_likes').get().track_id, 'g1')
    assert.equal(db.prepare('SELECT track_id FROM play_history').get().track_id, 'g1')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM track_aliases').get().n, 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE id = 'target'").get().n, indexResult.success ? 0 : 1)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM artist_track_links WHERE track_id = 'target'").get().n, indexResult.success ? 0 : 1)
    assert.equal(fs.existsSync(filepath), !indexResult.success)
    assert.equal(job.outputLines.some(line => line.includes('Replaced the streamed version')), false)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
  })
}

test('successful imported batch commits once, dedupes playlists, and resolves streamed copies', async t => {
  const { db, filepath, mgr, job, notifications } = downloadFixture(t, { success: true }, false)
  // The same ghost may also be selected through the explicit replacement path.
  job.opts.alsoReplace = ['g1']
  const result = await mgr.indexOne(job, filepath)
  assert.equal(result.libraryAdded, true)
  assert.equal(job.indexedTracks.length, 1)
  assert.equal(notifications(), 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE file_path LIKE 'ghost://%'").get().n, 0)
  assert.ok(db.prepare('SELECT track_id FROM playlist_tracks').all().every(row => row.track_id === 'target'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE position IN (0, 1)').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM track_aliases').get().n, 3)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('partial playlist completion includes indexing failures', async () => {
  const mgr = new DownloadManager()
  mgr.cleanup = async () => {}
  mgr.markPlaylist = () => {}
  mgr.update = (job, patch) => Object.assign(job, patch)
  const job = { id: 'partial', kind: 'playlist', post: Promise.resolve(), downloadedTracks: ['one.flac', 'two.flac'], libraryFailures: 1, errorLines: ['ERROR: unavailable'], outputLines: [] }
  mgr.jobs.set(job.id, job)
  await mgr.onExit(job, 1)
  assert.equal(job.status, 'done')
  assert.equal(job.message, '2 downloaded, 1 unavailable · 1 not added to library')
})

for (const provider of ['a-0123456789', 'yt', 'sc']) {
  test(`duplicate ${provider} queue requests retain all imported playlist targets`, t => {
    const { db } = fixture(t)
    const mgr = new DownloadManager()
    mgr.configure({ getDB: () => db, findTools: () => ({ ytdlp: 'unused' }) })
    mgr.pump = () => {}
    const url = provider === 'yt' ? 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
      : provider === 'sc' ? 'https://api.soundcloud.com/tracks/123' : 'https://addon.example/file.flac'
    const opts = { title: 'Song', addonSource: provider.startsWith('a-') ? { provider, id: 'song' } : undefined }
    const first = mgr.enqueue('single', url, { ...opts, replaceImported: ['g1'], replaceTrackId: 'stream1' })
    const second = mgr.enqueue('single', url, { ...opts, replaceImported: ['g2'], replaceTrackId: 'stream2' })
    assert.equal(second.downloadId, first.downloadId)
    const job = mgr.jobs.get(first.downloadId)
    assert.deepEqual(job.opts.replaceImported, ['g1', 'g2'])
    assert.deepEqual(job.opts.alsoReplace, ['stream2'])
    clearTimeout(job.emitTimer)
  })
}

test('an empty index result is reported as a library failure', async t => {
  const { db, filepath } = fixture(t)
  const mgr = new DownloadManager()
  mgr.configure({ getDB: () => db, index: async () => null })
  mgr.update = (job, patch) => Object.assign(job, patch)
  const job = { kind: 'single', opts: {}, outputLines: [], indexedTracks: [] }
  const result = await mgr.indexOne(job, filepath)
  assert.match(result.error, /could not be indexed/)
  assert.equal(job.libraryFailures, 1)
  assert.equal(job.indexedTracks.length, 0)
})

test('a failed cleanup never removes audio still referenced by a playlist', async t => {
  const { db, filepath, mgr, job } = downloadFixture(t, { success: true })
  db.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p', 'target', 3)").run()
  const result = await mgr.indexOne(job, filepath)
  assert.equal(result.libraryAdded, false)
  assert.ok(fs.existsSync(filepath))
  assert.ok(db.prepare("SELECT id FROM tracks WHERE id = 'target'").get())
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('reusing an owned source validates the full imported batch before replacing anything', t => {
  const { db, filepath, mgr } = downloadFixture(t, { skipped: true })
  db.prepare("UPDATE tracks SET source_ref = 'a-0123456789:song' WHERE id = 'target'").run()
  mgr.configure({ findTools: () => ({ ytdlp: 'unused' }) })
  mgr.pump = () => {}
  const result = mgr.enqueue('single', 'https://addon.example/file.flac', {
    title: 'Song', addonSource: { provider: 'a-0123456789', id: 'song' }, replaceImported: ['g1', 'g2'],
  })
  assert.match(result.error, /could not replace/)
  assert.equal(result.alreadyInLibrary, undefined)
  assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks ORDER BY position').all().map(r => r.track_id), ['g1', 'g2', 'streamed'])
  assert.ok(fs.existsSync(filepath))
})

test('desktop ghost resolution honors match checks, deduplication, and completed aliases', t => {
  const { db } = downloadFixture(t, { success: true })
  const { resolveGhostTrack } = require('../electron/ipc/playlists.js')
  const options = { requireMetadataMatch: true, dedupePlaylist: true }
  assert.equal(resolveGhostTrack(db, 'g2', 'target', null, options).ok, false)
  db.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('p', 'target', 3)").run()
  assert.equal(resolveGhostTrack(db, 'g1', 'target', null, options).ok, true)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playlist_tracks WHERE track_id = 'target'").get().n, 1)
  assert.equal(resolveGhostTrack(db, 'g1', 'target', null, options).ok, true)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('non-Latin CSV titles and artists can resolve to their matching library file', async t => {
  const { db, filepath, mgr, job } = downloadFixture(t, { success: true }, false)
  db.prepare('UPDATE tracks SET title = ?, artist = ?').run('夜の音楽', '音楽家')
  const result = await mgr.indexOne(job, filepath)
  assert.equal(result.libraryAdded, true)
  assert.ok(db.prepare('SELECT track_id FROM playlist_tracks').all().every(row => row.track_id === 'target'))
})

for (const approved of [[], ['g1'], ['g1', 'g2']]) {
  test(`alternate duration approvals stay scoped to rows: ${approved.join(',') || 'none'}`, async t => {
    const { db, filepath, mgr, job } = downloadFixture(t, { skipped: true }, false)
    db.prepare("UPDATE tracks SET duration = 492 WHERE id IN ('g1', 'g2')").run()
    job.opts.confirmedImported = approved
    const result = await mgr.indexOne(job, filepath)
    if (approved.length === 2) {
      assert.equal(result.libraryAdded, true)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlist_tracks WHERE track_id = ?').get('target').n, 2) // imported rows dedupe; pre-existing streamed row also resolves
      assert.equal(db.prepare('SELECT duration FROM tracks WHERE id = ?').get('target').duration, 200)
    } else {
      assert.equal(result.libraryAdded, false)
      assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks ORDER BY position').all().map(r => r.track_id), ['g1', 'g2', 'streamed'])
      assert.ok(db.prepare('SELECT id FROM tracks WHERE id = ?').get('target'))
    }
  })
}

test('duration approval never permits the wrong title', async t => {
  const { db, filepath, mgr, job } = downloadFixture(t, { skipped: true })
  job.opts.confirmedImported = ['g1', 'g2']
  assert.equal((await mgr.indexOne(job, filepath)).libraryAdded, false)
  assert.equal(db.prepare("SELECT track_id FROM playlist_tracks WHERE position = 0").get().track_id, 'g1')
})

test('manually selected source can replace a differently tagged ghost', async t => {
  const { db, filepath, mgr, job } = downloadFixture(t, { skipped: true })
  job.opts.manuallySelectedImported = ['g2']
  assert.equal((await mgr.indexOne(job, filepath)).libraryAdded, true)
  assert.equal(db.prepare('SELECT track_id FROM track_aliases WHERE old_id = ?').get('g2').track_id, 'target')
})

for (const approved of [false, true]) {
  test(`already downloaded alternate length needs approval: ${approved}`, t => {
    const { db, mgr } = downloadFixture(t, { skipped: true }, false)
    db.prepare("UPDATE tracks SET source_ref = 'a-0123456789:song' WHERE id = 'target'").run()
    db.prepare("UPDATE tracks SET duration = 492 WHERE id = 'g1'").run()
    mgr.configure({ findTools: () => ({ ytdlp: 'unused' }) })
    mgr.pump = () => {}
    const result = mgr.enqueue('single', 'https://addon.example/file.flac', {
      title: 'Song', addonSource: { provider: 'a-0123456789', id: 'song' }, replaceImported: ['g1'], confirmedImported: approved ? ['g1'] : [],
    })
    if (approved) {
      assert.equal(result.alreadyInLibrary, true)
      assert.equal(db.prepare('SELECT track_id FROM track_aliases WHERE old_id = ?').get('g1').track_id, 'target')
    } else {
      assert.match(result.error, /could not replace/)
      assert.equal(db.prepare('SELECT track_id FROM playlist_tracks WHERE position = 0').get().track_id, 'g1')
    }
  })
}

test('shared queued job merges only approvals belonging to requested rows', t => {
  const { db } = fixture(t)
  const mgr = new DownloadManager()
  mgr.configure({ getDB: () => db, findTools: () => ({ ytdlp: 'unused' }) })
  mgr.pump = () => {}
  const url = 'https://www.youtube.com/watch?v=aaaaaaaaaaa'
  const first = mgr.enqueue('single', url, { replaceImported: ['g1'] })
  mgr.enqueue('single', url, { replaceImported: ['g2'], confirmedImported: ['g2', 'g1'], manuallySelectedImported: ['g2', 'g1'] })
  const job = mgr.jobs.get(first.downloadId)
  assert.deepEqual(job.opts.confirmedImported, ['g2'])
  assert.deepEqual(job.opts.manuallySelectedImported, ['g2'])
  clearTimeout(job.emitTimer)
})

test('desktop and web download handlers preserve only row-scoped approvals', t => {
  const manager = require('../electron/download/manager.js').getDownloadManager()
  const calls = []
  const fake = { init() {}, enqueue: (kind, url, opts) => { calls.push(opts); return { downloadId: 'job' } } }
  t.mock.method(manager, 'configure', () => fake)
  const handlers = new Map()
  require('../electron/ipc/downloader.js').registerDownloaderHandlers({ handle: (name, handler) => handlers.set(name, handler) })
  const router = require('../server/routes/download.js')
  const web = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack[0].handle
  const opts = { replaceImported: ['g1', 'bad/id'], confirmedImported: ['g1', 'g2', 'bad/id'], manuallySelectedImported: ['g1', 'g2'], expectedDuration: 210 }
  handlers.get('downloader:download')(null, 'https://youtube.com/watch?v=aaaaaaaaaaa', opts)
  const response = { status() { return this }, json() {} }
  web({ body: { url: 'https://youtube.com/watch?v=aaaaaaaaaaa', ...opts } }, response)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.deepEqual(call.replaceImported, ['g1'])
    assert.deepEqual(call.confirmedImported, ['g1'])
    assert.deepEqual(call.manuallySelectedImported, ['g1'])
    assert.equal(call.expectedDuration, 210)
  }
})

for (const confirmed of [false, true]) {
  test(`missing row upgrade retains its identity only with duration confirmation (${confirmed})`, async t => {
    const { db, filepath, add } = fixture(t)
    const missing = path.join(path.dirname(filepath), 'missing.flac')
    add('missing-row', missing, 'Song', 'Artist', 492)
    t.mock.method(mm, 'parseFile', async () => ({ format: { duration: 210 } }))
    const mgr = new DownloadManager()
    mgr.deps = { getDB: () => db, index: () => { indexed++; return { id: 'separate' } } }
    let indexed = 0
    t.mock.method(mgr, 'update', () => {})
    const job = { opts: { upgradeTrackId: 'missing-row', allowUpgradeDurationMismatch: confirmed }, indexedTracks: [], outputLines: [], kind: 'single', url: '' }
    await mgr.indexOne(job, filepath)
    const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get('missing-row')
    assert.equal(row.file_path, confirmed ? filepath : missing)
    assert.equal(row.duration, confirmed ? 210 : 492)
    assert.equal(indexed, confirmed ? 0 : 1)
    assert.equal(job.upgradedTrackId, confirmed ? 'missing-row' : undefined)
  })
}

test('album route marks missing files while retaining existing album normalization', t => {
  const { db, filepath, add } = fixture(t)
  add('present', filepath)
  add('missing', `${filepath}.absent`)
  db.prepare('UPDATE tracks SET album = ?, album_artist = ?').run('Album', 'Artist')
  const router = require('../server/routes/tracks.js')
  const handler = router.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack[0].handle
  let rows
  handler({ query: { album: 'Album', albumArtist: 'Artist' } }, { json: value => { rows = value } })
  assert.equal(rows.length, 2)
  assert.equal(rows.find(row => row.id === 'present').missing, false)
  assert.equal(rows.find(row => row.id === 'missing').missing, true)
  assert.ok(rows.every(row => row.album === 'Album'))
})
