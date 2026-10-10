import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const storage = require('../electron/online/musicVideoDownloads.js')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-stack-'))
  const old = path.join(root, 'music-video-cache')
  const videos = path.join(root, 'Videos')
  fs.mkdirSync(old)
  const db = new Database(':memory:')
  db.exec('CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, duration REAL, file_path TEXT); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE download_jobs (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER)')
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?)').run('track-id', 'Song', 'Artist', 200, path.join(root, 'song.mp3'))
  fs.writeFileSync(path.join(root, 'song.mp3'), 'audio')
  const video = { videoId: 'abcdefghijk', title: 'Song', artist: 'Artist', duration: 200, segments: [{ start: 0, end: null, offset: 0 }], check: 'length' }
  const file = path.join(old, 'abcdefghijk-720.mp4')
  fs.writeFileSync(file, 'video')
  const metadata = path.join(root, 'music-videos.json')
  fs.writeFileSync(metadata, JSON.stringify({ 'v2|track-id|song|artist|200': { at: 1, video } }))
  const filename = require.resolve('../electron/ipc/online.js')
  const localRequire = createRequire(filename)
  const module = { exports: {} }
  const manager = { jobs: new Map(), persist() {}, emit() {} }
  let queued = 0
  const context = vm.createContext({
    require: id => {
      if (id === './db') return { getDB: () => db }
      if (id === './tools') return { findYtDlp: () => null, findFfmpeg: () => null }
      if (id === 'electron') return { app: { getPath: name => name === 'videos' ? videos : root } }
      if (id === '../cache') return { cacheDir: () => old }
      if (id === '../online/musicVideoDownloads') return { ...storage, videosDir: () => videos, peekDurableVideoFile: (id, options) => storage.peekDurableVideoFile(id, { ...options, videosDir: videos }) }
      if (id === '../online/youtubeSession') return { createYouTubeSession: () => ({ credentials: async () => ({}) }) }
      if (id === '../discoveryArtwork') return { createArtworkResolver: () => () => [] }
      if (id === '../online/sources') return { pruneOnlineTracks() {}, addons: { refreshManifests: async () => {} } }
      if (id === '../online/musicVideo') return { ...localRequire(id), findMusicVideo: () => { throw new Error('Local downloads must not rescan YouTube') } }
      if (id === './downloader') return { manager: () => manager, queueMusicVideo: () => { queued++; return { downloadId: 'queued' } } }
      return localRequire(id)
    },
    module, console, process, Buffer, URL, setTimeout: () => ({ unref() {} }), clearTimeout,
  })
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  return { db, root, old, videos, file, video, metadata, online: module.exports, queued: () => queued, cleanup: () => { db.close(); fs.rmSync(root, { recursive: true, force: true }) } }
}

test('v2 local downloads survive v3 invalidation and expose offline playable hover-preview files', async () => {
  const state = fixture()
  try {
    const rows = state.online.listMusicVideos()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].downloaded, true)
    assert.equal(rows[0].video.file, state.file)
    const prepared = await state.online.prepareMusicVideoFor('track-id')
    assert.equal(prepared.file, state.file)
    assert.equal(state.queued(), 0)
  } finally { state.cleanup() }
})

test('explicit migration retains old track and artist identity and remains offline playable', async () => {
  const state = fixture()
  try {
    const handlers = new Map()
    state.online.registerOnlineHandlers({ handle: (name, fn) => handlers.set(name, fn) })
    const result = handlers.get('musicVideo:migrate')()
    assert.equal(result.migrated, 1, result.errors.join(' · '))
    const file = storage.recordedVideoFile(state.db, state.video.videoId, 1080)
    assert.equal(path.dirname(file), path.join(state.videos, 'Artist'))
    const record = JSON.parse(state.db.prepare('SELECT video_json FROM downloaded_music_videos').get().video_json)
    assert.equal(record.trackId, 'track-id')
    assert.equal(record.artist, 'Artist')
    assert.equal(fs.existsSync(state.file), false)
    assert.equal((await state.online.prepareMusicVideoFor('track-id')).file, file)
    assert.equal(state.online.listMusicVideos()[0].video.file, file)
    assert.equal(handlers.get('musicVideo:migrate')().migrated, 0)
    assert.equal(state.queued(), 0)
  } finally { state.cleanup() }
})

test('renamed local tracks retain downloaded v2 metadata without a network rescan', async () => {
  const state = fixture()
  try {
    state.db.prepare('UPDATE tracks SET title = ?, artist = ?').run('Renamed song', 'Renamed artist')
    const rows = state.online.listMusicVideos()
    assert.equal(rows[0].track.artist, 'Renamed artist')
    assert.equal(rows[0].video.file, state.file)
    assert.equal((await state.online.prepareMusicVideoFor('track-id')).file, state.file)
    assert.equal(state.queued(), 0)
  } finally { state.cleanup() }
})

test('prepare never queues a replacement download after explicit deletion', async () => {
  const state = fixture()
  try {
    fs.writeFileSync(state.metadata, JSON.stringify({ 'v3|track-id|song|artist|200': { at: Date.now(), video: { ...state.video, motion: 'verified' } } }))
    const handlers = new Map()
    state.online.registerOnlineHandlers({ handle: (name, fn) => handlers.set(name, fn) })
    assert.equal((await handlers.get('musicVideo:deleteDownload')(null, 'track-id')).success, true)
    assert.equal(fs.existsSync(state.file), false)
    assert.equal(fs.existsSync(path.join(state.root, 'song.mp3')), true)
    for (let attempt = 0; attempt < 2; attempt++) {
      const prepared = await state.online.prepareMusicVideoFor('track-id')
      assert.equal(prepared.needsDownload, true)
      assert.equal(prepared.file, null)
    }
    assert.equal(state.queued(), 0)
    const downloaded = await state.online.prepareMusicVideoFor('track-id', { download: true })
    assert.equal(downloaded.downloadId, 'queued')
    assert.equal(state.queued(), 1)
  } finally { state.cleanup() }
})

test('video deletion refuses audio extensions and any files referenced by the audio library', () => {
  const state = fixture()
  try {
    const audio = path.join(state.root, 'song.mp3')
    storage.rememberVideoFile(state.db, state.video, audio, 1080)
    assert.throws(() => storage.deleteVideoFiles(state.db, state.video.videoId), /audio library/)
    assert.equal(fs.existsSync(audio), true)
    storage.rememberVideoFile(state.db, state.video, state.file, 1080)
    state.db.prepare('UPDATE tracks SET file_path = ?').run(state.file)
    assert.throws(() => storage.deleteVideoFiles(state.db, state.video.videoId), /audio library/)
    assert.equal(fs.existsSync(state.file), true)
  } finally { state.cleanup() }
})
