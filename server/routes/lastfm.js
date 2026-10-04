const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const crypto = require('crypto')
const scrobbler = require('../../electron/lastfmScrobbler')
const { getPrimaryLastfmArtist, syncLovedTracks } = require('../../electron/ipc/lastfm')
const { loadLastfmDiscovery } = require('../../electron/lastfmDiscovery')

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/'
const REQUEST_TIMEOUT_MS = 15000
const MAX_LOVED_PAGES = 25


// Last.fm's api_sig must leave out "format" (and "callback"); this used to
// include it, so every signed call from web mode (connect, scrobble, now
// playing) was rejected with "Invalid method signature".
const { sign: generateSignature } = require('../../electron/lastfmScrobbler')

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

    let timer = setTimeout(() => req.destroy(new Error('Last.fm request timed out')), REQUEST_TIMEOUT_MS)
    req.on('error', (error) => { clearTimeout(timer); reject(error) })

    if (apiSecret) {
      req.write(body)
    }

    req.end()
  })
}


// Settings shows secrets masked; this is the mask, never a real secret.
const SECRET_PLACEHOLDER = '••••••••'

router.post('/connect', async (req, res) => {
  const { apiKey, token } = req.body
  if (!apiKey) return res.status(400).json({ error: 'API key required' })
  
  const db = getDB()
  // The API secret, unchanged in Settings, arrives masked: use the one saved
  // here instead (the mask is never used as, or saved over, the secret).
  let apiSecret = typeof req.body.apiSecret === 'string' ? req.body.apiSecret : ''
  if (apiSecret === SECRET_PLACEHOLDER) {
    apiSecret = db.prepare("SELECT value FROM settings WHERE key = 'lastfm_api_secret'").get()?.value || ''
    if (!apiSecret) return res.status(400).json({ error: 'Enter your Last.fm API secret again' })
  } else if (apiSecret) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_secret', ?)").run(apiSecret)
  }
  
  if (apiKey) db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastfm_api_key', ?)").run(apiKey)
  
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


// Scrobbling and "now playing": the same shared scrobbler as the desktop app.
router.post('/scrobble', async (req, res) => {
  const { artist, track, album, duration, timestamp } = req.body || {}
  res.json(await scrobbler.scrobble(getDB(), { artist, track, album, duration, timestamp }).catch(e => ({ error: e.message })))
})

router.post('/update-now-playing', async (req, res) => {
  const { artist, track, album, duration } = req.body || {}
  res.json(await scrobbler.updateNowPlaying(getDB(), { artist, track, album, duration }).catch(e => ({ error: e.message })))
})

router.get('/similar-music', async (req, res) => {
  res.json(await similarMusic(req.query?.artist, req.query?.track, req.query?.limit || 24).catch(e => ({ error: e.message })))
})

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

function normalizeTrack(track) {
  return {
    title: track?.name || track?.title || '',
    artist: typeof track?.artist === 'string' ? track.artist : track?.artist?.name || '',
    album: typeof track?.album === 'string' ? track.album : track?.album?.name || '',
    artwork_url: imageUrl(track?.image),
    url: track?.url || '',
    playcount: Number(track?.playcount) || 0,
    scrobbledAt: Number(track?.date?.uts) || null,
  }
}

function normalizeSimilarArtist(artist) {
  return {
    name: artist?.name || '',
    image: imageUrl(artist?.image),
    url: artist?.url || '',
    match: Number(artist?.match) || 0,
  }
}

function settings() {
  return Object.fromEntries(getDB().prepare('SELECT key, value FROM settings').all().map(row => [row.key, row.value]))
}

async function discovery(page = 0) {
  return loadLastfmDiscovery(settings(), lastfmCall, { page })
}

async function similarMusic(artist, track, limit = 24) {
  const saved = settings()
  const artistName = String(artist || '').trim()
  const trackName = String(track || '').trim()
  if (!saved.lastfm_api_key || !artistName) return { error: 'Connect Last.fm before loading similar music.' }
  const parsedLimit = Number(limit)
  const normalizedLimit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(50, Math.max(1, Math.trunc(parsedLimit)))
    : 24
  const result = await lastfmCall(trackName ? 'track.getSimilar' : 'artist.getSimilar', trackName
    ? { artist: artistName, track: trackName, limit: String(normalizedLimit) }
    : { artist: artistName, limit: String(normalizedLimit) }, saved.lastfm_api_key, null)
  if (result?.error) return { error: result.message || result.error || 'Last.fm similar music failed.' }
  return trackName
    ? { tracks: asArray(result?.similartracks?.track).map(normalizeTrack).filter(item => item.title && item.artist) }
    : { artists: asArray(result?.similarartists?.artist).map(normalizeSimilarArtist).filter(item => item.name) }
}

async function lovedTracks(startPage = 1) {
  const saved = settings()
  if (!saved.lastfm_api_key || !saved.lastfm_username) return { error: 'Connect Last.fm before syncing liked tracks.' }
  const tracks = []
  const firstPage = Math.max(1, Number(startPage) || 1)
  const endPage = firstPage + MAX_LOVED_PAGES - 1
  let page = firstPage
  while (page <= endPage) {
    const result = await lastfmCall('user.getLovedTracks', { user: saved.lastfm_username, limit: '200', page: String(page) }, saved.lastfm_api_key, null)
    if (result?.error) return { error: result.message || 'Could not load Last.fm loved tracks.' }
    const current = asArray(result?.lovedtracks?.track).map(normalizeTrack).filter(track => track.title && track.artist)
    tracks.push(...current)
    const totalPages = Number(result?.lovedtracks?.['@attr']?.totalPages)
    if (!current.length || (totalPages && page >= totalPages)) break
    page++
  }
  const partial = page > endPage
  return { tracks, partial, nextPage: partial ? page : null }
}

async function setLoved(artist, track, loved) {
  const saved = settings()
  if (saved.lastfm_enabled === '0' || !saved.lastfm_api_key || !saved.lastfm_api_secret || !saved.lastfm_session_key) return { skipped: true }
  return lastfmCall(loved ? 'track.love' : 'track.unlove', { artist: getPrimaryLastfmArtist(artist), track, sk: saved.lastfm_session_key }, saved.lastfm_api_key, saved.lastfm_api_secret)
}

router.get('/discovery', async (req, res) => res.json(await discovery(req.query?.page).catch(e => ({ error: e.message }))))
router.get('/loved', async (req, res) => res.json(await lovedTracks(req.query?.page).catch(e => ({ error: e.message }))))
router.post('/loved', async (req, res) => res.json(await setLoved(req.body?.artist, req.body?.track, !!req.body?.loved).catch(e => ({ error: e.message }))))
router.post('/sync-likes', async (req, res) => {
  res.json(await syncLovedTracks(req.body?.userId || 'guest', req.body?.page).catch(e => ({ error: e.message })))
})

module.exports = router
