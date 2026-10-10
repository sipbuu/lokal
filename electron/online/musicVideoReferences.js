const POINTERS = new Set(['trackId', 'track_id', 'replaceTrackId', 'upgradeTrackId', 'upgradedTrackId'])
const LISTS = new Set(['replaceImported', 'alsoReplace', 'confirmedImported', 'manuallySelectedImported'])

function resolveTrackId(db, id) {
  if (typeof id !== 'string') return id
  const seen = new Set()
  let current = id
  while (!seen.has(current)) {
    seen.add(current)
    let next
    try { next = db?.prepare('SELECT track_id FROM track_aliases WHERE old_id = ?').get(current)?.track_id } catch {}
    if (!next || seen.has(next)) break
    current = next
  }
  return current
}

function remapTrackPointers(value, resolve, parent = '') {
  if (Array.isArray(value)) {
    if (LISTS.has(parent)) return [...new Set(value.map(resolve))]
    return value.map(item => remapTrackPointers(item, resolve, parent))
  }
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    POINTERS.has(key) || (parent === 'indexedTracks' && key === 'id') ? resolve(item) : remapTrackPointers(item, resolve, key),
  ]))
}

function rewriteMusicVideoReferences(db, resolve) {
  const exists = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  const rewrite = text => {
    try { return JSON.stringify(remapTrackPointers(JSON.parse(text), resolve)) } catch { return text }
  }
  if (exists('saved_music_videos')) {
    for (const row of db.prepare('SELECT track_id, added_at, video_json FROM saved_music_videos ORDER BY added_at').all()) {
      const target = resolve(row.track_id)
      const value = rewrite(row.video_json)
      if (target !== row.track_id) {
        db.prepare(`INSERT INTO saved_music_videos (track_id, added_at, video_json) VALUES (?, ?, ?)
          ON CONFLICT(track_id) DO UPDATE SET added_at = excluded.added_at, video_json = excluded.video_json
          WHERE excluded.added_at > saved_music_videos.added_at`).run(target, row.added_at, value)
        db.prepare('DELETE FROM saved_music_videos WHERE track_id = ?').run(row.track_id)
      } else if (value !== row.video_json) db.prepare('UPDATE saved_music_videos SET video_json = ? WHERE track_id = ?').run(value, row.track_id)
    }
  }
  if (exists('downloaded_music_videos')) {
    for (const row of db.prepare('SELECT video_id, height, video_json FROM downloaded_music_videos').all()) {
      const value = rewrite(row.video_json)
      if (value !== row.video_json) db.prepare('UPDATE downloaded_music_videos SET video_json = ? WHERE video_id = ? AND height = ?').run(value, row.video_id, row.height)
    }
  }
  if (exists('download_jobs')) {
    for (const row of db.prepare('SELECT id, data FROM download_jobs').all()) {
      const value = rewrite(row.data)
      if (value !== row.data) db.prepare('UPDATE download_jobs SET data = ? WHERE id = ?').run(value, row.id)
    }
  }
}

function remapMusicVideoReferences(db, from, to) {
  if (!from || !to || from === to) return
  rewriteMusicVideoReferences(db, id => id === from ? to : id)
}

function repairMusicVideoReferences(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'track_aliases'").get()
  if (!table) return
  const aliases = new Map()
  const resolve = id => {
    if (aliases.has(id)) return aliases.get(id)
    const target = resolveTrackId(db, id)
    const valid = target !== id && db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(target) ? target : id
    aliases.set(id, valid)
    return valid
  }
  db.transaction(() => {
    rewriteMusicVideoReferences(db, resolve)
  })()
}

module.exports = { resolveTrackId, remapTrackPointers, remapMusicVideoReferences, repairMusicVideoReferences }
