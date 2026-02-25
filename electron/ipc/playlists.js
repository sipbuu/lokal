const { ipcMain } = require('electron');
const { getDB } = require('./db');

function parseM3U(fileContent) {
  const lines = fileContent.split(/\r?\n/);
  const entries = [];
  let currentMeta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:(-?\d+),(.+)/);
      if (match) {
        const meta = match[2].trim();
        const dashIndex = meta.lastIndexOf(' - ');
        if (dashIndex > 0) {
          currentMeta = { artist: meta.substring(0, dashIndex).trim(), title: meta.substring(dashIndex + 3).trim() };
        } else {
          currentMeta = { title: meta, artist: null };
        }
      } else {
        currentMeta = null;
      }
      continue;
    }
    if (line.startsWith('#')) continue;
    entries.push({ file_path: line, title: currentMeta?.title || null, artist: currentMeta?.artist || null });
    currentMeta = null;
  }
  return entries;
}

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result.map(s => s.trim().replace(/^"|"$/g, ''));
}

function parseCSV(fileContent) {
  const lines = fileContent.split(/\r?\n/).filter(l => l.trim());
  const entries = [];
  if (lines.length < 1) return entries;
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const findCol = names => headers.findIndex(h => names.some(n => h.includes(n)));
  const titleCol = findCol(['track name', 'trackname', 'title', 'name', 'track']);
  const artistCol = findCol(['artist name', 'artist', 'performer']);
  if (titleCol === -1) return entries;
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const title = values[titleCol];
    const artist = artistCol !== -1 ? values[artistCol] : null;
    if (title) entries.push({ title, artist });
  }
  return entries;
}

function findTrack(db, entry) {
  let track = null;
  if (entry.file_path) {
    track = db.prepare('SELECT id FROM tracks WHERE file_path = ?').get(entry.file_path);
    if (!track) {
      const filename = entry.file_path.split(/[/\\]/).pop().replace(/\.[^.]+$/, '').toLowerCase();
      track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(filename);
    }
  }
  if (!track && entry.title && entry.artist) {
    track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? AND LOWER(artist) = ? LIMIT 1').get(entry.title.toLowerCase(), entry.artist.toLowerCase());
  }
  if (!track && entry.title) {
    track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(entry.title.toLowerCase());
  }
  return track;
}

function registerPlaylistHandlers() {
  ipcMain.handle('playlist:import', async (event, ...args) => {
    let payload;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) payload = args[0];
    else payload = { name: args[0], entries: args[1] || [], userId: args[2] };
    const { name, entries = [], userId } = payload;
    const db = getDB();
    const playlistId = 'pl-' + Date.now();
    const uid = userId || 'guest';
    console.log('IPC Import UID:', uid);
    try {
      db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid);
      let matched = 0;
      for (const entry of entries) {
        const track = findTrack(db, entry);
        if (track) {
          const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId);
          db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(
            playlistId,
            track.id,
            (max?.m || 0) + 1,
            uid,
            Date.now()
          );
          matched++;
        }
      }
      return { playlistId, name, matched, total: entries.length };
    } catch (e) {
      console.error('Import Error:', e);
      return { error: e.message };
    }
  });

  ipcMain.handle('playlist:importFile', async (event, ...args) => {
    let payload;
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) payload = args[0];
    else payload = { name: args[0], fileContent: args[1], fileType: args[2], userId: args[3] };
    const { name, fileContent = '', fileType = 'm3u', userId } = payload;
    const db = getDB();
    const playlistId = 'pl-' + Date.now();
    const uid = userId || 'guest';
    console.log('IPC Import-File UID:', uid);
    try {
      db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid);
      let entries = [];
      if (fileType === 'm3u' || fileType === 'm3u8') entries = parseM3U(fileContent);
      else if (fileType === 'csv') entries = parseCSV(fileContent);
      else if (fileType === 'json') {
        try {
          const json = JSON.parse(fileContent);
          if (Array.isArray(json.tracks)) entries = json.tracks.map(t => ({ title: t.title || null, artist: t.artist || null, file_path: t.file_path || null }));
        } catch (e) {}
      }
      let matched = 0;
      const unmatched = [];
      for (const entry of entries) {
        const track = findTrack(db, entry);
        if (track) {
          const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId);
          db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(
            playlistId,
            track.id,
            (max?.m || 0) + 1,
            uid,
            Date.now()
          );
          matched++;
        } else {
          unmatched.push({ title: entry.title, artist: entry.artist });
        }
      }
      return { created: name, matched, total: entries.length, unmatched, playlistId };
    } catch (e) {
      console.error('Import File Error:', e);
      return { error: e.message };
    }
  });
}

module.exports = { registerPlaylistHandlers };