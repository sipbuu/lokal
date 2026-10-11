// Songs that can't be played: their file is gone, or the last attempt to play
// them failed (a file the player couldn't decode even after conversion, a
// stream no source could play). Library → "Songs with errors" lists them.

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS track_errors (track_id TEXT PRIMARY KEY, message TEXT NOT NULL, at INTEGER NOT NULL)')
}

function recordTrackError(db, trackId, message) {
  if (!trackId) return false
  ensure(db)
  db.prepare('INSERT OR REPLACE INTO track_errors (track_id, message, at) VALUES (?, ?, ?)').run(String(trackId), String(message || "Couldn't play this song").slice(0, 300), Date.now())
  return true
}

function clearTrackError(db, trackId) {
  ensure(db)
  return db.prepare('DELETE FROM track_errors WHERE track_id = ?').run(String(trackId)).changes > 0
}

function trackErrors(db) {
  ensure(db)
  return new Map(db.prepare('SELECT track_id, message FROM track_errors').all().map(row => [row.track_id, row.message]))
}

/**
 * The tracks query for the library list. With `problems`, only songs that
 * can't be played, each with why (missing / playback_error); ordering and
 * paging then happen after the file check.
 */
function listTracks(db, opts, { where, params, exists }) {
  const { missingTrackFile } = require('./libraryTracks')
  const limit = Math.max(1, Math.min(500, parseInt(opts.limit, 10) || 500))
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0)
  const errors = trackErrors(db)
  const decorate = track => ({ ...track, missing: missingTrackFile(track, exists), ...(errors.has(String(track.id)) ? { playback_error: errors.get(String(track.id)) } : {}) })
  const problems = opts.problems === true || opts.problems === 'true' || opts.problems === '1'
  const clauses = [...where]
  if (problems) clauses.push("(file_path NOT LIKE 'ghost://%' OR id IN (SELECT track_id FROM track_errors))")
  let sql = 'SELECT * FROM tracks'
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ')
  sql += ` ORDER BY ${opts.sort || 'added_at DESC'}`
  if (!problems) return db.prepare(`${sql} LIMIT ${limit} OFFSET ${offset}`).all(...params).map(decorate)
  return db.prepare(sql).all(...params).map(decorate).filter(track => track.missing || track.playback_error).slice(offset, offset + limit)
}

module.exports = { recordTrackError, clearTrackError, trackErrors, listTracks }
