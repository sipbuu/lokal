const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs-extra')
const { getDB, getStorageDir } = require('./db')
const { findYtDlp, findFfmpeg, findFfprobe } = require('./tools')

const downloadQueue = new Map()
let mainWindow = null

function getPlaylistId(url) {
  const match = url.match(/(?:playlist\?list=|youtube\.com\/playlist\?list=)([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

function getVideoIdsFromArchive(archivePath) {
  const ids = new Set()
  try {
    if (fs.existsSync(archivePath)) {
      const content = fs.readFileSync(archivePath, 'utf-8')
      for (const line of content.split('\n')) {
        const match = line.match(/^([a-zA-Z0-9_-]{11})$/)
        if (match) ids.add(match[1])
      }
    }
  } catch {}
  return ids
}


function getYouTubeId(url) {
  const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/)
  return match ? match[1] : null
}


async function cleanupLeftovers(filepaths, outputDir) {
  const audioExts = new Set(['.mp3','.flac','.m4a','.ogg','.wav','.aac','.opus'])
  const junkExts = new Set(['.webp','.webm','.ytdl','.part','.jpg.part','.temp', '.mhtml', '.info.json'])

  for (const fp of filepaths) {
    const dir = path.dirname(fp)
    const base = path.basename(fp, path.extname(fp))
    try {
      const siblings = fs.readdirSync(dir)
      for (const f of siblings) {
        const ext = path.extname(f).toLowerCase()
        const fpath = path.join(dir, f)
        if (!f.startsWith(base)) continue
        if (audioExts.has(ext)) continue
        if (junkExts.has(ext)) { try { fs.unlinkSync(fpath) } catch {} }
        if (ext === '.jpg') {
          try {
            const stat = fs.statSync(fpath)
            if (stat.size < 51200) fs.unlinkSync(fpath)
          } catch {}
        }
      }
    } catch {}
  }

  try {
    const topLevel = fs.readdirSync(outputDir)
    for (const f of topLevel) {
      if (path.extname(f).toLowerCase() === '.webp') {
        try { fs.unlinkSync(path.join(outputDir, f)) } catch {}
      }
    }
  } catch {}
}

function getYouTubeThumbnail(videoId) {
  return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
}

function registerDownloaderHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')

  ipcMain.handle('downloader:search', async (e, query, page = 1, continuationToken = null) => {
    mainWindow = BrowserWindow.fromWebContents(e.sender)
    const ytdlp = findYtDlp()
    if (!ytdlp) return { error: 'yt-dlp not found. Go to Settings → External Tools to download it automatically or set a custom path.' }

    const limit = 10

    return new Promise((resolve) => {
      const results = []
      let searchQuery = ''
      
      
      
      if (page === 1 || !continuationToken) {
        searchQuery = `ytsearch${limit}:${query}`
      } else {
        
        searchQuery = `ytsearch${limit}:${query}+${continuationToken}`
      }
      
      const args = [
        searchQuery,
        '--dump-json',
        '--flat-playlist', '--skip-download',
        '--quiet'
      ]
      
      const proc = spawn(ytdlp, args)
      let buf = ''
      proc.stdout.on('data', d => { buf += d.toString() })
      proc.on('close', () => {
        const lines = buf.trim().split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const j = JSON.parse(line)
            results.push({
              id: j.id,
              title: j.title,
              channel: j.channel || j.uploader,
              duration: j.duration,
              thumbnail: j.thumbnail,
              url: j.webpage_url || `https://www.youtube.com/watch?v=${j.id}`,
            })
          } catch {}
        }
        
        
        const lastVideoId = results.length > 0 ? results[results.length - 1].id : null
        
        resolve({ 
          results, 
          page, 
          hasMore: results.length === limit && lastVideoId !== null,
          continuationToken: lastVideoId
        })
      })
      proc.on('error', () => resolve({ error: 'Failed to run yt-dlp' }))
    })
  })

  ipcMain.handle('downloader:searchArtist', async (e, query, page = 1) => {
    mainWindow = BrowserWindow.fromWebContents(e.sender)
    const ytdlp = findYtDlp()
    if (!ytdlp) return { error: 'yt-dlp not found. Go to Settings → External Tools to download it automatically or set a custom path.' }

    const limit = 20
    const offset = (page - 1) * limit

    return new Promise((resolve) => {
      const results = []
      const args = [
        `ytsearch${limit}:${query} official artist channel`,
        '--dump-json',
        '--flat-playlist',
        '--skip-download',
        '--quiet'
      ]
      const proc = spawn(ytdlp, args)
      let buf = ''
      proc.stdout.on('data', d => { buf += d.toString() })
      proc.on('close', () => {
        const lines = buf.trim().split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            const j = JSON.parse(line)
            
            const isChannel = j._type === 'playlist' || (j.url && j.url.includes('/@')) || j.channel_id
            const channelId = j.channel_id || j.id
            
            if (isChannel || j.playlist_id) {
              results.push({
                id: channelId,
                title: j.title || j.uploader,
                channel: j.uploader || j.channel,
                type: j.playlist_id ? 'playlist' : 'channel',
                thumbnail: j.thumbnail,
                url: j.channel_url || (channelId ? `https://www.youtube.com/channel/${channelId}` : j.webpage_url),
                playlistId: j.playlist_id || null,
                videoCount: j.playlist_count || j.channel_item_count || null,
              })
            }
          } catch {}
        }
        
        const uniqueResults = Array.from(new Map(results.map(item => [item.id, item])).values())
        
        if (uniqueResults.length === 0) {
          const fallbackArgs = [
            `ytsearch10:${query} @artist profile`,
            '--dump-json',
            '--flat-playlist',
            '--skip-download',
            '--quiet'
          ]
          const fallbackProc = spawn(ytdlp, fallbackArgs)
          let fallbackBuf = ''
          fallbackProc.stdout.on('data', d => { fallbackBuf += d.toString() })
          fallbackProc.on('close', () => {
            const fallbackLines = fallbackBuf.trim().split('\n').filter(Boolean)
            for (const line of fallbackLines) {
              try {
                const j = JSON.parse(line)
                const channelId = j.channel_id || j.id
                const isChannel = j._type === 'playlist' || (j.url && j.url.includes('/@')) || j.channel_id
                
                if (isChannel || j.playlist_id) {
                  results.push({
                    id: channelId,
                    title: j.title || j.uploader,
                    channel: j.uploader || j.channel,
                    type: j.playlist_id ? 'playlist' : 'channel',
                    thumbnail: j.thumbnail,
                    url: j.channel_url || (channelId ? `https://www.youtube.com/channel/${channelId}` : j.webpage_url),
                    playlistId: j.playlist_id || null,
                  })
                }
              } catch {}
            }
            const fallbackUnique = Array.from(new Map(results.map(item => [item.id, item])).values())
            resolve(fallbackUnique)
          })
          fallbackProc.on('error', () => resolve(uniqueResults))
        } else {
          resolve(uniqueResults)
        }
      })
      proc.on('error', () => resolve({ error: 'Failed to run yt-dlp' }))
    })
  })

  ipcMain.handle('downloader:download', async (e, url, opts = {}) => {
    mainWindow = BrowserWindow.fromWebContents(e.sender)
    const ytdlp = findYtDlp()
    const ffmpeg = findFfmpeg()
    const ffprobe = findFfprobe()
    
    if (!ffmpeg) return { error: 'ffmpeg not found. Please download it in Settings.' }
    if (!ffprobe) return { error: 'ffprobe not found. Please re-download ffmpeg in Settings (it now includes ffprobe).' }
    if (!ytdlp) return { error: 'yt-dlp not found. Go to Settings → External Tools to download it or set a custom path.' }

    const db = getDB()
    const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
    const outputDir = opts.outputDir || settings.music_folder || path.join(require('os').homedir(), 'Music')
    fs.ensureDirSync(outputDir)

    const downloadId = opts.id || 'dl-' + Date.now()
    const outputTemplate = path.join(outputDir, '%(artist)s', '%(album)s', '%(title)s.%(ext)s')

    
    let thumbnailUrl = opts.thumbnailUrl
    if (!thumbnailUrl) {
      const videoId = getYouTubeId(url)
      if (videoId) {
        thumbnailUrl = getYouTubeThumbnail(videoId)
      }
    }

    const isYouTube = !!getYouTubeId(url)

    const args = [
      url,
      '-x', '--audio-format', opts.format || 'mp3',
      '--audio-quality', opts.quality || '0',
      '--embed-thumbnail', '--add-metadata',
      '--embed-metadata',
      '--output', outputTemplate,
      '--newline', '--progress',
    ]

    if (isYouTube) {
      args.push(
        '--convert-thumbnail', 'jpg',
        '--ppa', 'EmbedThumbnail+ffmpeg_o:-c:v mjpeg -vf "crop=min(iw\\,ih):min(iw\\,ih)"'
      );
    }

    if (ffmpeg && (ffmpeg.includes('/') || ffmpeg.includes('\\'))) {
      args.push('--ffmpeg-location', path.dirname(ffmpeg));
    }

    const useYtCookies = settings.yt_cookies === '1'
    const ytCookieBrowser = settings.yt_cookie_browser || 'firefox'
    if (useYtCookies) {
      args.push('--cookies-from-browser', ytCookieBrowser);
    }
    
    return new Promise((resolve) => {
      const proc = spawn(ytdlp, args)
      downloadQueue.set(downloadId, { proc, url, status: 'downloading', progress: 0 })
      let outputLines = []
      let filepaths = []
      let indexedTracks = []

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/)
        for (const line of lines) {
          if (!line.trim()) continue
          outputLines.push(line)
          if (line.startsWith('filepath:')) {
            filepaths.push(line.slice(9))
            continue
          }
          if (line.includes('Destination:')) {
            const dest = line.match(/Destination: (.+)/)?.[1]
            if (dest) filepaths.push(dest)
            continue
          }
          const pctMatch = line.match(/(\d+\.?\d*)%/)
          if (pctMatch) {
            const progress = parseFloat(pctMatch[1])
            downloadQueue.get(downloadId).progress = progress
            const speedMatch = line.match(/(\d+\.?\d+[KMG]iB\/s)/)
            const etaMatch = line.match(/ETA (\d+:\d+)/)
            const payload = { id: downloadId, progress, speed: speedMatch?.[1] || null, eta: etaMatch?.[1] || null, output: outputLines.slice(-30).join('\n') }
            if (mainWindow) mainWindow.webContents.send('downloader:progress', payload)
          } else if (line.startsWith('[download]') || line.startsWith('[ffmpeg]')) {
            
            const msg = line.replace(/^\[\w+\]\s*/, '').trim()
            if (msg && mainWindow) mainWindow.webContents.send('downloader:progress', { id: downloadId, progress: null, message: msg.slice(0, 60), output: outputLines.slice(-30).join('\n') })
          }
        }
      })

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/)
        for (const line of lines) {
          if (!line.trim()) continue
          outputLines.push(line)
        }
      })

      proc.on('close', async (code) => {
        downloadQueue.delete(downloadId)
        if (code === 0) {
          
          await cleanupLeftovers(filepaths, outputDir);

          setImmediate(async () => {
            try {
              const { indexSingleFile } = require('./scanner')
              for (const filepath of filepaths) {
                if (fs.existsSync(filepath)) {
                  const result = await indexSingleFile(filepath, { thumbnailUrl })
                  if (result && result.id) {
                    indexedTracks.push({ filepath, id: result.id, title: path.basename(filepath, path.extname(filepath)) })
                  }
                }
              }
              
              if (mainWindow) {
                mainWindow.webContents.send('downloader:progress', { 
                  id: downloadId, 
                  progress: 100, 
                  done: true,
                  indexedTracks: indexedTracks,
                  message: indexedTracks.length > 0 ? `Indexed ${indexedTracks.length} track(s)` : 'Download complete'
                })
              }
            } catch (e) {
              console.error('Failed to index downloaded files:', e)
              if (mainWindow) mainWindow.webContents.send('downloader:progress', { id: downloadId, progress: 100, done: true, message: 'Download complete (indexing failed)' })
            }
          })
          resolve({ success: true, downloadId, indexedTracks })
        } else {
          if (mainWindow) mainWindow.webContents.send('downloader:progress', { id: downloadId, progress: null, error: 'Download failed', output: outputLines.slice(-50).join('\n') })
          resolve({ error: 'Download failed', code })
        }
      })

      proc.on('error', (err) => {
        if (mainWindow) mainWindow.webContents.send('downloader:progress', { id: downloadId, error: err.message, output: outputLines.slice(-50).join('\n') })
        resolve({ error: err.message })
      })
    })
  })

  ipcMain.handle('downloader:cancel', (_, id) => {
    const dl = downloadQueue.get(id)
    if (dl) { dl.proc.kill(); downloadQueue.delete(id) }
  })

  ipcMain.handle('downloader:queue', () => {
    return Array.from(downloadQueue.entries()).map(([id, v]) => ({
      id, url: v.url, status: v.status, progress: v.progress
    }))
  })
}

module.exports = { registerDownloaderHandlers }




function registerExtraDownloaderHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')
  const { getDB, getStorageDir } = require('./db')
  const { scanFolder } = require('./scanner')

  ipcMain.handle('downloader:downloadPlaylist', async (e, url, opts = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const ytdlp = findYtDlp()
    const ffmpeg = findFfmpeg()
    const ffprobe = findFfprobe()
    const path = require('path')
    const fs = require('fs-extra')
    const os = require('os')
    const { spawn } = require('child_process')

    if (!ytdlp) return { error: 'yt-dlp not found. Go to Settings → External Tools to download it or set a custom path.' }
    if (!ffmpeg) return { error: 'ffmpeg not found. Please download it in Settings.' }
    if (!ffprobe) return { error: 'ffprobe not found. Please re-download ffmpeg in Settings.' }

    const db = getDB()
    const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
    const outputDir = opts.outputDir || settings.music_folder || path.join(os.homedir(), 'Music')
    fs.ensureDirSync(outputDir)

    const dlId = opts.id || 'pl-' + Date.now()
    const outputTemplate = path.join(outputDir, '%(playlist)s', '%(artist)s', '%(title)s.%(ext)s')
    
    const playlistIdFromUrl = getPlaylistId(url)
    const playlistDbId = opts.playlistId || playlistIdFromUrl || 'pl-' + Date.now()
    const archivePath = path.join(getStorageDir(), `archive-${playlistDbId}.txt`)
    
    db.prepare(`INSERT OR REPLACE INTO downloaded_playlists (id, url, title, archive_path, status) VALUES (?, ?, ?, ?, 'downloading')`)
      .run(playlistDbId, url, opts.title || null, archivePath)

    const args = [
      url,
      '--download-archive', archivePath,
      '-x',
      '--audio-format', opts.format || 'mp3',
      '--audio-quality', '0',
      '--embed-thumbnail',
      '--add-metadata',
      '--output', outputTemplate,
      '--newline',
      '--progress',
      '--yes-playlist',
      '--ignore-errors',
    ]

    const useYtCookies = settings.yt_cookies === '1'
    const ytCookieBrowser = settings.yt_cookie_browser || 'firefox'
    if (useYtCookies) {
      args.push('--cookies-from-browser', ytCookieBrowser)
    }
    if (ffmpeg && (ffmpeg.includes('/') || ffmpeg.includes('\\'))) {
      args.push('--ffmpeg-location', path.dirname(ffmpeg))
    }

    return new Promise((resolve) => {
      let lastSong = null
      let currentIndex = 0
      let totalTracks = 0
      let errorLines = []
      let outputLines = []
      let filepaths = []              
      let indexedTracks = []
      let downloadedTracks = []

      downloadQueue.set(dlId, {
        proc: null,
        url,
        status: 'downloading',
        progress: 0,
        message: 'Starting…',
        song: null,
        output: null,
        downloadedTracks: []
      })

      const proc = spawn(ytdlp, args)
      downloadQueue.get(dlId).proc = proc

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/)
        for (const line of lines) {
          if (!line.trim()) continue
          outputLines.push(line)

          if (line.includes('has already been recorded in the archive')) {
            const idMatch = line.match(/\[download\] (.*) has already/)
            const videoId = idMatch ? idMatch[1] : 'item'
            
            if (win) win.webContents.send('downloader:progress', {
              id: dlId,
              message: `Skipping: ${videoId} (Already in library)`,
              status: 'skipped',
              output: outputLines.slice(-30).join('\n')
            })
            continue
          }

          const songMatch = line.match(/\[download\] Downloading video (\d+) of (\d+)/)
          if (songMatch) {
            currentIndex = parseInt(songMatch[1], 10)
            totalTracks = parseInt(songMatch[2], 10)
            const progress = totalTracks > 0 ? Math.round((currentIndex - 1) / totalTracks * 100) : 0
            Object.assign(downloadQueue.get(dlId), {
              progress,
              message: `Track ${currentIndex} of ${totalTracks}`,
              song: lastSong,
              downloadedTracks: downloadedTracks.slice(-10)
            })
            if (win) win.webContents.send('downloader:progress', {
              id: dlId,
              message: `Track ${currentIndex} of ${totalTracks}`,
              progress,
              song: lastSong,
              downloadedTracks: downloadedTracks.slice(-10),
              output: outputLines.slice(-30).join('\n')
            })
            continue
          }

          const titleMatch = line.match(/\[download\] Destination: (.+)/)
          if (titleMatch) {
            lastSong = titleMatch[1].replace(/\.(webm|m4a|webp|f\d+|temp|part)$/i, '.' + (opts.format || 'mp3'))
            if (!filepaths.includes(lastSong)) filepaths.push(lastSong)
            downloadedTracks.push(path.basename(lastSong))
            if (win) win.webContents.send('downloader:progress', {
              id: dlId,
              message: `Saving: ${path.basename(lastSong)}`,
              song: lastSong,
              downloadedTracks: downloadedTracks.slice(-10),
              output: outputLines.slice(-30).join('\n')
            })
            continue
          }

          const extractMatch = line.match(/\[ExtractAudio\] Destination: (.+)/)
          if (extractMatch) {
            lastSong = extractMatch[1]
            if (!filepaths.includes(lastSong)) filepaths.push(lastSong)
            if (!downloadedTracks.includes(path.basename(lastSong))) downloadedTracks.push(path.basename(lastSong))
            if (win) win.webContents.send('downloader:progress', {
              id: dlId,
              message: `Saved: ${path.basename(lastSong)}`,
              song: lastSong,
              downloadedTracks: downloadedTracks.slice(-10),
              output: outputLines.slice(-30).join('\n')
            })
            continue
          }

          if (line.includes('[EmbedThumbnail]') && line.includes('Adding thumbnail to')) {
            const finalPathMatch = line.match(/Adding thumbnail to "(.+)"/)
            const pathToIndex = finalPathMatch ? finalPathMatch[1] : lastSong

            if (settings.index_while_downloading === '1' && pathToIndex) {
              const { indexSingleFile } = require('./scanner')
              setTimeout(async () => {
                try {
                  if (fs.existsSync(pathToIndex)) {
                    const result = await indexSingleFile(pathToIndex)
                    if (result && result.id && win) {
                      indexedTracks.push({ filepath: pathToIndex, id: result.id, title: path.basename(pathToIndex, path.extname(pathToIndex)) })
                      win.webContents.send('downloader:progress', {
                        id: dlId,
                        indexedTracks: indexedTracks.slice(-10),
                        message: `Indexed: ${path.basename(pathToIndex)}`,
                        output: outputLines.slice(-30).join('\n')
                      })
                      win.webContents.send('library:updated', result)
                    }
                  }
                } catch (err) {
                  console.error('Indexing failed:', err)
                }
              }, 1000)
            }
            continue
          }

          const pctMatch = line.match(/(\d+\.?\d*)%/)
          if (pctMatch) {
            const rawProgress = parseFloat(pctMatch[1])
            const progress = totalTracks > 1
              ? Math.round(((currentIndex - 1) + (rawProgress / 100)) / totalTracks * 100)
              : Math.round(rawProgress)
            Object.assign(downloadQueue.get(dlId), {
              progress,
              message: lastSong ? `Downloading: ${path.basename(lastSong)}` : undefined,
              song: lastSong,
              downloadedTracks: downloadedTracks.slice(-10)
            })
            if (win) win.webContents.send('downloader:progress', {
              id: dlId,
              progress,
              message: lastSong ? `Downloading: ${path.basename(lastSong)}` : undefined,
              song: lastSong,
              downloadedTracks: downloadedTracks.slice(-10),
              output: outputLines.slice(-30).join('\n')
            })
            continue
          }

          if (/\[error\]/i.test(line)) errorLines.push(line)
        }
      })

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split(/\r?\n/)
        for (const line of lines) {
          if (!line.trim()) continue
          outputLines.push(line)
          if (/\[error\]/i.test(line) || (line.toLowerCase().includes('error') && !line.includes('Deleting original file'))) {
            errorLines.push(line)
          }
        }
      })

      proc.on('close', async (code) => {
        if (code === 0) {
          try {
            await cleanupLeftovers(filepaths, outputDir)
          } catch (e) {
            console.warn('cleanupLeftovers failed:', e)
          }

          setImmediate(async () => {
            try {
              const { indexSingleFile } = require('./scanner')
              for (const filepath of filepaths) {
                const alreadyIndexed = indexedTracks.some(t => t.filepath === filepath)
                if (!alreadyIndexed && fs.existsSync(filepath)) {
                  try {
                    const result = await indexSingleFile(filepath)
                    if (result && result.id) {
                      indexedTracks.push({ filepath, id: result.id, title: path.basename(filepath, path.extname(filepath)) })
                    }
                  } catch (e) {
                    console.error('Indexing file failed:', e)
                  }
                }
              }

              if (win) {
                win.webContents.send('downloader:progress', {
                  id: dlId,
                  progress: 100,
                  done: true,
                  indexedTracks,
                  downloadedTracks,
                  message: indexedTracks.length > 0 ? `Indexed ${indexedTracks.length} track(s)` : `Downloaded ${downloadedTracks.length} track(s)`,
                  output: outputLines.slice(-50).join('\n')
                })
              }
            } catch (e) {
              if (win) win.webContents.send('downloader:progress', { id: dlId, progress: 100, done: true, message: 'Complete' })
            }
          })

          resolve({ success: true, count: downloadedTracks.length, indexedTracks })
        } else {
          if (win) win.webContents.send('downloader:progress', {
            id: dlId,
            error: 'Failed',
            message: errorLines.length ? errorLines.join('\n').slice(0, 500) : `Failed (exit ${code})`,
            output: outputLines.slice(-50).join('\n')
          })
          resolve({ error: 'Failed', code })
        }
      })
    })
  })
}

module.exports.registerExtraDownloaderHandlers = registerExtraDownloaderHandlers

function registerPlaylistArchiveHandlers(ipcMain) {
  const { getDB, getStorageDir } = require('./db')

  ipcMain.handle('downloader:getDownloadedPlaylists', () => {
    const db = getDB()
    return db.prepare('SELECT * FROM downloaded_playlists ORDER BY last_downloaded_at DESC').all()
  })

  ipcMain.handle('downloader:deleteDownloadedPlaylist', (_, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (playlist && playlist.archive_path) {
      try { fs.unlinkSync(playlist.archive_path) } catch {}
    }
    db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)
    return { success: true }
  })

  ipcMain.handle('downloader:redownloadPlaylist', async (e, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT * FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist) return { error: 'Playlist not found' }

    if (playlist.archive_path && fs.existsSync(playlist.archive_path)) {
      try { fs.unlinkSync(playlist.archive_path) } catch {}
    }
    db.prepare('DELETE FROM downloaded_playlists WHERE id = ?').run(playlistId)

    const opts = { id: 'pl-redownload-' + Date.now() }
    const result = await new Promise((resolve) => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const ytdlp = findYtDlp()
      const ffmpeg = findFfmpeg()
      const ffprobe = findFfprobe()
      const os = require('os')

      if (!ytdlp || !ffmpeg || !ffprobe) {
        resolve({ error: 'Missing tools' })
        return
      }

      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
      const outputDir = settings.music_folder || path.join(os.homedir(), 'Music')

      const playlistIdFromUrl = getPlaylistId(playlist.url)
      const archivePath = path.join(getStorageDir(), `archive-${playlistIdFromUrl || playlistId}.txt`)

      db.prepare(`INSERT INTO downloaded_playlists (id, url, title, archive_path, status) VALUES (?, ?, ?, ?, 'downloading')`)
        .run(playlistId, playlist.url, playlist.title, archivePath)

      const args = [
        playlist.url,
        '--download-archive', archivePath,
        '-x', '--audio-format', 'mp3', '--audio-quality', '0',
        '--embed-thumbnail', '--add-metadata',
        '--output', path.join(outputDir, '%(playlist)s', '%(artist)s', '%(title)s.%(ext)s'),
        '--newline', '--progress', '--yes-playlist', '--ignore-errors'
      ]

      const useYtCookies = settings.yt_cookies === '1'
      if (useYtCookies) args.push('--cookies-from-browser', settings.yt_cookie_browser || 'firefox')
      if (ffmpeg && (ffmpeg.includes('/') || ffmpeg.includes('\\'))) args.push('--ffmpeg-location', path.dirname(ffmpeg))

      const proc = spawn(ytdlp, args)
      let downloadedCount = 0

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        for (const line of lines) {
          if (line.includes('Destination:') || line.includes('[ExtractAudio] Destination:')) {
            downloadedCount++
            if (win) win.webContents.send('downloader:progress', {
              id: playlistId,
              progress: null,
              message: `Downloaded: ${downloadedCount}`,
              output: lines.slice(-10).join('\n')
            })
          }
        }
      })

      proc.on('close', (code) => {
        db.prepare('UPDATE downloaded_playlists SET status = ?, downloaded_count = ?, last_downloaded_at = ? WHERE id = ?')
          .run(code === 0 ? 'completed' : 'failed', downloadedCount, Date.now(), playlistId)
        resolve({ success: code === 0, count: downloadedCount })
      })

      proc.on('error', (err) => {
        db.prepare('UPDATE downloaded_playlists SET status = ? WHERE id = ?').run('failed', playlistId)
        resolve({ error: err.message })
      })
    })

    return result
  })

  ipcMain.handle('downloader:getPlaylistArchiveIds', (_, playlistId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist) return []
    return Array.from(getVideoIdsFromArchive(playlist.archive_path))
  })

  ipcMain.handle('downloader:removeFromPlaylistArchive', (_, playlistId, videoId) => {
    const db = getDB()
    const playlist = db.prepare('SELECT archive_path FROM downloaded_playlists WHERE id = ?').get(playlistId)
    if (!playlist) return { error: 'Playlist not found' }

    try {
      if (fs.existsSync(playlist.archive_path)) {
        let content = fs.readFileSync(playlist.archive_path, 'utf-8')
        content = content.split('\n').filter(line => !line.includes(videoId)).join('\n')
        fs.writeFileSync(playlist.archive_path, content)
      }
      return { success: true }
    } catch (e) {
      return { error: e.message }
    }
  })
}

module.exports.registerPlaylistArchiveHandlers = registerPlaylistArchiveHandlers
