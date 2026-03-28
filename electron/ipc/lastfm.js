const { getDB } = require('./db')
const crypto = require('crypto')


const API_ROOT = 'https://ws.audioscrobbler.com/2.0/'

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
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ error: 'Failed to parse response' })
        }
      })
    })

    req.on('error', reject)

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
  
  
  ipcMain.handle('lastfm:connect', async (_, apiKey, apiSecret, token) => {
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
  
  
  ipcMain.handle('lastfm:scrobble', async (_, artist, track, album, duration, timestamp) => {
    const db = getDB()
    const settings = {
      apiKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value,
      apiSecret: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_secret'").get()?.value,
      sessionKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_session_key'").get()?.value,
      enabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_enabled'").get()?.value !== '0',
      scrobblingEnabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_scrobbling'").get()?.value === '1'
    }

    if (!settings.enabled) {
      return { skipped: true, reason: 'Last.fm disabled' }
    }
    if (!settings.scrobblingEnabled) {
      return { skipped: true, reason: 'Scrobbling disabled' }
    }
    
    if (!settings.apiKey || !settings.apiSecret || !settings.sessionKey) {
      return { skipped: true, reason: 'Last.fm not configured' }
    }
    
    return await scrobbleTrack(artist, track, album, duration, timestamp, settings.apiKey, settings.apiSecret, settings.sessionKey)
  })
  
  
  ipcMain.handle('lastfm:updateNowPlaying', async (_, artist, track, album, duration) => {
    const db = getDB()
    const settings = {
      apiKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value,
      apiSecret: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_secret'").get()?.value,
      sessionKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_session_key'").get()?.value,
      enabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_enabled'").get()?.value !== '0'
    }

    if (!settings.enabled) {
      return { skipped: true, reason: 'Last.fm disabled' }
    }
    if (!settings.apiKey || !settings.apiSecret || !settings.sessionKey) {
      return { skipped: true }
    }
    
    return await updateNowPlaying(artist, track, album, duration, settings.apiKey, settings.apiSecret, settings.sessionKey)
  })
}

module.exports = { registerLastFmHandlers }
