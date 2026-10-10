import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const database = require('../electron/ipc/db.js')
const { DownloadManager } = require('../electron/download/manager.js')
const storage = require('../electron/online/musicVideoDownloads.js')
const references = require('../electron/online/musicVideoReferences.js')
const { knownMusicVideos } = require('../electron/online/musicVideo.js')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-identity-'))
  const previous = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = path.join(root, 'data')
  let db = database.initDB()
  db.exec('CREATE TABLE saved_music_videos (track_id TEXT PRIMARY KEY, added_at INTEGER NOT NULL, video_json TEXT NOT NULL)')
  storage.ensureDownloadsTable(db)
  const manager = new DownloadManager().configure({ getDB: () => db })
  manager.ensureTable()
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('music_folder', ?)").run(root)
  const add = (id, file = path.join(root, `${id}.flac`), source = null, added = 1) => {
    if (!file.startsWith('ghost://')) fs.writeFileSync(file, `audio ${id}`)
    db.prepare('INSERT INTO tracks (id, file_path, file_hash, title, artist, duration, source_ref, added_at) VALUES (?, ?, ?, ?, ?, 200, ?, ?)').run(id, file, id, 'Song', 'Artist', source, added)
    return file
  }
  const videoFile = path.join(root, 'video.mp4')
  fs.writeFileSync(videoFile, 'retained video')
  const video = { videoId: 'abcdefghijk', title: 'Song', artist: 'Artist', duration: 200, trackId: 'loser', motion: 'verified', file: videoFile }
  const save = (id = 'loser', metadata = video, at = 2) => db.prepare('INSERT INTO saved_music_videos VALUES (?, ?, ?)').run(id, at, JSON.stringify(metadata))
  const download = (metadata = video, height = 720) => storage.rememberVideoFile(db, metadata, videoFile, height)
  t.after(() => {
    db.close()
    if (previous === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previous
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, add, save, download, video, videoFile, manager, db: () => db, reopen: () => { db.close(); db = database.initDB(); return db } }
}

function assertReferences(state, target = 'winner') {
  const saved = state.db().prepare('SELECT track_id, video_json FROM saved_music_videos').get()
  assert.equal(saved.track_id, target)
  assert.equal(JSON.parse(saved.video_json).trackId, target)
  for (const row of state.db().prepare('SELECT file_path, video_json FROM downloaded_music_videos').all()) {
    assert.equal(JSON.parse(row.video_json).trackId, target)
    assert.equal(row.file_path, state.videoFile)
  }
  assert.equal(fs.readFileSync(state.videoFile, 'utf8'), 'retained video')
  assert.deepEqual(state.db().pragma('foreign_key_check'), [])
}

test('source migration preserves saved videos, both download heights, job pointers and legacy metadata aliases', t => {
  const state = fixture(t)
  state.db().exec('DROP INDEX idx_tracks_source_ref_unique')
  state.add('loser', undefined, 'yt:bbbbbbbbbbb', 1)
  state.add('winner', undefined, 'yt:bbbbbbbbbbb', 2)
  state.db().prepare('INSERT INTO track_aliases VALUES (?, ?)').run('old-ghost', 'loser')
  state.save('loser', { ...state.video, trackId: 'old-ghost' })
  state.download(); state.download(state.video, 1080)
  const job = state.manager.makeJob('music-video', 'https://youtu.be/abcdefghijk', { videoId: 'abcdefghijk', trackId: 'loser', video: state.video })
  job.indexedTracks = [{ id: 'loser', filepath: path.join(state.root, 'loser.flac') }]
  state.manager.jobs.set(job.id, job)
  state.manager.persist(job)
  const cacheFile = path.join(state.root, 'music-videos.json')
  fs.writeFileSync(cacheFile, JSON.stringify({ 'v2|old-ghost|song|artist|200': { at: 1, video: state.video } }))
  state.reopen()
  assertReferences(state)
  assert.equal(state.db().prepare('SELECT COUNT(*) AS n FROM downloaded_music_videos').get().n, 2)
  const receipt = JSON.parse(state.db().prepare('SELECT data FROM download_jobs').get().data)
  assert.equal(receipt.opts.trackId, 'winner')
  assert.equal(receipt.opts.video.trackId, 'winner')
  assert.equal(receipt.indexedTracks[0].id, 'winner')
  const known = knownMusicVideos([state.db().prepare('SELECT * FROM tracks').get()], { cacheFile, findFile: () => state.videoFile, resolveTrackId: id => references.resolveTrackId(state.db(), id) })
  assert.equal(known.length, 1)
  assert.equal(known[0].track.id, 'winner')
  assert.equal(known[0].video.file, state.videoFile)
  state.reopen()
  assertReferences(state)
})

test('a scanner-indexed replay merges video references before removing its duplicate track', async t => {
  const state = fixture(t)
  state.add('winner', undefined, 'yt:ccccccccccc')
  const duplicate = state.add('loser')
  state.save(); state.download()
  const manager = new DownloadManager().configure({ getDB: state.db, index: require('../electron/ipc/scanner.js').indexSingleFile })
  const job = manager.makeJob('single', 'https://youtu.be/ccccccccccc', { title: 'Song' })
  assert.equal((await manager.indexOne(job, duplicate)).libraryAdded, true)
  assertReferences(state)
  assert.equal(state.db().prepare('SELECT COUNT(*) AS n FROM tracks').get().n, 1)
})

test('restart repairs videos attached to an alias removed by an earlier app version and replays canonical track options', async t => {
  const state = fixture(t)
  state.add('winner')
  state.db().prepare('INSERT INTO track_aliases VALUES (?, ?)').run('loser', 'winner')
  state.save(); state.download()
  const oldJob = state.manager.makeJob('music-video', 'https://youtu.be/abcdefghijk', { videoId: 'abcdefghijk', trackId: 'loser' })
  state.manager.jobs.set(oldJob.id, oldJob)
  state.manager.persist(oldJob)
  state.reopen()
  assertReferences(state)
  let options
  const manager = new DownloadManager().configure({ getDB: state.db, downloadMusicVideo: async (_id, value) => { options = value; return state.videoFile } })
  manager.pump = () => {}
  manager.init()
  const job = manager.jobs.get(oldJob.id)
  assert.equal(job.opts.trackId, 'winner')
  job.opts.trackId = 'loser'
  manager.startMusicVideo(job)
  while (manager.running) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(options.trackId, 'winner')
  assert.equal(job.status, 'done')
})

test('ghost resolution and file upgrades retain saved and downloaded video associations', async t => {
  const state = fixture(t)
  state.add('winner')
  state.add('loser', 'ghost://youtube/online/abcdefghijk')
  state.save(); state.download()
  assert.equal(require('../server/routes/playlists.js').resolveGhostTrack(state.db(), 'loser', 'winner').ok, true)
  assertReferences(state)
  const replacement = state.add('replacement')
  state.db().prepare('UPDATE saved_music_videos SET track_id = ?, video_json = ?').run('replacement', JSON.stringify({ ...state.video, trackId: 'replacement' }))
  storage.rememberVideoFile(state.db(), { ...state.video, trackId: 'replacement' }, state.videoFile, 720)
  t.mock.method(require('../electron/musicMetadata'), 'parseFile', async () => ({ format: { duration: 200 } }))
  assert.equal((await require('../electron/quality/upgrade').upgradeTrackFile(state.db(), 'winner', replacement, { storageDir: path.join(state.root, 'data') })).id, 'winner')
  assertReferences(state)
  assert.equal(references.resolveTrackId(state.db(), 'replacement'), 'winner')
})

test('colliding saved pointers keep the latest selection while retaining downloaded video files', t => {
  const state = fixture(t)
  state.add('winner'); state.add('loser')
  state.save('winner', { ...state.video, trackId: 'winner', videoId: 'zzzzzzzzzzz' }, 1)
  state.save(); state.download()
  state.db().transaction(() => references.remapMusicVideoReferences(state.db(), 'loser', 'winner'))()
  assertReferences(state)
  assert.equal(JSON.parse(state.db().prepare('SELECT video_json FROM saved_music_videos').get().video_json).videoId, 'abcdefghijk')
})

test('a failed track merge rolls back saved-video keys and downloaded metadata pointers', async t => {
  const state = fixture(t)
  state.add('winner'); state.add('loser')
  state.save(); state.download()
  state.db().exec("CREATE TRIGGER reject_merge BEFORE DELETE ON tracks BEGIN SELECT RAISE(ABORT, 'track merge rejected'); END")
  const result = await require('../electron/ipc/mergeDuplicates').mergeDuplicates(state.db(), 'winner', ['loser'])
  assert.match(result.error, /track merge rejected/)
  assertReferences(state, 'loser')
  assert.equal(state.db().prepare('SELECT COUNT(*) AS n FROM tracks').get().n, 2)
})
