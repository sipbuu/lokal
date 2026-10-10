import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { buildArgs } = require('../electron/download/args.js')

const base = {
  kind: 'single',
  url: 'https://media.example.test/song.flac',
  outputDir: '/music',
  settings: { clean_download_metadata: '1' },
  ffmpeg: 'ffmpeg',
  format: { format: 'original', quality: '320' },
}

test('addon original downloads keep the source audio and skip yt-dlp postprocessing', () => {
  const { args } = buildArgs({ ...base, addonSource: { provider: 'a-0123456789', id: 'song' } })
  assert.equal(args.includes('-x'), false)
  assert.equal(args.includes('--audio-format'), false)
  assert.equal(args.includes('--embed-thumbnail'), false)
  assert.equal(args.includes('--embed-metadata'), false)
  assert.equal(args.includes('--parse-metadata'), false)
})

test('ordinary downloads and explicitly converted addon downloads retain their format processing', () => {
  const ordinary = buildArgs(base).args
  assert.ok(ordinary.includes('-x'))
  assert.ok(ordinary.includes('--embed-thumbnail'))
  assert.ok(ordinary.includes('--parse-metadata'))

  const converted = buildArgs({
    ...base,
    format: { format: 'mp3', quality: '320' },
    addonSource: { provider: 'a-0123456789', id: 'song' },
  }).args
  assert.ok(converted.includes('-x'))
  assert.deepEqual(converted.slice(converted.indexOf('--audio-format'), converted.indexOf('--audio-quality') + 2), ['--audio-format', 'mp3', '--audio-quality', '320K'])
  assert.equal(converted.includes('--embed-thumbnail'), false)
  assert.equal(converted.includes('--parse-metadata'), false)
})

test('addon songs with identical media filenames get isolated, stable output paths', () => {
  const output = source => {
    const args = buildArgs({ ...base, addonSource: source }).args
    return args[args.indexOf('--output') + 1]
  }
  const first = { provider: 'a-0123456789', id: 'first' }
  assert.equal(output(first), output(first))
  assert.notEqual(output(first), output({ ...first, id: 'second' }))
  assert.notEqual(output(first), output({ ...first, provider: 'a-9876543210' }))
  assert.ok(output({ ...first, id: '../../escape/%(title)s' }).startsWith(path.join(base.outputDir, path.sep)))
  assert.equal(output({ ...first, id: '../../escape/%(title)s' }).includes('escape'), false)
})

test('download metadata retains the webpage identity used when indexing playlist files', () => {
  const args = buildArgs({ ...base, kind: 'playlist' }).args
  assert.ok(args.some(value => value.startsWith('after_move:lokalmeta:') && value.includes('webpage_url')))
})
