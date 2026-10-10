import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { DownloadManager } = require('../electron/download/manager.js')
const url = 'https://www.youtube.com/watch?v=4NRXx6U8ABQ'
const options = { videoId: '4NRXx6U8ABQ', title: 'Blinding Lights', videosDir: '/videos', artist: 'The Weeknd', videoHeight: 1080 }

function manager(deps = {}) {
  const mgr = new DownloadManager().configure({ findTools: () => ({ ytdlp: '/fixture/yt-dlp' }), ...deps })
  mgr.initialized = true
  mgr.persist = () => {}
  return mgr
}

test('video downloads share the real queue, deduplicate, and finish without audio library indexing', async () => {
  let complete
  let progress
  const snapshots = []
  let indexed = false
  const mgr = manager({
    emit: value => snapshots.push(value),
    index: () => { indexed = true },
    downloadMusicVideo: async (_, opts) => {
      progress = opts.onProgress
      return new Promise(resolve => { complete = resolve })
    },
  })
  const first = mgr.enqueue('music-video', url, options)
  const again = mgr.enqueue('music-video', url, options)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(again.downloadId, first.downloadId)
  assert.equal(mgr.list()[0].kind, 'music-video')
  assert.equal(mgr.list()[0].status, 'downloading')
  progress({ percent: 42 })
  assert.equal(mgr.list()[0].progress, 42)
  complete('/videos/The Weeknd/Blinding Lights - 4NRXx6U8ABQ - 1080.mp4')
  const job = await mgr.waitFor(first.downloadId)
  assert.equal(job.status, 'done')
  assert.equal(job.song, '/videos/The Weeknd/Blinding Lights - 4NRXx6U8ABQ - 1080.mp4')
  assert.deepEqual(job.filepaths, [job.song])
  assert.equal(indexed, false)
  assert.ok(snapshots.some(s => s.status === 'done'))
})

test('completed video job paths survive restart and removal deletes the real file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-video-queue-'))
  const file = path.join(root, 'video.mp4')
  fs.writeFileSync(file, 'video')
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  const deps = { getDB: () => db, findTools: () => ({ ytdlp: 'fixture' }), downloadMusicVideo: async () => file }
  const original = new DownloadManager().configure(deps)
  original.initialized = true
  original.ensureTable()
  try {
    const queued = original.enqueue('music-video', url, options)
    await original.waitFor(queued.downloadId)
    const restarted = new DownloadManager().configure(deps)
    restarted.init()
    const job = restarted.list().find(job => job.id === queued.downloadId)
    assert.equal(job.status, 'done')
    assert.equal(job.song, file)
    assert.deepEqual(job.filepaths, [file])
    assert.deepEqual(await restarted.remove(queued.downloadId), { success: true })
    assert.equal(fs.existsSync(file), false)
    assert.equal(db.prepare('SELECT id FROM download_jobs').all().length, 0)
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

test('video jobs respect download concurrency and can be cancelled from Downloads', async () => {
  const mgr = manager({ downloadMusicVideo: (_, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }) })
  mgr.concurrency = () => 1
  const first = mgr.enqueue('music-video', url, options)
  const second = mgr.enqueue('music-video', url.replace('4NRXx6U8ABQ', 'IKqV7DB8Iwg'), { ...options, videoId: 'IKqV7DB8Iwg' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mgr.jobs.get(second.downloadId).status, 'queued')
  await mgr.cancel(first.downloadId)
  assert.equal((await mgr.waitFor(first.downloadId)).status, 'cancelled')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mgr.jobs.get(second.downloadId).status, 'downloading')
  await mgr.cancel(second.downloadId)
  await mgr.waitFor(second.downloadId)
})
