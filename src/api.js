const isE = () => {
  try {
    if (typeof window !== 'undefined' && window.electron?.isElectron === true) return true
    if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')) return true
  } catch {}
  return false
}
const el = () => window.electron
const BASE = '/api'
const YOUTUBE_LOCAL_UNLIKES_KEY = 'lokal-youtube-local-unlikes'

function youtubeLocalUnlikes(userId = 'guest') {
  try {
    const value = JSON.parse(localStorage.getItem(YOUTUBE_LOCAL_UNLIKES_KEY) || '{}')
    if (Array.isArray(value)) return userId === 'guest' ? new Set(value.map(String)) : new Set()
    return new Set(Array.isArray(value?.[userId || 'guest']) ? value[userId || 'guest'].map(String) : [])
  } catch { return new Set() }
}

function rememberYoutubeUnlike(videoId, unlike, userId = 'guest') {
  if (!videoId) return
  const key = userId || 'guest'
  let stored = {}
  try {
    const value = JSON.parse(localStorage.getItem(YOUTUBE_LOCAL_UNLIKES_KEY) || '{}')
    stored = Array.isArray(value) ? { guest: value } : (value && typeof value === 'object' ? value : {})
  } catch {}
  const ids = new Set(Array.isArray(stored[key]) ? stored[key].map(String) : [])
  if (unlike) ids.add(String(videoId))
  else ids.delete(String(videoId))
  stored[key] = [...ids].slice(-500)
  try { localStorage.setItem(YOUTUBE_LOCAL_UNLIKES_KEY, JSON.stringify(stored)) } catch {}
}

function buildLastfmAuthUrl(apiKey) {
  const callback = isE()
    ? 'lokal://lastfm-auth'
    : `${window.location.origin}${BASE}/lastfm/callback`
  return `https://www.last.fm/api/auth/?${new URLSearchParams({ api_key: apiKey || '', cb: callback })}`
}

function electronFileURL(filePath = '') {
  if (!filePath) return ''
  const normalized = filePath.replace(/\\/g, '/')
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
    .replace(/%3A/g, ':')

  if (encoded.startsWith('//')) return `file:${encoded}`
  if (/^[A-Za-z]:/.test(encoded)) return `file:///${encoded}`
  return `file://${encoded}`
}

function normalizeProfilePayload(data = {}) {
  return {
    userId: data.userId,
    displayName: data.displayName ?? data.display_name,
    bio: data.bio ?? '',
    avatarData: data.avatarData ?? data.avatar ?? null,
  }
}

function albumTrackParams(album) {
  const data = album && typeof album === 'object'
    ? { album: album.title || album.album || '', albumArtist: album.album_artist || album.albumArtist || '' }
    : { album: album || '' }
  return new URLSearchParams(Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== '')))
}

// Web mode with API_KEY set on the server: ask for the key once, let the
// server store it as a cookie (which also covers artwork and audio), then
// reload so everything that failed without it loads.
let apiKeyPrompt = null
/** Ask once for the server's API key, store it as a cookie via /api/auth, then reload. */
function askForApiKey() {
  if (!apiKeyPrompt) {
    apiKeyPrompt = (async () => {
      let message = 'This Lokal server is protected. Enter its API key:'
      for (;;) {
        const key = window.prompt(message)
        if (!key) return false
        const res = await fetch(BASE + '/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        }).catch(() => null)
        if (res?.ok) { window.location.reload(); return true }
        if (res?.status === 403) {
          // Plain HTTP from outside the local network: retrying won't help.
          window.alert((await res.json().catch(() => ({}))).error || 'This server refused the key.')
          return false
        }
        message = 'That key was not accepted. Enter the API key:'
      }
    })()
    // Once it's settled (cancelled, refused or accepted), a later 401 can ask again.
    apiKeyPrompt.finally(() => { apiKeyPrompt = null })
  }
  return apiKeyPrompt
}

async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}))
      if (body.needsApiKey) askForApiKey()
      return { error: body.error || 'Not authorized' }
    }
    if (!res.ok) return { error: (await res.json().catch(() => ({}))).error || 'Request failed' }
    return res.json()
  } catch (e) { return { error: e.message } }
}

// The settings as last read (plus changes saved since), or null before the
// first read. Synchronous, for a page's first render.
let settingsSnapshot = null
// Bumped by every successful save: a read that started before one is older
// than the snapshot and mustn't replace it.
let settingsRevision = 0
export const peekSettings = () => settingsSnapshot

export const api = {
  get isElectron() { return isE() },
  fileURL: (path) => electronFileURL(path),
  artworkURL: (id) => `${BASE}/artwork/${encodeURIComponent(id)}`,
  // An album's cover (from getAllAlbums: the path, and the track it's from).
  // Artwork is served by track id, not by path (or album title).
  albumArtURL: (album) => {
    if (!album?.artwork_path) return null
    if (isE()) return `file://${album.artwork_path}`
    return album.artwork_track_id ? `${BASE}/artwork/${encodeURIComponent(album.artwork_track_id)}` : null
  },
  playlistCoverURL: (id) => `${BASE}/playlists/${encodeURIComponent(id)}/cover`,
  streamURL: (t) => `${BASE}/stream/${encodeURIComponent(t.id)}`,
  avatarURL: (id) => `${BASE}/avatar/${id}`,
  getTracks: (o = {}) => isE() ? el().getTracks(o) : apiFetch(`/tracks?${new URLSearchParams(o)}`),
  searchTracks: (q) => isE() ? el().searchTracks(q) : apiFetch(`/tracks/search?q=${encodeURIComponent(q)}`),
  searchLyrics: (q) => isE() ? el().searchLyrics(q) : apiFetch(`/tracks/search-lyrics?q=${encodeURIComponent(q)}`),
  toggleLike: async (tid, uid, track = null) => {
    const r = await (isE() ? el().toggleLike(tid, uid) : apiFetch(`/tracks/${tid}/like`, { method:'POST', body:{userId:uid} }))
    // The like went to the song, whichever copy was clicked: every id it goes
    // by (library copy, streamed copies) follows, so all its hearts agree.
    // Tagged with the user it was for: a late answer after switching user
    // mustn't touch the new user's hearts.
    if (r && typeof r === 'object' && Array.isArray(r.ids)) window.dispatchEvent(new CustomEvent('lokal:liked', { detail: { ids: r.ids, liked: !!r.liked, userId: uid ?? null } }))
    if (r && typeof r === 'object' && typeof r.liked === 'boolean' && track) {
      // Account-backed likes are best-effort mirrors. A local like remains
      // successful when a provider is offline or signed out.
      const youtubeId = String(track.file_path || '').match(/^ghost:\/\/youtube\/online\/([\w-]+)$/)?.[1]
      if (youtubeId) {
        rememberYoutubeUnlike(youtubeId, !r.liked, uid)
        Promise.resolve(api.youtubeSetLiked(youtubeId, r.liked)).catch(() => {})
      }
      if (track.artist && track.title) Promise.resolve(api.lastfmSetLoved(track.artist, track.title, r.liked)).catch(() => {})
    }
    return r
  },
  setLike: async (tid, uid, liked) => {
    const r = await (isE() ? el().setLike(tid, uid, liked) : apiFetch(`/tracks/${tid}/like-state`, { method:'POST', body:{userId:uid, liked:!!liked} }))
    if (r && typeof r === 'object' && Array.isArray(r.ids)) window.dispatchEvent(new CustomEvent('lokal:liked', { detail: { ids: r.ids, liked: !!r.liked, userId: uid ?? null } }))
    return r
  },
  isYoutubeLocallyUnliked: (videoId, uid) => youtubeLocalUnlikes(uid || 'guest').has(String(videoId || '')),
  getLikedTracks: (uid) => isE() ? el().getLikedTracks(uid) : apiFetch(`/tracks/liked?userId=${uid||'guest'}`),
  incrementPlayTime: (tid, uid, s) => isE() ? el().incrementPlayTime(tid, uid, s) : Promise.resolve(),
  getHistory: (uid, l) => isE() ? el().getHistory(uid, l) : apiFetch(`/tracks/history?userId=${uid||'guest'}&limit=${l||30}`),
  getSuggestions: (uid) => isE() ? el().getSuggestions(uid) : apiFetch(`/tracks/suggestions?userId=${uid||'guest'}`),
  getRelated: (tid, uid) => isE() ? el().getRelated(tid, uid) : apiFetch(`/tracks/${tid}/related?userId=${uid||'guest'}`),
  checkDuplicates: () => isE() ? el().checkDuplicates() : apiFetch('/tracks/duplicates'),
  checkPossibleDuplicates: () => isE() ? el().checkPossibleDuplicates() : apiFetch('/tracks/possible-duplicates'),
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
        sort: opts.sort || 'name',
      })}`),
  getArtist: (id) => isE() ? el().getArtist(id) : apiFetch(`/artists/${id}`),
  getAlbumTracks: (a) => isE() ? el().getAlbumTracks(a) : apiFetch(`/tracks?${albumTrackParams(a)}`),
  getAllAlbums: () => isE() ? el().getAllAlbums() : apiFetch('/albums'),
  searchAlbums: (q) => isE() ? el().searchAlbums(q) : apiFetch(`/albums/search?q=${encodeURIComponent(q)}`),
  artistUpdateBio: (id, b) => isE() ? el().artistUpdateBio(id, b) : apiFetch(`/artists/${id}/bio`, { method:'PUT', body:{bio:b} }),
  artistSetImage: (id, d) => isE() ? el().artistSetImage(id, d) : apiFetch(`/artists/${id}/image`, { method:'PUT', body:{imageData:d} }),
  artistSetImageUrl: (id, url) => isE() ? el().artistSetImageUrl(id, url) : apiFetch(`/artists/${id}/image-url`, { method:'PUT', body:{url} }),
  artistRefreshMetadata: (id, opts = {}) => isE() ? el().artistRefreshMetadata(id, opts) : apiFetch(`/artists/${id}/refresh-metadata`, { method:'POST', body: opts }),
  // Refresh every artist's bio and picture from a provider (a background job; poll its status).
  artistsRefreshAllMetadata: (opts = {}) => isE() ? el().artistsRefreshAllMetadata(opts) : apiFetch('/artists/refresh-all', { method:'POST', body: opts }),
  artistsRefreshAllStatus: () => isE() ? el().artistsRefreshAllStatus() : apiFetch('/artists/refresh-all'),
  artistsRefreshAllCancel: () => isE() ? el().artistsRefreshAllCancel() : apiFetch('/artists/refresh-all', { method:'DELETE' }),
  artistSearchMetadata: (query, opts = {}) => isE()
    ? el().artistSearchMetadata(query, opts)
    : apiFetch(`/artists/metadata/search?${new URLSearchParams({ q: query || '', source: opts.source || 'either' })}`),
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
  smartPlaylistPreview: (rules, uid) => isE() ? el().smartPlaylistPreview(rules, uid) : apiFetch('/playlists/smart-preview', { method:'POST', body:{ rules, userId: uid } }),
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
  previewExternalPlaylistImport: (payload) => isE() ? el().previewExternalPlaylistImport(payload) : apiFetch('/playlists/external-import-preview', { method:'POST', body:payload }),
  importExternalPlaylist: (payload) => isE() ? el().importExternalPlaylist(payload) : apiFetch('/playlists/external-import', { method:'POST', body:payload }),
  importExternalTrackMetadata: (payload) => isE() ? el().importExternalTrackMetadata(payload) : apiFetch('/playlists/external-import-metadata', { method:'POST', body:payload }),
  resolveGhostTrack: (ghostTrackId, targetTrackId) => isE() ? el().resolveGhostTrack(ghostTrackId, targetTrackId) : apiFetch('/playlists/resolve-ghost', { method:'POST', body:{ ghostTrackId, targetTrackId } }),
  reorderPlaylist: (pl, trackIds) => isE() ? el().reorderPlaylist(pl, trackIds) : apiFetch(`/playlists/${pl}/reorder`, { method:'PUT', body:{trackIds} }),
  getMixes: (uid) => isE() ? el().getMixes(uid) : apiFetch(`/mixes?userId=${uid||'guest'}`),
  getLyrics: (tid, ti, ar, al, dur, fp, opts = {}) => isE() ? el().getLyrics(tid, ti, ar, al, dur, fp, opts) : apiFetch(`/lyrics/${tid}?${new URLSearchParams({title:ti||'',artist:ar||'',album:al||'',duration:dur||'',filePath:fp||'',refresh:opts.refresh?'1':''})}`),
  getLyricsFrom: (providerId, tid, ti, ar, al, dur, fp) => isE() ? el().getLyricsFrom(providerId, tid, ti, ar, al, dur, fp) : apiFetch(`/lyrics/${tid}/from/${encodeURIComponent(providerId)}?${new URLSearchParams({title:ti||'',artist:ar||'',album:al||'',duration:dur||'',filePath:fp||''})}`),
  getLyricsSources: () => isE() ? el().getLyricsSources() : apiFetch('/lyrics/sources'),
  romanizeLyrics: (tid, lines) => isE() ? el().romanizeLyrics(tid, lines) : apiFetch(`/lyrics/${tid}/romanize`, { method:'POST', body:{ lines } }),
  detectLyricsLanguage: (tid, lines) => (isE() && typeof el().detectLyricsLanguage === 'function')
    ? el().detectLyricsLanguage(tid, lines)
    : apiFetch(`/lyrics/${tid}/detect-language`, { method:'POST', body:{ lines } }),
  translateLyrics: (tid, lines, targetLang = 'en') => (isE() && typeof el().translateLyrics === 'function')
    ? el().translateLyrics(tid, lines, targetLang)
    : apiFetch(`/lyrics/${tid}/translate`, { method:'POST', body:{ lines, targetLang } }),
  importLyrics: (tid, c, t, fp) => isE() ? el().importLyrics(tid, c, t, fp) : apiFetch(`/lyrics/${tid}/import`, { method:'POST', body:{content:c,type:t,filePath:fp} }),
  clearLyricsCache: (tid) => isE() ? el().clearLyricsCache(tid) : apiFetch(`/lyrics/${tid}`, { method:'DELETE' }),
  clearLyricsDb: () => isE() ? el().clearLyricsDb() : apiFetch('/lyrics/clear-all', { method:'POST' }),
  clearSongCache: () => isE() ? el().clearSongCache() : Promise.resolve({ ok: false, error: 'Electron only' }),
  // Both keep the snapshot peekSettings() hands out, so a page can paint with
  // the real settings on its first frame instead of defaults.
  getSettings: () => {
    const revision = settingsRevision
    return Promise.resolve(isE() ? el().getSettings() : apiFetch('/settings')).then(s => {
      if (s && typeof s === 'object' && !s.error && revision === settingsRevision) settingsSnapshot = s
      return s
    })
  },
  saveSettings: (s) => Promise.resolve(isE() ? el().saveSettings(s) : apiFetch('/settings', { method:'PUT', body:s })).then(r => {
    // Only what was actually saved goes into the snapshot.
    if (!r?.error && s && typeof s === 'object') {
      settingsRevision++
      if (settingsSnapshot) settingsSnapshot = { ...settingsSnapshot, ...s }
    }
    return r
  }),
  exportAllData: () => isE() ? el().exportAllData() : apiFetch('/settings/export-all'),
  importAllData: (payload) => isE() ? el().importAllData(payload) : apiFetch('/settings/import-all', { method:'POST', body: payload }),
  factoryReset: () => isE() ? el().factoryReset() : apiFetch('/settings/factory-reset', { method:'POST' }),
  clearTracks: () => isE() ? el().clearTracks() : apiFetch('/settings/clear-tracks', { method:'POST' }),
  getKeepCommaArtists: () => isE() ? el().getKeepCommaArtists() : apiFetch('/settings/keep-comma-artists'),
  setKeepCommaArtists: (artists) => isE() ? el().setKeepCommaArtists(artists) : apiFetch('/settings/keep-comma-artists', { method:'PUT', body:{artists} }),
  getTheme: () => isE() ? el().getTheme() : apiFetch('/settings/theme'),
  saveTheme: (theme, overrides) => isE() ? el().saveTheme(theme, overrides) : apiFetch('/settings/theme', { method:'PUT', body:{theme, overrides} }),
  scanFolder: (f) => isE() ? el().scanFolder(f) : apiFetch('/settings/scan', { method:'POST', body:{folder:f} }),
  resolveFileToPlay: (f) => isE() ? el().resolveFileToPlay(f) : Promise.resolve({ success: false, error: 'Electron only' }),
  onOpenFileRequest: (fn) => { if (isE() && typeof el().onOpenFileRequest === 'function') return el().onOpenFileRequest(fn); return () => {} },
  updateThumbarState: (state) => (isE() && typeof el().updateThumbarState === 'function') ? el().updateThumbarState(state) : Promise.resolve(),
  onThumbarCommand: (fn) => { if (isE() && typeof el().onThumbarCommand === 'function') return el().onThumbarCommand(fn); return () => {} },
  openFolder: () => isE() ? el().openFolder() : Promise.resolve(null),
  openFile: (f) => isE() ? el().openFile(f) : Promise.resolve(null),
  readFileBinary: (fp) => isE() ? el().readFileBinary(fp) : Promise.resolve(null),
  readFileAsDataURL: (fp) => isE() ? el().readFileAsDataURL(fp) : Promise.resolve(null),
  searchYT: (q, page = 1) => isE() ? el().searchYT(q, page) : apiFetch(`/download/search?q=${encodeURIComponent(q)}&page=${page}`),
  searchYTPaginated: (q, page = 1) => isE() ? el().searchYT(q, page) : apiFetch(`/download/search?q=${encodeURIComponent(q)}&page=${page}`),
  searchYTArtist: (artist, page = 1) => isE() ? el().searchYTArtist(artist, page) : apiFetch(`/download/artist-search?q=${encodeURIComponent(artist)}&page=${page}`),
  downloadYT: (url, o) => isE() ? el().downloadYT(url, o) : apiFetch('/download', { method:'POST', body:{url,...o} }),
  // Online results (YouTube Music 'yt', SoundCloud 'sc'), streamed with the user's yt-dlp.
  onlineSearch: (q, provider = 'yt') => isE() ? el().onlineSearch(q, provider) : apiFetch(`/online/search?${new URLSearchParams({ q, provider })}`),
  onlineSave: (items) => isE() ? el().onlineSave(items) : apiFetch('/online/save', { method:'POST', body:{ items } }),
  onlinePrepare: (provider, id, force = false) => isE() ? el().onlinePrepare(provider, id, force) : apiFetch(`/online/prepare/${encodeURIComponent(provider)}/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, { method:'POST' }),
  onlineProviders: () => isE() ? el().onlineProviders() : apiFetch('/online/providers'),
  youtubeAccount: (force = false) => isE() ? el().youtubeAccount(force) : apiFetch(`/online/account?force=${force ? '1' : '0'}`),
  youtubeAccountPlaylist: (playlistId) => isE() ? el().youtubeAccountPlaylist(playlistId) : apiFetch(`/online/account-playlist/${encodeURIComponent(playlistId)}`),
  youtubeRadio: (videoId) => isE() ? el().youtubeRadio(videoId) : apiFetch(`/online/radio/${encodeURIComponent(videoId)}`),
  youtubeSetLiked: (videoId, liked) => isE() ? el().youtubeSetLiked(videoId, liked) : apiFetch('/online/account-liked', { method: 'POST', body: { videoId, liked } }),
  onlineDownloadUrl: (provider, id) => isE() ? el().onlineDownloadUrl(provider, id) : apiFetch(`/online/download-url/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`, { method:'POST' }),
  // Addons: online sources added by manifest URL (Settings → Addons).
  addonsList: () => isE() ? el().addonsList() : apiFetch('/online/addons'),
  addonsInstall: (url) => isE() ? el().addonsInstall(url) : apiFetch('/online/addons', { method:'POST', body:{ url } }),
  addonsRemove: (key) => isE() ? el().addonsRemove(key) : apiFetch(`/online/addons/${encodeURIComponent(key)}`, { method:'DELETE' }),
  addonsSetEnabled: (key, enabled) => isE() ? el().addonsSetEnabled(key, enabled) : apiFetch(`/online/addons/${encodeURIComponent(key)}/enabled`, { method:'PUT', body:{ enabled } }),
  addonsSetSettings: (key, values) => isE() ? el().addonsSetSettings(key, values) : apiFetch(`/online/addons/${encodeURIComponent(key)}/settings`, { method:'PUT', body:{ values } }),
  onlineStreamURL: (provider, id) => isE() ? `lokal-stream://${provider}/${encodeURIComponent(id)}` : `${BASE}/online/stream/${encodeURIComponent(provider)}/${encodeURIComponent(id)}`,
  downloadPlaylist: (url, o) => isE() ? el().downloadPlaylist(url, o) : apiFetch('/download/playlist', { method:'POST', body:{url,...o} }),
  getDownloadedPlaylists: () => isE() ? el().getDownloadedPlaylists() : apiFetch('/download/playlists'),
  redownloadPlaylist: (id) => isE() ? el().redownloadPlaylist(id) : apiFetch('/download/playlist/redownload', { method:'POST', body:{playlistId:id} }),
  removeFromPlaylistArchive: (id, videoId) => isE() ? el().removeFromPlaylistArchive(id, videoId) : apiFetch('/download/playlist/remove-archive', { method:'POST', body:{playlistId:id, videoId} }),
  deleteDownloadedPlaylist: (id) => isE() ? el().deleteDownloadedPlaylist(id) : apiFetch('/download/playlist', { method:'DELETE', body:{playlistId:id} }),
  getPlaylistArchiveIds: (id) => isE() ? el().getPlaylistArchiveIds(id) : apiFetch(`/download/playlist/archive-ids?playlistId=${id}`),
  cancelDownload: (id) => isE() ? el().cancelDownload(id) : apiFetch('/download/cancel', { method:'POST', body:{id} }),
  getDownloadQueue: () => isE() ? el().getDownloadQueue() : apiFetch('/download/queue'),
  retryDownload: (id) => isE() ? el().retryDownload(id) : apiFetch('/download/retry', { method:'POST', body:{id} }),
  removeDownload: (id) => isE() ? el().removeDownload(id) : apiFetch('/download/remove', { method:'POST', body:{id} }),
  cancelAllDownloads: () => isE() ? el().cancelAllDownloads() : apiFetch('/download/cancel-all', { method:'POST', body:{} }),
  clearFinishedDownloads: () => isE() ? el().clearFinishedDownloads() : apiFetch('/download/clear-finished', { method:'POST', body:{} }),
  markDownloadsSeen: () => isE() ? el().markDownloadsSeen() : apiFetch('/download/seen', { method:'POST', body:{} }),
  artworkMesh: (trackId) => isE() ? el().artworkMesh(trackId) : apiFetch(`/artwork-fx/mesh/${encodeURIComponent(trackId)}`).then(r => (Array.isArray(r) ? r : null)),
  // { src, source } -- src is something a <video> can play in this mode.
  spotifyCanvasCheck: () => isE() ? el().spotifyCanvasCheck() : apiFetch('/artwork-fx/spotify-check', { method: 'POST' }),
  motionCover: (trackId) => isE()
    ? el().motionCover(trackId).then(r => (r?.file ? { ...r, src: `file://${r.file.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':')}` } : null))
    : apiFetch(`/artwork-fx/motion/${encodeURIComponent(trackId)}`).then(r => (r?.src ? r : null)),
  playableFile: (fp) => isE() ? el().playableFile(fp) : Promise.resolve(null),
  soulseekStatus: () => isE() ? el().soulseekStatus() : apiFetch('/download/soulseek/status'),
  soulseekSearch: (text) => isE() ? el().soulseekSearch(text) : apiFetch('/download/soulseek/search', { method:'POST', body:{ text } }),
  soulseekResults: (id) => isE() ? el().soulseekResults(id) : apiFetch(`/download/soulseek/search/${encodeURIComponent(id)}`),
  soulseekFinishSearch: (id) => isE() ? el().soulseekFinishSearch(id) : apiFetch(`/download/soulseek/search/${encodeURIComponent(id)}`, { method:'PUT' }),
  soulseekStopSearch: (id) => isE() ? el().soulseekStopSearch(id) : apiFetch(`/download/soulseek/search/${encodeURIComponent(id)}`, { method:'DELETE' }),
  soulseekDownload: (file, opts = {}) => isE() ? el().soulseekDownload(file, opts) : apiFetch('/download/soulseek/download', { method:'POST', body:{ file, ...opts } }),
  // Audio quality (codec / lossless / spectrum check) and "Get it in lossless".
  qualitySummary: () => isE() ? el().qualitySummary() : apiFetch('/quality/summary'),
  qualityList: (opts = {}) => isE() ? el().qualityList(opts) : apiFetch(`/quality/list?${new URLSearchParams(Object.entries(opts).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))}`),
  qualityStatus: () => isE() ? el().qualityStatus() : apiFetch('/quality/status'),
  qualityRead: (opts = {}) => isE() ? el().qualityRead(opts) : apiFetch('/quality/read', { method:'POST', body: opts }),
  qualityCheck: (opts = {}) => isE() ? el().qualityCheck(opts) : apiFetch('/quality/check', { method:'POST', body: opts }),
  qualityCheckOne: (trackId) => isE() ? el().qualityCheckOne(trackId) : apiFetch(`/quality/check/${encodeURIComponent(trackId)}`, { method:'POST' }),
  qualityCancel: () => isE() ? el().qualityCancel() : apiFetch('/quality/cancel', { method:'POST' }),
  qualityBuyLinks: (trackId) => isE() ? el().qualityBuyLinks(trackId) : apiFetch(`/quality/buy/${encodeURIComponent(trackId)}`),
  updaterDownload: () => isE() ? el().updaterDownload() : Promise.resolve({ error: 'Electron only' }),
  getToolsStatus: () => isE() ? el().getToolsStatus() : Promise.resolve({}),
  getYtDlpVersionStatus: () => isE() ? el().getYtDlpVersionStatus() : Promise.resolve({ found: false, error: 'Electron only' }),
  downloadYtDlp: () => isE() ? el().downloadYtDlp() : Promise.resolve({ error: 'Electron only' }),
  downloadFfmpeg: () => isE() ? el().downloadFfmpeg() : Promise.resolve({ error: 'Electron only' }),
  setCustomToolPath: (tool, path) => isE() ? el().setCustomToolPath(tool, path) : Promise.resolve({ error: 'Electron only' }),
  detectTools: () => isE() ? el().detectTools() : Promise.resolve({}),
  onToolsDownloadProgress: (fn) => { if (isE()) return el().onToolsDownloadProgress(fn); return () => {} },
  getRandomTrack: () => isE() ? el().getRandomTrack() : apiFetch('/tracks/random'),
  getTopGenres: () => isE() ? el().getTopGenres() : apiFetch('/tracks/top-genres'),
  getAllGenres: () => isE() ? el().getAllGenres() : apiFetch('/tracks/genres'),
  historyExport: (uid, format) => isE() ? el().historyExport(uid, format) : apiFetch(`/tracks/history/export?userId=${uid||'guest'}&format=${format||'json'}`),
  register: (d) => isE() ? el().register(d) : apiFetch('/users/register', { method:'POST', body:d }),
  login: (d) => isE() ? el().login(d) : apiFetch('/users/login', { method:'POST', body:d }),
  listUsers: () => isE() ? el().listUsers() : apiFetch('/users'),
  deleteUser: (userId) => isE() ? el().deleteUser(userId) : apiFetch(`/users/${userId}`, { method:'DELETE' }),
  updateProfile: async (d) => {
    const payload = normalizeProfilePayload(d)
    const result = isE()
      ? await el().updateProfile(payload)
      : await apiFetch(`/users/${payload.userId}`, { method:'PUT', body: payload })
    return result?.user || result
  },
  getUserStats: (uid) => isE() ? el().getUserStats(uid) : apiFetch(`/users/${uid}/stats`),
  getUserRecap: (uid) => isE() ? el().getUserRecap(uid) : apiFetch(`/users/${uid || 'guest'}/recap`),
  getListeningRecap: (uid, opts = {}) => isE()
    ? el().getListeningRecap(uid, opts)
    : apiFetch(`/recaps/${uid || 'guest'}?${new URLSearchParams(Object.fromEntries(Object.entries(opts || {}).filter(([, value]) => value !== undefined && value !== null)))}`),
  // One artist's or genre's songs in a recap: opts = periodQuery(period) + { artist } or { genre }.
  getRecapTracks: (uid, opts = {}) => isE()
    ? el().getRecapTracks(uid, opts)
    : apiFetch(`/recaps/${uid || 'guest'}/tracks?${new URLSearchParams(Object.fromEntries(Object.entries(opts || {}).filter(([, value]) => value !== undefined && value !== null)))}`),
  getListeningDays: (uid, opts = {}) => isE() ? el().getListeningDays(uid, opts) : apiFetch(`/recaps/${uid || 'guest'}/days?${new URLSearchParams(Object.fromEntries(Object.entries(opts || {}).filter(([, value]) => value !== undefined && value !== null)))}`),
  getListeningPreferences: (uid) => isE() ? el().getListeningPreferences(uid) : apiFetch(`/recaps/${uid || 'guest'}/preferences`),
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
  lastfmDiscovery: (page = 0) => isE() ? el().lastfmDiscovery(page) : apiFetch(`/lastfm/discovery?page=${encodeURIComponent(page)}`),
  lastfmSimilar: (artist, track, limit = 24) => isE() ? el().lastfmSimilar(artist, track, limit) : apiFetch(`/lastfm/similar-music?${new URLSearchParams({ artist, ...(track ? { track } : {}), limit: String(limit) })}`),
  lastfmLoved: (page) => isE() ? el().lastfmLoved(page) : apiFetch(`/lastfm/loved${page ? `?page=${encodeURIComponent(page)}` : ''}`),
  lastfmSetLoved: (artist, track, loved) => isE() ? el().lastfmSetLoved(artist, track, loved) : apiFetch('/lastfm/loved', { method:'POST', body:{ artist, track, loved } }),
  lastfmSyncLikes: (uid, page) => isE() ? el().lastfmSyncLikes(uid || 'guest', page) : apiFetch('/lastfm/sync-likes', { method:'POST', body:{ userId: uid || 'guest', page } }),
  listenbrainzStatus: () => isE() ? el().listenbrainzStatus() : apiFetch('/listenbrainz/status'),
  listenbrainzConnect: (token) => isE() ? el().listenbrainzConnect(token) : apiFetch('/listenbrainz/connect', { method: 'POST', body: { token } }),
  listenbrainzDisconnect: () => isE() ? el().listenbrainzDisconnect() : apiFetch('/listenbrainz/disconnect', { method: 'POST' }),
  listenbrainzSetEnabled: (enabled) => isE() ? el().listenbrainzSetEnabled(enabled) : apiFetch('/listenbrainz/enabled', { method: 'POST', body: { enabled } }),
  listenbrainzNowPlaying: (track) => isE() ? el().listenbrainzNowPlaying(track) : apiFetch('/listenbrainz/now-playing', { method: 'POST', body: { track } }),
  listenbrainzSubmit: (track, listenedAt) => isE() ? el().listenbrainzSubmit(track, listenedAt) : apiFetch('/listenbrainz/submit', { method: 'POST', body: { track, listenedAt } }),
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
  batchUpdateTracks: (trackIds, operations) => isE() ? el().batchUpdateTracks(trackIds, operations) : apiFetch('/tracks/batch-update', { method: 'POST', body: { trackIds, operations } }),
  updateTrackArtwork: (id, imageData) => isE() ? el().updateTrackArtwork(id, imageData) : apiFetch(`/tracks/${id}/artwork`, { method: 'PUT', body: { imageData } }),
  fetchExternalArtwork: (id, title, artist) => isE() ? el().fetchExternalArtwork(id, title, artist) : apiFetch(`/tracks/${id}/fetch-external-artwork`, { method: 'POST', body: { title, artist } }),
}
