
const http = require('http')
const fs = require('fs')
const path = require('path')

let rpcClient = null
let startTimestamp = null
let artworkServer = null
let artworkPort = null
let artworkFile = null 


function ensureArtworkServer() {
  return new Promise((resolve) => {
    if (artworkServer) return resolve(artworkPort)
    artworkServer = http.createServer((req, res) => {
      if (artworkFile && fs.existsSync(artworkFile)) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache' })
        fs.createReadStream(artworkFile).pipe(res)
      } else {
        res.writeHead(404); res.end()
      }
    })
    artworkServer.listen(0, '127.0.0.1', () => {
      artworkPort = artworkServer.address().port
      resolve(artworkPort)
    })
  })
}

async function tryConnect(clientId) {
  if (!clientId) return false
  try {
    const DiscordRPC = require('discord-rpc')
    if (rpcClient) { try { rpcClient.destroy() } catch {} rpcClient = null }
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' })
    rpcClient.on('error', () => { rpcClient = null })
    await Promise.race([
      rpcClient.login({ clientId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ])
    return true
  } catch (e) {
    console.log('Discord RPC:', e.message); rpcClient = null; return false
  }
}

async function setActivity(track, isPlaying) {
  if (!rpcClient) return
  try {
    if (!track || !isPlaying) { await rpcClient.clearActivity().catch(() => {}); return }
    if (isPlaying) startTimestamp = new Date()

    
    let largeImageKey = 'lokal_music'
    if (track.artwork_path && fs.existsSync(track.artwork_path)) {
      try {
        const port = await ensureArtworkServer()
        artworkFile = track.artwork_path
        
        
        
        largeImageKey = 'lokal_music' 
      } catch {}
    }

    await rpcClient.setActivity({
      details: (track.title || 'Unknown').slice(0, 128),
      state: `by ${(track.artist || 'Unknown').slice(0, 122)}`,
      startTimestamp: isPlaying ? startTimestamp : undefined,
      largeImageKey,
      largeImageText: track.album?.slice(0, 128) || 'Lokal Music',
      smallImageKey: isPlaying ? 'playing' : 'paused',
      smallImageText: isPlaying ? '▶ Playing' : '⏸ Paused',
      instance: false,
    })
  } catch { rpcClient = null }
}

function registerDiscordHandlers(ipcMain) {
  const { getDB } = require('./db')

  ipcMain.handle('discord:connect', async (_, clientId) => {
    const id = clientId || (() => {
      try { return getDB().prepare("SELECT value FROM settings WHERE key = 'discord_client_id'").get()?.value } catch { return null }
    })()
    return tryConnect(id)
  })

  ipcMain.handle('discord:setActivity', async (_, track, isPlaying) => {
    return setActivity(track, isPlaying)
  })

  ipcMain.handle('discord:disconnect', async () => {
    if (rpcClient) { try { await rpcClient.clearActivity(); rpcClient.destroy() } catch {} rpcClient = null }
    if (artworkServer) { artworkServer.close(); artworkServer = null; artworkPort = null }
  })
}

module.exports = { registerDiscordHandlers }
