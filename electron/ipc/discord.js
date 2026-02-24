const http = require('http')
const fs = require('fs')
const path = require('path')

let rpcClient = null
let artworkServer = null
let artworkPort = null
let artworkFile = null

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

    let largeImageKey = 'lokal_music'

    const positionMs = msFromMaybeSeconds(track.position_ms ?? track.position)
    const durationMs = msFromMaybeSeconds(track.duration_ms ?? track.duration)
    const now = Date.now()
    const timestamps = {}

    if (isPlaying) {
      timestamps.startTimestamp = new Date(now - positionMs)
      if (durationMs > 0) timestamps.endTimestamp = new Date(now + (durationMs - positionMs))
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
  } catch {
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

module.exports = { registerDiscordHandlers }