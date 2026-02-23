const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { initDB } = require('./ipc/db')
const { registerScannerHandlers, registerExtraHandlers, registerV4Handlers } = require('./ipc/scanner')
const { registerPlayerHandlers } = require('./ipc/player')
const { registerDownloaderHandlers, registerExtraDownloaderHandlers } = require('./ipc/downloader')
const { registerLyricsHandlers } = require('./ipc/lyrics')
const { registerUserHandlers } = require('./ipc/users')
const { registerDiscordHandlers } = require('./ipc/discord')
const { registerLastFmHandlers } = require('./ipc/lastfm')
const { registerToolsHandlers } = require('./ipc/tools')


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
    width: 1400, height: 860, minWidth: 960, minHeight: 640,
    frame: false, backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, webSecurity: false,
    },
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

app.whenReady().then(() => {
  
  if (app.isPackaged) {
    try { require('../server/index.js') } catch (e) { console.error('Server:', e.message) }
  }
  
  try { initDB() } catch (e) { console.error('DB:', e.message) }

  for (const fn of [
    registerScannerHandlers, registerPlayerHandlers, registerDownloaderHandlers,
    registerExtraDownloaderHandlers, registerLyricsHandlers, registerUserHandlers,
    registerDiscordHandlers, registerExtraHandlers, registerV4Handlers, registerLastFmHandlers,
    registerToolsHandlers,
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

  
  ipcMain.handle('perf:load', async () => {
    return perfSettings
  })

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
  ipcMain.handle('window:minimize', () => mainWindow.minimize())
  ipcMain.handle('window:maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
  ipcMain.handle('window:close', () => mainWindow.close())
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
