function registerPlayerHandlers(ipcMain) {
  
  ipcMain.handle('player:getFileURL', (e, filePath) => {
    const { pathToFileURL } = require('url')
    return pathToFileURL(filePath).href
  })
}

module.exports = { registerPlayerHandlers }
