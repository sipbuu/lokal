const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs-extra')

function getDataDir() {
  
  if (process.env.LOKAL_DATA_DIR) return process.env.LOKAL_DATA_DIR
  if (process.type === 'browser' || process.versions?.electron) {
    const { app } = require('electron')
    return path.join(app.getPath('userData'), 'data')
  }
  
  return path.join(process.cwd(), 'data')
}

let db
let _dataDir

function ensureStorageDirs() {
  fs.ensureDirSync(_dataDir)
  fs.ensureDirSync(path.join(_dataDir, 'artwork'))
  fs.ensureDirSync(path.join(_dataDir, 'lyrics'))
  fs.ensureDirSync(path.join(_dataDir, 'avatars'))
}

function initDB() {
  _dataDir = getDataDir()
  ensureStorageDirs()

  db = new Database(path.join(_dataDir, 'lokal.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT UNIQUE NOT NULL,
      file_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT,
      album_artist TEXT,
      track_num INTEGER,
      year INTEGER,
      genre TEXT,
      duration REAL,
      artwork_path TEXT,
      bitrate INTEGER,
      last_modified INTEGER,
      play_count INTEGER DEFAULT 0,
      liked INTEGER DEFAULT 0,
      added_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      bio TEXT,
      image_path TEXT
    );
    CREATE TABLE IF NOT EXISTS artist_track_links (
      artist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      PRIMARY KEY (artist_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT DEFAULT 'guest',
      description TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id TEXT,
      track_id TEXT,
      position INTEGER,
      added_by TEXT DEFAULT 'guest',
      added_at INTEGER,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id),
      FOREIGN KEY (track_id) REFERENCES tracks(id)
    );
    CREATE TABLE IF NOT EXISTS user_likes (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      liked_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, track_id)
    );
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      seconds_played INTEGER DEFAULT 0,
      played_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (track_id) REFERENCES tracks(id)
    );
    CREATE TABLE IF NOT EXISTS lyrics_cache (
      track_id TEXT PRIMARY KEY,
      lyrics_type TEXT,
      content TEXT,
      source TEXT,
      cached_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS lyrics_translations (
      track_id TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      detected_lang TEXT,
      content TEXT,
      provider TEXT,
      fetched_at INTEGER DEFAULT 0,
      PRIMARY KEY (track_id, target_lang, source_hash)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      bio TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (user_id, key)
    );
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist);
    CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album);
    CREATE INDEX IF NOT EXISTS idx_ph_user ON play_history(user_id);
    CREATE INDEX IF NOT EXISTS idx_ph_time ON play_history(played_at);
  `)

  
  const migrations = [
    `ALTER TABLE playlists ADD COLUMN user_id TEXT DEFAULT 'guest'`,
    `ALTER TABLE playlists ADD COLUMN description TEXT`,
    `ALTER TABLE users ADD COLUMN bio TEXT`,
    `ALTER TABLE artists ADD COLUMN bio_source TEXT`,
    `ALTER TABLE artists ADD COLUMN bio_fetched_at INTEGER`,
    `ALTER TABLE artists ADD COLUMN image_source TEXT`,
    `ALTER TABLE artists ADD COLUMN image_fetched_at INTEGER`,
    `ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS artist_track_links (artist_id TEXT NOT NULL, track_id TEXT NOT NULL, PRIMARY KEY (artist_id, track_id))`,
    `CREATE TABLE IF NOT EXISTS play_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL, seconds_played INTEGER DEFAULT 0, played_at INTEGER DEFAULT (unixepoch()))`,
  ]
  
  const quickMigrations = [
    `ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0`,
    `ALTER TABLE playlists ADD COLUMN user_id TEXT DEFAULT 'guest'`,
    `ALTER TABLE playlists ADD COLUMN description TEXT`,
    `ALTER TABLE users ADD COLUMN bio TEXT`,
    `ALTER TABLE artists ADD COLUMN bio_source TEXT`,
    `ALTER TABLE artists ADD COLUMN bio_fetched_at INTEGER`,
    `ALTER TABLE artists ADD COLUMN image_source TEXT`,
    `ALTER TABLE artists ADD COLUMN image_fetched_at INTEGER`,
    `ALTER TABLE playlist_tracks ADD COLUMN added_by TEXT DEFAULT 'guest'`,
    `ALTER TABLE playlist_tracks ADD COLUMN added_at INTEGER`,
    
    `ALTER TABLE playlist_tracks ADD COLUMN id INTEGER PRIMARY KEY AUTOINCREMENT`,
    
    `CREATE TABLE IF NOT EXISTS downloaded_playlists (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      archive_path TEXT NOT NULL,
      total_tracks INTEGER DEFAULT 0,
      downloaded_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch()),
      last_downloaded_at INTEGER
    )`,
  ]
  for (const m of quickMigrations) { try { db.exec(m) } catch {} }
  
  
  try {
    
    const tableInfo = db.prepare('PRAGMA table_info(playlist_tracks)').all()
    const hasId = tableInfo.some(c => c.name === 'id')
    if (!hasId) {
      
      db.exec(`
        CREATE TABLE IF NOT EXISTS playlist_tracks_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          playlist_id TEXT,
          track_id TEXT,
          position INTEGER,
          added_by TEXT DEFAULT 'guest',
          added_at INTEGER,
          FOREIGN KEY (playlist_id) REFERENCES playlists(id),
          FOREIGN KEY (track_id) REFERENCES tracks(id)
        );
        INSERT INTO playlist_tracks_new (playlist_id, track_id, position, added_by, added_at)
        SELECT playlist_id, track_id, position, COALESCE(added_by, 'guest'), added_at FROM playlist_tracks;
        DROP TABLE playlist_tracks;
        ALTER TABLE playlist_tracks_new RENAME TO playlist_tracks;
      `)
    }
  } catch (e) {
    console.log('Playlist tracks migration skipped:', e.message)
  }

  
  for (const m of migrations) {
    try {
      if (m.includes('ALTER TABLE') && m.includes('ADD COLUMN')) {
        const match = m.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/)
        if (match) {
          const [, table, col] = match
          const cols = db.prepare(`PRAGMA table_info(${table})`).all()
          if (cols.some(c => c.name === col)) continue 
        }
      }
      db.exec(m)
    } catch {}
  }

  try {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('lyrics_auto_translate', '0')").run()
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('lyrics_translate_target', 'en')").run()
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('prefer_media_keys', '1')").run()
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_fetch_artist_metadata', '0')").run()
  } catch {}

  return db
}

function getDB() { return db }
function getStorageDir() { return _dataDir }

function clearDatabaseTables() {
  db.prepare('DELETE FROM playlist_tracks').run()
  db.prepare('DELETE FROM user_likes').run()
  db.prepare('DELETE FROM play_history').run()
  db.prepare('DELETE FROM artist_track_links').run()
  db.prepare('DELETE FROM lyrics_translations').run()
  db.prepare('DELETE FROM lyrics_cache').run()
  try { db.prepare('DELETE FROM downloaded_playlists').run() } catch {}
  db.prepare('DELETE FROM playlists').run()
  db.prepare('DELETE FROM tracks').run()
  db.prepare('DELETE FROM artists').run()
  db.prepare('DELETE FROM user_settings').run()
  db.prepare('DELETE FROM users').run()
  db.prepare('DELETE FROM settings').run()
}

function resetAppData() {
  if (!db) throw new Error('Database not initialized')
  const wipe = db.transaction(() => {
    clearDatabaseTables()
  })
  wipe()
  for (const dir of ['artwork', 'lyrics', 'avatars']) {
    fs.removeSync(path.join(_dataDir, dir))
  }
  ensureStorageDirs()
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('lyrics_auto_translate', '0')").run()
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('lyrics_translate_target', 'en')").run()
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('prefer_media_keys', '1')").run()
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_fetch_artist_metadata', '0')").run()
  return { ok: true }
}

function importAppData(payload = {}) {
  if (!db) throw new Error('Database not initialized')
  if (!payload || typeof payload !== 'object') throw new Error('Invalid backup payload')
  if (payload.version !== 1) throw new Error('Unsupported backup version')

  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : {}
  const users = Array.isArray(payload.users) ? payload.users : []
  const userSettings = Array.isArray(payload.user_settings) ? payload.user_settings : []
  const artists = Array.isArray(payload.artists) ? payload.artists : []
  const tracks = Array.isArray(payload.tracks) ? payload.tracks : []
  const artistLinks = Array.isArray(payload.artist_track_links) ? payload.artist_track_links : []
  const playlists = Array.isArray(payload.playlists) ? payload.playlists : []
  const playlistTracks = Array.isArray(payload.playlist_tracks) ? payload.playlist_tracks : []
  const userLikes = Array.isArray(payload.user_likes) ? payload.user_likes : []
  const playHistory = Array.isArray(payload.play_history) ? payload.play_history : []

  fs.ensureDirSync(path.join(_dataDir, 'avatars'))

  const restore = db.transaction(() => {
    clearDatabaseTables()

    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    for (const [key, value] of Object.entries(settings)) {
      insertSetting.run(String(key), String(value))
    }

    const insertUser = db.prepare('INSERT INTO users (id, username, display_name, password_hash, avatar_path, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const user of users) {
      let avatarPath = user.avatar_path || null
      if (user.avatar_data) {
        const ext = String(user.avatar_data).includes('image/png') ? 'png' : String(user.avatar_data).includes('image/webp') ? 'webp' : 'jpg'
        avatarPath = path.join(_dataDir, 'avatars', `${user.id}.${ext}`)
        const base64 = String(user.avatar_data).split(',')[1] || ''
        fs.writeFileSync(avatarPath, Buffer.from(base64, 'base64'))
      }
      insertUser.run(
        user.id,
        user.username,
        user.display_name || null,
        user.password_hash,
        avatarPath,
        user.bio || null,
        user.created_at || Math.floor(Date.now() / 1000)
      )
    }

    const insertUserSetting = db.prepare('INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)')
    for (const entry of userSettings) {
      insertUserSetting.run(entry.user_id, entry.key, entry.value)
    }

    const insertArtist = db.prepare('INSERT INTO artists (id, name, bio, image_path, bio_source, bio_fetched_at, image_source, image_fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    for (const artist of artists) {
      insertArtist.run(
        artist.id,
        artist.name,
        artist.bio || null,
        artist.image_path || null,
        artist.bio_source || null,
        artist.bio_fetched_at || null,
        artist.image_source || null,
        artist.image_fetched_at || null
      )
    }

    const insertTrack = db.prepare('INSERT INTO tracks (id, file_path, file_hash, title, artist, album, album_artist, track_num, year, genre, duration, artwork_path, bitrate, last_modified, replaygain, play_count, liked, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const track of tracks) {
      insertTrack.run(
        track.id,
        track.file_path,
        track.file_hash,
        track.title,
        track.artist,
        track.album || null,
        track.album_artist || null,
        track.track_num || null,
        track.year || null,
        track.genre || null,
        track.duration || 0,
        track.artwork_path || null,
        track.bitrate || null,
        track.last_modified || null,
        track.replaygain || null,
        track.play_count || 0,
        track.liked || 0,
        track.added_at || Math.floor(Date.now() / 1000)
      )
    }

    const insertArtistLink = db.prepare('INSERT INTO artist_track_links (artist_id, track_id) VALUES (?, ?)')
    for (const link of artistLinks) {
      insertArtistLink.run(link.artist_id, link.track_id)
    }

    const insertPlaylist = db.prepare('INSERT INTO playlists (id, name, user_id, description, created_at) VALUES (?, ?, ?, ?, ?)')
    for (const playlist of playlists) {
      insertPlaylist.run(
        playlist.id,
        playlist.name,
        playlist.user_id || 'guest',
        playlist.description || null,
        playlist.created_at || Math.floor(Date.now() / 1000)
      )
    }

    const insertPlaylistTrack = db.prepare('INSERT INTO playlist_tracks (id, playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const item of playlistTracks) {
      insertPlaylistTrack.run(
        item.id || null,
        item.playlist_id,
        item.track_id,
        item.position || 0,
        item.added_by || 'guest',
        item.added_at || null
      )
    }

    const insertUserLike = db.prepare('INSERT INTO user_likes (user_id, track_id, liked_at) VALUES (?, ?, ?)')
    for (const like of userLikes) {
      insertUserLike.run(like.user_id, like.track_id, like.liked_at || Math.floor(Date.now() / 1000))
    }

    const insertPlayHistory = db.prepare('INSERT INTO play_history (id, user_id, track_id, seconds_played, played_at) VALUES (?, ?, ?, ?, ?)')
    for (const row of playHistory) {
      insertPlayHistory.run(
        row.id || null,
        row.user_id,
        row.track_id,
        row.seconds_played || 0,
        row.played_at || Math.floor(Date.now() / 1000)
      )
    }
  })

  restore()

  return {
    ok: true,
    imported: {
      users: users.length,
      artists: artists.length,
      tracks: tracks.length,
      playlists: playlists.length,
      history: playHistory.length,
    },
  }
}

module.exports = { initDB, getDB, getStorageDir, resetAppData, importAppData }
