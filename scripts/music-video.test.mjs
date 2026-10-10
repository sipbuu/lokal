import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { findMusicVideo, discoveredVideos, databaseVideos, isMusicVideoFor, baseTitle, plainTitle, artistNames, audioFeatures, alignAudio, videoTimeFor, FPS, hasVisualMotion, validateVisualMotion } = require('../electron/online/musicVideo.js')
const { runJsonSearch } = require('../electron/download/search.js')
const { songAudioFor } = require('../electron/ipc/online.js')

const track = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
const video = (fields) => ({ videoId: 'abcdefghijk', kind: 'video', official: true, artists: ['The Weeknd'], artist: 'The Weeknd', duration: 263, ...fields })

test('titles match without video tags and features', () => {
  assert.equal(baseTitle('Blinding Lights (Official Video)'), 'blinding lights')
  assert.equal(baseTitle('Levitating (feat. DaBaby) [4K]'), 'levitating')
  assert.deepEqual(artistNames('Dua Lipa feat. DaBaby & Elton John'), ['dua lipa', 'dababy', 'elton john'])
  assert.deepEqual(artistNames('TaylorSwiftVEVO'), ['taylorswift'])
})

test('only the official video of the same song by the same artist is a match', () => {
  assert.ok(isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)' })))
  assert.ok(isMusicVideoFor(track, video({ title: 'The Weeknd - Blinding Lights (Official Music Video)' })))
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', official: false })), 'not an official upload')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', artists: ['The Sevenights'], artist: 'The Sevenights' })), 'other artist')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Live at SoFi Stadium)' })), 'live')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Lyric Video)' })), 'lyric video')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Remix)' })), 'remix')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', isStatic: true })), 'static upload')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', visualMotion: false })), 'motion check rejection')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Save Your Tears (Official Video)' })), 'other song')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', kind: 'song' })), 'the song itself')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', duration: 120 })), 'shorter than the song')
  assert.ok(!isMusicVideoFor(track, video({ title: 'Blinding Lights (Official Video)', duration: 900 })), 'far longer')
  assert.ok(isMusicVideoFor({ ...track, title: 'Blinding Lights - Live' }, video({ title: 'Blinding Lights (Live)' })), 'the song is the live one')
})

// A deterministic "song": noise bursts at irregular onsets.
function song(seconds, seed = 1) {
  const rate = 8000
  const out = new Float32Array(seconds * rate)
  let x = seed
  const random = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
  let t = 0
  while (t < out.length) {
    const length = Math.floor(rate * (0.05 + random() * 0.1))
    const level = 0.2 + random() * 0.8
    for (let i = t; i < Math.min(out.length, t + length); i++) out[i] = (random() * 2 - 1) * level * (1 - (i - t) / length)
    t += length + Math.floor(rate * (0.1 + random() * 0.5))
  }
  return out
}

test('finds where the song starts inside a video with an intro', () => {
  const audio = song(90)
  const intro = new Float32Array(8000 * 20).map((_, i) => Math.sin(i / 3) * 0.05) // 20 s of a quiet hum
  const clip = new Float32Array(intro.length + audio.length)
  clip.set(intro)
  clip.set(audio, intro.length)
  const segments = alignAudio(audioFeatures(audio), audioFeatures(clip))
  assert.ok(segments)
  assert.equal(segments.length, 1)
  assert.ok(Math.abs(segments[0].offset - 20) < 1 / FPS, `offset ${segments[0].offset}`)
  assert.ok(Math.abs(videoTimeFor(segments, 30) - 50) < 0.05)
})

test('follows a skit in the middle of the video', () => {
  const audio = song(120, 7)
  const half = 8000 * 60
  const skit = song(15, 99).map(v => v * 0.3)
  const clip = new Float32Array(audio.length + skit.length)
  clip.set(audio.subarray(0, half))
  clip.set(skit, half)
  clip.set(audio.subarray(half), half + skit.length)
  const segments = alignAudio(audioFeatures(audio), audioFeatures(clip))
  assert.ok(segments && segments.length === 2, JSON.stringify(segments))
  assert.ok(Math.abs(videoTimeFor(segments, 10) - 10) < 0.05)
  assert.ok(Math.abs(videoTimeFor(segments, 100) - 115) < 0.05)
})

test('rejects a video whose audio is another song', () => {
  assert.equal(alignAudio(audioFeatures(song(90, 3)), audioFeatures(song(100, 4))), null)
})

test('uses curated music-video links even when YouTube Music has no OMV result', async () => {
  const track = { id: 'blinding-lights', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
  const rows = [{ strTrack: 'Blinding Lights', strArtist: 'The Weeknd', intDuration: '201000', strMusicVid: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ' }]
  const found = await discoveredVideos(track, {
    audioDbSearch: async () => rows,
    fetchImpl: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
  })
  assert.deepEqual(found.candidates.map(item => item.videoId), ['4NRXx6U8ABQ'])
  assert.equal(found.inconclusive, false)
})

test('normalizes artist articles in curated music-video metadata', () => {
  const videos = databaseVideos(
    { title: "Let's Get It Started", artist: 'Black Eyed Peas', duration: 225 },
    [{ strTrack: "Let's Get It Started", strArtist: 'The Black Eyed Peas', intDuration: '225000', strMusicVid: 'https://www.youtube.com/watch?v=IKqV7DB8Iwg' }],
  )
  assert.equal(videos[0].videoId, 'IKqV7DB8Iwg')
  assert.ok(isMusicVideoFor({ title: "Let's Get It Started", artist: 'Black Eyed Peas', duration: 225 }, videos[0], { requireDuration: false }))
  assert.ok(isMusicVideoFor(
    { title: "Let's Get It Started", artist: 'Black Eyed Peas', duration: 225 },
    { ...videos[0], title: "The Black Eyed Peas - Let's Get It Started (Official Video)", duration: 225 },
  ))
})

test('a rejected curated row does not hide a later valid result with the same video id', async () => {
  const found = await discoveredVideos(
    { title: "Let's Get It Started", artist: 'Black Eyed Peas', duration: 225 },
    {
      audioDbSearch: async () => [{ strTrack: 'Wrong Song', strArtist: 'Black Eyed Peas', strMusicVid: 'https://www.youtube.com/watch?v=IKqV7DB8Iwg' }],
      fetchImpl: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
      youtubeSearch: async () => [{ videoId: 'IKqV7DB8Iwg', title: "The Black Eyed Peas - Let's Get It Started (Official Video)", artist: 'Black Eyed Peas', artists: ['Black Eyed Peas'], duration: 225, kind: 'video', official: true }],
    },
  )
  assert.deepEqual(found.candidates.map(item => item.videoId), ['IKqV7DB8Iwg'])
})

test('yt-dlp discovery is bounded when the child stalls', { skip: process.platform === 'win32' ? 'POSIX shell fixture requires /bin/sh' : false }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-ytdlp-'))
  const script = path.join(directory, 'yt-dlp-stall.sh')
  fs.writeFileSync(script, '#!/bin/sh\nsleep 1\n')
  fs.chmodSync(script, 0o755)
  try {
    const started = Date.now()
    const result = await runJsonSearch(script, 'song', () => null, 1, 10, undefined, { timeoutMs: 20 })
    assert.equal(result.error, 'YouTube search timed out')
    assert.ok(Date.now() - started < 500)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('does not cache a missing video when audio checking was inconclusive', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-music-video-'))
  const cacheFile = path.join(directory, 'music-videos.json')
  const track = { id: 'online-track', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
  let searches = 0
  const fetchImpl = async url => String(url).endsWith('/')
    ? { ok: true, text: async () => '' }
    : { ok: true, json: async () => { searches++; return {} } }
  const options = {
    ffmpeg: '/definitely/missing/ffmpeg',
    songAudio: async () => ({ input: 'song', headers: {} }),
    videoAudio: async () => ({ input: 'video', headers: {} }),
    fetchImpl,
    audioDbSearch: async () => [{ strTrack: 'Blinding Lights', strArtist: 'The Weeknd', intDuration: '230000', strMusicVid: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    cacheFile,
  }
  try {
    assert.equal(await findMusicVideo(track, options), null)
    assert.equal(fs.existsSync(cacheFile), false)
    assert.equal(await findMusicVideo(track, options), null)
    assert.equal(searches, 4)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

for (const track of [
  { file_path: 'ghost://soundcloud/online/123' },
  { file_path: 'ghost://addon/0123456789/track%2Fone' },
]) {
  test(`full music-video matching resolves ${track.file_path.split('://')[1].split('/')[0]} audio through sources.resolveStream`, async () => {
    const calls = []
    const getAudio = songAudioFor(track, true, {
      options: { db: 'db', ytdlp: '/fixture/yt-dlp' },
      resolve: async (provider, id, options) => {
        calls.push({ provider, id, options })
        return { url: `https://media.example.test/${provider}/${encodeURIComponent(id)}`, headers: { Authorization: 'test' } }
      },
    })
    assert.ok(getAudio)
    assert.deepEqual(await getAudio(0), {
      input: `https://media.example.test/${track.file_path.startsWith('ghost://soundcloud') ? 'sc/123' : 'a-0123456789/track%2Fone'}`,
      headers: { Authorization: 'test' },
    })
    assert.deepEqual(await getAudio(1), {
      input: `https://media.example.test/${track.file_path.startsWith('ghost://soundcloud') ? 'sc/123' : 'a-0123456789/track%2Fone'}`,
      headers: { Authorization: 'test' },
    })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].options.force, false)
    assert.equal(calls[1].options.force, true)
  })

  test(`${track.file_path.split('://')[1].split('/')[0]} audio does not depend on yt-dlp`, () => {
    assert.equal(typeof songAudioFor(track, false, {
      options: { db: 'db' },
      resolve: async () => ({ url: 'https://media.example.test/audio', headers: {} }),
    }), 'function')
  })
}

test('plainTitle strips vanity tags and leaves real titles alone', () => {
  assert.equal(plainTitle("Let's Get It Started (Spice Mix)"), "Let's Get It Started")
  assert.equal(plainTitle('Africa - Radio Edit'), 'Africa')
  assert.equal(plainTitle('One More Time (2011 Remaster) [Deluxe Edition]'), 'One More Time')
  assert.equal(plainTitle("(What's the Story) Morning Glory"), null, 'a leading parenthesis is the title itself')
  assert.equal(plainTitle('Blinding Lights'), null)
  assert.equal(plainTitle('Knives Out - live'), null, 'live is another performance, not a vanity tag')
})

test('falls back to the vanity-free title and takes its official video by name', async () => {
  const track = { id: 'spice-mix', title: "Let's Get It Started (Spice Mix)", artist: 'The Black Eyed Peas', duration: 180 }
  const queries = []
  const video = await findMusicVideo(track, {
    visualMotion: async () => true,
    fetchImpl: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    audioDbSearch: async () => [],
    youtubeSearch: async (query) => {
      queries.push(query)
      return query.includes('Spice Mix') ? [] : [{
        videoId: 'IKqV7DB8Iwg', title: "The Black Eyed Peas - Let's Get It Started (Official Music Video)",
        artist: 'The Black Eyed Peas', artists: ['The Black Eyed Peas'], duration: 225, kind: 'video', official: true,
      }]
    },
  })
  assert.ok(video, 'the original version\'s video is found')
  assert.equal(video.videoId, 'IKqV7DB8Iwg')
  assert.equal(video.check, 'title')
  assert.deepEqual(video.segments, [{ start: 0, end: null, offset: 0 }])
  assert.ok(queries.some(q => q.includes('Spice Mix')) && queries.some(q => !q.includes('Spice Mix')))
})

function framesFor(kind) {
  const frames = Buffer.alloc(64 * 36 * 72)
  for (let frame = 0; frame < 72; frame++) {
    const shift = kind === 'moving' ? frame : kind === 'slideshow' ? Math.floor(frame / 24) * 8 : 0
    for (let pixel = 0; pixel < 64 * 36; pixel++) frames[frame * 64 * 36 + pixel] = ((pixel + shift) * 31) % 240
  }
  return frames
}

test('motion validation rejects still art and slide changes but accepts continuous picture motion', async () => {
  assert.equal(hasVisualMotion(framesFor('static')), false)
  assert.equal(hasVisualMotion(framesFor('slideshow')), false)
  assert.equal(hasVisualMotion(framesFor('moving')), true)
  assert.equal(hasVisualMotion(Buffer.alloc(64 * 36 * 72)), null)
  assert.equal(await validateVisualMotion('ffmpeg', async () => ({ input: 'video' }), 200, { decode: async () => framesFor('moving') }), true)
  assert.equal(await validateVisualMotion('ffmpeg', async () => ({ input: 'video' }), 200, { decode: async () => framesFor('slideshow') }), false)
  assert.equal(await validateVisualMotion(null, async () => ({ input: 'video' }), 200), null)
})

test('unproven visual motion keeps audio fallback and does not cache a missing match', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-motion-'))
  const cacheFile = path.join(root, 'matches.json')
  const track = { id: 'motion', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }
  const options = {
    cacheFile,
    fetchImpl: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    audioDbSearch: async () => [],
    youtubeSearch: async () => [{ videoId: '4NRXx6U8ABQ', title: 'Blinding Lights (Official Video)', artists: ['The Weeknd'], artist: 'The Weeknd', duration: 200, kind: 'video', official: true }],
  }
  try {
    assert.equal(await findMusicVideo(track, { ...options, visualMotion: async () => null }), null)
    assert.equal(fs.existsSync(cacheFile), false)
    assert.equal(await findMusicVideo(track, { ...options, visualMotion: async () => false }), null)
    fs.rmSync(cacheFile, { force: true })
    const video = await findMusicVideo(track, { ...options, visualMotion: async () => true })
    assert.equal(video?.motion, 'verified')
    assert.equal(video?.check, 'length')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('the lookup reports its progress', async () => {
  const stages = []
  await findMusicVideo({ id: 'p1', title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    audioDbSearch: async () => [],
    onProgress: p => stages.push(p.stage),
  })
  assert.ok(stages.includes('searching'))
  assert.equal(stages[stages.length - 1], 'done')
})
