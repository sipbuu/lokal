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

function initDB() {
  _dataDir = getDataDir()
  fs.ensureDirSync(_dataDir)
  fs.ensureDirSync(path.join(_dataDir, 'artwork'))
  fs.ensureDirSync(path.join(_dataDir, 'lyrics'))
  fs.ensureDirSync(path.join(_dataDir, 'avatars'))

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
    `ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS artist_track_links (artist_id TEXT NOT NULL, track_id TEXT NOT NULL, PRIMARY KEY (artist_id, track_id))`,
    `CREATE TABLE IF NOT EXISTS play_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL, seconds_played INTEGER DEFAULT 0, played_at INTEGER DEFAULT (unixepoch()))`,
  ]
  
  const quickMigrations = [
    `ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0`,
    `ALTER TABLE playlists ADD COLUMN user_id TEXT DEFAULT 'guest'`,
    `ALTER TABLE playlists ADD COLUMN description TEXT`,
    `ALTER TABLE users ADD COLUMN bio TEXT`,
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

  return db
}

function getDB() { return db }
function getStorageDir() { return _dataDir }

module.exports = { initDB, getDB, getStorageDir }
