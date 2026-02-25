const { contextBridge, ipcRenderer } = require('electron')
const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a)
const on = (ch, fn) => { ipcRenderer.on(ch, fn); return () => ipcRenderer.removeListener(ch, fn) }

contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  minimize: () => invoke('window:minimize'),
  maximize: () => invoke('window:maximize'),
  close: () => invoke('window:close'),
  openExternal: (url) => invoke('shell:openExternal', url),
  openFolder: () => invoke('dialog:openFolder'),
  openFile: (f) => invoke('dialog:openFile', f),
  readFileBinary: (fp) => invoke('dialog:readFileBinary', fp),
  readFileAsDataURL: (fp) => invoke('dialog:readFileAsDataURL', fp),

  
  scanFolder: (f) => invoke('scanner:scan', f),
  getTracks: (o) => invoke('scanner:getTracks', o),
  searchTracks: (q) => invoke('scanner:search', q),
  getArtists: () => invoke('scanner:getArtists'),
  getArtist: (id) => invoke('scanner:getArtist', id),
  getAlbumTracks: (a) => invoke('scanner:getAlbumTracks', a),
  getAllAlbums: () => invoke('scanner:getAllAlbums'),
  searchAlbums: (q) => invoke('scanner:searchAlbums', q),
  onScanProgress: (fn) => on('scanner:progress', fn),
  getSuggestions: (uid) => invoke('scanner:getSuggestions', uid),
  getHistory: (uid, l) => invoke('scanner:getHistory', uid, l),
  getMixes: (uid) => invoke('scanner:getMixes', uid),
  getRelated: (id, uid) => invoke('scanner:getRelated', id, uid),
  checkDuplicates: () => invoke('scanner:checkDuplicates'),
  mergeDuplicates: (keepId, removeIds) => invoke('scanner:mergeDuplicates', keepId, removeIds),
  mergeAllDuplicates: () => invoke('scanner:mergeAllDuplicates'),
  deleteTracks: (ids) => invoke('scanner:deleteTracks', ids),
  incrementPlayTime: (id, uid, secs) => invoke('scanner:incrementPlayTime', id, uid, secs),
  getRandomTrack: () => invoke('scanner:getRandomTrack'),
  getTopGenres: () => invoke('scanner:getTopGenres'),
  fetchMissingGenres: () => invoke('scanner:fetchMissingGenres'),
  readFileAsDataURL: (path) => ipcRenderer.invoke('dialog:readFileAsDataURL', path),
  
  getPlaylists: (uid) => invoke('scanner:getPlaylists', uid),
  createPlaylist: (n, uid, d) => invoke('scanner:createPlaylist', n, uid, d),
  updatePlaylist: (id, d) => invoke('scanner:updatePlaylist', id, d),
  addToPlaylist: (pl, t) => invoke('scanner:addToPlaylist', pl, t),
  removeFromPlaylist: (pl, t) => invoke('scanner:removeFromPlaylist', pl, t),
  getPlaylistTracks: (pl) => invoke('scanner:getPlaylistTracks', pl),
  deletePlaylist: (pl) => invoke('scanner:deletePlaylist', pl),
  playlistImport: (name, entries, uid) => invoke('playlist:import', name, entries, uid),
  playlistImportFile: (name, fileContent, fileType, uid) => invoke('playlist:importFile', name, fileContent, fileType, uid),
  reorderPlaylist: (pl, trackIds) => invoke('scanner:reorderPlaylist', pl, trackIds),

  
  toggleLike: (t, uid) => invoke('scanner:toggleLike', t, uid),
  getLikedTracks: (uid) => invoke('scanner:getLikedTracks', uid),
  historyExport: (uid, format) => invoke('history:export', uid, format),

  
  artistUpdateBio: (id, b) => invoke('artist:updateBio', id, b),
  artistSetImage: (id, d) => invoke('artist:setImage', id, d),
  artistSetImageUrl: (id, url) => invoke('artist:setImageUrl', id, url),
  artistRename: (id, n) => invoke('artist:rename', id, n),
  artistMerge: (s, t) => invoke('artist:merge', s, t),
  artistDelete: (id) => invoke('artist:delete', id),
  trackSetArtwork: (id, d) => invoke('track:setArtwork', id, d),
  trackSetGenre: (id, genre) => invoke('track:setGenre', id, genre),
  setManualGenre: (data) => invoke('scanner:setManualGenre', data),
  importPhotosDir: (dir) => invoke('artist:importPhotosDir', dir),

  
  getLyrics: (id, ti, ar, al, d) => invoke('lyrics:get', id, ti, ar, al, d),
  clearLyricsCache: (id) => invoke('lyrics:clearCache', id),
  importLyrics: (id, c, t) => invoke('lyrics:import', id, c, t),
  clearLyricsDb: () => invoke('db:clearLyrics'),

  
  downloadYT: (url, opts) => invoke('downloader:download', url, opts),
  downloadPlaylist: (url, opts) => invoke('downloader:downloadPlaylist', url, opts),
  searchYT: (q) => invoke('downloader:search', q),
  cancelDownload: (id) => invoke('downloader:cancel', id),
  getDownloadQueue: () => invoke('downloader:queue'),
  onDownloadProgress: (fn) => on('downloader:progress', fn),

  
  getToolsStatus: () => invoke('tools:status'),
  downloadYtDlp: () => invoke('tools:downloadYtDlp'),
  downloadFfmpeg: () => invoke('tools:downloadFfmpeg'),
  setCustomToolPath: (tool, path) => invoke('tools:setCustomPath', { tool, customPath: path }),
  detectTools: () => invoke('tools:detect'),
  onToolsDownloadProgress: (fn) => on('tools:downloadProgress', fn),

  
  getPerfSettings: () => invoke('perf:load'),
  savePerfSettings: (s) => invoke('perf:save', s),
  relaunchApp: () => ipcRenderer.send('relaunch-app'),
  onPerfSettings: (fn) => on('perf-settings', fn),

  
  getSettings: () => invoke('settings:get'),
  saveSettings: (s) => invoke('settings:save', s),
  clearTracks: () => invoke('db:clearTracks'),
  getKeepCommaArtists: () => invoke('settings:getKeepCommaArtists'),
  setKeepCommaArtists: (artists) => invoke('settings:setKeepCommaArtists', artists),
  getTheme: () => invoke('settings:getTheme'),
  saveTheme: (theme, overrides) => invoke('settings:saveTheme', { theme, overrides }),

  
  register: (d) => invoke('user:register', d),
  login: (d) => invoke('user:login', d),
  updateProfile: (d) => invoke('user:updateProfile', d),
  getUserStats: (uid) => invoke('user:getStats', uid),

  
  discordSetActivity: (t, p) => invoke('discord:setActivity', t, p),
  discordConnect: (id) => invoke('discord:connect', id),
  discordDisconnect: () => invoke('discord:disconnect'),

  
  lastfmConnect: (apiKey, apiSecret, token) => invoke('lastfm:connect', apiKey, apiSecret, token),
  lastfmGetArtistInfo: (artist) => invoke('lastfm:getArtistInfo', artist),
  lastfmGetTrackInfo: (artist, track) => invoke('lastfm:getTrackInfo', artist, track),
  lastfmGetSimilarArtists: (artist, limit) => invoke('lastfm:getSimilarArtists', artist, limit),
  lastfmScrobble: (artist, track, album, duration, timestamp) => invoke('lastfm:scrobble', artist, track, album, duration, timestamp),
  lastfmUpdateNowPlaying: (artist, track, album, duration) => invoke('lastfm:updateNowPlaying', artist, track, album, duration),
  updaterInstall: () => invoke('updater:install'),
  updaterCheck: () => invoke('updater:check'),
  getVersion: () => invoke('app:getVersion'),
  onUpdaterEvent: (cb) => {
    ipcRenderer.on('updater:available', (_, info) => cb('available', info))
    ipcRenderer.on('updater:progress', (_, p) => cb('progress', p))
    ipcRenderer.on('updater:ready', () => cb('ready'))
    ipcRenderer.on('updater:error', (_, msg) => cb('error', msg))
    return () => {
      ipcRenderer.removeAllListeners('updater:available')
      ipcRenderer.removeAllListeners('updater:progress')
      ipcRenderer.removeAllListeners('updater:ready')
      ipcRenderer.removeAllListeners('updater:error')
    }
  },
})
