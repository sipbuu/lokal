const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const log = require('electron-log')

const date = new Date().toISOString().replace(/[:.]/g, '-')
log.transports.file.fileName = `lokal-${date}.log`
log.transports.file.level = 'info'
log.errorHandler.startCatching()
Object.assign(console, log.functions)

const { autoUpdater } = require('electron-updater')
const { initDB } = require('./ipc/db')
const { registerScannerHandlers, registerExtraHandlers, registerV4Handlers } = require('./ipc/scanner')
const { registerMixesHandlers } = require('./ipc/mixes')
const { registerPlayerHandlers } = require('./ipc/player')
const { registerDownloaderHandlers, registerExtraDownloaderHandlers, registerPlaylistArchiveHandlers } = require('./ipc/downloader')
const { registerLyricsHandlers } = require('./ipc/lyrics')
const { registerUserHandlers } = require('./ipc/users')
const { registerDiscordHandlers } = require('./ipc/discord')
const { registerLastFmHandlers } = require('./ipc/lastfm')
const { registerToolsHandlers } = require('./ipc/tools')
const { registerPlaylistHandlers } = require('./ipc/playlists')
let isUpdating = false;

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-available', (info) => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:available', info)
  }
})

autoUpdater.on('download-progress', (progress) => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:progress', progress)
  }
})

autoUpdater.on('update-downloaded', () => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:ready')
  }
})

autoUpdater.on('error', (err) => {
  if (mainWindow) {
    mainWindow.webContents.send('updater:error', err.message)
  }
})


const settingsPath = path.join(app.getPath('userData'), 'performance-settings.json')

function loadPerformanceSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    }
  } catch (e) {}
  return { hardwareAcceleration: true, performanceMode: false }
}


const perfSettings = loadPerformanceSettings()


if (!perfSettings.hardwareAcceleration) {
  app.disableHardwareAcceleration()
  
  app.commandLine.appendSwitch('disable-software-rasterizer')
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, process.platform === 'win32' ? '../public/lokal-icon.ico' : '../public/lokal-icon.png'),
    width: 1400, height: 860, minWidth: 960, minHeight: 640,
    frame: false, backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: false,
    },
  })
  
  
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    const logLevel = ['debug', 'info', 'warn', 'error'][level] || 'info'
    log[logLevel](`[Renderer:${sourceId}:${line}] ${message}`)
  })
  
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('perf-settings', perfSettings)
  })
  
  
  if (!app.isPackaged) {
    
    mainWindow.loadURL('http://localhost:5173')
  } else {
    
    const filePath = path.join(__dirname, '../dist/index.html')
    mainWindow.loadFile(filePath)
  }
}
app.name = 'Lokal'
app.whenReady().then(() => {
  if (!gotTheLock) return;
  if (app.isPackaged) {
    try { require('../server/index.js') } catch (e) { console.error('Server already running or port blocked:', e.message) }
  }
  app.name = 'Lokal'
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.lokal.music');
  }
  try { initDB() } catch (e) { console.error('DB:', e.message) }

  for (const fn of [
    registerScannerHandlers, registerPlayerHandlers, registerDownloaderHandlers,
    registerExtraDownloaderHandlers, registerPlaylistArchiveHandlers, registerLyricsHandlers, registerUserHandlers,
    registerDiscordHandlers, registerExtraHandlers, registerV4Handlers, registerLastFmHandlers,
    registerToolsHandlers, registerPlaylistHandlers, registerMixesHandlers
  ]) {
    try { fn(ipcMain) } catch (e) { console.error(fn.name + ':', e.message) }
  }


  ipcMain.on('relaunch-app', () => {
    app.relaunch()
    app.exit()
  })

  
  ipcMain.handle('perf:save', async (_, newSettings) => {
    try {
      fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2))
      return { success: true }
    } catch (e) {
      return { error: e.message }
    }
  })

  ipcMain.handle('updater:download', async () => {
  return await autoUpdater.downloadUpdate()
})

  ipcMain.handle('perf:load', async () => {
    return perfSettings
  })
  ipcMain.on('app-log', (event, { level, message }) => {
    if (log[level]) {
      log[level](`[Renderer] ${message}`);
    } else {
      log.info(`[Renderer] ${message}`);
    }
  });
  ipcMain.handle('dialog:openFolder', async () => {
    const r = await require('electron').dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return r.filePaths[0] || null
  })
  ipcMain.handle('dialog:openFile', async (_, filters) => {
    const r = await require('electron').dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'Files', extensions: ['jpg','jpeg','png','webp','lrc','txt','ttl','ttml'] }]
    })
    return r.filePaths[0] || null
  })
  ipcMain.handle('dialog:readFileBinary', async (_, fp) => require('fs').readFileSync(fp, 'utf8'))
  ipcMain.handle('dialog:readFileAsDataURL', async (_, fp) => {
  try {
    const sharp = require('sharp');
    const buffer = await sharp(fp)
      .resize(512, 512, {
        fit: 'cover',  
        position: 'centre' 
      })
      .jpeg({ quality: 80 }) 
      .toBuffer();

    const base64 = buffer.toString('base64');
    return `data:image/jpeg;base64,${base64}`;
  } catch (e) {
    console.error('Error processing artwork:', e);
    try {
      const fs = require('fs');
      return `data:image/jpeg;base64,${fs.readFileSync(fp).toString('base64')}`;
    } catch (err) {
      return null;
    }
  }
});

ipcMain.handle('window:minimize', () => mainWindow.minimize())
ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.handle('window:close', () => mainWindow.close())
ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
ipcMain.on('open-logs', () => {
  const logFile = log.transports.file.getFile().path;
  const logDir = path.dirname(logFile);
  if (fs.existsSync(logFile)) {
    shell.showItemInFolder(logFile);
  } else {
    shell.openPath(logDir);
  }
});

ipcMain.handle('updater:install', () => {
  isUpdating = true; 
  BrowserWindow.getAllWindows().forEach(w => w.close());
  
  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true); 
  }, 500);
});
  ipcMain.handle('updater:check', () => {
    autoUpdater.checkForUpdates()
  })
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

  if (!app.isPackaged) {
    console.log('[updater] skipping in dev mode')
  } else {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('[updater] check failed:', err.message)
      })
    }, 3000)
  }
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || isUpdating) {
    app.quit();
  }
})

app.on('before-quit', () => {
  if (isUpdating) {
    if (mainWindow) {
      mainWindow.destroy();
    }
  }
});
