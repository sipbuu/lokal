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
  
  if (apiSecret) {
    allParams.api_sig = generateSignature(allParams, apiSecret)
  }
  
  const body = new URLSearchParams(allParams).toString()
  const requestUrl = apiSecret ? API_ROOT : `${API_ROOT}?${body}`
  
  return new Promise((resolve, reject) => {
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


router.post('/connect', async (req, res) => {
  const { apiKey, apiSecret, token } = req.body
  if (!apiKey) return res.status(400).json({ error: 'API key required' })
  
  const db = getDB()
  
  
  if (apiKey) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_key', ?)").run(apiKey)
  if (apiSecret) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_secret', ?)").run(apiSecret)
  
  if (token) {
    try {
      const json = await lastfmCall('auth.getSession', { token }, apiKey, apiSecret, apiSecret)
      if (json.session?.key) {
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_session_key', ?)").run(json.session.key)
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_username', ?)").run(json.session.name)
        return res.json({ success: true, sessionKey: json.session.key, username: json.session.name })
      }
      return res.status(400).json({ error: json.message || 'Failed to get session' })
    } catch {
      return res.status(500).json({ error: 'Connection failed' })
    }
  }
  
  
  const result = await lastfmCall('artist.getInfo', { artist: 'Radiohead' }, apiKey, null, null)
  if (result.error) {
    return res.status(400).json({ error: result.message || 'Invalid API key' })
  }
  res.json({ success: true, message: 'API key valid' })
})

router.get('/callback', (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : ''
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Lokal Last.fm</title>
  </head>
  <body style="margin:0;background:#0a0a0a;color:#f5f5f5;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
    <div style="padding:24px 28px;border:1px solid rgba(255,255,255,0.12);border-radius:16px;background:rgba(255,255,255,0.04);text-align:center;max-width:420px">
      <div style="font-size:18px;font-weight:600;margin-bottom:8px">Last.fm Authorization</div>
      <div id="status" style="font-size:14px;color:rgba(255,255,255,0.72)">Finishing connection…</div>
    </div>
    <script>
      const token = ${JSON.stringify(token)};
      const payload = { type: 'lokal-lastfm-auth-token', token };
      try { localStorage.setItem('lokal-lastfm-auth-token', token) } catch {}
      try { if (window.opener) window.opener.postMessage(payload, window.location.origin) } catch {}
      document.getElementById('status').textContent = token ? 'You can return to Lokal now.' : 'No token was received from Last.fm.'
      setTimeout(() => { try { window.close() } catch {} }, 600)
    </script>
  </body>
</html>`)
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
  
  if (!settings.apiKey || !settings.apiSecret || !settings.sessionKey) {
    return res.json({ skipped: true })
  }
  
  const { artist, track, album, duration } = req.body
  if (!artist || !track) {
    return res.status(400).json({ error: 'artist and track required' })
  }
  
  const params = {
    artist,
    track,
    sk: settings.sessionKey
  }
  
  if (album) params.album = album
  if (duration) params.duration = duration.toString()
  
  const result = await lastfmCall('track.updateNowPlaying', params, settings.apiKey, settings.apiSecret, settings.sessionKey)
  res.json(result)
})

module.exports = router
