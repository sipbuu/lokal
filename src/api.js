const isE = () => {
  try {
    if (typeof window !== 'undefined' && window.electron?.isElectron === true) return true
    if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return true
  } catch {}
  return false
}
const el = () => window.electron
const BASE = '/api'

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
  getArtists: () => isE() ? el().getArtists() : apiFetch('/artists'),
  getArtist: (id) => isE() ? el().getArtist(id) : apiFetch(`/artists/${id}`),
  getAlbumTracks: (a) => isE() ? el().getAlbumTracks(a) : apiFetch(`/tracks?album=${encodeURIComponent(a)}`),
  getAllAlbums: () => isE() ? el().getAllAlbums() : apiFetch('/albums'),
  searchAlbums: (q) => isE() ? el().searchAlbums(q) : apiFetch(`/albums/search?q=${encodeURIComponent(q)}`),
  artistUpdateBio: (id, b) => isE() ? el().artistUpdateBio(id, b) : apiFetch(`/artists/${id}/bio`, { method:'PUT', body:{bio:b} }),
  artistSetImage: (id, d) => isE() ? el().artistSetImage(id, d) : apiFetch(`/artists/${id}/image`, { method:'PUT', body:{imageData:d} }),
  artistSetImageUrl: (id, url) => isE() ? el().artistSetImageUrl(id, url) : apiFetch(`/artists/${id}/image-url`, { method:'PUT', body:{url} }),
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
  getLyrics: (tid, ti, ar, al, dur) => isE() ? el().getLyrics(tid, ti, ar, al, dur) : apiFetch(`/lyrics/${tid}?${new URLSearchParams({title:ti||'',artist:ar||'',album:al||'',duration:dur||''})}`),
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
  searchYT: (q) => isE() ? el().searchYT(q) : apiFetch(`/download/search?q=${encodeURIComponent(q)}`),
  downloadYT: (url, o) => isE() ? el().downloadYT(url, o) : apiFetch('/download', { method:'POST', body:{url,...o} }),
  downloadPlaylist: (url, o) => isE() ? el().downloadPlaylist(url, o) : apiFetch('/download/playlist', { method:'POST', body:{url,...o} }),
  cancelDownload: (id) => isE() ? el().cancelDownload(id) : Promise.resolve(),
  getDownloadQueue: () => isE() ? el().getDownloadQueue() : apiFetch('/download/queue'),

  
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
  updateProfile: (d) => isE() ? el().updateProfile(d) : apiFetch(`/users/${d.userId}`, { method:'PUT', body:d }),
  getUserStats: (uid) => isE() ? el().getUserStats(uid) : apiFetch(`/users/${uid}/stats`),
  discordSetActivity: (t, p) => { if (isE() && el().discordSetActivity) return el().discordSetActivity(t, p); return Promise.resolve() },
  discordConnect: (id) => isE() ? el().discordConnect(id) : Promise.resolve(false),
  discordDisconnect: () => isE() ? el().discordDisconnect() : Promise.resolve(),
  lastfmConnect: (apiKey, apiSecret, token) => isE() ? el().lastfmConnect(apiKey, apiSecret, token) : apiFetch('/lastfm/connect', { method:'POST', body:{apiKey, apiSecret, token} }),
  lastfmGetArtistInfo: (artist) => isE() ? el().lastfmGetArtistInfo(artist) : apiFetch(`/lastfm/artist/${encodeURIComponent(artist)}`),
  lastfmGetTrackInfo: (artist, track) => isE() ? el().lastfmGetTrackInfo(artist, track) : apiFetch(`/lastfm/track?${new URLSearchParams({artist, track})}`),
  lastfmGetSimilarArtists: (artist, limit) => isE() ? el().lastfmGetSimilarArtists(artist, limit) : apiFetch(`/lastfm/similar/${encodeURIComponent(artist)}?limit=${limit || 5}`),
  lastfmScrobble: (artist, track, album, duration, timestamp) => isE() ? el().lastfmScrobble(artist, track, album, duration, timestamp) : apiFetch('/lastfm/scrobble', { method:'POST', body:{artist, track, album, duration, timestamp} }),
  lastfmUpdateNowPlaying: (artist, track, album, duration) => isE() ? el().lastfmUpdateNowPlaying(artist, track, album, duration) : apiFetch('/lastfm/update-now-playing', { method:'POST', body:{artist, track, album, duration} }),
  onScanProgress: (fn) => { if (isE()) return el().onScanProgress(fn); return () => {} },
  onDownloadProgress: (fn) => { if (isE()) return el().onDownloadProgress(fn); return () => {} },
  getAvatarSrc: (user) => {
    if (!user) return 'fallback_nopfp.png';
    if (user.avatar_path) {
       return isE() ? `file://${user.avatar_path}` : `${BASE}/avatar/${user.id}`;
    }
    return 'fallback_nopfp.png';
  },
  
  getPerfSettings: () => isE() ? el().getPerfSettings() : Promise.resolve({ hardwareAcceleration: true, performanceMode: false }),
  savePerfSettings: (s) => isE() ? el().savePerfSettings(s) : Promise.resolve({}),
  relaunchApp: () => isE() ? el().relaunchApp() : Promise.resolve(),
  onPerfSettings: (fn) => { if (isE()) return el().onPerfSettings(fn); return () => {} },
  updaterInstall: () => isE() ? el().updaterInstall() : Promise.resolve(),
  updaterCheck: () => isE() ? el().updaterCheck() : Promise.resolve(),
  getVersion: () => isE() ? el().getVersion() : Promise.resolve('1.0.0'),
  onUpdaterEvent: (fn) => { if (isE()) return el().onUpdaterEvent(fn); return () => {} },
  fetchMissingGenres: () => isE() ? el().fetchMissingGenres() : apiFetch('/tracks/fetch-missing-genres', { method: 'POST' }),
  setManualGenre: (data) => isE() ? el().setManualGenre(data) : apiFetch('/tracks/set-manual-genre', { method: 'POST', body: data }),
}
