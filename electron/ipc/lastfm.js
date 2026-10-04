const { getDB } = require('./db')
const { loadLastfmDiscovery } = require('../lastfmDiscovery')
const scrobbler = require('../lastfmScrobbler')
const crypto = require('crypto')


const API_ROOT = 'https://ws.audioscrobbler.com/2.0/'
const REQUEST_TIMEOUT_MS = 15000
const MAX_LOVED_PAGES = 25

function getKeepCommaArtists() {
  const keepComma = new Set([
    'tyler, the creator', 'earth, wind & fire', 'crosby, stills & nash',
    'crosby, stills, nash & young', 'simon & garfunkel', 'emerson, lake & palmer',
    'syd barrett', 'pete & bas', 'pe & ne',
  ])
  try {
    const db = getDB()
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'keep_comma_artists'").get()
    if (setting?.value) {
      const userDefined = JSON.parse(setting.value)
      userDefined.forEach(artist => keepComma.add(String(artist || '').toLowerCase().trim()))
    }
  } catch {}
  return keepComma
}

function getPrimaryLastfmArtist(artist) {
  const raw = String(artist || '').trim()
  if (!raw) return ''
  const keepCommaArtists = getKeepCommaArtists()
  const lower = raw.toLowerCase()
  if (keepCommaArtists.has(lower)) return raw
  return raw.split(',')[0].trim() || raw
}


function generateSignature(params, secret) {
  const sorted = Object.keys(params)
    .filter(key => key !== 'format')
    .sort()

  let str = ''
  for (const key of sorted) {
    str += key + params[key]
  }

  str += secret
  return crypto.createHash('md5').update(str).digest('hex')
}


async function lastfmCall(method, params, apiKey, apiSecret) {
  const https = require('https')
  const baseParams = {
    method,
    api_key: apiKey,
    ...params
  }

  if (apiSecret) {
    baseParams.api_sig = generateSignature(baseParams, apiSecret)
  }

  baseParams.format = 'json'

  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(baseParams).toString()
    const requestUrl = apiSecret ? API_ROOT : `${API_ROOT}?${body}`
    let timer
    const req = https.request(requestUrl, {
      method: apiSecret ? 'POST' : 'GET',
      headers: apiSecret
        ? {
            'User-Agent': 'LokalMusic/4.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body)
          }
        : {
            'User-Agent': 'LokalMusic/4.0'
          }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('error', (error) => { clearTimeout(timer); reject(error) })
      res.on('end', () => {
        clearTimeout(timer)
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ error: 'Failed to parse response' })
        }
      })
    })

    timer = setTimeout(() => req.destroy(new Error('Last.fm request timed out')), REQUEST_TIMEOUT_MS)
    req.on('error', (error) => { clearTimeout(timer); reject(error) })

    if (apiSecret) {
      req.write(body)
    }

    req.end()
  })
}


async function fetchArtistInfo(artistName, apiKey) {
  return lastfmCall('artist.getInfo', { artist: artistName }, apiKey, null)
}


async function fetchTrackInfo(artistName, trackName, apiKey) {
  return lastfmCall('track.getInfo', { artist: artistName, track: trackName }, apiKey, null)
}


async function fetchSimilarArtists(artistName, apiKey, limit = 5) {
  return lastfmCall('artist.getSimilar', { artist: artistName, limit: limit.toString() }, apiKey, null)
}

function normalizeSimilarArtist(artist) {
  return {
    name: artist?.name || '',
    image: imageUrl(artist?.image),
    url: artist?.url || '',
    match: Number(artist?.match) || 0,
  }
}

async function fetchSimilar({ artist, track, limit = 24 } = {}) {
  const settings = storedLastfmSettings()
  const apiKey = settings.lastfm_api_key
  const artistName = String(artist || '').trim()
  const trackName = String(track || '').trim()
  if (!apiKey || !artistName) return { error: 'Connect Last.fm before loading similar music.' }
  limit = Math.min(50, Math.max(1, Number(limit) || 24))
  const method = trackName ? 'track.getSimilar' : 'artist.getSimilar'
  const result = await lastfmCall(method, trackName
    ? { artist: artistName, track: trackName, limit: String(limit) }
    : { artist: artistName, limit: String(limit) }, apiKey, null)
  if (result?.error) return { error: result.message || result.error || 'Last.fm similar music failed.' }
  if (trackName) {
    return { tracks: asArray(result?.similartracks?.track).map(normalizeLastfmTrack).filter(item => item.title && item.artist) }
  }
  return { artists: asArray(result?.similarartists?.artist).map(normalizeSimilarArtist).filter(item => item.name) }
}



async function scrobbleTrack(artist, track, album, duration, timestamp, apiKey, apiSecret, sessionKey) {
  if (!sessionKey || !apiKey || !apiSecret) {
    return { error: 'Last.fm not configured - missing API key, secret, or session key' }
  }

  const resolvedArtist = getPrimaryLastfmArtist(artist)
  const params = {
    'artist[0]': resolvedArtist,
    'track[0]': track,
    'timestamp[0]': timestamp.toString(),
    'sk': sessionKey
  }
  
  if (album) params['album[0]'] = album
  if (duration) params['duration[0]'] = duration.toString()
  
  return lastfmCall('track.scrobble', params, apiKey, apiSecret)
}


async function updateNowPlaying(artist, track, album, duration, apiKey, apiSecret, sessionKey) {
  if (!sessionKey || !apiKey || !apiSecret) {
    return { error: 'Last.fm not configured' }
  }

  const resolvedArtist = getPrimaryLastfmArtist(artist)
  const params = {
    artist: resolvedArtist,
    track,
    sk: sessionKey
  }
  
  if (album) params.album = album
  if (duration) params.duration = duration.toString()
  
  return lastfmCall('track.updateNowPlaying', params, apiKey, apiSecret)
}

function storedLastfmSettings() {
  const rows = getDB().prepare('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map(row => [row.key, row.value]))
}

function asArray(value) {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

function imageUrl(images) {
  const list = asArray(images)
  const value = list.find(image => image?.size === 'extralarge')?.['#text']
    || list.find(image => image?.size === 'large')?.['#text']
    || list.find(image => image?.['#text'])?.['#text']
    || ''
  if (!value || /2a96cbd8b46e442fc41c2b86b821562f/i.test(value)) return ''
  return String(value).replace(/^http:\/\//i, 'https://')
}

function normalizeLastfmTrack(track) {
  const artist = typeof track?.artist === 'string' ? track.artist : track?.artist?.name || ''
  return {
    title: track?.name || track?.title || '',
    artist,
    album: typeof track?.album === 'string' ? track.album : track?.album?.name || track?.album?.['#text'] || '',
    artwork_url: imageUrl(track?.image),
    url: track?.url || '',
    playcount: Number(track?.playcount) || 0,
    rank: Number(track?.['@attr']?.rank) || null,
    scrobbledAt: Number(track?.date?.uts) || null,
  }
}

async function fetchDiscovery(page = 0) {
  return loadLastfmDiscovery(storedLastfmSettings(), lastfmCall, { page })
}

async function fetchLovedTracks(startPage = 1) {
  const settings = storedLastfmSettings()
  if (!settings.lastfm_api_key || !settings.lastfm_username) return { error: 'Connect Last.fm before syncing liked tracks.' }
  const tracks = []
  const firstPage = Math.max(1, Number(startPage) || 1)
  const endPage = firstPage + MAX_LOVED_PAGES - 1
  let page = firstPage
  while (page <= endPage) {
    const result = await lastfmCall('user.getLovedTracks', { user: settings.lastfm_username, limit: '200', page: String(page) }, settings.lastfm_api_key, null)
    if (result?.error) return { error: result.message || 'Could not load Last.fm loved tracks.' }
    const current = asArray(result?.lovedtracks?.track).map(normalizeLastfmTrack).filter(track => track.title && track.artist)
    tracks.push(...current)
    const totalPages = Number(result?.lovedtracks?.['@attr']?.totalPages)
    if (!current.length || (totalPages && page >= totalPages)) break
    page++
  }
  const partial = page > endPage
  return { tracks, partial, nextPage: partial ? page : null }
}

async function setLovedTrack(artist, track, loved) {
  const settings = storedLastfmSettings()
  if (settings.lastfm_enabled === '0' || !settings.lastfm_api_key || !settings.lastfm_api_secret || !settings.lastfm_session_key) return { skipped: true }
  return lastfmCall(loved ? 'track.love' : 'track.unlove', {
    artist: getPrimaryLastfmArtist(artist),
    track,
    sk: settings.lastfm_session_key,
  }, settings.lastfm_api_key, settings.lastfm_api_secret)
}

async function syncLovedTracks(userId = 'guest', startPage = 1) {
  const loved = await fetchLovedTracks(startPage)
  if (loved.error) return loved
  const db = getDB()
  const insert = db.prepare('INSERT OR IGNORE INTO user_likes (user_id, track_id) VALUES (?, ?)')
  const titleCandidates = db.prepare(`SELECT id, artist, album FROM tracks WHERE lower(trim(title)) = lower(trim(?))`)
  let matched = 0
  const transaction = db.transaction((tracks) => {
    for (const track of tracks) {
      const artist = getPrimaryLastfmArtist(track.artist)
      let rows = titleCandidates.all(track.title).filter(row => getPrimaryLastfmArtist(row.artist).toLowerCase() === artist.toLowerCase())
      if (rows.length > 1 && track.album) {
        rows = rows.filter(row => String(row.album || '').trim().toLowerCase() === String(track.album).trim().toLowerCase())
      }
      if (rows.length === 1) {
        insert.run(userId || 'guest', rows[0].id)
        matched++
      }
    }
  })
  transaction(loved.tracks)
  return { ok: true, matched, remote: loved.tracks.length, partial: !!loved.partial, nextPage: loved.nextPage || null }
}

function registerLastFmHandlers(ipcMain) {
  console.log("!!! LAST.FM IPC LOADING !!!")
  
  
  ipcMain.handle('lastfm:getSettings', () => {
    const db = getDB()
    const settings = Object.fromEntries(
      db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value])
    )
    return {
      apiKey: settings.lastfm_api_key || '',
      apiSecret: settings.lastfm_api_secret || '',
      username: settings.lastfm_username || '',
      sessionKey: settings.lastfm_session_key || '',
      enabled: settings.lastfm_enabled !== '0',
      scrobblingEnabled: settings.lastfm_scrobbling === '1'
    }
  })
  
  
  ipcMain.handle('lastfm:saveSettings', (_, settings) => {
    const db = getDB()
    if (settings.apiKey !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_key', ?)").run(settings.apiKey || '')
    }
    if (settings.apiSecret !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_secret', ?)").run(settings.apiSecret || '')
    }
    if (settings.username !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_username', ?)").run(settings.username || '')
    }
    if (settings.sessionKey !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_session_key', ?)").run(settings.sessionKey || '')
    }
    if (settings.enabled !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_enabled', ?)").run(settings.enabled ? '1' : '0')
    }
    if (settings.scrobblingEnabled !== undefined) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_scrobbling', ?)").run(settings.scrobblingEnabled ? '1' : '0')
    }
    return { success: true }
  })
  
  
  ipcMain.handle('lastfm:connect', async (_, apiKey, maskedOrSecret, token) => {
  // Settings shows the saved secret masked: the mask means "the saved one".
  let apiSecret = maskedOrSecret
  if (apiSecret === '••••••••') {
    apiSecret = getDB().prepare("SELECT value FROM settings WHERE key = 'lastfm_api_secret'").get()?.value || ''
    if (!apiSecret) return { error: 'Enter your Last.fm API secret again' }
  }
  if (!apiKey || !apiSecret) {
    return { error: 'API key and secret required' }
  }

  if (!token) {
    return { error: 'Auth token required' }
  }

  try {
    const params = {
      token: token
    }

    const response = await lastfmCall(
      'auth.getSession',
      params,
      apiKey,
      apiSecret
    )

    if (response.session?.key) {
      return {
        success: true,
        sessionKey: response.session.key,
        username: response.session.name
      }
    }

    return { error: response.message || 'Failed to get session' }

  } catch (err) {
    return { error: 'Connection failed' }
  }
})
  
  
  ipcMain.handle('lastfm:getArtistInfo', async (_, artistName) => {
    const db = getDB()
    const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value
    if (!apiKey) return { error: 'API key not configured' }
    
    return await fetchArtistInfo(artistName, apiKey)
  })
  
  
  ipcMain.handle('lastfm:getTrackInfo', async (_, artistName, trackName) => {
    const db = getDB()
    const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value
    if (!apiKey) return { error: 'API key not configured' }
    
    return await fetchTrackInfo(artistName, trackName, apiKey)
  })
  
  
  ipcMain.handle('lastfm:getSimilarArtists', async (_, artistName, limit) => {
    const db = getDB()
    const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value
    if (!apiKey) return { error: 'API key not configured' }
    
    return await fetchSimilarArtists(artistName, apiKey, limit)
  })

  ipcMain.handle('lastfm:similar', (_, artist, track, limit) => fetchSimilar({ artist, track, limit }).catch(e => ({ error: e.message })))
  
  
  // Scrobbling and "now playing" go through the shared scrobbler (also used
  // by the web server): correct signing, main-artist handling, no
  // placeholder albums, and an offline queue.
  ipcMain.handle('lastfm:scrobble', (_, artist, track, album, duration, timestamp) =>
    scrobbler.scrobble(getDB(), { artist, track, album, duration, timestamp }).catch(e => ({ error: e.message })))

  ipcMain.handle('lastfm:updateNowPlaying', (_, artist, track, album, duration) =>
    scrobbler.updateNowPlaying(getDB(), { artist, track, album, duration }).catch(e => ({ error: e.message })))

  ipcMain.handle('lastfm:discovery', (_, page) => fetchDiscovery(page).catch(e => ({ error: e.message })))
  ipcMain.handle('lastfm:loved', (_, page) => fetchLovedTracks(page).catch(e => ({ error: e.message })))
  ipcMain.handle('lastfm:setLoved', (_, artist, track, loved) => setLovedTrack(artist, track, loved).catch(e => ({ error: e.message })))
  ipcMain.handle('lastfm:syncLikes', (_, userId, page) => syncLovedTracks(userId, page).catch(e => ({ error: e.message })))

  // Scrobbles queued while offline: try once shortly after start-up.
  setTimeout(() => { try { scrobbler.flushQueue(getDB()).catch(() => {}) } catch {} }, 20000)
}

module.exports = { registerLastFmHandlers, getPrimaryLastfmArtist, syncLovedTracks, fetchSimilar, fetchDiscovery }
