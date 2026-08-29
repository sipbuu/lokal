const path = require('path')
const { nativeImage } = require('electron')

const ICONS_DIR = path.join(__dirname, '..', 'icons')

let cachedIcons = null
function getIcons() {
  if (!cachedIcons) {
    cachedIcons = {
      prev: nativeImage.createFromPath(path.join(ICONS_DIR, 'prev.png')),
      next: nativeImage.createFromPath(path.join(ICONS_DIR, 'next.png')),
      play: nativeImage.createFromPath(path.join(ICONS_DIR, 'play.png')),
      pause: nativeImage.createFromPath(path.join(ICONS_DIR, 'pause.png')),
      like: nativeImage.createFromPath(path.join(ICONS_DIR, 'like.png')),
      likeFilled: nativeImage.createFromPath(path.join(ICONS_DIR, 'like-filled.png')),
    }
  }
  return cachedIcons
}

function updateThumbarButtons(mainWindow, { isPlaying = false, isLiked = false } = {}) {
  if (process.platform !== 'win32') return
  if (!mainWindow || mainWindow.isDestroyed()) return
  const icons = getIcons()
  try {
    mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: icons.prev,
        click: () => mainWindow.webContents.send('thumbar:previous'),
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: isPlaying ? icons.pause : icons.play,
        click: () => mainWindow.webContents.send('thumbar:toggle-play'),
      },
      {
        tooltip: 'Next',
        icon: icons.next,
        click: () => mainWindow.webContents.send('thumbar:next'),
      },
      {
        tooltip: isLiked ? 'Unlike' : 'Like',
        icon: isLiked ? icons.likeFilled : icons.like,
        click: () => mainWindow.webContents.send('thumbar:toggle-like'),
      },
    ])
  } catch (e) {
    console.warn('[thumbar] Failed to set thumbar buttons:', e.message)
  }
}

function registerThumbarHandlers(ipcMain, getMainWindow) {
  ipcMain.handle('thumbar:updateState', (_, state) => {
    updateThumbarButtons(getMainWindow(), state || {})
  })
}

module.exports = { updateThumbarButtons, registerThumbarHandlers }
