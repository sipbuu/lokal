// Lokal's caches on disk, under one size limit (Settings → Data → Cache):
//   motion-covers/    moving covers (.mp4), downloaded once (electron/artwork/motion.js)
//   playback-cache/   playable copies of files the player can't decode
//                     (Apple Lossless, WMA...; electron/download/convert.js)
// Everything in them can be made again. When they're over the limit together,
// the files used longest ago go first; the one being played is kept.
// Chromium's own web cache is reported and cleared from the desktop app's
// IPC handlers (electron/ipc/cache.js).

const fs = require('fs')
const path = require('path')
const db = require('./ipc/db')

const MB = 1024 * 1024
const DEFAULT_LIMIT_MB = 4096
const LIMITS_MB = [512, 1024, 2048, 4096, 8192, 16384]
const DIRS = { motion: 'motion-covers', playback: 'playback-cache', musicVideo: 'music-video-cache', addonAudio: 'spotiflac/audio-cache' }

function cacheDir(name) {
  const root = db.getStorageDir()
  return root ? path.join(root, DIRS[name]) : null
}

/** The limit in bytes: Settings' choice, or 4 GB. */
function limitBytes(settings) {
  let value = settings?.cache_limit_mb
  if (value == null) {
    try { value = db.getDB().prepare("SELECT value FROM settings WHERE key = 'cache_limit_mb'").get()?.value } catch {}
  }
  const mb = Number(value)
  return (LIMITS_MB.includes(mb) ? mb : DEFAULT_LIMIT_MB) * MB
}

// Files still being written (yt-dlp's .part, ffmpeg's temp files) aren't counted or removed.
const unfinished = name => /\.part(?:\.|$)|\.tmp$|\.temp$|\.download-/.test(name)

function entries(name) {
  const dir = cacheDir(name)
  if (!dir) return []
  try {
    return fs.readdirSync(dir).filter(f => !unfinished(f)).map(f => {
      const p = path.join(dir, f)
      const s = fs.statSync(p)
      return s.isFile() ? { p, size: s.size, used: Math.max(s.atimeMs || 0, s.mtimeMs || 0) } : null
    }).filter(Boolean)
  } catch { return [] }
}

/** Bytes used by each cache. */
function usage() {
  const out = {}
  for (const name of Object.keys(DIRS)) out[name] = entries(name).reduce((sum, e) => sum + e.size, 0)
  return out
}

/**
 * Bring the caches under the limit, oldest use first. `keep`: paths in use
 * right now, never removed.
 */
function trim({ keep = [], settings } = {}) {
  const limit = limitBytes(settings)
  const kept = new Set([].concat(keep).filter(Boolean).map(p => path.resolve(p)))
  const all = Object.keys(DIRS).filter(name => name !== 'musicVideo').flatMap(entries).sort((a, b) => b.used - a.used)
  let total = 0
  let removed = 0
  for (const e of all) {
    total += e.size
    if (total > limit && !kept.has(path.resolve(e.p))) {
      try { fs.unlinkSync(e.p); total -= e.size; removed++ } catch {}
    }
  }
  return { removed, total }
}

/** Empty both caches (files being written are left alone). */
function clear() {
  let removed = 0
  for (const name of Object.keys(DIRS)) {
    if (name === 'musicVideo') continue
    for (const e of entries(name)) { try { fs.unlinkSync(e.p); removed++ } catch {} }
  }
  return removed
}

module.exports = { cacheDir, limitBytes, usage, trim, clear, LIMITS_MB, DEFAULT_LIMIT_MB }
