const http = require('http')
const fs = require('fs')
const path = require('path')

let rpcClient = null
let artworkServer = null
let artworkPort = null
let artworkFile = null
let lastTrackId = null

const artworkCache = new Map()

function cleanTitle(title) {
  if (!title) return ''
  return title.replace(/\s*\([^)]*\)/g, '').trim()
}

function isArtistMatch(localArtist, itunesArtist) {
  if (!localArtist || !itunesArtist) return false
  const a = localArtist.toLowerCase()
  const b = itunesArtist.toLowerCase()
  return a.includes(b) || b.includes(a)
}

async function fetchiTunesArtwork(title, artist) {
  if (!title || !artist) return null
  
  const cacheKey = `${title}-${artist}`
  
  if (artworkCache.has(cacheKey)) {
    return artworkCache.get(cacheKey)
  }
  
  try {
    const cleanTitleText = cleanTitle(title)
    const query = encodeURIComponent(`${cleanTitleText} ${artist}`)
    const response = await fetch(`https://itunes.apple.com/search?term=${query}&entity=song&limit=5`)
    const data = await response.json()

    if (data.results && data.results.length > 0) {
      const match = data.results.find(res => isArtistMatch(artist, res.artistName))
      
      if (match) {
        const artworkUrl = match.artworkUrl100.replace('100x100bb', '600x600bb')
        artworkCache.set(cacheKey, artworkUrl)
        return artworkUrl
      }
    }
  } catch (err) {
    console.error('iTunes API Error:', err)
  }
  
  artworkCache.set(cacheKey, 'lokal_music')
  return 'lokal_music'
}

function msFromMaybeSeconds(value) {
  if (!value) return 0
  return value > 100000 ? Math.round(value) : Math.round(value * 1000)
}

function formatTimeMs(ms) {
  if (!ms) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const s = totalSec % 60
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

async function tryConnect(clientId) {
  if (!clientId) return false
  try {
    const DiscordRPC = require('discord-rpc')
    if (rpcClient) {
      try { rpcClient.destroy() } catch {}
      rpcClient = null
    }
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' })
    rpcClient.on('error', () => { rpcClient = null })
    await Promise.race([
      rpcClient.login({ clientId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ])
    return true
  } catch (e) {
    rpcClient = null
    return false
  }
}

async function setActivity(track, isPlaying) {
  if (!rpcClient) return
  try {
    if (!track) {
      await rpcClient.clearActivity().catch(() => {})
      return
    }

    const cacheKey = `${track.title}-${track.artist}`
    let largeImageKey = artworkCache.get(cacheKey) || 'lokal_music'

    if (track.id !== lastTrackId) {
      lastTrackId = track.id
      fetchiTunesArtwork(track.title, track.artist).then((url) => {
        if (url && url !== largeImageKey && url !== 'lokal_music') {
          setActivity(track, isPlaying)
        }
      })
    }

    const positionMs = msFromMaybeSeconds(track.position_ms ?? track.position)
    const durationMs = msFromMaybeSeconds(track.duration_ms ?? track.duration)
    const now = Date.now()
    const timestamps = {}

    if (isPlaying) {
      timestamps.startTimestamp = Math.floor(now - positionMs)
      if (durationMs > 0) {
        timestamps.endTimestamp = Math.floor(now + (durationMs - positionMs))
      }
    }

    await rpcClient.setActivity({
      details: (track.title || 'Unknown').slice(0, 128),
      state: `by ${(track.artist || 'Unknown').slice(0, 122)}`,
      startTimestamp: timestamps.startTimestamp,
      endTimestamp: timestamps.endTimestamp,
      largeImageKey,
      largeImageText: track.album?.slice(0, 128) || 'Lokal Music',
      smallImageKey: isPlaying ? 'playing' : 'paused',
      smallImageText: (isPlaying ? '▶ Playing — ' : '⏸ Paused — ')
        + `${formatTimeMs(positionMs)}${durationMs ? ' / ' + formatTimeMs(durationMs) : ''}`,
      instance: false,
    })
  } catch (err) {
    console.error('Discord RPC Error:', err)
    rpcClient = null
  }
}

function registerDiscordHandlers(ipcMain) {
  const { getDB } = require('./db')

  ipcMain.handle('discord:connect', async (_, clientId) => {
    const id = clientId || (() => {
      try {
        return getDB().prepare("SELECT value FROM settings WHERE key = 'discord_client_id'").get()?.value
      } catch {
        return null
      }
    })()
    return tryConnect(id)
  })

  ipcMain.handle('discord:setActivity', async (_, track, isPlaying) => {
    return setActivity(track, isPlaying)
  })

  ipcMain.handle('discord:disconnect', async () => {
    if (rpcClient) {
      try {
        await rpcClient.clearActivity()
        rpcClient.destroy()
      } catch {}
      rpcClient = null
    }
    if (artworkServer) {
      try { artworkServer.close() } catch {}
      artworkServer = null
      artworkPort = null
    }
  })
}

async function cleanupAndExit(code = 0) {
  try {
    if (rpcClient) {
      try { await rpcClient.clearActivity() } catch {}
      try { rpcClient.destroy() } catch {}
      rpcClient = null
    }
  } catch {}
  process.exit(code)
}

process.on('SIGINT', () => cleanupAndExit(0))
process.on('SIGTERM', () => cleanupAndExit(0))

process.on('uncaughtException', async (err) => {
  try { console.error(err) } catch {}
  await cleanupAndExit(1)
})

process.on('unhandledRejection', async (err) => {
  try { console.error(err) } catch {}
  await cleanupAndExit(1)
})

module.exports = { registerDiscordHandlers }
