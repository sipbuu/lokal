// Official music videos for songs, Apple Music style: found on YouTube Music,
// then checked against the song itself so the wrong video never shows.
//
//   1. discovery: curated TheAudioDB links, YouTube Music's Videos tab and
//      broad YouTube searches, all narrowed to official music videos whose
//      title and artist are the song's;
//   2. check: with ffmpeg, the song's audio is lined up against the video's
//      (onset envelopes, correlated window by window). That finds where the
//      song sits in the video -- an intro, a skit in the middle -- as a map
//      from song time to video time, and rejects a video whose audio isn't
//      the song.
//
// The video plays muted, following the song's own audio (see
// src/musicVideo.js), so lossless files, EQ and crossfade are untouched.

const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const yt = require('./youtube')
const audioDb = require('../theAudioDb')

// YouTube Music's "Videos" filter, retained as one discovery source.
const VIDEOS_PARAMS = 'EgWKAQIQAWoMEA4QChADEAQQCRAF'
const RATE = 8000 // Hz, mono: plenty for onsets
const HOP = 160 // samples per frame: 50 frames a second
const FPS = RATE / HOP
const WINDOW_S = 12
const STEP_S = 8
// A window's match counts from this correlation; the song is in the video when
// most windows match and well on average.
const COARSE_CORRELATION = 0.2
const COARSE_CANDIDATES = 12
const CANDIDATE_CORRELATION = 0.2
const NO_MATCH_SCORE = 0.25
const OFFSET_CHANGE_COST = 0.3
const SAME_OFFSET_S = 0.1
const MIN_COVERAGE = 0.5
const MIN_MEAN_CORRELATION = 0.38
// The video may start a little before the song (cut-in) and run longer
// (intros, skits, end scenes) by this much.
const LEAD_S = 4
const MAX_EXTRA_S = 240
const SAME_LENGTH_S = 3
const DECODE_TIMEOUT_MS = 120000
const FOUND_TTL_MS = 60 * 24 * 60 * 60 * 1000
const MISSING_TTL_MS = 3 * 24 * 60 * 60 * 1000

// Words in a video's title that mean it isn't the recording itself, unless the
// song's own title has them too.
const OTHER_VERSION = ['live', 'lyric', 'lyrics', 'visualizer', 'visualiser', 'audio', 'cover', 'slideshow', 'photo', 'static', 'remix', 'sped', 'slowed', 'reverb', 'karaoke',
  'instrumental', 'teaser', 'trailer', 'behind', 'making', 'reaction', 'acoustic', '8d', 'nightcore', 'boosted', 'extended', 'piano',
  'tutorial', 'practice', 'performance', 'session', 'concert', 'tour', 'rehearsal', 'shorts', 'loop', 'hour', 'mashup', 'parody']
// Tags around the title that don't change what it is.
const NOISE_TAG = /[([](?:[^)\]]*\b(?:official|video|hd|hq|4k|remaster(?:ed)?|explicit|clean|uncensored|mv|m\/v|music video)\b[^)\]]*)[)\]]/gi
const FEAT = /[([]?\s*\b(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?/gi
// Vanity tags at the end of a song's own title -- "(Spice Mix)", "- Radio
// Edit", "(2011 Remaster)" -- that name a version the original video covers.
const VANITY_WORD = /\b(?:mix|remix|edit|version|remaster(?:ed)?|rework(?:ed)?|redux|reprise|mono|stereo|deluxe|single|radio|cut|dub|demo|take|session|anniversary|bonus|sped|slowed|extended|edition|master)\b/i
const VANITY_PAREN = /\s*[([][^()[\]]*[)\]]\s*$/
const VANITY_DASH = /\s+[-\u2013\u2014]\s+[^-\u2013\u2014]+$/

/** Lowercase words only: no accents, punctuation or "&". */
function clean(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9\u00c0-\uffff]+/g, ' ').trim()
}

/** The title without "(Official Video)", "[4K]", "feat. X". */
function baseTitle(title) {
  return clean(String(title || '').replace(NOISE_TAG, ' ').replace(FEAT, ' '))
}

/**
 * The title without a trailing vanity tag -- "Let's Get It Started (Spice
 * Mix)" is "Let's Get It Started" -- or null when there's nothing to strip.
 * Only tags naming a version are stripped: "(What's the Story) Morning Glory"
 * keeps its parenthesis.
 */
function plainTitle(title) {
  let text = String(title || '').trim()
  let changed = false
  for (;;) {
    const paren = text.match(VANITY_PAREN)
    if (paren && VANITY_WORD.test(paren[0])) { text = text.slice(0, text.length - paren[0].length).trim(); changed = true; continue }
    const dash = text.match(VANITY_DASH)
    if (dash && VANITY_WORD.test(dash[0])) { text = text.slice(0, text.length - dash[0].length).trim(); changed = true; continue }
    break
  }
  return changed && text ? text : null
}

/** Each artist of "A, B & C feat. D", cleaned. */
function artistNames(artist) {
  return String(artist || '').split(/\s*(?:,|;|\/|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing|\band\b)\s*/i)
    .map(name => clean(name).replace(/\s*(?:vevo|official|topic)$/, '').trim()).filter(Boolean)
}

function sameArtist(a, b) {
  if (a === b) return true
  const withoutArticle = value => value.replace(/^the\s+/, '')
  return withoutArticle(a) === withoutArticle(b)
}

/** Whether a search result is the song's own official music video. */
function isMusicVideoFor(track, item, { requireOfficial = true, requireDuration = true } = {}) {
  if (!item?.videoId || item.kind === 'song' || item.visualMotion === false || item.isStatic === true || (requireOfficial && !item.official)) return false
  const songNames = artistNames(track.artist)
  const videoNames = artistNames((item.artists || []).join(', ') || item.artist)
  if (!songNames.length || !videoNames.some(name => songNames.some(wantedName => sameArtist(name, wantedName)))) return false
  // "Artist - Title (Official Video)" or just "Title (Official Video)".
  let title = String(item.title || '')
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dash && artistNames(dash[1]).some(name => songNames.some(wantedName => sameArtist(name, wantedName)))) title = dash[2]
  const wanted = baseTitle(track.title)
  if (!wanted || baseTitle(title) !== wanted) return false
  const songWords = new Set(clean(track.title).split(' '))
  if (clean(item.title).split(' ').some(word => OTHER_VERSION.includes(word) && !songWords.has(word))) return false
  if (!requireDuration) return true
  const duration = Number(item.duration)
  const length = Number(track.duration)
  if (!(duration > 0) || !(length > 0)) return false
  return duration >= length - LEAD_S && duration <= length + MAX_EXTRA_S
}

async function visualMotionOf(item, probe) {
  if (item?.visualMotion === true || item?.hasMotion === true) return true
  if (item?.visualMotion === false || item?.hasMotion === false || item?.isStatic === true) return false
  if (typeof probe !== 'function') return null
  try { return await probe(item) } catch { return null }
}

function hasVisualMotion(frames, frameSize = 64 * 36) {
  const count = Math.floor(frames.length / frameSize)
  if (count < 12) return null
  let changed = 0
  let textured = 0
  for (let frame = 1; frame < count; frame++) {
    let mean = 0
    let difference = 0
    let variation = 0
    const start = frame * frameSize
    for (let pixel = 0; pixel < frameSize; pixel++) mean += frames[start + pixel] - frames[start - frameSize + pixel]
    mean /= frameSize
    for (let pixel = 0; pixel < frameSize; pixel++) {
      difference += Math.abs(frames[start + pixel] - frames[start - frameSize + pixel] - mean)
      if (pixel % 64) variation += Math.abs(frames[start + pixel] - frames[start + pixel - 1])
    }
    if (variation / frameSize > 1) textured++
    if (difference / frameSize > 1.2) changed++
  }
  if (!textured) return null
  return changed >= Math.max(5, (count - 1) * 0.55)
}

function decodeVisualFrames(ffmpeg, input, { headers = {}, start = 0, seconds = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const headerText = Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')
    const args = ['-v', 'error', '-nostdin', ...(headerText && /^https?:/.test(input) ? ['-headers', headerText] : []),
      '-ss', String(start), '-i', input, '-t', String(seconds), '-an', '-vf', 'fps=12,scale=64:36', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']
    const proc = spawn(ffmpeg, args, { windowsHide: true })
    const chunks = []
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Video motion validation timed out')) }, 20000)
    proc.stdout.on('data', data => chunks.push(data))
    proc.stderr.on('data', () => {})
    proc.on('error', error => { clearTimeout(timer); reject(error) })
    proc.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error('Video motion validation could not decode frames'))
      else resolve(Buffer.concat(chunks))
    })
  })
}

async function validateVisualMotion(ffmpeg, source, duration, { decode = decodeVisualFrames } = {}) {
  if (!ffmpeg || typeof source !== 'function' || !(Number(duration) > 30)) return null
  let checked = 0
  let moving = 0
  for (const fraction of [0.15, 0.35, 0.6, 0.8]) {
    try {
      const media = await source()
      if (!media?.input) return null
      const frames = await decode(ffmpeg, media.input, { headers: media.headers, start: Math.min(Number(duration) - 6, Number(duration) * fraction) })
      const motion = hasVisualMotion(frames)
      if (motion !== null) checked++
      if (motion === true) moving++
      if (moving >= 2) return true
    } catch { return null }
  }
  return checked >= 3 ? false : null
}

async function searchVideos(query, fetchImpl = fetch) {
  return yt.innertubeSearch(query, VIDEOS_PARAMS, fetchImpl)
}

const OFFICIAL_VIDEO = /\b(?:official(?:\s+music)?\s+video|official\s+mv|music\s+video)\b/i

function markOfficial(item) {
  const channel = item.channel || item.uploader || item.artist || ''
  return {
    ...item,
    videoId: item.videoId || item.id,
    artists: item.artists || (channel ? [channel] : []),
    artist: item.artist || channel,
    kind: item.kind || 'video',
    official: !!item.official || /VEVO$/i.test(channel) || OFFICIAL_VIDEO.test(item.title || ''),
  }
}

function databaseVideos(track, rows) {
  return (rows || []).map(row => {
    const videoId = yt.videoIdFromUrl(row?.strMusicVid)
    if (!videoId) return null
    return markOfficial({
      videoId,
      title: row.strTrack || track.title,
      artist: row.strArtist || track.artist,
      artists: [row.strArtist || track.artist],
      duration: null,
      thumbnail: row.strTrackThumb || null,
      source: 'theaudiodb',
      database: true,
      official: true,
    })
  }).filter(Boolean)
}

/** Candidates from curated metadata and broad YouTube searches. `lenient` skips the duration gate (vanity-free fallback: the version's length differs). */
async function discoveredVideos(track, { fetchImpl = fetch, audioDbSearch = audioDb.searchTracks, youtubeSearch = null, lenient = false } = {}) {
  const query = `${track.artist} ${track.title}`
  const lookups = [
    Promise.resolve().then(async () => databaseVideos(track, await audioDbSearch(track.artist, track.title))),
    searchVideos(query, fetchImpl).then(items => items.map(markOfficial)),
    yt.innertubeSearch(query, null, fetchImpl).then(items => items.map(markOfficial)),
  ]
  if (youtubeSearch) lookups.push(Promise.resolve(youtubeSearch(`${query} official music video`)).then(result => (result?.results || result || []).map(markOfficial)))
  const results = await Promise.allSettled(lookups)
  const seen = new Set()
  const candidates = results.flatMap(result => result.status === 'fulfilled' ? result.value : []).filter(item => {
    if (!item.videoId || seen.has(item.videoId)) return false
    if (!isMusicVideoFor(track, item, { requireDuration: !lenient && !item.database })) return false
    seen.add(item.videoId)
    return true
  }).sort((a, b) => {
    const source = item => item.source === 'theaudiodb' ? 0 : 1
    const distance = item => Number.isFinite(Number(item.duration)) ? Math.abs(Number(item.duration) - Number(track.duration)) : Infinity
    return source(a) - source(b) || distance(a) - distance(b)
  })
  return { candidates: candidates.slice(0, 8), inconclusive: results.some(result => result.status === 'rejected') }
}

// ------------------------------------------------------------ audio check

const FFT_SIZE = 256
const BANDS = 8
const HANN = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE))
// Log-spaced bands, 100 Hz to 3.8 kHz, as FFT bins.
const BAND_EDGES = Array.from({ length: BANDS + 1 }, (_, i) => Math.round(FFT_SIZE / RATE * 100 * (3800 / 100) ** (i / BANDS)))

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const angle = -2 * Math.PI / len
    for (let k = 0; k < half; k++) {
      const c = Math.cos(angle * k)
      const sn = Math.sin(angle * k)
      for (let i = k; i < n; i += len) {
        const xr = re[i + half] * c - im[i + half] * sn
        const xi = re[i + half] * sn + im[i + half] * c
        re[i + half] = re[i] - xr
        im[i + half] = im[i] - xi
        re[i] += xr
        im[i] += xi
      }
    }
  }
}

/**
 * Onsets per frame: how much louder each band got since the last frame
 * (`bands`), and all bands together (`env`). Two encodes of the same master
 * line up on these through a different codec or mix level; the bands tell a
 * chorus from its repeat far better than loudness alone.
 */
function audioFeatures(samples, { hop = HOP } = {}) {
  const frames = samples.length >= FFT_SIZE ? Math.floor((samples.length - FFT_SIZE) / hop) + 1 : 0
  const bands = Array.from({ length: BANDS }, () => new Float32Array(frames))
  const env = new Float32Array(frames)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  const prev = new Float64Array(BANDS)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = samples[f * hop + i] * HANN[i]; im[i] = 0 }
    fft(re, im)
    for (let b = 0; b < BANDS; b++) {
      let energy = 0
      for (let k = BAND_EDGES[b], end = Math.max(BAND_EDGES[b + 1], k + 1); k < end; k++) energy += re[k] * re[k] + im[k] * im[k]
      const level = Math.log10(1e-9 + energy)
      const flux = f ? Math.max(0, level - prev[b]) : 0
      prev[b] = level
      bands[b][f] = flux
      env[f] += flux
    }
  }
  return { env, bands }
}

/** Pearson correlation of song bands [s, s + win) with video bands [p, p + win), all bands at once. */
function bandCorrelation(song, s, video, p, win) {
  let num = 0
  let da = 0
  let db = 0
  for (let b = 0; b < song.length; b++) {
    const x = song[b]
    const y = video[b]
    let mx = 0
    let my = 0
    for (let i = 0; i < win; i++) { mx += x[s + i]; my += y[p + i] }
    mx /= win
    my /= win
    for (let i = 0; i < win; i++) {
      const u = x[s + i] - mx
      const v = y[p + i] - my
      num += u * v
      da += u * u
      db += v * v
    }
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0
}

/** Pearson correlation of `a` (mean/norm given) with b[p, p + a.length). */
function correlate(a, aMean, aNorm, b, p, sums, squares) {
  const n = a.length
  const bSum = sums[p + n] - sums[p]
  const bMean = bSum / n
  const bVar = squares[p + n] - squares[p] - bSum * bMean
  if (bVar <= 1e-9) return 0
  let dot = 0
  for (let i = 0; i < n; i++) dot += (a[i] - aMean) * b[p + i]
  return dot / (aNorm * Math.sqrt(bVar))
}

/**
 * Where the song's audio sits in the video's: [{ start, end, offset }] in
 * seconds (video time = song time + offset from `start` to `end`), or null
 * when too little of the song is found in the video.
 *
 * Each window of the song keeps its few best matches in the video; the path
 * through them that changes offset the least wins (Viterbi). So a chorus that
 * also matches its repeat elsewhere doesn't pull the video off, while a real
 * skit or cut still moves it.
 */
function alignAudio(songFeatures, videoFeatures, options = {}) {
  const { windows, path } = matchAudio(songFeatures, videoFeatures, options)
  if (!windows.length) return null
  const groups = forwardGroups(path.filter(Boolean))
  const matched = groups.flatMap(g => g.items)
  if (matched.length / windows.length < MIN_COVERAGE) return null
  if (matched.reduce((n, m) => n + m.corr, 0) / matched.length < MIN_MEAN_CORRELATION) return null
  return groups.map((g, index) => ({
    start: index ? g.items[0].start : 0,
    end: index < groups.length - 1 ? groups[index + 1].items[0].start : null,
    offset: Math.round(g.offset * 1000) / 1000,
  }))
}

/**
 * The matched windows as runs at one offset, keeping the runs that play the
 * video forward (an offset can grow -- an intro, a skit -- but a video doesn't
 * jump back to replay the song) with the most correlation between them. A
 * lone window off on its own is a chorus matching its repeat: dropped.
 */
function forwardGroups(matched) {
  const runs = []
  for (const m of matched) {
    const last = runs[runs.length - 1]
    if (last && Math.abs(m.offset - last.offset) <= SAME_OFFSET_S) { last.items.push(m); last.offset = median(last.items.map(x => x.offset)); continue }
    runs.push({ offset: m.offset, items: [m] })
  }
  const kept = runs.length > 1 ? runs.filter(r => r.items.length > 1) : runs
  const weight = kept.map(r => r.items.reduce((n, m) => n + m.corr, 0))
  const best = weight.slice()
  const from = kept.map(() => -1)
  for (let i = 0; i < kept.length; i++) {
    for (let j = 0; j < i; j++) {
      if (kept[i].offset >= kept[j].offset - SAME_OFFSET_S && best[j] + weight[i] > best[i]) { best[i] = best[j] + weight[i]; from[i] = j }
    }
  }
  const chosen = []
  for (let i = best.indexOf(Math.max(...best)); i >= 0; i = from[i]) chosen.unshift(kept[i])
  // Runs at the same offset either side of a dropped one are one segment.
  const groups = []
  for (const r of chosen) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(r.offset - last.offset) <= SAME_OFFSET_S) { last.items.push(...r.items); last.offset = median(last.items.map(x => x.offset)) }
    else groups.push({ offset: r.offset, items: [...r.items] })
  }
  return groups
}

/** Each audible window of the song with its best matches in the video, and the chosen path through them. */
function matchAudio(songFeatures, videoFeatures, { fps = FPS, windowS = WINDOW_S, stepS = STEP_S, leadS = LEAD_S, maxExtraS = MAX_EXTRA_S } = {}) {
  const song = songFeatures.env
  const video = videoFeatures.env
  const win = Math.round(windowS * fps)
  const step = Math.round(stepS * fps)
  if (song.length < win || video.length < win) return { windows: [], path: [] }
  const sums = new Float64Array(video.length + 1)
  const squares = new Float64Array(video.length + 1)
  for (let i = 0; i < video.length; i++) { sums[i + 1] = sums[i] + video[i]; squares[i + 1] = squares[i] + video[i] * video[i] }
  const lead = Math.round(leadS * fps)
  const extra = Math.round(maxExtraS * fps)
  const apart = Math.round(0.5 * fps)
  const windows = []
  for (let s = 0; s + win <= song.length; s += step) {
    const a = song.subarray(s, s + win)
    let mean = 0
    for (let i = 0; i < win; i++) mean += a[i]
    mean /= win
    let norm = 0
    for (let i = 0; i < win; i++) norm += (a[i] - mean) ** 2
    if (norm < 1e-4) continue // silence: nothing to line up
    norm = Math.sqrt(norm)
    const from = Math.max(0, s - lead)
    const to = Math.min(video.length - win, s + extra)
    if (to < from) { windows.push({ start: s / fps, candidates: [] }); continue }
    const scores = new Float32Array(to - from + 1)
    for (let p = from; p <= to; p++) scores[p - from] = correlate(a, mean, norm, video, p, sums, squares)
    // Loudness finds the likely places; the bands pick the right one.
    const candidates = peaks(scores, apart, COARSE_CANDIDATES).map(i => {
      const at = from + i
      const fine = [-1, 0, 1].map(d => (at + d >= 0 && at + d + win <= video.length ? bandCorrelation(songFeatures.bands, s, videoFeatures.bands, at + d, win) : -1))
      return { offset: (at + subFrame(fine, 1) - s) / fps, corr: fine[1] }
    }).filter(c => c.corr >= CANDIDATE_CORRELATION).sort((x, y) => y.corr - x.corr).slice(0, 5)
    windows.push({ start: s / fps, candidates })
  }
  return { windows, path: windows.length ? bestPath(windows) : [] }
}

/** The best few local maxima of `scores` (indices), at least `apart` from each other. */
function peaks(scores, apart, count) {
  const found = []
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i]
    if (v < COARSE_CORRELATION || v < (scores[i - 1] ?? -1) || v < (scores[i + 1] ?? -1)) continue
    const near = found.findIndex(j => Math.abs(j - i) <= apart)
    if (near >= 0) { if (v > scores[found[near]]) found[near] = i; continue }
    found.push(i)
  }
  return found.sort((x, y) => scores[y] - scores[x]).slice(0, count)
}

/** Where the peak at `i` really is, between frames (a parabola through its neighbours). */
function subFrame(scores, i) {
  const y0 = scores[i - 1] ?? scores[i]
  const y1 = scores[i]
  const y2 = scores[i + 1] ?? scores[i]
  const curve = y0 - 2 * y1 + y2
  return curve < 0 ? Math.max(-0.5, Math.min(0.5, (y0 - y2) / (2 * curve))) : 0
}

/** One candidate (or none) per window: the most correlation for the fewest offset changes. */
function bestPath(windows) {
  let prev = null
  const back = []
  for (const w of windows) {
    const states = [null, ...w.candidates]
    const score = states.map(state => (state ? state.corr : NO_MATCH_SCORE))
    const from = states.map(() => -1)
    if (prev) {
      for (let i = 0; i < states.length; i++) {
        let best = -Infinity
        for (let j = 0; j < prev.states.length; j++) {
          const a = prev.states[j]
          const b = states[i]
          const change = a && b && Math.abs(a.offset - b.offset) > SAME_OFFSET_S ? OFFSET_CHANGE_COST : 0
          const value = prev.score[j] - change
          if (value > best) { best = value; from[i] = j }
        }
        score[i] += best
      }
    }
    back.push(from)
    prev = { states, score }
  }
  let at = prev.score.indexOf(Math.max(...prev.score))
  const path = []
  for (let k = windows.length - 1; k >= 0; k--) {
    const state = [null, ...windows[k].candidates][at]
    path.unshift(state && { start: windows[k].start, ...state })
    at = back[k][at]
  }
  return path
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/** Mono 8 kHz samples of a file or URL, through ffmpeg. */
function decodeMono(ffmpeg, input, { headers = {}, seconds = 900 } = {}) {
  return new Promise((resolve, reject) => {
    const headerText = Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}\r\n`).join('')
    const args = ['-v', 'error', '-nostdin', ...(headerText && /^https?:/.test(input) ? ['-headers', headerText] : []),
      '-i', input, '-t', String(seconds), '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1']
    let proc
    try { proc = spawn(ffmpeg, args, { windowsHide: true }) } catch (e) { reject(e); return }
    const chunks = []
    let err = ''
    const timer = setTimeout(() => { try { proc.kill() } catch {} reject(new Error('ffmpeg took too long')) }, DECODE_TIMEOUT_MS)
    proc.stdout.on('data', d => chunks.push(d))
    proc.stderr.on('data', d => { err += d })
    proc.on('error', e => { clearTimeout(timer); reject(e) })
    proc.on('close', code => {
      clearTimeout(timer)
      const data = Buffer.concat(chunks)
      if (code !== 0 && !data.length) { reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited with ${code}`)); return }
      const copy = new Uint8Array(data.length - (data.length % 4))
      copy.set(data.subarray(0, copy.length))
      resolve(new Float32Array(copy.buffer))
    })
  })
}

// ------------------------------------------------------------------ lookup

function readCache(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { return {} }
}

function writeCache(file, cache) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 2000)
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(entries)))
  } catch {}
}

function cacheKey(track) {
  return ['v3', track.id, clean(track.title), clean(track.artist), Math.round(Number(track.duration) || 0)].join('|')
}

/** Already discovered matches only: listing Videos never downloads/scans songs. */
function knownMusicVideos(tracks, { cacheFile, now = Date.now, findFile, resolveTrackId = id => id } = {}) {
  const cache = readCache(cacheFile)
  const local = new Map()
  if (findFile) {
    for (const [key, hit] of Object.entries(cache)) {
      const parts = key.split('|')
      if (!['v2', 'v3'].includes(parts[0])) continue
      const trackId = resolveTrackId(parts[1])
      const hits = local.get(trackId) || []
      hits.push(hit)
      local.set(trackId, hits)
    }
  }
  return (tracks || []).flatMap(track => {
    const key = cacheKey(track)
    for (const hit of new Set([cache[key], ...(local.get(String(track.id)) || [])])) {
      if (!hit?.video || !/^[\w-]{11}$/.test(String(hit.video.videoId || ''))) continue
      const file = findFile?.(hit.video, track) || null
      if (!file && (hit !== cache[key] || hit.video.motion !== 'verified' || now() - hit.at >= FOUND_TTL_MS)) continue
      return [{ track, video: { ...hit.video, ...(file ? { file } : {}) } }]
    }
    return []
  })
}

const pending = new Map()

/**
 * The music video for a track: { videoId, title, artist, duration, thumbnail,
 * segments, check: 'audio' | 'length' | 'title' }, or null. `songAudio(attempt)`
 * and `videoAudio(videoId, attempt)` say where ffmpeg reads each from:
 * { input, headers } (a file or a URL); a second attempt gets a fresh URL.
 * `onProgress({ stage, index, total })` hears about each step: 'searching',
 * 'checking' (with index/total), 'fallback' (the vanity-free title's turn).
 */
async function findMusicVideo(track, { ffmpeg, songAudio, videoAudio, fetchImpl = fetch, cacheFile, now = Date.now, audioDbSearch = audioDb.searchTracks, youtubeSearch, onProgress, visualMotion } = {}) {
  if (!track?.title || !track?.artist || !(Number(track.duration) > 30)) return null
  const progress = (update) => { try { onProgress?.(update) } catch {} }
  const key = cacheKey(track)
  const cache = cacheFile ? readCache(cacheFile) : {}
  const hit = cache[key]
  if (hit && now() - hit.at < (hit.video ? FOUND_TTL_MS : MISSING_TTL_MS)) return hit.video
  if (pending.has(key)) return pending.get(key)
  const job = (async () => {
    const tryTrack = async (wanted, { acceptByTitle = false, stage = 'searching' } = {}) => {
      progress({ stage })
      const discovered = await discoveredVideos(wanted, { fetchImpl, audioDbSearch, youtubeSearch, lenient: acceptByTitle })
      const candidates = discovered.candidates
      let songEnv = null
      let video = null
      let inconclusive = discovered.inconclusive
      for (const [index, item] of candidates.entries()) {
        progress({ stage: 'checking', index: index + 1, total: candidates.length })
        const sameLength = !item.database && Math.abs(item.duration - wanted.duration) <= SAME_LENGTH_S
        // By title alone (vanity-free fallback), an absurd length is still out.
        const plausible = !Number.isFinite(Number(item.duration)) || (item.duration >= 60 && item.duration <= Number(wanted.duration) * 2 + 300)
        const byTitle = acceptByTitle && plausible
        const motion = await visualMotionOf(item, visualMotion)
        if (motion === false) continue
        if (motion !== true) { inconclusive = true; progress({ stage: 'motion-unverified', message: 'Video motion could not be verified. Continuing with the song and artwork.' }); continue }
        if (ffmpeg && songAudio && videoAudio) {
          try {
            songEnv ||= audioFeatures(await decodeFrom(ffmpeg, songAudio))
            const videoEnv = audioFeatures(await decodeFrom(ffmpeg, attempt => videoAudio(item.videoId, attempt)))
            const segments = alignAudio(songEnv, videoEnv)
            if (segments) { video = describe(item, segments, 'audio', motion === true); break }
            // Heard, and it isn't the song. A vanity-free fallback expects
            // that (the video is another version's): the title match is enough.
            if (byTitle) { video = describe(item, [{ start: 0, end: null, offset: 0 }], 'title', motion === true); break }
            continue
          } catch {
            // Couldn't listen (offline, no stream): fall back to the length.
            inconclusive = true
          }
        }
        if (sameLength) { video = describe(item, [{ start: 0, end: null, offset: 0 }], 'length', motion === true); break }
        if (byTitle) { video = describe(item, [{ start: 0, end: null, offset: 0 }], 'title', motion === true); break }
      }
      return { video, inconclusive }
    }
    let { video, inconclusive } = await tryTrack(track)
    // "Let's Get It Started (Spice Mix)" has no video of its own: try the
    // title without the vanity tag, taking the original's official video even
    // when its audio is another version's.
    const plain = plainTitle(track.title)
    if (!video && plain && baseTitle(plain) !== baseTitle(track.title)) {
      const fallback = await tryTrack({ ...track, title: plain }, { acceptByTitle: true, stage: 'fallback' })
      video = fallback.video
      inconclusive = inconclusive || fallback.inconclusive
    }
    if (cacheFile && (video || !inconclusive)) {
      const fresh = readCache(cacheFile)
      fresh[key] = { at: now(), video }
      writeCache(cacheFile, fresh)
    }
    progress({ stage: 'done', found: !!video, ...(inconclusive && !video ? { message: 'Video validation could not finish. Continuing with the song and artwork.' } : {}) })
    return video
  })().finally(() => pending.delete(key))
  pending.set(key, job)
  return job
}

/** Decoded audio from `source(attempt)`, trying a fresh source once (stream URLs can be refused). */
async function decodeFrom(ffmpeg, source) {
  let error = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const from = await source(attempt)
      if (!from) throw new Error('No audio to check against')
      return await decodeMono(ffmpeg, from.input, { headers: from.headers })
    } catch (e) {
      error = e
    }
  }
  throw error
}

function describe(item, segments, check, motionVerified = false) {
  return { videoId: item.videoId, title: item.title, artist: item.artist, duration: item.duration, thumbnail: item.thumbnail || null, segments, check, motion: motionVerified ? 'verified' : 'unverified' }
}

/** Video time for a song time (seconds), from the segments; null where the video has no such moment. */
function videoTimeFor(segments, time) {
  const segment = (segments || []).find(s => time >= s.start && (s.end == null || time < s.end))
  return segment ? time + segment.offset : null
}

module.exports = {
  findMusicVideo, knownMusicVideos, discoveredVideos, databaseVideos, isMusicVideoFor, baseTitle, plainTitle, artistNames, audioFeatures, alignAudio, matchAudio, decodeMono, videoTimeFor,
  VIDEOS_PARAMS, FPS, visualMotionOf, hasVisualMotion, decodeVisualFrames, validateVisualMotion,
}
