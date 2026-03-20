const isE = () => {
  try {
    if (typeof window !== 'undefined' && window.electron?.isElectron === true) return true
    if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return true
  } catch {}
  return false
}
const el = () => window.electron
const BASE = '/api'

function buildLastfmAuthUrl(apiKey) {
  const callback = isE()
    ? 'lokal://lastfm-auth'
    : `${window.location.origin}${BASE}/lastfm/callback`
  return `https://www.last.fm/api/auth/?${new URLSearchParams({ api_key: apiKey || '', cb: callback })}`
}

function normalizeProfilePayload(data = {}) {
  return {
    userId: data.userId,
    displayName: data.displayName ?? data.display_name,
    bio: data.bio ?? '',
    avatarData: data.avatarData ?? data.avatar ?? null,
  }
}

async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) return { error: (await res.json().catch(() => ({}))).error || 'Request failed' }
    return res.json()
  } catch (e) { return { error: e.message } }
}

export const api = {
  get isElectron() { return isE() },
  artworkURL: (id) => `${BASE}/artwork/${encodeURIComponent(id)}`,
  streamURL: (t) => `${BASE}/stream/${encodeURIComponent(t.id)}`,
  avatarURL: (id) => `${BASE}/avatar/${id}`,
  getTracks: (o = {}) => isE() ? el().getTracks(o) : apiFetch(`/tracks?${new URLSearchParams(o)}`),
  searchTracks: (q) => isE() ? el().searchTracks(q) : apiFetch(`/tracks/search?q=${encodeURIComponent(q)}`),
  toggleLike: (tid, uid) => isE() ? el().toggleLike(tid, uid) : apiFetch(`/tracks/${tid}/like`, { method:'POST', body:{userId:uid} }),
  getLikedTracks: (uid) => isE() ? el().getLikedTracks(uid) : apiFetch(`/tracks/liked?userId=${uid||'guest'}`),
  incrementPlayTime: (tid, uid, s) => isE() ? el().incrementPlayTime(tid, uid, s) : Promise.resolve(),
  getHistory: (uid, l) => isE() ? el().getHistory(uid, l) : apiFetch(`/tracks/history?userId=${uid||'guest'}&limit=${l||30}`),
  getSuggestions: (uid) => isE() ? el().getSuggestions(uid) : apiFetch(`/tracks/suggestions?userId=${uid||'guest'}`),
  getRelated: (tid, uid) => isE() ? el().getRelated(tid, uid) : apiFetch(`/tracks/${tid}/related?userId=${uid||'guest'}`),
  checkDuplicates: () => isE() ? el().checkDuplicates() : apiFetch('/tracks/duplicates'),
  mergeDuplicates: (keepId, removeIds) => isE() ? el().mergeDuplicates(keepId, removeIds) : apiFetch('/tracks/merge', { method:'POST', body:{keepId, removeIds} }),
  mergeAllDuplicates: () => isE() ? el().mergeAllDuplicates() : apiFetch('/tracks/merge-all', { method:'POST' }),
  deleteTracks: (ids) => isE() ? el().deleteTracks(ids) : apiFetch('/tracks/batch-delete', { method:'POST', body:{ids} }),
  deleteTrackByPath: (filePath) => isE() ? el().deleteTrackByPath(filePath) : apiFetch('/tracks/delete-by-path', { method:'POST', body:{filePath} }),
  getArtists: () => isE() ? el().getArtists() : apiFetch('/artists'),
  getArtistsPage: (opts = {}) => isE()
    ? el().getArtistsPage(opts)
    : apiFetch(`/artists?${new URLSearchParams({
        search: opts.search || '',
        limit: String(opts.limit || 60),
        offset: String(opts.offset || 0),
      })}`),
  getArtist: (id) => isE() ? el().getArtist(id) : apiFetch(`/artists/${id}`),
  getAlbumTracks: (a) => isE() ? el().getAlbumTracks(a) : apiFetch(`/tracks?album=${encodeURIComponent(a)}`),
  getAllAlbums: () => isE() ? el().getAllAlbums() : apiFetch('/albums'),
  searchAlbums: (q) => isE() ? el().searchAlbums(q) : apiFetch(`/albums/search?q=${encodeURIComponent(q)}`),
  artistUpdateBio: (id, b) => isE() ? el().artistUpdateBio(id, b) : apiFetch(`/artists/${id}/bio`, { method:'PUT', body:{bio:b} }),
  artistSetImage: (id, d) => isE() ? el().artistSetImage(id, d) : apiFetch(`/artists/${id}/image`, { method:'PUT', body:{imageData:d} }),
  artistSetImageUrl: (id, url) => isE() ? el().artistSetImageUrl(id, url) : apiFetch(`/artists/${id}/image-url`, { method:'PUT', body:{url} }),
  artistRefreshMetadata: (id, opts = {}) => isE() ? el().artistRefreshMetadata(id, opts) : apiFetch(`/artists/${id}/refresh-metadata`, { method:'POST', body: opts }),
  artistSearchMetadata: (query) => isE() ? el().artistSearchMetadata(query) : apiFetch(`/artists/metadata/search?q=${encodeURIComponent(query || '')}`),
  artistApplyMetadataSelection: (id, selection, mode = 'both') => isE()
    ? el().artistApplyMetadataSelection(id, selection, mode)
    : apiFetch(`/artists/${id}/metadata-selection`, { method:'POST', body:{ selection, mode } }),
  artistClearImageOverride: (id) => isE() ? el().artistClearImageOverride(id) : apiFetch(`/artists/${id}/image/fallback`, { method:'POST' }),
  artistRename: (id, n) => isE() ? el().artistRename(id, n) : apiFetch(`/artists/${id}/rename`, { method:'PUT', body:{name:n} }),
  artistMerge: (s, t) => isE() ? el().artistMerge(s, t) : apiFetch('/artists/merge', { method:'POST', body:{sourceId:s,targetId:t} }),
  artistDelete: (id) => isE() ? el().artistDelete(id) : apiFetch(`/artists/${id}`, { method:'DELETE' }),
  trackSetArtwork: (id, d) => isE() ? el().trackSetArtwork(id, d) : apiFetch(`/tracks/${id}/artwork`, { method:'PUT', body:{imageData:d} }),
  trackSetGenre: (id, genre) => isE() ? el().trackSetGenre(id, genre) : apiFetch(`/tracks/${id}/genre`, { method:'PUT', body:{genre} }),
  importPhotosDir: (dir) => isE() ? el().importPhotosDir(dir) : Promise.resolve({ error:'Electron only' }),
  getPlaylists: (uid) => isE() ? el().getPlaylists(uid) : apiFetch(`/playlists?userId=${uid||'guest'}`),
  createPlaylist: (n, uid, d) => isE() ? el().createPlaylist(n, uid, d) : apiFetch('/playlists', { method:'POST', body:{name:n,userId:uid,description:d} }),
  updatePlaylist: (id, d) => isE() ? el().updatePlaylist(id, d) : apiFetch(`/playlists/${id}`, { method:'PUT', body:d }),
  addToPlaylist: (pl, tid) => isE() ? el().addToPlaylist(pl, tid) : apiFetch(`/playlists/${pl}/tracks`, { method:'POST', body:{trackId:tid} }),
  addMultipleToPlaylist: async (pl, trackIds) => {
    if (!trackIds || trackIds.length === 0) return
    for (const tid of trackIds) {
      await (isE() ? el().addToPlaylist(pl, tid) : apiFetch(`/playlists/${pl}/tracks`, { method:'POST', body:{trackId:tid} }))
    }
  }, 
  removeFromPlaylist: (pl, tid) => isE() ? el().removeFromPlaylist(pl, tid) : apiFetch(`/playlists/${pl}/tracks/${tid}`, { method:'DELETE' }),
  getPlaylistTracks: (pl) => isE() ? el().getPlaylistTracks(pl) : apiFetch(`/playlists/${pl}/tracks`),
  deletePlaylist: (pl) => isE() ? el().deletePlaylist(pl) : apiFetch(`/playlists/${pl}`, { method:'DELETE' }),
  playlistImport: (name, entries, userId) => isE() ? el().playlistImport(name, entries, userId || 'guest') : apiFetch('/playlists/import', { method: 'POST', body: { name, entries, userId: userId || 'guest' }}),
  playlistImportFile: (name, fileContent, fileType, userId) => isE() ? el().playlistImportFile(name, fileContent, fileType, userId || 'guest') : apiFetch('/playlists/import-file', { method:'POST', body:{name, fileContent, fileType, userId:userId||'guest'} }),
  reorderPlaylist: (pl, trackIds) => isE() ? el().reorderPlaylist(pl, trackIds) : apiFetch(`/playlists/${pl}/reorder`, { method:'PUT', body:{trackIds} }),
  getMixes: (uid) => isE() ? el().getMixes(uid) : apiFetch(`/mixes?userId=${uid||'guest'}`),
  getLyrics: (tid, ti, ar, al, dur, fp) => isE() ? el().getLyrics(tid, ti, ar, al, dur, fp) : apiFetch(`/lyrics/${tid}?${new URLSearchParams({title:ti||'',artist:ar||'',album:al||'',duration:dur||'',filePath:fp||''})}`),
  detectLyricsLanguage: (tid, lines) => (isE() && typeof el().detectLyricsLanguage === 'function')
    ? el().detectLyricsLanguage(tid, lines)
    : apiFetch(`/lyrics/${tid}/detect-language`, { method:'POST', body:{ lines } }),
  translateLyrics: (tid, lines, targetLang = 'en') => (isE() && typeof el().translateLyrics === 'function')
    ? el().translateLyrics(tid, lines, targetLang)
    : apiFetch(`/lyrics/${tid}/translate`, { method:'POST', body:{ lines, targetLang } }),
  importLyrics: (tid, c, t) => isE() ? el().importLyrics(tid, c, t) : apiFetch(`/lyrics/${tid}/import`, { method:'POST', body:{content:c,type:t} }),
  clearLyricsCache: (tid) => isE() ? el().clearLyricsCache(tid) : apiFetch(`/lyrics/${tid}`, { method:'DELETE' }),
  clearLyricsDb: () => isE() ? el().clearLyricsDb() : apiFetch('/lyrics/clear-all', { method:'POST' }),
  getSettings: () => isE() ? el().getSettings() : apiFetch('/settings'),
  saveSettings: (s) => isE() ? el().saveSettings(s) : apiFetch('/settings', { method:'PUT', body:s }),
  clearTracks: () => isE() ? el().clearTracks() : apiFetch('/settings/clear-tracks', { method:'POST' }),
  getKeepCommaArtists: () => isE() ? el().getKeepCommaArtists() : apiFetch('/settings/keep-comma-artists'),
  setKeepCommaArtists: (artists) => isE() ? el().setKeepCommaArtists(artists) : apiFetch('/settings/keep-comma-artists', { method:'PUT', body:{artists} }),
  getTheme: () => isE() ? el().getTheme() : apiFetch('/settings/theme'),
  saveTheme: (theme, overrides) => isE() ? el().saveTheme(theme, overrides) : apiFetch('/settings/theme', { method:'PUT', body:{theme, overrides} }),
  scanFolder: (f) => isE() ? el().scanFolder(f) : apiFetch('/settings/scan', { method:'POST', body:{folder:f} }),
  openFolder: () => isE() ? el().openFolder() : Promise.resolve(null),
  openFile: (f) => isE() ? el().openFile(f) : Promise.resolve(null),
  readFileBinary: (fp) => isE() ? el().readFileBinary(fp) : Promise.resolve(null),
  readFileAsDataURL: (fp) => isE() ? el().readFileAsDataURL(fp) : Promise.resolve(null),
  searchYT: (q, page = 1) => isE() ? el().searchYT(q, page) : apiFetch(`/download/search?q=${encodeURIComponent(q)}&page=${page}`),
  searchYTPaginated: (q, page = 1) => isE() ? el().searchYT(q, page) : apiFetch(`/download/search?q=${encodeURIComponent(q)}&page=${page}`),
  searchYTArtist: (artist, page = 1) => isE() ? el().searchYTArtist(artist, page) : apiFetch(`/download/artist-search?q=${encodeURIComponent(artist)}&page=${page}`),
  downloadYT: (url, o) => isE() ? el().downloadYT(url, o) : apiFetch('/download', { method:'POST', body:{url,...o} }),
  downloadPlaylist: (url, o) => isE() ? el().downloadPlaylist(url, o) : apiFetch('/download/playlist', { method:'POST', body:{url,...o} }),
  getDownloadedPlaylists: () => isE() ? el().getDownloadedPlaylists() : apiFetch('/download/playlists'),
  redownloadPlaylist: (id) => isE() ? el().redownloadPlaylist(id) : apiFetch('/download/playlist/redownload', { method:'POST', body:{playlistId:id} }),
  removeFromPlaylistArchive: (id, videoId) => isE() ? el().removeFromPlaylistArchive(id, videoId) : apiFetch('/download/playlist/remove-archive', { method:'POST', body:{playlistId:id, videoId} }),
  deleteDownloadedPlaylist: (id) => isE() ? el().deleteDownloadedPlaylist(id) : apiFetch('/download/playlist', { method:'DELETE', body:{playlistId:id} }),
  getPlaylistArchiveIds: (id) => isE() ? el().getPlaylistArchiveIds(id) : apiFetch(`/download/playlist/archive-ids?playlistId=${id}`),
  cancelDownload: (id) => isE() ? el().cancelDownload(id) : apiFetch('/download/cancel', { method:'POST', body:{id} }),
  getDownloadQueue: () => isE() ? el().getDownloadQueue() : apiFetch('/download/queue'),
  updaterDownload: () => isE() ? el().updaterDownload() : Promise.resolve({ error: 'Electron only' }),
  getToolsStatus: () => isE() ? el().getToolsStatus() : Promise.resolve({}),
  downloadYtDlp: () => isE() ? el().downloadYtDlp() : Promise.resolve({ error: 'Electron only' }),
  downloadFfmpeg: () => isE() ? el().downloadFfmpeg() : Promise.resolve({ error: 'Electron only' }),
  setCustomToolPath: (tool, path) => isE() ? el().setCustomToolPath(tool, path) : Promise.resolve({ error: 'Electron only' }),
  detectTools: () => isE() ? el().detectTools() : Promise.resolve({}),
  onToolsDownloadProgress: (fn) => { if (isE()) return el().onToolsDownloadProgress(fn); return () => {} },
  getRandomTrack: () => isE() ? el().getRandomTrack() : apiFetch('/tracks/random'),
  getTopGenres: () => isE() ? el().getTopGenres() : apiFetch('/tracks/top-genres'),
  historyExport: (uid, format) => isE() ? el().historyExport(uid, format) : apiFetch(`/tracks/history/export?userId=${uid||'guest'}&format=${format||'json'}`),
  register: (d) => isE() ? el().register(d) : apiFetch('/users/register', { method:'POST', body:d }),
  login: (d) => isE() ? el().login(d) : apiFetch('/users/login', { method:'POST', body:d }),
  updateProfile: async (d) => {
    const payload = normalizeProfilePayload(d)
    const result = isE()
      ? await el().updateProfile(payload)
      : await apiFetch(`/users/${payload.userId}`, { method:'PUT', body: payload })
    return result?.user || result
  },
  getUserStats: (uid) => isE() ? el().getUserStats(uid) : apiFetch(`/users/${uid}/stats`),
  getUserRecap: (uid) => isE() ? el().getUserRecap(uid) : apiFetch(`/users/${uid || 'guest'}/recap`),
  discordSetActivity: (t, p) => { if (isE() && el().discordSetActivity) return el().discordSetActivity(t, p); return Promise.resolve() },
  discordConnect: (id) => isE() ? el().discordConnect(id) : Promise.resolve(false),
  discordDisconnect: () => isE() ? el().discordDisconnect() : Promise.resolve(),
  openExternal: (url) => isE() ? el().openExternal(url) : Promise.resolve(window.open(url, '_blank', 'noopener,noreferrer')),
  lastfmConnect: (apiKey, apiSecret, token) => isE() ? el().lastfmConnect(apiKey, apiSecret, token) : apiFetch('/lastfm/connect', { method:'POST', body:{apiKey, apiSecret, token} }),
  lastfmAuthorize: (apiKey) => {
    const url = buildLastfmAuthUrl(apiKey)
    return isE() ? el().openExternal(url) : Promise.resolve(window.open(url, '_blank', 'noopener,noreferrer'))
  },
  lastfmGetArtistInfo: (artist) => isE() ? el().lastfmGetArtistInfo(artist) : apiFetch(`/lastfm/artist/${encodeURIComponent(artist)}`),
  lastfmGetTrackInfo: (artist, track) => isE() ? el().lastfmGetTrackInfo(artist, track) : apiFetch(`/lastfm/track?${new URLSearchParams({artist, track})}`),
  lastfmGetSimilarArtists: (artist, limit) => isE() ? el().lastfmGetSimilarArtists(artist, limit) : apiFetch(`/lastfm/similar/${encodeURIComponent(artist)}?limit=${limit || 5}`),
  lastfmScrobble: (artist, track, album, duration, timestamp) => isE() ? el().lastfmScrobble(artist, track, album, duration, timestamp) : apiFetch('/lastfm/scrobble', { method:'POST', body:{artist, track, album, duration, timestamp} }),
  lastfmUpdateNowPlaying: (artist, track, album, duration) => isE() ? el().lastfmUpdateNowPlaying(artist, track, album, duration) : apiFetch('/lastfm/update-now-playing', { method:'POST', body:{artist, track, album, duration} }),
  onLastfmAuthToken: (fn) => {
    if (isE() && typeof el().onLastfmAuthToken === 'function') {
      return el().onLastfmAuthToken(fn)
    }
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'lokal-lastfm-auth-token') return
      fn(event.data.token || '')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  },
  pluginsList: () => isE() ? el().pluginsList() : apiFetch('/plugins'),
  pluginsReload: () => isE() ? el().pluginsReload() : apiFetch('/plugins/reload', { method: 'POST' }),
  pluginsEnable: (pluginId) => isE() ? el().pluginsEnable(pluginId) : apiFetch(`/plugins/${encodeURIComponent(pluginId)}/enable`, { method: 'POST' }),
  pluginsDisable: (pluginId) => isE() ? el().pluginsDisable(pluginId) : apiFetch(`/plugins/${encodeURIComponent(pluginId)}/disable`, { method: 'POST' }),
  pluginsInstallFromFolder: (sourceFolderPath) => isE() ? el().pluginsInstallFromFolder(sourceFolderPath) : apiFetch('/plugins/install-folder', { method: 'POST', body: { sourceFolderPath } }),
  pluginsRemove: (pluginId) => isE() ? el().pluginsRemove(pluginId) : apiFetch(`/plugins/${encodeURIComponent(pluginId)}`, { method: 'DELETE' }),
  onScanProgress: (fn) => { if (isE()) return el().onScanProgress(fn); return () => {} },
  onDownloadProgress: (fn) => { if (isE()) return el().onDownloadProgress(fn); return () => {} },
  getAvatarSrc: (user) => {
    if (!user) return 'fallback_nopfp.png';
    if (user.avatar_path) {
       const version = user.avatar_updated_at ? `?v=${user.avatar_updated_at}` : '';
       return isE() ? `file://${user.avatar_path}${version}` : `${BASE}/avatar/${user.id}${version}`;
    }
    return 'fallback_nopfp.png';
  },
  openLogs: () => isE() ? el().openLogs() : Promise.resolve(),
  log: (level, message) => isE() ? el().log(level, message) : console.log(`[${level}] ${message}`),
  getPerfSettings: () => isE() ? el().getPerfSettings() : Promise.resolve({ hardwareAcceleration: true, performanceMode: false }),
  savePerfSettings: (s) => isE() ? el().savePerfSettings(s) : Promise.resolve({}),
  setMediaKeyPreference: (enabled) => (isE() && typeof el().setMediaKeyPreference === 'function') ? el().setMediaKeyPreference(enabled) : Promise.resolve({ ok: false, enabled: false }),
  relaunchApp: () => isE() ? el().relaunchApp() : Promise.resolve(),
  onPerfSettings: (fn) => { if (isE()) return el().onPerfSettings(fn); return () => {} },
  updaterInstall: () => isE() ? el().updaterInstall() : Promise.resolve(),
  updaterCheck: () => isE() ? el().updaterCheck() : Promise.resolve(),
  getVersion: () => isE() ? el().getVersion() : Promise.resolve('1.0.0'),
  onUpdaterEvent: (fn) => { if (isE()) return el().onUpdaterEvent(fn); return () => {} },
  fetchMissingGenres: () => isE() ? el().fetchMissingGenres() : apiFetch('/tracks/fetch-missing-genres', { method: 'POST' }),
  setManualGenre: (data) => isE() ? el().setManualGenre(data) : apiFetch('/tracks/set-manual-genre', { method: 'POST', body: data }),
  
  updateTrack: (id, data) => isE() ? el().updateTrack(id, data) : apiFetch(`/tracks/${id}`, { method: 'PUT', body: data }),
  updateTrackArtwork: (id, imageData) => isE() ? el().updateTrackArtwork(id, imageData) : apiFetch(`/tracks/${id}/artwork`, { method: 'PUT', body: { imageData } }),
  fetchExternalArtwork: (id, title, artist) => isE() ? el().fetchExternalArtwork(id, title, artist) : apiFetch(`/tracks/${id}/fetch-external-artwork`, { method: 'POST', body: { title, artist } }),
}
