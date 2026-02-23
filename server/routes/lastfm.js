const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
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


async function lastfmCall(method, params, apiKey, apiSecret, sessionKey) {
  const https = require('https')
  
  const allParams = {
    method,
    api_key: apiKey,
    ...params,
    format: 'json'
  }
  
  if (sessionKey && apiSecret) {
    allParams.api_sig = generateSignature({ ...allParams, sk: sessionKey }, apiSecret)
  }
  
  const queryString = new URLSearchParams(allParams).toString()
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


router.post('/connect', async (req, res) => {
  const { apiKey, apiSecret, token } = req.body
  if (!apiKey) return res.status(400).json({ error: 'API key required' })
  
  const db = getDB()
  
  
  if (apiKey) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_key', ?)").run(apiKey)
  if (apiSecret) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_secret', ?)").run(apiSecret)
  
  if (token) {
    
    const params = {
      method: 'auth.getSession',
      token: token,
      api_key: apiKey
    }
    
    const sorted = Object.keys(params).sort()
    let str = ''
    for (const key of sorted) {
      str += key + params[key]
    }
    str += apiSecret
    const signature = crypto.createHash('md5').update(str).digest('hex')
    params.api_sig = signature
    params.format = 'json'
    
    const queryString = new URLSearchParams(params).toString()
    const url = `${API_ROOT}?${queryString}`
    
    return new Promise((resolve) => {
      const https = require('https')
      https.get(url, { headers: { 'User-Agent': 'LokalMusic/4.0' } }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const json = JSON.parse(data)
            if (json.session?.key) {
              db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_session_key', ?)").run(json.session.key)
              db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_username', ?)").run(json.session.name)
              resolve(res.json({ success: true, sessionKey: json.session.key, username: json.session.name }))
            } else {
              resolve(res.status(400).json({ error: json.message || 'Failed to get session' }))
            }
          } catch {
            resolve(res.status(500).json({ error: 'Failed to parse response' }))
          }
        })
      }).on('error', () => res.status(500).json({ error: 'Connection failed' }))
    })
  }
  
  
  const result = await lastfmCall('artist.getInfo', { artist: 'Radiohead' }, apiKey, null, null)
  if (result.error) {
    return res.status(400).json({ error: result.message || 'Invalid API key' })
  }
  res.json({ success: true, message: 'API key valid' })
})


router.get('/artist/:artist', async (req, res) => {
  const db = getDB()
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value
  if (!apiKey) return res.status(400).json({ error: 'API key not configured' })
  
  const result = await lastfmCall('artist.getInfo', { artist: req.params.artist }, apiKey, null, null)
  res.json(result)
})


router.get('/track', async (req, res) => {
  const db = getDB()
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value
  if (!apiKey) return res.status(400).json({ error: 'API key not configured' })
  
  const { artist, track } = req.query
  if (!artist || !track) return res.status(400).json({ error: 'artist and track required' })
  
  const result = await lastfmCall('track.getInfo', { artist, track }, apiKey, null, null)
  res.json(result)
})


router.get('/similar/:artist', async (req, res) => {
  const db = getDB()
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value
  if (!apiKey) return res.status(400).json({ error: 'API key not configured' })
  
  const limit = req.query.limit || 5
  const result = await lastfmCall('artist.getSimilar', { artist: req.params.artist, limit: limit.toString() }, apiKey, null, null)
  res.json(result)
})


router.post('/scrobble', async (req, res) => {
  const db = getDB()
  const settings = {
    apiKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value,
    apiSecret: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_secret'").get()?.value,
    sessionKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_session_key'").get()?.value,
    scrobblingEnabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_scrobbling'").get()?.value === '1'
  }
  
  if (!settings.scrobblingEnabled) {
    return res.json({ skipped: true, reason: 'Scrobbling disabled' })
  }
  
  if (!settings.apiKey || !settings.apiSecret || !settings.sessionKey) {
    return res.json({ skipped: true, reason: 'Last.fm not configured' })
  }
  
  const { artist, track, album, duration, timestamp } = req.body
  if (!artist || !track || !timestamp) {
    return res.status(400).json({ error: 'artist, track, and timestamp required' })
  }
  
  const params = {
    'artist[0]': artist,
    'track[0]': track,
    'timestamp[0]': timestamp.toString(),
    'sk': settings.sessionKey
  }
  
  if (album) params['album[0]'] = album
  if (duration) params['duration[0]'] = duration.toString()
  
  const result = await lastfmCall('track.scrobble', params, settings.apiKey, settings.apiSecret, settings.sessionKey)
  res.json(result)
})


router.post('/update-now-playing', async (req, res) => {
  const db = getDB()
  const settings = {
    apiKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_key'").get()?.value,
    apiSecret: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_secret'").get()?.value,
    sessionKey: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_session_key'").get()?.value,
    scrobblingEnabled: db.prepare("SELECT value FROM settings WHERE key = 'lastfm_scrobbling'").get()?.value === '1'
  }
  
  if (!settings.scrobblingEnabled || !settings.apiKey || !settings.apiSecret || !settings.sessionKey) {
    return res.json({ skipped: true })
  }
  
  const { artist, track, album, duration } = req.body
  if (!artist || !track) {
    return res.status(400).json({ error: 'artist and track required' })
  }
  
  const params = {
    'artist[0]': artist,
    'track[0]': track,
    'sk': settings.sessionKey
  }
  
  if (album) params['album[0]'] = album
  if (duration) params['duration[0]'] = duration.toString()
  
  const result = await lastfmCall('track.updateNowPlaying', params, settings.apiKey, settings.apiSecret, settings.sessionKey)
  res.json(result)
})

module.exports = router
