const { getDB } = require('./db')
const crypto = require('crypto')


const API_ROOT = 'https://ws.audioscrobbler.com/2.0/'


function generateSignature(params, secret) {
  const sorted = Object.keys(params).sort()
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
    const sigParams = { ...baseParams }
    const sorted = Object.keys(sigParams).sort()
    let sigString = ''
    for (const key of sorted) {
      sigString += key + sigParams[key]
    }
    sigString += apiSecret

    baseParams.api_sig = crypto
      .createHash('md5')
      .update(sigString)
      .digest('hex')
  }

  baseParams.format = 'json'

  const queryString = new URLSearchParams(baseParams).toString()
  const url = `${API_ROOT}?${queryString}`

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'LokalMusic/4.0' } }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          resolve({ error: 'Failed to parse response' })
        }
      })
    }).on('error', reject)
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
  
  const params = {
    'artist[0]': artist,
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
  
  const params = {
    'artist[0]': artist,
    'track[0]': track,
    'sk': sessionKey
  }
  
  if (album) params['album[0]'] = album
  if (duration) params['duration[0]'] = duration.toString()
  
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
      scrobblingEnabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_scrobbling'").get()?.value === '1'
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
      scrobblingEnabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_scrobbling'").get()?.value === '1'
    }
    
    if (!settings.scrobblingEnabled || !settings.apiKey || !settings.apiSecret || !settings.sessionKey) {
      return { skipped: true }
    }
    
    return await updateNowPlaying(artist, track, album, duration, settings.apiKey, settings.apiSecret, settings.sessionKey)
  })
}

module.exports = { registerLastFmHandlers }
