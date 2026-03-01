const { app } = require('electron')
const path = require('path')
const fs = require('fs-extra')
const https = require('https')
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


function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(dest));
    
    const file = fs.createWriteStream(dest);
    const request = https.get(url, (response) => {

      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        console.log(`[Redirect] Following to: ${redirectUrl}`);
        file.close();
        return downloadFile(redirectUrl, dest).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed: ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log(`[Download] Finished: ${dest}`);
        resolve();
      });
    });

    request.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      console.error(`[Download] Error: ${err.message}`);
      reject(err);
    });
  });
}


async function downloadYtDlp(progressCallback) {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const filename = `yt-dlp${ext}`
  const url = process.platform === 'win32'
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'
  
  const dest = path.join(getUserDataBin(), filename)
  fs.ensureDirSync(getUserDataBin())
  console.log(`[Tools] Starting download: ${url}`); 
  
  if (progressCallback) progressCallback({ status: 'downloading', message: 'Downloading yt-dlp...' });
  
  try {
    await downloadFile(url, dest);
    console.log(`[Tools] yt-dlp downloaded successfully to: ${dest}`); 
    
    if (process.platform !== 'win32') {
      fs.chmodSync(dest, '755');
      console.log(`[Tools] Set executable permissions for yt-dlp`); 
    }
  } catch (err) {
    console.error(`[Tools] Failed to download yt-dlp: ${err.message}`); 
    throw err;
  }
  
  return dest; 
}


async function downloadFfmpeg(progressCallback) {
  const binDir = getUserDataBin()
  fs.ensureDirSync(binDir)
  
  if (progressCallback) progressCallback({ status: 'downloading', message: 'Downloading ffmpeg...' })
  
  let url, archiveName, extractFolderName, exeSubPath
  
  if (process.platform === 'win32') {
    url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
    archiveName = 'ffmpeg.zip'
    extractFolderName = 'ffmpeg-master-latest-win64-gpl'
    exeSubPath = 'bin'
  } else if (process.platform === 'darwin') {
    url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-macos64-gpl.tar.xz'
    archiveName = 'ffmpeg.tar.xz'
    extractFolderName = 'ffmpeg-master-latest-macos64-gpl'
    exeSubPath = 'bin'
  } else {
    url = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz'
    archiveName = 'ffmpeg.tar.xz'
    extractFolderName = 'ffmpeg-master-latest-linux64-gpl'
    exeSubPath = 'bin'
  }
  
  const archivePath = path.join(binDir, archiveName)
  const extractFolder = path.join(binDir, 'temp_ffmpeg')
  
  try {
    console.log(`[Tools] Downloading ffmpeg from: ${url}`)
    await downloadFile(url, archivePath)
    
    if (progressCallback) progressCallback({ status: 'extracting', message: 'Extracting ffmpeg...' })
    
    if (process.platform === 'win32') {
      const zip = new AdmZip(archivePath)
      zip.extractAllTo(extractFolder, true)
      
      const srcFfmpeg = path.join(extractFolder, extractFolderName, exeSubPath, 'ffmpeg.exe')
      const destFfmpeg = path.join(binDir, 'ffmpeg.exe')
      if (fileExists(srcFfmpeg)) {
        fs.moveSync(srcFfmpeg, destFfmpeg, { overwrite: true })
      }
      
      const srcFfprobe = path.join(extractFolder, extractFolderName, exeSubPath, 'ffprobe.exe')
      const destFfprobe = path.join(binDir, 'ffprobe.exe')
      if (fileExists(srcFfprobe)) {
        fs.moveSync(srcFfprobe, destFfprobe, { overwrite: true })
      }
    } else {
      const tar = require('tar')
      await tar.extract({ file: archivePath, cwd: extractFolder })
      
      const srcFfmpeg = path.join(extractFolder, extractFolderName, exeSubPath, 'ffmpeg')
      const destFfmpeg = path.join(binDir, 'ffmpeg')
      if (fileExists(srcFfmpeg)) {
        fs.moveSync(srcFfmpeg, destFfmpeg, { overwrite: true })
        fs.chmodSync(destFfmpeg, '755')
      }
      
      const srcFfprobe = path.join(extractFolder, extractFolderName, exeSubPath, 'ffprobe')
      const destFfprobe = path.join(binDir, 'ffprobe')
      if (fileExists(srcFfprobe)) {
        fs.moveSync(srcFfprobe, destFfprobe, { overwrite: true })
        fs.chmodSync(destFfprobe, '755')
      }
    }
    
    try { fs.removeSync(extractFolder) } catch {}
    try { fs.removeSync(archivePath) } catch {}
    
    console.log(`[Tools] ffmpeg extracted successfully`)
    
    return path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  } catch (err) {
    console.error(`[Tools] Failed to download/extract ffmpeg: ${err.message}`)
    throw err
  }
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
}

module.exports = { 
  registerToolsHandlers, 
  findYtDlp, 
  findFfmpeg,
  findFfprobe,
  downloadYtDlp, 
  downloadFfmpeg,
  getUserDataBin,
  getBundledBin
}
