// Upgrading a track to a better file ("Get it in lossless" → Soulseek).
//
// The new file takes the old one's place in the library: same track, so its
// playlists, likes, play counts, history and lyrics stay as they were. Only
// the file and what describes it (format, bitrate, duration) change; the
// title, artist, album and cover the user has are kept.
//
// The old file is not deleted: it is moved out of the music folder into
// Lokal's data folder (replaced/<date>/), so a rescan doesn't bring it back
// and it can still be recovered.

const fs = require('fs')
const path = require('path')
const quality = require('./index')

const MAX_LENGTH_DIFFERENCE_S = 10

/** Move a file, across drives too (rename, else copy then remove). */
function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch (e) {
    if (e.code !== 'EXDEV') throw e
    fs.copyFileSync(from, to)
    fs.unlinkSync(from)
  }
}

/** A path in `dir` for `name` that isn't taken yet. */
function freePath(dir, name) {
  const ext = path.extname(name)
  const base = path.basename(name, ext)
  let candidate = path.join(dir, name)
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i})${ext}`)
  return candidate
}

let mmLib = null
function musicMetadata() {
  if (mmLib === null) { try { mmLib = require('../musicMetadata') } catch { mmLib = false } }
  return mmLib || null
}

/**
 * Put `newPath` in place of track `trackId`'s file.
 * @returns {{ id, oldPath, movedTo }} or { error } (then the caller indexes
 *          the new file as a track of its own, as usual)
 */
async function upgradeTrackFile(db, trackId, newPath, { storageDir, allowDurationMismatch = false } = {}) {
  const track = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path NOT LIKE 'ghost://%'").get(String(trackId || ''))
  if (!track) return { error: 'The track to upgrade is no longer in the library.' }
  if (!fs.existsSync(newPath)) return { error: 'The new file is missing.' }
  if (path.resolve(track.file_path) === path.resolve(newPath)) return { id: track.id, oldPath: null, movedTo: null }

  const mm = musicMetadata()
  if (!mm) return { error: 'Could not read the new file.' }
  let meta
  try { meta = await mm.parseFile(newPath, { duration: true, skipCovers: true }) } catch { return { error: 'Could not read the new file.' } }
  const duration = Number(meta?.format?.duration) || 0
  // Another song (or a different edit) shouldn't silently replace this one.
  if (!allowDurationMismatch && duration && Number(track.duration) && Math.abs(duration - Number(track.duration)) > MAX_LENGTH_DIFFERENCE_S) {
    return { error: `The new file is ${Math.round(duration)} s long and the track ${Math.round(track.duration)} s: not the same recording, so it was added as a separate track.` }
  }

  let movedTo = null
  if (fs.existsSync(track.file_path) && storageDir) {
    const day = new Date().toISOString().slice(0, 10)
    const dir = path.join(storageDir, 'replaced', day)
    movedTo = freePath(dir, path.basename(track.file_path))
    try { moveFile(track.file_path, movedTo) } catch (e) { return { error: `Could not move the old file aside (${e.message}).` } }
  }

  // The new file may already have been indexed as a track of its own (e.g.
  // by a rescan): that row goes, this one takes its file.
  const stat = fs.statSync(newPath)
  const swap = db.transaction(() => {
    const other = db.prepare('SELECT id FROM tracks WHERE file_path = ? AND id <> ?').get(newPath, track.id)
    if (other) {
      for (const table of ['playlist_tracks', 'user_likes', 'play_history', 'listening_events']) {
        try { db.prepare(`UPDATE OR IGNORE ${table} SET track_id = ? WHERE track_id = ?`).run(track.id, other.id) } catch {}
        try { db.prepare(`DELETE FROM ${table} WHERE track_id = ?`).run(other.id) } catch {}
      }
      try { db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(other.id) } catch {}
      db.prepare('DELETE FROM tracks WHERE id = ?').run(other.id)
    }
    db.prepare('UPDATE tracks SET file_path = ?, bitrate = ?, duration = COALESCE(?, duration), last_modified = ? WHERE id = ?')
      .run(newPath, meta?.format?.bitrate ? Math.round(meta.format.bitrate / 1000) : null, duration || null, stat.mtimeMs, track.id)
    quality.saveFields(db, track.id, quality.qualityFields(meta), { fileChanged: true })
  })
  try {
    swap()
  } catch (e) {
    // Put the old file back: the library still points at it.
    if (movedTo) { try { moveFile(movedTo, track.file_path) } catch {} }
    return { error: `Could not update the library (${e.message}).` }
  }
  return { id: track.id, oldPath: track.file_path, movedTo }
}

module.exports = { upgradeTrackFile }
