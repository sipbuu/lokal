import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { downloadVideo, peekDurableVideoFile, durablePath, migrationStatus, migrateOldVideos, rememberVideoFile, recordedVideoFile, deleteVideoFiles, safePart, updateVideoReferences } = require('../electron/online/musicVideoDownloads.js')
const Database = require('better-sqlite3')

test('music videos download once into artist folders and never trim durable files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-cache-'))
  let downloads = 0
  const trimmed = []
  const fetchStream = async () => {
    downloads++
    return {
      mime: 'video/mp4',
      res: new Response(new Uint8Array([0, 1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '4' },
      }),
    }
  }
  try {
    const options = { videosDir: dir, artist: 'The Weeknd', title: 'Blinding Lights', fetchStream, trim: value => trimmed.push(value) }
    assert.equal(peekDurableVideoFile('4NRXx6U8ABQ', options), null)
    const first = await downloadVideo('4NRXx6U8ABQ', options)
    assert.equal(path.dirname(first), path.join(dir, 'The Weeknd'))
    assert.equal(peekDurableVideoFile('4NRXx6U8ABQ', options), first)
    const second = await downloadVideo('4NRXx6U8ABQ', options)
    assert.equal(first, second)
    assert.equal(downloads, 1)
    assert.deepEqual([...fs.readFileSync(first)], [0, 1, 2, 3])
    assert.deepEqual(trimmed, [])
    assert.equal(fs.readdirSync(dir).length, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('durable downloads use artist folders and migration is safe to repeat', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-durable-'))
  const old = path.join(root, 'old')
  fs.mkdirSync(old)
  fs.writeFileSync(path.join(old, '4NRXx6U8ABQ-1080.mp4'), Buffer.from([1, 2, 3]))
  const target = durablePath(root, 'A/B', 'Song: title', '4NRXx6U8ABQ', 1080, 'mp4')
  try {
    const status = migrationStatus({ cacheDir: old })
    assert.deepEqual(status, { count: 1, bytes: 3 })
    const first = migrateOldVideos({ cacheDir: old, videosDir: root, resolve: () => ({ artist: 'A/B', title: 'Song: title' }) })
    assert.equal(first.migrated, 1, first.errors.join(' · '))
    assert.equal(fs.existsSync(target), true)
    assert.equal(fs.existsSync(path.join(old, '4NRXx6U8ABQ-1080.mp4')), false)
    const second = migrateOldVideos({ cacheDir: old, videosDir: root, resolve: () => ({ artist: 'A/B', title: 'Song: title' }) })
    assert.equal(second.migrated, 0)
    assert.equal(second.count, 0)
    assert.equal(peekDurableVideoFile('4NRXx6U8ABQ', { videosDir: root, artist: 'A/B', videoHeight: 1080 }), target)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('portable path parts cannot traverse folders or use Windows devices', () => {
  assert.equal(safePart('CON', 'fallback'), '_CON')
  assert.equal(safePart('NUL.txt', 'fallback'), '_NUL.txt')
  assert.equal(safePart('..', 'Unknown Artist'), 'Unknown Artist')
  const file = durablePath('/videos', '../A: B/', 'Song? *', '4NRXx6U8ABQ', 720, 'webm')
  assert.equal(path.relative('/videos', file).split(path.sep).length, 2)
  assert.ok(!path.basename(file).includes('?'))
  assert.throws(() => durablePath('/videos', 'artist', 'song', '../escape', 720, 'mp4'))
})

test('migration retains source on reference failure, retries idempotently and never overwrites', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-migration-'))
  const old = path.join(root, 'old')
  fs.mkdirSync(old)
  const source = path.join(old, '4NRXx6U8ABQ-1080.mp4')
  fs.writeFileSync(source, 'video')
  const options = { cacheDir: old, videosDir: root, resolve: () => ({ artist: 'Artist', title: 'Song' }) }
  const occupied = durablePath(root, 'Artist', 'Song', '4NRXx6U8ABQ', 1080, 'mp4')
  fs.mkdirSync(path.dirname(occupied))
  fs.writeFileSync(occupied, 'existing video')
  try {
    const failure = migrateOldVideos({ ...options, onMove: () => { throw new Error('DB unavailable') } })
    assert.equal(failure.migrated, 0)
    assert.equal(fs.existsSync(source), true)
    assert.equal(fs.readFileSync(occupied, 'utf8'), 'existing video')
    let updated
    const success = migrateOldVideos({ ...options, onMove: (from, to) => { assert.equal(fs.existsSync(from), true); updated = to } })
    assert.equal(success.migrated, 1, success.errors.join(' · '))
    assert.equal(fs.existsSync(source), false)
    assert.equal(fs.readFileSync(updated, 'utf8'), 'video')
    assert.equal(fs.readdirSync(path.dirname(occupied)).length, 2)
    assert.equal(migrateOldVideos(options).migrated, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('downloaded file paths survive a DB reopen and deletion removes only the downloaded video', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-db-'))
  const file = path.join(root, 'video.mp4')
  const song = path.join(root, 'song.mp3')
  fs.writeFileSync(file, 'video')
  fs.writeFileSync(song, 'song')
  const dbFile = path.join(root, 'library.sqlite')
  let db = new Database(dbFile)
  try {
    rememberVideoFile(db, { videoId: '4NRXx6U8ABQ', artist: 'Artist', title: 'Song' }, file, 1080)
    db.close()
    db = new Database(dbFile)
    assert.equal(recordedVideoFile(db, '4NRXx6U8ABQ', 720), file)
    assert.equal(deleteVideoFiles(db, '4NRXx6U8ABQ'), 1)
    assert.equal(fs.existsSync(file), false)
    assert.equal(fs.existsSync(song), true)
    assert.equal(recordedVideoFile(db, '4NRXx6U8ABQ', 1080), null)
    assert.equal(deleteVideoFiles(db, '4NRXx6U8ABQ'), 0)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('cancelled and incomplete downloads leave no finished or partial files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-error-'))
  try {
    const options = { videosDir: root, artist: 'Artist', title: 'Song', fetchStream: async () => ({ mime: 'video/mp4', res: new Response('short', { headers: { 'content-length': '20' } }) }) }
    await assert.rejects(downloadVideo('4NRXx6U8ABQ', options), /incomplete/)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(downloadVideo('4NRXx6U8ABQ', { ...options, signal: controller.signal }), /cancelled/)
    assert.deepEqual(fs.readdirSync(path.join(root, 'Artist')), [])
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('migration updates DB, settings and queue references before deleting the source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-refs-'))
  const old = path.join(root, 'old')
  fs.mkdirSync(old)
  const file = path.join(old, '4NRXx6U8ABQ-1080.mp4')
  fs.writeFileSync(file, 'video')
  const db = new Database(':memory:')
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE saved_music_videos (track_id TEXT PRIMARY KEY, video_json TEXT); CREATE TABLE download_jobs (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER)')
  db.prepare('INSERT INTO settings VALUES (?, ?)').run('last_video', file)
  db.prepare('INSERT INTO saved_music_videos VALUES (?, ?)').run('song', JSON.stringify({ file }))
  db.prepare('INSERT INTO download_jobs VALUES (?, ?, ?)').run('mv', JSON.stringify({ kind: 'music-video', song: file, filepaths: [file], opts: { cacheDir: old, videoId: '4NRXx6U8ABQ' } }), 0)
  db.prepare('INSERT INTO download_jobs VALUES (?, ?, ?)').run('other', JSON.stringify({ kind: 'music-video', opts: { videoId: 'IKqV7DB8Iwg', artist: 'Other artist' } }), 0)
  try {
    let target
    const result = migrateOldVideos({ cacheDir: old, videosDir: root, resolve: () => ({ artist: 'Artist', title: 'Song', trackId: 'song' }), onMove: (from, to, video) => {
      assert.equal(fs.existsSync(from), true)
      updateVideoReferences(db, from, to, video, root)
      target = to
    } })
    assert.equal(result.migrated, 1, result.errors.join(' · '))
    assert.equal(fs.existsSync(file), false)
    assert.equal(recordedVideoFile(db, '4NRXx6U8ABQ', 1080), target)
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'last_video'").get().value, target)
    assert.equal(JSON.parse(db.prepare("SELECT video_json FROM saved_music_videos WHERE track_id = 'song'").get().video_json).file, target)
    const job = JSON.parse(db.prepare("SELECT data FROM download_jobs WHERE id = 'mv'").get().data)
    assert.equal(job.song, target)
    assert.deepEqual(job.filepaths, [target])
    assert.equal(job.opts.videosDir, root)
    assert.equal(job.opts.cacheDir, undefined)
    assert.equal(JSON.parse(db.prepare("SELECT data FROM download_jobs WHERE id = 'other'").get().data).opts.artist, 'Other artist')
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('cache maintenance preserves durable downloads and legacy videos awaiting migration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-maintenance-'))
  const db = require('../electron/ipc/db.js')
  const storageDir = db.getStorageDir
  db.getStorageDir = () => root
  const cache = require('../electron/cache.js')
  fs.mkdirSync(path.join(root, 'music-video-cache'))
  fs.mkdirSync(path.join(root, 'motion-covers'))
  const legacy = path.join(root, 'music-video-cache', '4NRXx6U8ABQ-1080.mp4')
  const durable = durablePath(path.join(root, 'Videos'), 'Artist', 'Song', '4NRXx6U8ABQ', 1080, 'mp4')
  fs.mkdirSync(path.dirname(durable), { recursive: true })
  fs.writeFileSync(legacy, 'old video')
  fs.writeFileSync(durable, 'new video')
  fs.writeFileSync(path.join(root, 'motion-covers', 'cover.mp4'), 'cover')
  try {
    assert.equal(cache.trim({ settings: { cache_limit_mb: 512 } }).total, 5)
    assert.equal(cache.clear(), 1)
    assert.equal(fs.existsSync(legacy), true)
    assert.equal(fs.existsSync(durable), true)
  } finally { db.getStorageDir = storageDir; fs.rmSync(root, { recursive: true, force: true }) }
})
