import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const sync = require('../electron/playlists/sync')

function setup(remote) {
  const db = new Database(':memory:')
  db.exec("CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, file_path TEXT); CREATE TABLE playlist_tracks (playlist_id TEXT, track_id TEXT, position INTEGER, added_by TEXT, added_at INTEGER)")
  db.prepare("INSERT INTO playlists VALUES ('p1', 'Mine')").run()
  db.prepare("INSERT INTO tracks VALUES ('local-1', 'Owned', 'Band', '/music/owned.flac')").run()
  const addon = { key: 'abcdef0123', enabled: 1, manifest: { displayName: 'Spotify Web', urlHandler: { enabled: true, patterns: ['open.spotify.com', 'spotify:'] } } }
  const packages = { list: () => [addon], find: () => addon, runtime: async () => ({ invoke: async () => ({ type: 'playlist', name: 'Theirs', tracks: remote.list }) }) }
  let n = 0
  const helpers = {
    findTrack: (database, entry) => database.prepare("SELECT id FROM tracks WHERE LOWER(title) = ? AND file_path NOT LIKE 'ghost://%'").get(entry.title.toLowerCase()),
    createGhostTrack: (database, entry) => { const id = `g-${++n}`; database.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?)').run(id, entry.title, entry.artist, `ghost://spotify/p1/${id}`); return { id, title: entry.title, artist: entry.artist } },
  }
  return { db, packages, helpers }
}
const songs = db => db.prepare('SELECT t.title FROM playlist_tracks pt JOIN tracks t ON t.id = pt.track_id ORDER BY position').all().map(r => r.title)

test('linking accepts streaming playlist links only', () => {
  const { db } = setup({ list: [] })
  assert.ok(sync.link(db, 'p1', 'https://example.com/playlist/1').error)
  assert.ok(sync.link(db, 'p1', 'https://open.spotify.com/album/1').error)
  assert.equal(sync.link(db, 'p1', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').platformLabel, 'Spotify')
})

test('sync adds only new songs, library copies first, and never removes', async () => {
  const remote = { list: [{ id: 'a', name: 'Owned', artists: 'Band', duration_ms: 200000 }, { id: 'b', name: 'Missing', artists: 'Other' }] }
  const { db, packages, helpers } = setup(remote)
  sync.link(db, 'p1', 'https://open.spotify.com/playlist/xyz')
  const first = await sync.sync(db, 'p1', { packages, helpers })
  assert.equal(first.added, 2); assert.equal(first.matched, 1); assert.equal(first.ghosts.length, 1)
  assert.deepEqual(songs(db), ['Owned', 'Missing'])
  // Removed there, and one removed here: neither comes back nor goes.
  db.prepare("DELETE FROM playlist_tracks WHERE track_id = 'local-1'").run()
  remote.list = [{ id: 'a', name: 'Owned', artists: 'Band' }, { id: 'c', name: 'Fresh', artists: 'New' }]
  const second = await sync.sync(db, 'p1', { packages, helpers })
  assert.equal(second.added, 1)
  assert.deepEqual(songs(db), ['Missing', 'Fresh'])
  assert.equal(sync.status(db, 'p1').title, 'Theirs')
})

test('a link no installed addon reads says which addon to install', async () => {
  const { db, helpers } = setup({ list: [] })
  sync.link(db, 'p1', 'https://tidal.com/browse/playlist/abc')
  const result = await sync.sync(db, 'p1', { packages: { list: () => [], find: () => null }, helpers })
  assert.match(result.error, /install the Tidal addon/)
})
