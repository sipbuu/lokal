const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')
const { isInside, moveToTrash, forgetDownloads } = require('./trackFiles')

const isVirtual = file => !file || /^(ghost|stream):\/\//.test(file)
const realPath = file => {
  if (isVirtual(file)) return null
  try { return fs.realpathSync(file) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// File moves and the database transaction are synchronous so another merge cannot
// interleave with them. A failed transaction restores every staged audio file.
async function mergeDuplicates(db, keepId, removeIds) {
  const staged = []
  let losers
  try {
    if (!Array.isArray(removeIds) || removeIds.includes(keepId)) throw new Error('Choose a different copy to remove.')
    const winner = db.prepare('SELECT * FROM tracks WHERE id = ?').get(keepId)
    if (!winner) throw new Error('The copy to keep no longer exists. Refresh the duplicate list.')
    losers = [...new Set(removeIds)].map(id => db.prepare('SELECT * FROM tracks WHERE id = ?').get(id))
    if (losers.some(track => !track)) throw new Error('A copy no longer exists. Refresh the duplicate list.')
    const winnerFile = realPath(winner.file_path)
    const folder = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
    const realFolder = realPath(folder)
    const files = []
    for (const loser of losers) {
      const file = loser.file_path
      const real = realPath(file)
      if (!real) continue // Ghosts and already missing files have nothing to delete.
      if (!winnerFile) throw new Error('The copy to keep has no local audio file. Choose a downloaded copy first.')
      if (real === winnerFile) throw new Error('These entries share the same audio file. No files were removed.')
      if (!isInside(file, folder) || !isInside(real, realFolder)) {
        throw new Error('A duplicate is outside your music folder. Move it into that folder before merging.')
      }
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('A duplicate is a symbolic link. Remove it manually so its original audio file is not left behind.')
      if (!fs.statSync(file).isFile()) throw new Error('A duplicate path is not an audio file. No files were removed.')
      files.push(file)
    }
    // Do not remove audio used by a surviving entry, including symlink aliases.
    const removedIds = new Set(losers.map(track => track.id))
    const removedFiles = new Set(files.map(file => realPath(file)))
    for (const track of db.prepare('SELECT id, file_path FROM tracks').all()) {
      if (!removedIds.has(track.id) && removedFiles.has(realPath(track.file_path))) {
        throw new Error('A duplicate shares its audio file with another library entry. No files were removed.')
      }
    }
    db.transaction(() => {
      for (const loser of losers) {
        for (const field of ['artwork_path', 'album', 'year', 'genre']) {
          if (!winner[field] && loser[field]) {
            db.prepare(`UPDATE tracks SET ${field} = ? WHERE id = ?`).run(loser[field], keepId)
            winner[field] = loser[field]
          }
        }
        db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(keepId, loser.id)
        db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(loser.id)
        db.prepare('UPDATE OR IGNORE user_likes SET track_id = ? WHERE track_id = ?').run(keepId, loser.id)
        db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(loser.id)
        db.prepare('UPDATE play_history SET track_id = ? WHERE track_id = ?').run(keepId, loser.id)
        db.prepare('UPDATE listening_events SET track_id = ? WHERE track_id = ?').run(keepId, loser.id)
        db.prepare('UPDATE tracks SET play_count = COALESCE(play_count, 0) + ?, liked = MAX(liked, ?) WHERE id = ?')
          .run(loser.play_count || 0, loser.liked || 0, keepId)
        db.prepare('UPDATE track_aliases SET track_id = ? WHERE track_id = ?').run(keepId, loser.id)
        db.prepare('INSERT OR REPLACE INTO track_aliases (old_id, track_id) VALUES (?, ?)').run(loser.id, keepId)
        for (const table of ['artist_track_links', 'lyrics_cache', 'lyrics_translations']) {
          db.prepare(`DELETE FROM ${table} WHERE track_id = ?`).run(loser.id)
        }
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'artist_link_locks'").get()) {
          db.prepare('DELETE FROM artist_link_locks WHERE track_id = ?').run(loser.id)
        }
        db.prepare('DELETE FROM tracks WHERE id = ?').run(loser.id)
      }
      for (const file of [...new Set(files)]) {
        // An unrecognized extension keeps even a failed Trash operation out of scans.
        const temporary = `${file}.${randomUUID()}.lokal-duplicate`
        fs.renameSync(file, temporary)
        staged.push({ file, temporary })
      }
    })()
  } catch (error) {
    const unrestored = []
    for (const { file, temporary } of staged.reverse()) {
      try { fs.renameSync(temporary, file) } catch { unrestored.push(temporary) }
    }
    return { error: unrestored.length
      ? `${error.message} Some files could not be restored: ${unrestored.join(', ')}`
      : error.message }
  }
  forgetDownloads(losers.map(track => track.id))
  const failed = []
  for (const { temporary } of staged) {
    try { await moveToTrash(temporary) } catch { failed.push(temporary) }
  }
  return {
    ok: true, merged: losers.length,
    ...(failed.length ? { warning: `Duplicates were removed from the library, but some files could not be moved to Trash. They will not be rescanned. Remove these files manually: ${failed.join(', ')}` } : {}),
  }
}

async function mergeAllDuplicates(db, scoreTrack) {
  const groups = db.prepare('SELECT GROUP_CONCAT(id) AS ids FROM tracks GROUP BY LOWER(title), LOWER(artist) HAVING COUNT(*) > 1').all()
  let merged = 0
  const errors = []
  const warnings = []
  for (const group of groups) {
    const tracks = group.ids.split(',').map(id => db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)).filter(Boolean)
    tracks.sort((a, b) => scoreTrack(b) - scoreTrack(a))
    if (tracks.length < 2) continue
    const result = await mergeDuplicates(db, tracks[0].id, tracks.slice(1).map(track => track.id))
    merged += result.merged || 0
    if (result.error) errors.push(result.error)
    if (result.warning) warnings.push(result.warning)
  }
  return { merged, groups: groups.length,
    ...(errors.length ? { error: `${errors.length} group(s) could not be merged. ${[...new Set(errors)].join(' ')}` } : {}),
    ...(warnings.length ? { warning: warnings.join(' ') } : {}),
  }
}

module.exports = { mergeDuplicates, mergeAllDuplicates }
