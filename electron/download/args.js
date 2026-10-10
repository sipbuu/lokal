// yt-dlp arguments for a download, shared by the desktop app and the web server.
//
// Formats are honest about what they are:
//   original  keep the source's own audio (YouTube: Opus or AAC), no re-encode
//   m4a       AAC; copied as-is when the source already is AAC
//   opus      Opus; copied as-is when the source already is Opus
//   mp3       re-encoded, for players that need MP3 (128/192/320 kbps)
//   flac      only for sources that are lossless to begin with; YouTube isn't,
//             so the UI no longer offers it (old callers still work)

const path = require('path')
const crypto = require('crypto')
const { cookieArgs } = require('../ipc/ytCookies')
const { jsRuntime } = require('../online/jsRuntime')

const FORMATS = ['original', 'mp3', 'm4a', 'opus', 'flac']
const MP3_BITRATES = ['128', '192', '256', '320']

function resolveFormat(opts = {}, settings = {}) {
  // Same default as the Downloader page shows: Original (no re-encoding).
  let format = String(opts.format || settings.download_format || 'original').toLowerCase()
  if (!FORMATS.includes(format)) format = 'original'
  let quality = String(opts.quality || settings.download_quality || '320').replace(/k$/i, '')
  if (!MP3_BITRATES.includes(quality)) quality = '320'
  return { format, quality }
}

function audioArgs({ format, quality, directAudio = false }) {
  // Direct addon audio already has its container. Original downloads need no
  // extraction, and the addon metadata is written by Lokal's file tagger.
  if (directAudio && format === 'original') return []
  switch (format) {
    case 'original': return ['-f', 'bestaudio/best', '-x', '--audio-format', 'best', '--audio-quality', '0']
    case 'm4a': return ['-f', 'bestaudio[ext=m4a]/bestaudio/best', '-x', '--audio-format', 'm4a', '--audio-quality', '0']
    case 'opus': return ['-f', 'bestaudio[acodec=opus]/bestaudio/best', '-x', '--audio-format', 'opus', '--audio-quality', '0']
    case 'flac': return ['-f', 'bestaudio/best', '-x', '--audio-format', 'flac']
    default: return ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${quality}K`]
  }
}

// "Song (Official Video)", "Song [Lyric Video]", "Song (Visualizer)", "Song (HD)" -> "Song"
const TITLE_NOISE = String.raw`(?i)\s*[(\[](?:official\s+)?(?:(?:music|lyrics?|hd|4k|audio)\s+)?(?:video|audio|visuali[sz]er|lyrics?|m/?v|hd|hq|4k)[)\]]`

function metadataArgs(settings) {
  if (settings.clean_download_metadata === '0') return []
  return [
    // One clean artist: the channel ("Artist - Topic" / "ArtistVEVO" trimmed below)
    // rather than every contributor YouTube Music lists.
    '--parse-metadata', '%(uploader,artist,creator|Unknown Artist)s:%(artist)s',
    '--replace-in-metadata', 'artist', String.raw`\s+-\s+Topic$`, '',
    '--replace-in-metadata', 'artist', 'VEVO$', '',
    '--replace-in-metadata', 'title', TITLE_NOISE, '',
  ]
}

function outputTemplate(kind, outputDir, addonSource) {
  // No "NA" folders: a track without an album goes under "Singles".
  if (kind === 'playlist') return path.join(outputDir, '%(playlist|Playlist)s', '%(artist,uploader|Unknown Artist)s', '%(title)s.%(ext)s')
  // Addon endpoints commonly all end in /file.flac. Isolate their temporary
  // filenames before tagging moves each download to its artist/album folder.
  const suffix = addonSource?.provider && addonSource?.id
    ? ' [' + crypto.createHash('sha256').update(`${addonSource.provider}\0${addonSource.id}`).digest('hex').slice(0, 16) + ']'
    : ''
  return path.join(outputDir, '%(artist,uploader|Unknown Artist)s', '%(album|Singles)s', `%(title)s${suffix}.%(ext)s`)
}

function isSoundCloud(url) {
  try {
    const host = new URL(url).hostname.replace(/^(?:www|m)\./, '')
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com') || host === 'on.soundcloud.com'
  } catch { return /soundcloud\.com/i.test(String(url || '')) }
}

function isYouTube(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host === 'youtu.be' || host.endsWith('youtube.com')
  } catch { return /youtu\.?be/i.test(String(url || '')) }
}

/**
 * @returns {{ args: string[], cookies: { args, notes, usedBrowser } }}
 */
function buildArgs({ kind, url, outputDir, settings, ffmpeg, format, archivePath, withoutCookies, extraArgs = [], addonSource = false }) {
  const cookies = cookieArgs(settings, { withoutCookies, url })
  const directAudio = !!addonSource && !isYouTube(url) && !isSoundCloud(url)
  const args = [
    ...audioArgs({ ...format, directAudio }),
    ...(directAudio ? [] : ['--embed-thumbnail', '--embed-metadata']),
    // What the video said about itself, before our metadata rewrites, printed
    // just ahead of the path so each file can be matched to its own details.
    // (`artists` is the source's own credit list, e.g. SoundCloud's publisher
    // metadata; --parse-metadata below only rewrites `artist`.)
    '--print', 'after_move:lokalmeta:%(.{channel,uploader,track,artist,artists,creator,title,fulltitle,album})j',
    '--print', 'after_move:filepath:%(filepath)s',
    '--output', outputTemplate(kind, outputDir, addonSource),
    '--trim-filenames', '180',
    '--newline',
    '--progress',
    '--no-warnings',
    '--retries', '5',
    '--fragment-retries', '5',
    ...(kind === 'playlist'
      ? ['--yes-playlist', '--ignore-errors', ...(archivePath ? ['--download-archive', archivePath] : [])]
      : ['--no-playlist']),
    ...cookies.args,
    ...(directAudio ? [] : metadataArgs(settings)),
  ]
  // YouTube's stream links need a JavaScript runtime once cookies are given (jsRuntime.js).
  const runtime = isYouTube(url) ? jsRuntime() : { args: [], options: {} }
  args.push(...runtime.args)
  if (isYouTube(url)) args.push('--convert-thumbnail', 'jpg')
  if (ffmpeg && (ffmpeg.includes('/') || ffmpeg.includes('\\'))) args.push('--ffmpeg-location', path.dirname(ffmpeg))
  args.push(...extraArgs)
  // The URL goes last, after "--", so a "URL" that starts with "-" can never be
  // read as a yt-dlp option (argument injection, CWE-88).
  args.push('--', url)
  return { args, cookies, spawnOptions: runtime.options }
}

module.exports = { buildArgs, resolveFormat, audioArgs, outputTemplate, isYouTube, isSoundCloud, FORMATS, MP3_BITRATES, TITLE_NOISE }
