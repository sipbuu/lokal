const { app } = require('electron')
const path = require('path')
const fs = require('fs-extra')
const https = require('https')
const { execFile } = require('child_process')
const AdmZip = require('adm-zip')


function getPlatformFolder() {
  const platform = process.platform
  if (platform === 'win32') return 'win'
  if (platform === 'darwin') return 'mac'
  return 'linux'
}


function getUserDataBin() {
  return path.join(app.getPath('userData'), 'bin')
}


function getBundledBin() {
  const platformFolder = getPlatformFolder();
  let base = path.join(process.resourcesPath, 'bin', platformFolder);
  
  if (base.includes('app.asar') && !base.includes('app.asar.unpacked')) {
    base = base.replace('app.asar', 'app.asar.unpacked');
  }
  return base;
}

function fileExists(fp) {
  try {
    return fs.existsSync(fp)
  } catch {
    return false
  }
}

function normalizePathCase(fp) {
  return String(fp || '').replace(/\//g, '\\').toLowerCase()
}


function ensureExecutable(fp) {
  if (process.platform !== 'win32' && fileExists(fp)) {
    try {
      const stats = fs.statSync(fp);
      if (!(stats.mode & fs.constants.X_OK)) {
        fs.chmodSync(fp, '755');
      }
    } catch (e) { console.error("Mode check failed", e); }
  }
  return fp;
}

function findYtDlp() {
  const ext = process.platform === 'win32' ? '.exe' : ''

  
  const userDataPath = path.join(getUserDataBin(), `yt-dlp${ext}`)
  if (fileExists(userDataPath)) return userDataPath

  
  const bundledPath = path.join(getBundledBin(), `yt-dlp${ext}`)
  if (fileExists(bundledPath)) return ensureExecutable(bundledPath);

  
  try {
    const db = require('./db').getDB()
    const customPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('custom_ytdlp_path')
    if (customPath && fileExists(customPath.value)) return customPath.value
  } catch {}

  
  try {
    require('child_process').execSync(`yt-dlp --version`, { stdio: 'pipe' })
    return 'yt-dlp' + (process.platform === 'win32' ? '.exe' : '')
  } catch {}

  return null
}

function getYtDlpSource(ytdlpPath) {
  if (!ytdlpPath) return null
  const ext = process.platform === 'win32' ? '.exe' : ''
  const normalized = normalizePathCase(ytdlpPath)
  if (normalized === normalizePathCase(path.join(getUserDataBin(), `yt-dlp${ext}`))) return 'app'
  if (normalized === normalizePathCase(path.join(getBundledBin(), `yt-dlp${ext}`))) return 'bundled'
  try {
    const db = require('./db').getDB()
    const customPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('custom_ytdlp_path')
    if (customPath?.value && normalized === normalizePathCase(customPath.value)) return 'custom'
  } catch {}
  return 'system'
}


function findFfmpeg() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const candidates = process.platform === 'win32' 
    ? ['ffmpeg.exe', 'ffmpeg-mac-static.exe']
    : ['ffmpeg']

  
  const userDataPath = path.join(getUserDataBin(), `ffmpeg${ext}`)
  if (fileExists(userDataPath)) return userDataPath

  
  const bundledPath = path.join(getBundledBin(), `ffmpeg${ext}`)
  if (fileExists(bundledPath)) return bundledPath

  
  try {
    const db = require('./db').getDB()
    const customPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('custom_ffmpeg_path')
    if (customPath && fileExists(customPath.value)) return customPath.value
  } catch {}

  
  for (const c of candidates) {
    try {
      require('child_process').execSync(`${c} -version`, { stdio: 'pipe' })
      return c
    } catch {}
  }

  return null
}


function findFfprobe() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const candidates = process.platform === 'win32' 
    ? ['ffprobe.exe']
    : ['ffprobe']

  
  const userDataPath = path.join(getUserDataBin(), `ffprobe${ext}`)
  if (fileExists(userDataPath)) return userDataPath

  
  const bundledPath = path.join(getBundledBin(), `ffprobe${ext}`)
  if (fileExists(bundledPath)) return bundledPath

  
  try {
    const db = require('./db').getDB()
    const customPath = db.prepare('SELECT value FROM settings WHERE key = ?').get('custom_ffmpeg_path')
    // Check in custom ffmpeg directory
    if (customPath && fileExists(customPath.value)) {
      const ffprobeInCustomDir = path.join(path.dirname(customPath.value), `ffprobe${ext}`)
      if (fileExists(ffprobeInCustomDir)) return ffprobeInCustomDir
    }
  } catch {}

  
  for (const c of candidates) {
    try {
      require('child_process').execSync(`${c} -version`, { stdio: 'pipe' })
      return c
    } catch {}
  }

  return null
}

function parseYtDlpVersion(version) {
  const match = String(version || '').trim().match(/(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const revision = Number(match[4] || 0)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(date.getTime())) return null
  return {
    raw: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}${match[4] ? `.${revision}` : ''}`,
    parts: [year, month, day, revision],
    date,
  }
}

function compareYtDlpVersions(left, right) {
  const a = parseYtDlpVersion(left)
  const b = parseYtDlpVersion(right)
  if (!a || !b) return 0
  for (let index = 0; index < 4; index += 1) {
    const diff = (a.parts[index] || 0) - (b.parts[index] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function getVersionDaysBehind(installedVersion, latestVersion) {
  const installed = parseYtDlpVersion(installedVersion)
  const latest = parseYtDlpVersion(latestVersion)
  if (!installed || !latest) return null
  const diffMs = latest.date.getTime() - installed.date.getTime()
  return diffMs > 0 ? Math.floor(diffMs / 86400000) : 0
}

function getExecutableVersion(executable, args = ['--version'], retries = 3) {
  return new Promise(resolve => {
    if (!executable) {
      resolve(null)
      return
    }

    function trySpawn(attemptsLeft) {
      // execFile/spawn can throw synchronously on Windows for a corrupt/truncated
      // exe (e.g. a 0-byte file left behind by a failed download), not just via the
      // callback or 'error' event. Uncaught, that throw becomes an unhandled
      // rejection that crashes the whole ipcMain handler.
      let child
      try {
        child = execFile(executable, args, { windowsHide: true, timeout: 10000 }, (error, stdout) => {
          if (error && !stdout) {
            if (isBusyError(error) && attemptsLeft > 0) {
              console.warn(`[Version Check] Executable busy, retrying... (${attemptsLeft} attempts left)`);
              setTimeout(() => trySpawn(attemptsLeft - 1), 500);
              return;
            }
            if (isCorruptBinaryError(error)) {
              console.error(`[Version Check] Executable appears corrupt (code=${error.code}), file=${executable}`);
              if (attemptsLeft > 0) {
                console.warn(`[Version Check] Trying to remove corrupt binary before retry... (${attemptsLeft} attempts left)`);
                try {
                  require('fs').unlinkSync(executable);
                  console.log(`[Version Check] Removed corrupt binary: ${executable}`);
                } catch (removeErr) {
                  console.error(`[Version Check] Could not remove corrupt binary: ${removeErr.message}`);
                }
                setTimeout(() => trySpawn(attemptsLeft - 1), 800);
                return;
              }
            }
            resolve(null)
            return
          }
          const version = String(stdout || '').trim().split(/\r?\n/).find(Boolean) || null
          resolve(version)
        })
      } catch (err) {
        console.error(`[Version Check] Synchronous spawn failure (code=${err?.code}), file=${executable}: ${err.message}`);
        if (isCorruptBinaryError(err) && attemptsLeft > 0) {
          try {
            require('fs').unlinkSync(executable);
            console.log(`[Version Check] Removed corrupt binary: ${executable}`);
          } catch (removeErr) {
            console.error(`[Version Check] Could not remove corrupt binary: ${removeErr.message}`);
          }
          setTimeout(() => trySpawn(attemptsLeft - 1), 800);
          return;
        }
        resolve(null)
        return
      }

      child.on('error', (err) => {
        if (isBusyError(err) && attemptsLeft > 0) {
          console.warn(`[Version Check] Spawn busy error caught, retrying...`);
          setTimeout(() => trySpawn(attemptsLeft - 1), 500);
        } else if (isCorruptBinaryError(err) && attemptsLeft > 0) {
          console.error(`[Version Check] Spawn error suggests corrupt binary (code=${err.code}), file=${executable}`);
          try {
            require('fs').unlinkSync(executable);
            console.log(`[Version Check] Removed corrupt binary: ${executable}`);
          } catch (removeErr) {
            console.error(`[Version Check] Could not remove corrupt binary: ${removeErr.message}`);
          }
          setTimeout(() => trySpawn(attemptsLeft - 1), 800);
        } else {
          resolve(null);
        }
      });
    }

    trySpawn(retries);
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'Lokal',
        'Accept': 'application/vnd.github+json',
      },
    }, response => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        response.resume()
        fetchJson(redirectUrl).then(resolve).catch(reject)
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Request failed: ${response.statusCode}`))
        return
      }
      let body = ''
      response.on('data', chunk => {
        body += chunk.toString()
      })
      response.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
      response.on('error', reject)
    })
    request.on('error', reject)
  })
}

async function getYtDlpVersionStatus() {
  const installLock = getYtDlpInstallLock()
  if (installLock) await installLock

  const ytdlpPath = findYtDlp()
  const installedVersion = await getExecutableVersion(ytdlpPath)

  const result = {
    found: !!ytdlpPath,
    path: ytdlpPath,
    source: getYtDlpSource(ytdlpPath),
    installedVersion: installedVersion || null,
    latestVersion: null,
    latestPublishedAt: null,
    latestUrl: null,
    releasesBehind: null,
    daysBehind: null,
    upToDate: null,
    error: null,
    checkedAt: Date.now(),
  }

  try {
    const releases = await fetchJson('https://api.github.com/repos/yt-dlp/yt-dlp/releases?per_page=100')
    const validReleases = (Array.isArray(releases) ? releases : []).filter(release => {
      if (!release || release.draft || release.prerelease) return false
      return Boolean(parseYtDlpVersion(release.tag_name))
    })
    const latest = validReleases[0]
    if (!latest) return result

    result.latestVersion = latest.tag_name
    result.latestPublishedAt = latest.published_at || null
    result.latestUrl = latest.html_url || null

    if (!installedVersion) {
      result.upToDate = false
      return result
    }

    const newerReleases = validReleases.filter(release => compareYtDlpVersions(release.tag_name, installedVersion) > 0)
    result.releasesBehind = newerReleases.length
    result.daysBehind = getVersionDaysBehind(installedVersion, latest.tag_name)
    result.upToDate = compareYtDlpVersions(installedVersion, latest.tag_name) >= 0
    return result
  } catch (error) {
    result.error = error.message
    return result
  }
}


function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(dest))

    let settled = false
    let request = null
    let expectedLength = 0
    let receivedLength = 0
    const file = fs.createWriteStream(dest)

    const fail = (err) => {
      if (settled) return
      settled = true
      try { request?.destroy() } catch {}
      try { file.destroy() } catch {}
      try { fs.unlinkSync(dest) } catch {}
      console.error(`[Download] Error: ${err.message}`)
      reject(err)
    }

    const succeed = () => {
      if (settled) return
      if (expectedLength > 0 && receivedLength < expectedLength) {
        fail(new Error(`Download incomplete: got ${receivedLength} of ${expectedLength} bytes`))
        return
      }
      if (receivedLength === 0) {
        fail(new Error('Download produced an empty file (0 bytes)'))
        return
      }
      settled = true
      console.log(`[Download] Finished: ${dest} (${receivedLength} bytes)`)
      resolve()
    }

    file.on('error', fail)

    request = https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        console.log(`[Redirect] Following to: ${redirectUrl}`)
        response.resume()
        file.close(() => {
          try { fs.unlinkSync(dest) } catch {}
          downloadFile(redirectUrl, dest).then(resolve).catch(reject)
        })
        return
      }

      if (response.statusCode !== 200) {
        response.resume()
        file.close(() => fail(new Error(`Download failed: ${response.statusCode}`)))
        return
      }

      expectedLength = Number(response.headers['content-length']) || 0
      response.on('data', (chunk) => { receivedLength += chunk.length })
      response.on('error', fail)
      response.pipe(file)
    })

    file.on('finish', () => {
      file.close(succeed)
    })

    request.on('error', fail)
  })
}

function validateDownloadedExecutable(filePath) {
  const stat = fs.statSync(filePath)
  if (!stat || stat.size === 0) {
    throw new Error('Downloaded file is empty (0 bytes)')
  }
  if (process.platform === 'win32') {
    // A real Windows PE executable always starts with the "MZ" magic bytes.
    // A truncated download, or GitHub serving an HTML/JSON error page instead
    // of the binary, would fail this check instead of silently installing junk.
    const fd = fs.openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(2)
      fs.readSync(fd, header, 0, 2, 0)
      if (header.toString('ascii') !== 'MZ') {
        throw new Error(`Downloaded file is not a valid Windows executable (size=${stat.size} bytes)`)
      }
    } finally {
      fs.closeSync(fd)
    }
  }
  return stat.size
}

function isBusyError(err) {
  return ['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)
}

function isCorruptBinaryError(err) {
  return ['UNKNOWN', 'EINVAL', 'ENOEXEC'].includes(err?.code)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

let ytDlpInstallPromise = null

function getYtDlpInstallLock() {
  return ytDlpInstallPromise
}

function getYtDlpDestPaths() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const filename = `yt-dlp${ext}`
  const dest = path.join(getUserDataBin(), filename)
  return { filename, dest }
}


async function replaceFileWithRetry(source, dest, progressCallback) {
  const maxRetries = 5
  const baseDelayMs = 1000

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fs.move(source, dest, { overwrite: true })
      console.log(`[Tools] Successfully replaced ${dest} on attempt ${attempt + 1}`)
      return dest
    } catch (err) {
      if (!isBusyError(err)) throw err

      console.warn(`[Tools] replaceFileWithRetry attempt ${attempt + 1}/${maxRetries} failed: ${err.code} ${err.message}`)

      if (attempt === maxRetries - 1) {
        console.error(`[Tools] All ${maxRetries} attempts failed. Trying force-delete of destination...`)
        if (progressCallback) {
          progressCallback({ status: 'stopping', message: 'Force-deleting old yt-dlp...' })
        }
        try {
          await fs.remove(dest)
          await wait(500)
          await fs.move(source, dest, { overwrite: true })
          console.log(`[Tools] Replaced ${dest} after force-delete`)
          return dest
        } catch (finalErr) {
          console.error(`[Tools] Force-delete replace also failed: ${finalErr.message}`)
          throw finalErr
        }
      }

      if (progressCallback) {
        progressCallback({ status: 'stopping', message: `Stopping yt-dlp processes (attempt ${attempt + 2}/${maxRetries})...` })
      }

      try {
        const { stopActiveDownloadsForToolUpdate } = require('./downloader')
        if (typeof stopActiveDownloadsForToolUpdate === 'function') {
          await stopActiveDownloadsForToolUpdate()
        }
      } catch {}

      if (process.platform === 'win32') {
        try {
          require('child_process').execSync('taskkill /f /im yt-dlp.exe 2>nul', { stdio: 'ignore' })
          console.log('[Tools] taskkill /f /im yt-dlp.exe issued')
        } catch {}
      }

      const delay = baseDelayMs * Math.pow(2, attempt)
      await wait(delay)
    }
  }
  throw new Error(`Failed to replace file after ${maxRetries} attempts`)
}


async function downloadYtDlp(progressCallback) {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const filename = `yt-dlp${ext}`

  if (getYtDlpInstallLock()) {
    return getYtDlpInstallLock()
  }

  ytDlpInstallPromise = (async () => {
    const url = process.platform === 'win32'
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

    const dest = path.join(getUserDataBin(), filename)
    const tempDest = path.join(getUserDataBin(), `${filename}.download-${process.pid}-${Date.now()}`)

    try {
      fs.ensureDirSync(getUserDataBin())
      console.log(`[Tools] Starting download: ${url}`)

      if (progressCallback) progressCallback({ status: 'downloading', message: 'Downloading yt-dlp...' })

      await downloadFile(url, tempDest)
      const downloadedSize = validateDownloadedExecutable(tempDest)
      console.log(`[Tools] yt-dlp download validated: ${downloadedSize} bytes`)

      if (progressCallback) progressCallback({ status: 'installing', message: 'Installing yt-dlp...' })
      await replaceFileWithRetry(tempDest, dest, progressCallback)
      //small cushion, teehee (i hate you windows defender.)
      if (process.platform === 'win32') {
        await wait(300); 
      }

      console.log(`[Tools] yt-dlp downloaded successfully to: ${dest}`)

      if (process.platform !== 'win32') {
        fs.chmodSync(dest, '755')
        console.log(`[Tools] Set executable permissions for yt-dlp`)
      }

      return dest
    } catch (err) {
      console.error(`[Tools] Failed to download yt-dlp: ${err.message}`)
      throw err
    } finally {
      try { fs.removeSync(tempDest) } catch {}
      ytDlpInstallPromise = null
    }
  })()

  return ytDlpInstallPromise
}


let ffmpegInstallPromise = null

function getFfmpegInstallLock() {
  return ffmpegInstallPromise
}

async function downloadFfmpeg(progressCallback) {
  if (getFfmpegInstallLock()) {
    return getFfmpegInstallLock()
  }

  ffmpegInstallPromise = (async () => {
    const binDir = getUserDataBin()
    fs.ensureDirSync(binDir)

    if (progressCallback) progressCallback({ status: 'downloading', message: 'Downloading ffmpeg...' })

    let url, archiveExt, extractFolderName, exeSubPath

    if (process.platform === 'win32') {
      url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
      archiveExt = 'zip'
      extractFolderName = 'ffmpeg-master-latest-win64-gpl'
      exeSubPath = 'bin'
    } else if (process.platform === 'darwin') {
      url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.tar.xz'
      archiveExt = 'tar.xz'
      extractFolderName = 'ffmpeg-master-latest-macos64-gpl'
      exeSubPath = 'bin'
    } else {
      url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz'
      archiveExt = 'tar.xz'
      extractFolderName = 'ffmpeg-master-latest-linux64-gpl'
      exeSubPath = 'bin'
    }

    // Unique per-attempt paths so a stale/locked file from a previous failed
    // (or overlapping) attempt can never collide with this one.
    const attemptId = `${process.pid}-${Date.now()}`
    const archivePath = path.join(binDir, `ffmpeg.${attemptId}.${archiveExt}`)
    const extractFolder = path.join(binDir, `temp_ffmpeg_${attemptId}`)

    try {
      console.log(`[Tools] Downloading ffmpeg from: ${url}`)
      await downloadFile(url, archivePath)

      const stat = fs.statSync(archivePath)
      if (!stat || stat.size === 0) {
        throw new Error('Downloaded ffmpeg archive is empty (0 bytes)')
      }

      if (progressCallback) progressCallback({ status: 'extracting', message: 'Extracting ffmpeg...' })

      if (process.platform === 'win32') {
        let zip
        try {
          zip = new AdmZip(archivePath)
        } catch (zipErr) {
          throw new Error(`ffmpeg archive is corrupt or incomplete: ${zipErr.message}`)
        }
        zip.extractAllTo(extractFolder, true)

        const srcFfmpeg = path.join(extractFolder, extractFolderName, exeSubPath, 'ffmpeg.exe')
        const destFfmpeg = path.join(binDir, 'ffmpeg.exe')
        if (fileExists(srcFfmpeg)) {
          validateDownloadedExecutable(srcFfmpeg)
          await replaceFileWithRetry(srcFfmpeg, destFfmpeg, progressCallback)
        } else {
          throw new Error('ffmpeg.exe not found inside downloaded archive')
        }

        const srcFfprobe = path.join(extractFolder, extractFolderName, exeSubPath, 'ffprobe.exe')
        const destFfprobe = path.join(binDir, 'ffprobe.exe')
        if (fileExists(srcFfprobe)) {
          validateDownloadedExecutable(srcFfprobe)
          await replaceFileWithRetry(srcFfprobe, destFfprobe, progressCallback)
        }
      } else {
        const tar = require('tar')
        fs.ensureDirSync(extractFolder)
        await tar.extract({ file: archivePath, cwd: extractFolder })

        const srcFfmpeg = path.join(extractFolder, extractFolderName, exeSubPath, 'ffmpeg')
        const destFfmpeg = path.join(binDir, 'ffmpeg')
        if (fileExists(srcFfmpeg)) {
          validateDownloadedExecutable(srcFfmpeg)
          await replaceFileWithRetry(srcFfmpeg, destFfmpeg, progressCallback)
          fs.chmodSync(destFfmpeg, '755')
        } else {
          throw new Error('ffmpeg not found inside downloaded archive')
        }

        const srcFfprobe = path.join(extractFolder, extractFolderName, exeSubPath, 'ffprobe')
        const destFfprobe = path.join(binDir, 'ffprobe')
        if (fileExists(srcFfprobe)) {
          validateDownloadedExecutable(srcFfprobe)
          await replaceFileWithRetry(srcFfprobe, destFfprobe, progressCallback)
          fs.chmodSync(destFfprobe, '755')
        }
      }

      console.log(`[Tools] ffmpeg extracted successfully`)

      return path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    } catch (err) {
      console.error(`[Tools] Failed to download/extract ffmpeg: ${err.message}`)
      throw err
    } finally {
      try { fs.removeSync(archivePath) } catch {}
      try { fs.removeSync(extractFolder) } catch {}
      ffmpegInstallPromise = null
    }
  })()

  return ffmpegInstallPromise
}


function registerToolsHandlers(ipcMain) {
  const { BrowserWindow } = require('electron')
  const { getDB } = require('./db')

  
  ipcMain.handle('tools:status', async () => {
    const ytdlp = findYtDlp()
    const ffmpeg = findFfmpeg()
    const ffprobe = findFfprobe()
    
    
    let customYtDlp = null
    let customFfmpeg = null
    
    try {
      const db = getDB()
      const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
      customYtDlp = settings.custom_ytdlp_path || null
      customFfmpeg = settings.custom_ffmpeg_path || null
    } catch {}

    return {
      ytdlp: {
        found: !!ytdlp,
        path: ytdlp,
        isCustom: customYtDlp ? fileExists(customYtDlp) : false,
        customPath: customYtDlp || null
      },
      ffmpeg: {
        found: !!ffmpeg,
        path: ffmpeg,
        isCustom: customFfmpeg ? fileExists(customFfmpeg) : false,
        customPath: customFfmpeg || null
      },
      ffprobe: {
        found: !!ffprobe,
        path: ffprobe
      },
      bundledPath: getBundledBin(),
      userDataPath: getUserDataBin()
    }
  })

  
  ipcMain.handle('tools:downloadYtDlp', async (e) => {
  console.log("[IPC] Received tools:downloadYtDlp request"); 
  const win = BrowserWindow.fromWebContents(e.sender);
  try {
    const dest = await downloadYtDlp((progress) => {
      console.log("[IPC] Download Progress:", progress.message); 
      if (win) win.webContents.send('tools:downloadProgress', { tool: 'yt-dlp', ...progress });
    });
    return { success: true, path: dest };
  } catch (err) {
    console.error("[IPC] Download Error:", err); 
    return { error: err.message };
  }
});

  
  ipcMain.handle('tools:downloadFfmpeg', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    try {
      const dest = await downloadFfmpeg((progress) => {
        if (win) win.webContents.send('tools:downloadProgress', { tool: 'ffmpeg', ...progress })
      })
      return { success: true, path: dest }
    } catch (err) {
      return { error: err.message }
    }
  })

  
  ipcMain.handle('tools:setCustomPath', async (_, { tool, customPath }) => {
    if (!fileExists(customPath)) {
      return { error: 'File does not exist' }
    }

    try {
      const db = getDB()
      const key = tool === 'yt-dlp' ? 'custom_ytdlp_path' : 'custom_ffmpeg_path'
      
      
      const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key)
      if (existing) {
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(customPath, key)
      } else {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, customPath)
      }
      
      return { success: true, path: customPath }
    } catch (err) {
      return { error: err.message }
    }
  })

  
  ipcMain.handle('tools:detect', async () => {
    const ytdlp = findYtDlp()
    const ffmpeg = findFfmpeg()
    const ffprobe = findFfprobe()
    return {
      ytDlpPath: ytdlp,
      ffmpegPath: ffmpeg,
      ffprobePath: ffprobe
    }
  })

  ipcMain.handle('tools:getYtDlpVersionStatus', async () => {
    return getYtDlpVersionStatus()
  })
}

module.exports = { 
  registerToolsHandlers, 
  findYtDlp, 
  findFfmpeg,
  findFfprobe,
  downloadYtDlp, 
  downloadFfmpeg,
  getYtDlpVersionStatus,
  getUserDataBin,
  getBundledBin
}
