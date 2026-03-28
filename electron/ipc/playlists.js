const { ipcMain } = require('electron');
const path = require('path');
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

function firstGenre(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean)[0] || null
}

function normalizeGenres(value) {
  const parts = String(value || '').split(',').map(part => part.trim()).filter(Boolean)
  return parts.length ? [...new Set(parts)].join(', ') : null
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseExplicit(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 0
  return ['1', 'true', 'yes', 'y', 'explicit'].includes(normalized) ? 1 : 0
}

function parseCSV(fileContent) {
  const lines = fileContent.split(/\r?\n/).filter(l => l.trim())
  const entries = []
  if (lines.length < 1) return entries
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const findCol = names => headers.findIndex(h => names.some(n => h === n || h.includes(n)))
  const titleCol = findCol(['track name', 'trackname', 'song title', 'title', 'name'])
  const artistCol = findCol(['artist name', 'artist', 'performer'])
  const albumCol = findCol(['album name', 'album'])
  const durationCol = findCol(['duration_ms', 'duration ms', 'duration'])
  const urlCol = findCol(['track url', 'url', 'spotify uri', 'uri', 'apple music url', 'youtube url'])
  const genreCol = findCol(['genres', 'genre'])
  const labelCol = findCol(['record label', 'label'])
  const explicitCol = findCol(['explicit'])
  const releaseDateCol = findCol(['release date', 'release_date', 'year'])
  const danceabilityCol = findCol(['danceability'])
  const energyCol = findCol(['energy'])
  const keyCol = findCol(['track key', 'key'])
  const loudnessCol = findCol(['loudness'])
  const modeCol = findCol(['mode'])
  const speechinessCol = findCol(['speechiness'])
  const acousticnessCol = findCol(['acousticness'])
  const instrumentalnessCol = findCol(['instrumentalness'])
  const livenessCol = findCol(['liveness'])
  const valenceCol = findCol(['valence'])
  const tempoCol = findCol(['tempo'])
  const timeSignatureCol = findCol(['time signature'])
  if (titleCol === -1) return entries
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const title = values[titleCol]
    const artist = artistCol !== -1 ? values[artistCol].replace(/\s*;\s*/g, ', ') : null
    const album = albumCol !== -1 ? values[albumCol] : null
    const genres = genreCol !== -1 ? normalizeGenres(values[genreCol]) : null
    const releaseDate = releaseDateCol !== -1 ? values[releaseDateCol] : null
    if (title) entries.push({
      title,
      artist,
      album,
      duration: durationCol !== -1 ? parseNumber(values[durationCol]) : null,
      source_url: urlCol !== -1 ? values[urlCol] : null,
      genres,
      genre: firstGenre(genres),
      record_label: labelCol !== -1 ? values[labelCol] || null : null,
      explicit: explicitCol !== -1 ? parseExplicit(values[explicitCol]) : 0,
      year: releaseDate ? parseInteger(String(releaseDate).slice(0, 4)) : null,
      danceability: danceabilityCol !== -1 ? parseNumber(values[danceabilityCol]) : null,
      energy: energyCol !== -1 ? parseNumber(values[energyCol]) : null,
      track_key: keyCol !== -1 ? parseInteger(values[keyCol]) : null,
      loudness: loudnessCol !== -1 ? parseNumber(values[loudnessCol]) : null,
      mode: modeCol !== -1 ? parseInteger(values[modeCol]) : null,
      speechiness: speechinessCol !== -1 ? parseNumber(values[speechinessCol]) : null,
      acousticness: acousticnessCol !== -1 ? parseNumber(values[acousticnessCol]) : null,
      instrumentalness: instrumentalnessCol !== -1 ? parseNumber(values[instrumentalnessCol]) : null,
      liveness: livenessCol !== -1 ? parseNumber(values[livenessCol]) : null,
      valence: valenceCol !== -1 ? parseNumber(values[valenceCol]) : null,
      tempo: tempoCol !== -1 ? parseNumber(values[tempoCol]) : null,
      time_signature: timeSignatureCol !== -1 ? parseInteger(values[timeSignatureCol]) : null,
    })
  }
  return entries
}

function parseJSON(fileContent) {
  try {
    const json = JSON.parse(fileContent);
    if (Array.isArray(json)) {
      return json.map(t => ({
        title: t.title || t.name || null,
        artist: t.artist || t.artistName || t.performer || null,
        album: t.album || t.albumName || null,
        file_path: t.file_path || t.path || null,
        duration: t.duration || t.duration_ms || null,
        source_url: t.source_url || t.url || t.uri || null,
        genres: normalizeGenres(t.genres || t.genre),
        genre: firstGenre(t.genres || t.genre),
        record_label: t.record_label || t.label || null,
        explicit: parseExplicit(t.explicit),
        year: parseInteger(t.year || String(t.release_date || '').slice(0, 4)),
        danceability: parseNumber(t.danceability),
        energy: parseNumber(t.energy),
        track_key: parseInteger(t.track_key ?? t.key),
        loudness: parseNumber(t.loudness),
        mode: parseInteger(t.mode),
        speechiness: parseNumber(t.speechiness),
        acousticness: parseNumber(t.acousticness),
        instrumentalness: parseNumber(t.instrumentalness),
        liveness: parseNumber(t.liveness),
        valence: parseNumber(t.valence),
        tempo: parseNumber(t.tempo),
        time_signature: parseInteger(t.time_signature ?? t.timeSignature),
      })).filter(t => t.title || t.file_path);
    }
    if (Array.isArray(json.tracks)) {
      return json.tracks.map(t => ({
        title: t.title || t.name || null,
        artist: t.artist || t.artistName || null,
        album: t.album || t.albumName || null,
        file_path: t.file_path || t.path || null,
        duration: t.duration || t.duration_ms || null,
        source_url: t.source_url || t.url || t.uri || null,
        genres: normalizeGenres(t.genres || t.genre),
        genre: firstGenre(t.genres || t.genre),
        record_label: t.record_label || t.label || null,
        explicit: parseExplicit(t.explicit),
        year: parseInteger(t.year || String(t.release_date || '').slice(0, 4)),
        danceability: parseNumber(t.danceability),
        energy: parseNumber(t.energy),
        track_key: parseInteger(t.track_key ?? t.key),
        loudness: parseNumber(t.loudness),
        mode: parseInteger(t.mode),
        speechiness: parseNumber(t.speechiness),
        acousticness: parseNumber(t.acousticness),
        instrumentalness: parseNumber(t.instrumentalness),
        liveness: parseNumber(t.liveness),
        valence: parseNumber(t.valence),
        tempo: parseNumber(t.tempo),
        time_signature: parseInteger(t.time_signature ?? t.timeSignature),
      })).filter(t => t.title || t.file_path);
    }
  } catch {}
  return [];
}

function parseImportEntries(fileContent, fileType) {
  if (fileType === 'm3u' || fileType === 'm3u8') return parseM3U(fileContent);
  if (fileType === 'csv') return parseCSV(fileContent);
  if (fileType === 'json') return parseJSON(fileContent);
  return [];
}

function normalizeMatchValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(?:feat|ft|featuring|remaster(?:ed)?|deluxe|radio edit|explicit|clean|version|mix)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findTrack(db, entry) {
  let track = null;
  const primaryArtist = String(entry.artist || '').split(/\s*;\s*|\s*,\s*/).map(s => s.trim()).filter(Boolean)[0] || null;
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
  if (!track && entry.title && primaryArtist) {
    track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? AND (LOWER(artist) = ? OR LOWER(artist) LIKE ?) LIMIT 1').get(entry.title.toLowerCase(), primaryArtist.toLowerCase(), `%${primaryArtist.toLowerCase()}%`);
  }
  if (!track && entry.title) {
    track = db.prepare('SELECT id FROM tracks WHERE LOWER(title) = ? LIMIT 1').get(entry.title.toLowerCase());
  }
  if (!track && entry.title && entry.artist) {
    const titleNorm = normalizeMatchValue(entry.title);
    const artistNorm = normalizeMatchValue(entry.artist);
    const candidates = db.prepare('SELECT id, title, artist FROM tracks WHERE LOWER(title) LIKE ? LIMIT 50').all(`%${entry.title.toLowerCase().slice(0, 18)}%`);
    let best = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const candidateTitle = normalizeMatchValue(candidate.title);
      const candidateArtist = normalizeMatchValue(candidate.artist);
      let score = 0;
      if (candidateTitle === titleNorm) score += 70;
      else if (candidateTitle.includes(titleNorm) || titleNorm.includes(candidateTitle)) score += 45;
      if (candidateArtist === artistNorm) score += 30;
      else if (candidateArtist.includes(artistNorm) || artistNorm.includes(candidateArtist)) score += 18;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best && bestScore >= 72) {
      track = { id: best.id };
    }
  }
  return track;
}

function createGhostTrack(db, entry, sourcePlatform = 'generic', playlistId = 'import') {
  const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safePlatform = String(sourcePlatform || 'generic').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'generic';
  const title = String(entry.title || 'Unknown Track').trim() || 'Unknown Track';
  const artist = String(entry.artist || 'Unknown Artist').trim() || 'Unknown Artist';
  const filePath = `ghost://${safePlatform}/${playlistId}/${id}`;
  db.prepare(`
    INSERT INTO tracks
    (id, file_path, file_hash, title, artist, album, album_artist, track_num, year, genre, genres, record_label, explicit, danceability, energy, track_key, loudness, mode, speechiness, acousticness, instrumentalness, liveness, valence, tempo, time_signature, duration, artwork_path, bitrate, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    filePath,
    id,
    title,
    artist,
    entry.album || null,
    entry.artist || null,
    null,
    entry.year || null,
    entry.genre || null,
    entry.genres || null,
    entry.record_label || null,
    entry.explicit ? 1 : 0,
    entry.danceability ?? null,
    entry.energy ?? null,
    entry.track_key ?? null,
    entry.loudness ?? null,
    entry.mode ?? null,
    entry.speechiness ?? null,
    entry.acousticness ?? null,
    entry.instrumentalness ?? null,
    entry.liveness ?? null,
    entry.valence ?? null,
    entry.tempo ?? null,
    entry.time_signature ?? null,
    entry.duration ? Number(entry.duration) : null,
    null,
    null,
    Date.now()
  );
  return { id, title, artist, album: entry.album || null, file_path: filePath, source_url: entry.source_url || null, isGhost: true };
}

function applyImportedMetadata(db, trackId, entry = {}) {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  if (!track) return null
  db.prepare(`
    UPDATE tracks SET
      year = COALESCE(year, ?),
      genre = COALESCE(NULLIF(genre, ''), ?),
      genres = COALESCE(NULLIF(genres, ''), ?),
      record_label = COALESCE(NULLIF(record_label, ''), ?),
      explicit = CASE WHEN explicit = 1 THEN 1 ELSE ? END,
      danceability = COALESCE(danceability, ?),
      energy = COALESCE(energy, ?),
      track_key = COALESCE(track_key, ?),
      loudness = COALESCE(loudness, ?),
      mode = COALESCE(mode, ?),
      speechiness = COALESCE(speechiness, ?),
      acousticness = COALESCE(acousticness, ?),
      instrumentalness = COALESCE(instrumentalness, ?),
      liveness = COALESCE(liveness, ?),
      valence = COALESCE(valence, ?),
      tempo = COALESCE(tempo, ?),
      time_signature = COALESCE(time_signature, ?)
    WHERE id = ?
  `).run(
    entry.year ?? null,
    entry.genre || firstGenre(entry.genres),
    entry.genres || null,
    entry.record_label || null,
    entry.explicit ? 1 : 0,
    entry.danceability ?? null,
    entry.energy ?? null,
    entry.track_key ?? null,
    entry.loudness ?? null,
    entry.mode ?? null,
    entry.speechiness ?? null,
    entry.acousticness ?? null,
    entry.instrumentalness ?? null,
    entry.liveness ?? null,
    entry.valence ?? null,
    entry.tempo ?? null,
    entry.time_signature ?? null,
    trackId
  )
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
}

function buildImportPreview(db, entries = []) {
  const preview = [];
  let matched = 0;
  for (const entry of entries) {
    const track = findTrack(db, entry);
    if (track) matched++;
    preview.push({
      title: entry.title || path.basename(entry.file_path || '').replace(/\.[^.]+$/, '') || 'Unknown Track',
      artist: entry.artist || 'Unknown Artist',
      album: entry.album || null,
      status: track ? 'Matched' : 'Ghost Song',
      action: track ? 'Already in library' : 'Try auto-match, download, or pick a local file',
    });
  }
  return {
    total: entries.length,
    matched,
    ghostable: Math.max(entries.length - matched, 0),
    rows: preview.slice(0, 12),
  };
}

function resolveGhostTrack(db, ghostTrackId, targetTrackId) {
  const ghost = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path LIKE 'ghost://%'").get(ghostTrackId);
  const target = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path NOT LIKE 'ghost://%'").get(targetTrackId);
  if (!ghost) return { error: 'Ghost track not found' };
  if (!target) return { error: 'Target track not found' };

  const run = db.transaction(() => {
    applyImportedMetadata(db, targetTrackId, ghost)
    db.prepare('UPDATE OR IGNORE playlist_tracks SET track_id = ? WHERE track_id = ?').run(targetTrackId, ghostTrackId);
    db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(ghostTrackId);
    db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(ghostTrackId);
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(ghostTrackId);
    db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(ghostTrackId);
    db.prepare('DELETE FROM lyrics_translations WHERE track_id = ?').run(ghostTrackId);
    db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(ghostTrackId);
    db.prepare('DELETE FROM tracks WHERE id = ?').run(ghostTrackId);
  });

  run();
  return { ok: true, track: db.prepare('SELECT * FROM tracks WHERE id = ?').get(targetTrackId) };
}

function importExternalMetadata(db, payload = {}) {
  const { fileContent = '', fileType = 'csv', sourcePlatform = 'generic' } = payload || {}
  const entries = parseImportEntries(fileContent, fileType)
  let matched = 0
  const unmatched = []
  for (const entry of entries) {
    const track = findTrack(db, entry)
    if (!track) {
      unmatched.push({
        title: entry.title || 'Unknown Track',
        artist: entry.artist || 'Unknown Artist',
        album: entry.album || null,
      })
      continue
    }
    applyImportedMetadata(db, track.id, { ...entry, sourcePlatform })
    matched++
  }
  return {
    ok: true,
    total: entries.length,
    matched,
    skipped: Math.max(entries.length - matched, 0),
    unmatched: unmatched.slice(0, 50),
  }
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

  ipcMain.handle('playlist:previewExternalImport', async (event, payload = {}) => {
    const { fileContent = '', fileType = 'csv' } = payload || {};
    try {
      const entries = parseImportEntries(fileContent, fileType);
      const db = getDB();
      return {
        ok: true,
        fileType,
        ...buildImportPreview(db, entries),
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('playlist:importExternalFile', async (event, payload = {}) => {
    const { name, fileContent = '', fileType = 'csv', userId, sourcePlatform = 'generic' } = payload || {};
    const db = getDB();
    const playlistId = 'pl-' + Date.now();
    const uid = userId || 'guest';
    try {
      const entries = parseImportEntries(fileContent, fileType);
      db.prepare('INSERT INTO playlists (id, name, user_id) VALUES (?, ?, ?)').run(playlistId, name, uid);
      let matched = 0;
      let ghosted = 0;
      const unresolved = [];
      for (const entry of entries) {
        let track = findTrack(db, entry);
        if (!track) {
          track = createGhostTrack(db, entry, sourcePlatform, playlistId);
          ghosted++;
          unresolved.push({
            title: track.title,
            artist: track.artist,
            album: track.album,
            status: 'Ghost Song',
            action: 'Search YouTube, download, pick local file, or skip',
          });
        } else {
          applyImportedMetadata(db, track.id, entry)
          matched++;
        }
        const max = db.prepare('SELECT MAX(position) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId);
        db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)').run(
          playlistId,
          track.id,
          (max?.m || 0) + 1,
          uid,
          Date.now()
        );
      }
      return {
        ok: true,
        playlistId,
        name,
        total: entries.length,
        matched,
        ghosted,
        unresolved: unresolved.slice(0, 50),
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  ipcMain.handle('playlist:importExternalMetadata', async (event, payload = {}) => {
    try {
      return importExternalMetadata(getDB(), payload)
    } catch (e) {
      return { error: e.message }
    }
  });

  ipcMain.handle('playlist:resolveGhostTrack', async (event, ghostTrackId, targetTrackId) => {
    try {
      return resolveGhostTrack(getDB(), ghostTrackId, targetTrackId);
    } catch (e) {
      return { error: e.message };
    }
  });
}

module.exports = { registerPlaylistHandlers };
