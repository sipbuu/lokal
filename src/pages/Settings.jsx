import OutputPrecisionSettings from '../components/OutputPrecisionSettings'
﻿import React, { useEffect, useLayoutEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { Info, Tags, FolderOpen, RefreshCw, Trash2, AlertTriangle, Link, CheckCircle, Disc3, Zap, Download, Music2, X, MoreHorizontal, ListMusic, Palette, ChevronDown, ChevronUp, RefreshCcw, Image as ImageIcon, Blocks } from 'lucide-react'
import { api, peekSettings } from '../api'
import { FORMATS, MP3_BITRATES, savedFormat } from '../downloadLinks'
import { peekCache, writeCache, usePageReady } from '../pageCache'
import SectionSwap, { ReadyWhen } from '../components/SectionSwap'
import AddonsSettings from '../components/AddonsSettings'
import ProviderConnections from '../components/ProviderConnections'
import { DEFAULT_DISCORD_CLIENT_ID } from '../discord'
import PlaybackSourceSettings from '../components/PlaybackSourceSettings'
import { useAppStore, usePlayerStore } from '../store/player'
import Modal from '../components/Modal'
import LyricsSourcesSettings from '../components/LyricsSourcesSettings'
import { THEMES, ACCENT_COLORS, applyTheme } from '../theme'
import { useTheme } from '../themeHooks'
import { ARTIST_SOURCES } from '../artistSources'
import { repairMissingTracks } from '../ghostDownloads'
import { plural } from '../plural'
import { readCrossfadeSettings, CROSSFADE_MIN_S } from '../audio/crossfade'

const EQ_BANDS = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz']
const EQ_PRESETS = {
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bassBoost: { label: 'Bass Boost', gains: [5, 4.5, 3, 1.5, 0.5, 0, -0.5, -1, -1.5, -2] },
  vocalBoost: { label: 'Vocal Boost', gains: [-1.5, -1, -0.5, 0.5, 1.5, 3, 3.5, 2.5, 1, 0] },
  bright: { label: 'Bright', gains: [-1, -0.5, 0, 0.5, 1, 1.5, 2.5, 3, 3.5, 3] },
  electronic: { label: 'Electronic', gains: [4, 3, 1, 0, -1, 1, 2, 3, 4, 4.5] },
  mellow: { label: 'Mellow', gains: [1.5, 1, 0.5, 0, -0.5, -1, -0.5, 0.5, 1, 1.5] },
}
const DEFAULT_EQ_PRESET = 'flat'
const LASTFM_STATUS_KEY = 'lokal-lastfm-status-feed'
const SETTINGS_CATEGORIES = [
  { key: 'library', label: 'Library', icon: Music2 },
  { key: 'playback', label: 'Playback', icon: Disc3 },
  { key: 'integrations', label: 'Integrations', icon: Zap },
  { key: 'addons', label: 'Addons', icon: Blocks },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'data', label: 'Data', icon: Download },
  { key: 'about', label: 'About', icon: Info },
]
// Tabs that were folded into others: a link to one opens where it went.
const MOVED_CATEGORIES = { artists: 'library', plugins: 'addons' }

const TRANSLATION_LANGUAGES = [
  ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'],
  ['nl', 'Nederlands'], ['pl', 'Polski'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['uk', 'Українська'], ['ar', 'العربية'],
  ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['ja', '日本語'], ['ko', '한국어'],
  ['zh-CN', '中文（简体）'], ['zh-TW', '中文（繁體）'], ['sv', 'Svenska'], ['el', 'Ελληνικά'], ['he', 'עברית'], ['sw', 'Kiswahili'],
]

// Each section (heading + card) keeps a readable width and sits centred in
// the page, so on a wide or full-screen window the cards don't stretch edge
// to edge. The page header and category tabs above still span the width.
function Section({ title, children }) {
  return (
    <div className="space-y-3 w-full max-w-2xl mx-auto">
      <h2 className="text-xs font-display text-muted uppercase tracking-widest">{title}</h2>
      <div className="bg-elevated border border-border rounded-xl p-5 space-y-5">{children}</div>
    </div>
  )
}
/** 1536 -> "1.5 KB" */
function fmtBytes(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

// `stacked`: the control goes under the text, full width (a wide control
// beside it would squeeze the description into a narrow column).
function Row({ label, desc, children, stacked = false }) {
  return (
    <div className={stacked ? 'space-y-3' : 'flex items-center justify-between gap-6'}>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white font-medium">{label}</p>
        {desc && <p className="text-xs text-muted mt-0.5 leading-relaxed whitespace-pre-line">{desc}</p>}
      </div>
      <div className={stacked ? '' : 'flex-shrink-0'}>{children}</div>
    </div>
  )
}

function ThreeDotsMenu({ items = [], align = 'right' }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="p-1.5 rounded-full hover:bg-card text-muted hover:text-white transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      
      {open && (
        <div className={`absolute z-50 mt-1 min-w-40 bg-elevated border border-border rounded-lg shadow-xl py-1 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {items.map((item, i) => (
            item.divider ? (
              <div key={i} className="h-px bg-border my-1" />
            ) : (
              <button
                key={i}
                onClick={() => { item.onClick?.(); setOpen(false) }}
                disabled={item.disabled}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
                  item.danger 
                    ? 'text-red-400 hover:bg-red-500/10' 
                    : 'text-muted hover:text-white hover:bg-card'
                } ${item.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {item.icon}
                {item.label}
              </button>
            )
          ))}
        </div>
      )}
    </div>
  )
}

function normalizeEqGains(values) {
  const safeValues = Array.isArray(values) ? values.map(v => Number(v) || 0) : []
  if (safeValues.length === EQ_BANDS.length) {
    return safeValues.slice(0, EQ_BANDS.length)
  }
  if (safeValues.length === 5) {
    return [safeValues[0], safeValues[0], safeValues[1], safeValues[1], safeValues[2], safeValues[2], safeValues[3], safeValues[3], safeValues[4], safeValues[4]]
  }
  return EQ_BANDS.map((_, i) => safeValues[i] || 0)
}

function getEqPresetKey(gains) {
  const normalized = normalizeEqGains(gains)
  const match = Object.entries(EQ_PRESETS).find(([, preset]) =>
    preset.gains.length === normalized.length && preset.gains.every((value, index) => value === normalized[index])
  )
  return match?.[0] || 'custom'
}

// The Side Panels toggle saves on every click rather than waiting for the
// "Save Settings" button, so a quick double-click could otherwise fire two
// overlapping requests and let the first one's response land after the
// second's, leaving the backend on the stale value. Chaining each save onto
// the previous one's settled promise keeps them applied in click order;
// sidePanelsSaveSeq lets only the most recent attempt update the error
// indicator, so a failure that's since been superseded by a successful
// retry doesn't leave a stale error showing.
//
// Deliberately module scope, not useRef: Settings can unmount and remount
// (it's a route, not a singleton), and a useRef resets on every mount --
// which meant a save still in flight from before an unmount could land
// after the remount initialized a fresh, unrelated chain/seq pair, letting
// it race a save started post-remount exactly the way the chaining above is
// meant to prevent. A module-level binding persists across mounts, so the
// chain and sequence counter stay continuous for the life of the app.
let sidePanelsSaveChain = Promise.resolve()
let sidePanelsSaveSeq = 0

// Settings save as they change. Each change saves only its own keys (saving
// the whole page's copy used to write back stale values -- e.g. the theme it
// loaded when opened, undoing a theme picked since). Changes within a short
// pause are batched, so typing isn't a save per keystroke, and saves are
// chained so they land in order. Module scope, like the chain above, so a
// save still pending when Settings closes isn't lost or reordered.
let settingsSaveChain = Promise.resolve()
let pendingSettings = {}
let pendingSettingsTimer = null
const settingsSaveListeners = new Set()
const notifySettingsSave = (state) => settingsSaveListeners.forEach(fn => fn(state))

function flushSettings() {
  clearTimeout(pendingSettingsTimer)
  pendingSettingsTimer = null
  const patch = pendingSettings
  if (!Object.keys(patch).length) return settingsSaveChain
  pendingSettings = {}
  notifySettingsSave('saving')
  settingsSaveChain = settingsSaveChain
    .catch(() => {})
    .then(() => api.saveSettings(patch))
    .then(r => {
      if (r?.error) throw new Error(r.error)
      // Mounted panels (sidebar lyrics, now playing...) re-read their settings.
      window.dispatchEvent(new Event('lokal:settings-saved'))
      if (!Object.keys(pendingSettings).length) notifySettingsSave('saved')
    })
    .catch(e => {
      // Keep what failed so "Retry" (or the next change) sends it again,
      // without overwriting anything changed since.
      pendingSettings = { ...patch, ...pendingSettings }
      notifySettingsSave({ error: e?.message || 'Save failed' })
    })
  return settingsSaveChain
}

function queueSettings(patch, delay = 400) {
  pendingSettings = { ...pendingSettings, ...patch }
  clearTimeout(pendingSettingsTimer)
  pendingSettingsTimer = setTimeout(flushSettings, delay)
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { flushSettings() })

/** Settings as the page shows them: the Discord fields get their defaults. */
function withSettingDefaults(s) {
  return {
    ...(s || {}),
    discord_use_default_app_id: s?.discord_use_default_app_id ?? '1',
    discord_client_id: s?.discord_client_id || DEFAULT_DISCORD_CLIENT_ID,
    discord_auto_connect: s?.discord_auto_connect ?? '0',
  }
}

export default function Settings() {
  const location = useLocation()
  // Seeded from the settings already read (and the version / tools found on
  // the last visit), so the first frame already has the real values: rows
  // used to appear, change text and push everything below them down.
  const [settings, setSettings] = useState(() => (peekSettings() ? withSettingDefaults(peekSettings()) : {}))
  const [settingsLoaded, setSettingsLoaded] = useState(() => !!peekSettings())
  const touchedSettingsRef = useRef(new Set())
  const [settingsLoadError, setSettingsLoadError] = useState('')
  // null | 'saving' | 'saved' | { error }
  const [saveState, setSaveState] = useState(null)
  useEffect(() => {
    let hide = null
    const listener = (state) => {
      clearTimeout(hide)
      setSaveState(state)
      if (state === 'saved') hide = setTimeout(() => setSaveState(null), 1800)
    }
    settingsSaveListeners.add(listener)
    return () => {
      settingsSaveListeners.delete(listener)
      clearTimeout(hide)
      flushSettings() // leaving Settings: send anything still waiting now
    }
  }, [])
  const [scanning, setScanning] = useState(false)
  const [showGenreModal, setShowGenreModal] = useState(false)
  const [eqGains, setEqGains] = useState(EQ_PRESETS[DEFAULT_EQ_PRESET].gains)
  const [eqPreset, setEqPreset] = useState(DEFAULT_EQ_PRESET)
  const [showClearModal, setShowClearModal] = useState(false)
  // Lists a category loads are kept for the next visit, so switching back to
  // it shows them at once (and refreshes them quietly).
  const [dups, setDups] = useState(null)
  const [showDups, setShowDups] = useState(false)
  const [possibleDups, setPossibleDups] = useState(null)
  const [showPossibleDups, setShowPossibleDups] = useState(false)
  const [duplicateMessage, setDuplicateMessage] = useState('')
  const [mergingDuplicate, setMergingDuplicate] = useState(false)
  const [mergingAll, setMergingAll] = useState(false)
  const [mergeAllResult, setMergeAllResult] = useState(null)
  const [showMergeAllConfirm, setShowMergeAllConfirm] = useState(false)
  const [deduplicatePlaylists, setDeduplicatePlaylists] = useState([])
  const [deduplicatePlaylistId, setDeduplicatePlaylistId] = useState('')
  const [deduplicatingPlaylist, setDeduplicatingPlaylist] = useState(false)
  const [deduplicateResult, setDeduplicateResult] = useState('')
  const [keepCommaArtists, setKeepCommaArtists] = useState([])
  const [commaInput, setCommaInput] = useState('')
  const [showCommaModal, setShowCommaModal] = useState(false)
  const [exportingHistory, setExportingHistory] = useState(false)
  const [historyExported, setHistoryExported] = useState(false)
  const [exportingAllData, setExportingAllData] = useState(false)
  const [fullExported, setFullExported] = useState(false)
  const [importingAllData, setImportingAllData] = useState(false)
  const [importPreview, setImportPreview] = useState(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [appUsers, setAppUsers] = useState(() => peekCache('settings:users') || [])
  const [usersLoading, setUsersLoading] = useState(false)
  // A users request has answered (or failed): the Data category can show.
  const [usersTried, setUsersTried] = useState(() => peekCache('settings:users') !== undefined)
  const [accountStatus, setAccountStatus] = useState('')
  const [userToDelete, setUserToDelete] = useState(null)
  const [showFactoryResetModal, setShowFactoryResetModal] = useState(false)
  const [showFactoryResetConfirmModal, setShowFactoryResetConfirmModal] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetConfirmArmed, setResetConfirmArmed] = useState(false)
  const [factoryResetting, setFactoryResetting] = useState(false)
  const [toolsStatus, setToolsStatusState] = useState(() => peekCache('settings:tools') || null)
  const setToolsStatus = (status) => { writeCache('settings:tools', status); setToolsStatusState(status) }
  const [toolsLoading, setToolsLoading] = useState(false)
  const [soulseekCheck, setSoulseekCheck] = useState(null)
  const testSoulseek = async () => {
    setSoulseekCheck({ loading: true })
    await api.saveSettings({
      soulseek_url: settings.soulseek_url || 'http://localhost:5030',
      soulseek_api_key: settings.soulseek_api_key || '',
      soulseek_downloads_dir: settings.soulseek_downloads_dir || '',
    })
    const status = await api.soulseekStatus().catch(e => ({ error: e.message }))
    setSoulseekCheck(status || { error: 'No answer' })
  }
  // ListenBrainz: its token is saved only once ListenBrainz confirms it.
  const [lbStatus, setLbStatus] = useState(null)
  const [cacheInfo, setCacheInfo] = useState(null) // { motion, playback, musicVideo, web, limit, limits } | { busy }
  const refreshCache = () => { Promise.resolve(api.cacheUsage?.()).then(info => { if (info && !info.error) setCacheInfo(info) }).catch(() => {}) }
  const setCacheLimit = async (mb) => {
    await Promise.resolve(api.saveSettings({ cache_limit_mb: String(mb) })).catch(() => {})
    setSettings(prev => ({ ...prev, cache_limit_mb: String(mb) }))
    const info = await Promise.resolve(api.cacheTrim?.()).catch(() => null)
    if (info && !info.error) setCacheInfo(info)
  }
  const clearCache = async () => {
    setCacheInfo(info => ({ ...info, busy: true }))
    const info = await Promise.resolve(api.cacheClear?.()).catch(() => null)
    if (info && !info.error) setCacheInfo(info)
    else setCacheInfo(prev => ({ ...prev, busy: false }))
  }
  /** Reload the ListenBrainz connection status. */
  const refreshListenBrainz = () => { Promise.resolve(api.listenbrainzStatus?.()).then(s => { if (s && !s.error) setLbStatus(s) }).catch(() => {}) }
  const [spotifyCheck, setSpotifyCheck] = useState(null)
  const testSpotifyCanvas = async () => {
    setSpotifyCheck({ loading: true })
    try {
      const saved = await api.saveSettings({ spotify_sp_dc: settings.spotify_sp_dc || '' })
      if (saved?.error) { setSpotifyCheck({ error: `Couldn't save the cookie: ${saved.error}` }); return }
      // Never leave the button on "Checking...": give up after a minute.
      const status = await Promise.race([
        api.spotifyCanvasCheck(),
        new Promise(resolve => setTimeout(() => resolve({ error: 'No answer from Spotify after a minute. Try again, or check your connection.' }), 60000)),
      ])
      setSpotifyCheck(status || { error: 'No answer' })
      window.dispatchEvent(new Event('lokal:settings-saved'))
    } catch (e) {
      setSpotifyCheck({ error: e.message || 'Could not reach Spotify' })
    }
  }
  // Live progress of a yt-dlp / ffmpeg download, so the button doesn't look stuck.
  const [toolProgress, setToolProgress] = useState({})
  useEffect(() => api.onToolsDownloadProgress((_, p) => {
    if (!p?.tool) return
    setToolProgress(prev => ({ ...prev, [p.tool]: p.status === 'done' || p.status === 'error' ? null : p }))
  }), [])
  const progressLabel = (tool) => {
    const p = toolProgress[tool]
    if (!p) return 'Downloading...'
    if (p.status === 'installing') return 'Installing...'
    return Number.isFinite(p.percent) ? `Downloading ${p.percent}%` : 'Downloading...'
  }
  const [toolsError, setToolsError] = useState('')
  const [toolsErrorTool, setToolsErrorTool] = useState(null)
  const [showPlatformImportGuide, setShowPlatformImportGuide] = useState(false)
  const [platformImportPlatform, setPlatformImportPlatform] = useState('spotify')
  const [platformImportFileName, setPlatformImportFileName] = useState('')
  const [platformImportFileContent, setPlatformImportFileContent] = useState('')
  const [platformImportFileType, setPlatformImportFileType] = useState('csv')
  const [platformImportFiles, setPlatformImportFiles] = useState([])
  const [platformImportPreview, setPlatformImportPreview] = useState(null)
  const [platformImportStatus, setPlatformImportStatus] = useState('')
  const [platformImporting, setPlatformImporting] = useState(false)
  // hardwareAcceleration is what the next launch uses; running is what this
  // launch started with (main only applies it at startup).
  const [perfSettings, setPerfSettings] = useState({ hardwareAcceleration: true, performanceMode: false, platform: null, running: null })
  const [perfSaveError, setPerfSaveError] = useState(null) // { key, message }
  const [sidePanelsSaveError, setSidePanelsSaveError] = useState(false)
  // sidePanelsSaveChain/sidePanelsSaveSeq (module scope, below) serialize
  // the Side Panels toggle's saves -- see their declaration for why this
  // can't be a useRef here.
  const [appVersion, setAppVersionState] = useState(() => peekCache('settings:version') || '')
  const setAppVersion = (version) => { writeCache('settings:version', version); setAppVersionState(version) }
  usePageReady(settingsLoaded && (!api.isElectron || (!!appVersion && !!toolsStatus)))
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  // Fill In Genres runs in the background; its progress, read every few seconds while it runs.
  const [genreJob, setGenreJob] = useState(null)
  const [missingRepairJob, setMissingRepairJob] = useState(null)
  const [lyricsIndexJob, setLyricsIndexJob] = useState(null)
  useEffect(() => {
    const offLyrics = api.onLyricsIndexProgress?.(p => setLyricsIndexJob(p))
    return () => { offLyrics?.() }
  }, [])
  const indexAllLyrics = () => {
    if (lyricsIndexJob?.running) { api.cancelLyricsIndex?.(); return }
    setLyricsIndexJob({ running: true, done: 0, total: 0, found: 0 })
    Promise.resolve(api.indexAllLyrics?.()).catch(() => setLyricsIndexJob(null))
  }
  const indexText = (job, what) => job?.running
    ? `${job.done || 0} of ${job.total || '…'} songs · ${job.found || 0} ${what} found${job.title ? ` · ${job.title}` : ''}`
    : job ? `Done: ${job.found || 0} ${what} found for ${job.done || 0} songs${job.cancelled ? ' (stopped)' : ''}` : ''
  useEffect(() => {
    let timer = null
    let active = true
    const poll = async () => {
      const status = await Promise.resolve(api.genresStatus?.()).catch(() => null)
      if (!active || !status) return
      setGenreJob(current => ({ ...status, started: current?.started }))
      if (status.running) timer = setTimeout(poll, 2500)
    }
    if (genreJob?.running) timer = setTimeout(poll, 2500)
    else if (genreJob === null) poll()
    return () => { active = false; clearTimeout(timer) }
  }, [genreJob?.running]) // eslint-disable-line react-hooks/exhaustive-deps
  const fillGenres = async () => {
    const status = await Promise.resolve(api.fetchMissingGenres()).catch(e => ({ error: e?.message || 'Could not start' }))
    setGenreJob(status?.error ? { error: status.error } : { ...status, started: true })
  }
  const genreText = genreJob?.error ? genreJob.error
    : genreJob?.running ? `Looking up… ${genreJob.done} of ${genreJob.total} albums and songs · ${genreJob.updated} songs filled in`
      : genreJob?.total ? `Done: ${genreJob.updated} of ${genreJob.songs} songs filled in. Songs iTunes doesn't know stay empty.`
        : genreJob?.started ? 'Every song already has a genre.' : ''
  const loadMissingTracks = async () => {
    const rows = await Promise.resolve(api.getMissingTracks?.()).catch(() => null)
    return Array.isArray(rows) ? rows : []
  }
  useEffect(() => {
    loadMissingTracks().then(rows => setMissingRepairJob(current => ({ ...(current || {}), missing: rows.length })))
  }, [])
  const repairMissingLibraryFiles = async () => {
    if (missingRepairJob?.running) return
    const rows = await loadMissingTracks()
    if (!rows.length) {
      setMissingRepairJob({ missing: 0, message: 'No missing downloaded files found.' })
      return
    }
    setMissingRepairJob({ missing: rows.length, running: true, done: 0, queued: 0, unsupported: 0, failed: 0 })
    const result = await repairMissingTracks(rows, {
      onProgress: ({ done, total }) => setMissingRepairJob(current => ({ ...current, running: true, done, total })),
    })
    const remaining = await loadMissingTracks()
    const summaryParts = []
    if (result.queued) summaryParts.push('Queued ' + result.queued + ' redownload' + (result.queued === 1 ? '' : 's'))
    if (result.unsupported) summaryParts.push(result.unsupported + ' need manual matching')
    if (result.failed) summaryParts.push(result.failed + ' could not be queued')
    if (result.cancelled) summaryParts.push('repair stopped')
    const message = summaryParts.join('; ') || (remaining.length ? remaining.length + ' files still missing.' : 'All missing downloads were queued for repair.')
    setMissingRepairJob({ missing: remaining.length, done: result.total, total: result.total, queued: result.queued, unsupported: result.unsupported, failed: result.failed, cancelled: result.cancelled, message })
    window.dispatchEvent(new Event('lokal:refresh'))
  }
  const missingRepairText = missingRepairJob?.running
    ? `Queuing ${missingRepairJob.done || 0} of ${missingRepairJob.total || missingRepairJob.missing || 0} missing downloads…`
    : missingRepairJob?.message
      || (missingRepairJob?.missing ? `${missingRepairJob.missing} downloaded file${missingRepairJob.missing === 1 ? '' : 's'} missing.` : 'No missing downloaded files detected.')
  const [manualGenreArtist, setManualGenreArtist] = useState('')
  const [bgImage, setBgImage] = useState(null)
  const [manualGenreTrack, setManualGenreTrack] = useState('')
  const [manualGenreAlbum, setManualGenreAlbum] = useState('')
  const [manualGenreValue, setManualGenreValue] = useState('')
  const [activeCategory, setActiveCategory] = useState(() => {
    const requested = MOVED_CATEGORIES[location.state?.category] || location.state?.category
    return SETTINGS_CATEGORIES.some(category => category.key === requested) ? requested : 'library'
  })
  useEffect(() => {
    const requested = MOVED_CATEGORIES[location.state?.category] || location.state?.category
    if (SETTINGS_CATEGORIES.some(category => category.key === requested)) setActiveCategory(requested)
  }, [location.state?.category])
  // Load the ListenBrainz connection state when Integrations is opened.
  useEffect(() => { if (activeCategory === 'integrations') refreshListenBrainz() }, [activeCategory]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeCategory === 'data' && api.isElectron) refreshCache() }, [activeCategory]) // eslint-disable-line react-hooks/exhaustive-deps
  // Every category shares the page's one scroll container (App's <main>), so
  // switching from halfway down a long category used to land halfway down
  // the next one. Start each category at the top; layout effect so the new
  // content never paints at the old offset first.
  const rootRef = useRef(null)
  const firstCategoryRef = useRef(true)
  useLayoutEffect(() => {
    if (firstCategoryRef.current) { firstCategoryRef.current = false; return }
    const scroller = rootRef.current?.closest('main')
    if (scroller) scroller.scrollTop = 0
  }, [activeCategory])

  
  const { openAlbums, user, logout } = useAppStore()
  const setExclusiveSidePanels = usePlayerStore(s => s.setExclusiveSidePanels)
  const autoOpenSidePanel = usePlayerStore(s => s.autoOpenSidePanel)
  const setAutoOpenSidePanel = usePlayerStore(s => s.setAutoOpenSidePanel)
  const hydrateAutoOpenSidePanel = usePlayerStore(s => s.hydrateAutoOpenSidePanel)
  const hydrateExclusiveSidePanels = usePlayerStore(s => s.hydrateExclusiveSidePanels)
  const exclusiveSidePanels = usePlayerStore(s => s.exclusiveSidePanels)
  const fileInputRef = useRef(null)
  const { themeName, themeOverrides, showAdvanced, setShowAdvanced, selectTheme, setAccent, saveOverride, saveOverrides, resetTheme, textScale, setTextScale } = useTheme()

  useEffect(() => {
    if (activeCategory !== 'library') return
    let live = true
    api.getPlaylists(user?.id).then(result => {
      if (!live || !Array.isArray(result)) return
      const regular = result.filter(playlist => !playlist.smart_rules)
      setDeduplicatePlaylists(regular)
      setDeduplicatePlaylistId(current => regular.some(playlist => String(playlist.id) === String(current)) ? current : String(regular[0]?.id || ''))
    }).catch(() => { if (live) setDeduplicatePlaylists([]) })
    return () => { live = false }
  }, [activeCategory, user?.id])

  useEffect(() => {

    api.getSettings().then(s => {
      if (!s || s.error) {
        // Keep the settings already shown; say the read failed.
        setSettingsLoadError(s?.error || 'No answer')
        setSettingsLoaded(true)
        return
      }
      setSettingsLoadError('')
      // A seeded page is live at once: keep what was changed while this loaded.
      setSettings(prev => {
        const next = withSettingDefaults(s)
        for (const key of touchedSettingsRef.current) next[key] = prev[key]
        return next
      })
      setSettingsLoaded(true)
      // Keep the player store's live `exclusiveSidePanels` in sync with the
      // backend-persisted value on load -- it was previously seeded only
      // from localStorage, so a value saved from another install/profile
      // (or a cleared localStorage) could silently disagree with what
      // Settings displays here until the toggle was clicked again. Uses
      // the hydrate (not set) action, which is a no-op once the user has
      // already made their own live choice this session, so this response
      // -- which can resolve after a selection the user already made
      // while it was loading -- can never overwrite a fresher choice.
      hydrateExclusiveSidePanels(s?.exclusive_side_panels !== '0')
      // Same for "Open the Side Panel on Play": the store ignores it once
      // the switch was clicked this session, on this page or a later one.
      if (s?.auto_open_side_panel === '0' || s?.auto_open_side_panel === '1') {
        hydrateAutoOpenSidePanel(s.auto_open_side_panel === '1')
      }
    }).catch(e => {
      setSettingsLoadError(e?.message || 'No answer')
      setSettingsLoaded(true)
    })

    api.getKeepCommaArtists().then(a => {

      const defaults = ['Tyler, The Creator', 'Earth, Wind & Fire']

      const combined = [...defaults, ...(a || [])]

      setKeepCommaArtists(combined)

      setCommaInput(combined.join('\n'))

    })

    try {
      const nextEq = normalizeEqGains(JSON.parse(localStorage.getItem('lokal-eq') || '[]'))
      setEqGains(nextEq)
      setEqPreset(getEqPresetKey(nextEq))
    } catch {}

    if (api.isElectron) {

      api.getToolsStatus().then(setToolsStatus)
      api.getVersion().then(v => setAppVersion(v || '1.0.0'))

      api.getPerfSettings().then(s => { if (s) setPerfSettings(p => ({ ...p, ...s })) }).catch(() => {})
    }


  }, []) 

  const loadUsers = async () => {
    setUsersLoading(true)
    try {
      const result = await api.listUsers()
      if (Array.isArray(result)) {
        writeCache('settings:users', result)
        setAppUsers(result)
      }
    } catch {
      // Keeps the accounts already shown.
    } finally {
      setUsersLoading(false)
      setUsersTried(true)
    }
  }

  useEffect(() => {
    if (activeCategory === 'data') {
      loadUsers()
    }
  }, [activeCategory])

  useEffect(() => {
    if (themeOverrides['--bg-image']) {
      const match = themeOverrides['--bg-image'].match(/url\(['"]?(.+?)['"]?\)/)
      if (match) setBgImage(match[1])
    } else {
      setBgImage(null)
    }
  }, [themeOverrides])

  const checkForUpdates = async () => {
    if (!api.isElectron) return
    setCheckingUpdate(true)
    setUpdateCheckResult('')
    try {
      const result = await api.updaterCheck()
      if (result?.nightly) {
        // Nightlies aren't offered the stable release; they update by hand.
        setUpdateCheckResult('')
        setCheckingUpdate(false)
        api.openExternal('https://github.com/sipbuu/lokal/releases')
        return
      }
      setUpdateCheckResult('Checking for updates...')
      setTimeout(() => {
        setUpdateCheckResult('')
        setCheckingUpdate(false)
      }, 5000)
    } catch (e) {
      setUpdateCheckResult('Error checking for updates')
      setCheckingUpdate(false)
    }
  }

  // Saves one performance field. On failure only that field (and its error)
  // changes, so overlapping saves of the two fields can't undo each other.
  const savePerfField = async (key, value) => {
    const before = perfSettings[key]
    setPerfSettings(p => ({ ...p, [key]: value }))
    setPerfSaveError(err => (err?.key === key ? null : err))
    try {
      const res = await api.savePerfSettings({ [key]: value })
      if (res?.error) throw new Error(res.error)
    } catch (e) {
      setPerfSettings(p => ({ ...p, [key]: before }))
      setPerfSaveError({ key, message: e.message || 'unknown error' })
    }
  }
  const setHardwareAcceleration = (on) => savePerfField('hardwareAcceleration', on)
  const perfRestartNeeded = !!perfSettings.running && perfSettings.running.hardwareAcceleration !== perfSettings.hardwareAcceleration

  // Every change saves itself (see queueSettings above).
  const set = (k, v) => {
    touchedSettingsRef.current.add(k)
    setSettings(s => ({ ...s, [k]: v }))
    queueSettings({ [k]: v })
    if (k.startsWith('crossfade_')) usePlayerStore.getState().setCrossfadeOptions(readCrossfadeSettings({ ...settings, [k]: v }))
  }
  const crossfade = readCrossfadeSettings(settings)

  const applyEqGains = (nextGains, presetKey = getEqPresetKey(nextGains)) => {
    const normalized = normalizeEqGains(nextGains)
    setEqGains(normalized)
    setEqPreset(presetKey)
    try {
      localStorage.setItem('lokal-eq', JSON.stringify(normalized))
      localStorage.setItem('lokal-eq-preset', presetKey)
    } catch {}
    window.__lokalInitAudio?.()
    normalized.forEach((gain, index) => {
      window.__lokaleq?.setGain(index, gain)
    })
  }

  const setEQ = (i, v) => {
    const next = [...eqGains]
    next[i] = v
    applyEqGains(next)
  }

  const rescan = async () => {
    if (!settings.music_folder) return
    setScanning(true)
    await api.scanFolder(settings.music_folder)
    setScanning(false)
  }

  const checkDuplicates = async () => {
    setDuplicateMessage('')
    const d = await api.checkDuplicates()
    setDups(Array.isArray(d) ? d : [])
    setShowDups(true)
  }

  const mergeDup = async (group) => {
    const ids = group.ids.split(',')
    const keepId = ids[0]
    const removeIds = ids.slice(1)
    if (mergingDuplicate || mergingAll) return
    setMergingDuplicate(true)
    setDuplicateMessage('')
    try {
      const result = await api.mergeDuplicates(keepId, removeIds)
      if (!result?.ok) throw new Error(result?.error || 'Could not merge these copies. Please try again.')
      setDuplicateMessage(result.warning || '')
      setDups(prev => prev.filter(d => d.ids !== group.ids))
    } catch (error) { setDuplicateMessage(error.message) }
    finally { setMergingDuplicate(false) }
  }

  const mergeAllDuplicates = async () => {
    setMergingAll(true)
    setDuplicateMessage('')
    setShowMergeAllConfirm(false)
    try {
      const result = await api.mergeAllDuplicates()
      setMergeAllResult(result)
      setDuplicateMessage([result.error, result.warning].filter(Boolean).join(' '))
      const d = await api.checkDuplicates()
      setDups(Array.isArray(d) ? d : [])
    } catch (e) {
      setMergeAllResult({ error: e.message })
      setDuplicateMessage(e.message)
    }
    setMergingAll(false)
  }

  const checkPossibleDuplicates = async () => {
    setDuplicateMessage('')
    const groups = await api.checkPossibleDuplicates()
    setPossibleDups(Array.isArray(groups) ? groups : [])
    setShowPossibleDups(true)
  }

  const removePlaylistDuplicates = async () => {
    if (!deduplicatePlaylistId || deduplicatingPlaylist) return
    setDeduplicatingPlaylist(true)
    setDeduplicateResult('')
    try {
      const result = await api.deduplicatePlaylist(deduplicatePlaylistId)
      if (result?.error === 'Playlist not found') {
        setDeduplicateResult('This playlist no longer exists. Please select another playlist.')
        return
      }
      if (result?.error === 'Smart playlists cannot be deduplicated.') {
        setDeduplicateResult('Choose a regular playlist. Smart playlists manage their songs automatically.')
        return
      }
      if (!result?.ok) throw new Error(result?.error || 'Unexpected deduplication response')
      const count = Number(result.removed) || 0
      setDeduplicateResult(count ? `Removed ${count} duplicate song${count === 1 ? '' : 's'}.` : 'No duplicate songs were found.')
      window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: deduplicatePlaylistId } }))
    } catch (e) {
      console.error('Playlist duplicate removal failed:', e)
      setDeduplicateResult('We couldn’t remove duplicate songs. Please try again. If this keeps happening, restart Lokal and try again.')
    } finally {
      setDeduplicatingPlaylist(false)
    }
  }

  const mergePossibleDup = async (group, keepId) => {
    const removeIds = (group?.tracks || []).map(track => track.id).filter(id => id !== keepId)
    if (!removeIds.length) return
    if (mergingDuplicate) return
    setMergingDuplicate(true)
    setDuplicateMessage('')
    try {
      const result = await api.mergeDuplicates(keepId, removeIds)
      if (!result?.ok) throw new Error(result?.error || 'Could not merge these copies. Please try again.')
      setDuplicateMessage(result.warning || '')
      setPossibleDups(prev => prev.filter(item => item.id !== group.id))
    } catch (error) { setDuplicateMessage(error.message) }
    finally { setMergingDuplicate(false) }
  }

  const saveCommaArtists = async () => {
    const artists = commaInput.split('\n').map(s => s.trim()).filter(Boolean)
    await api.setKeepCommaArtists(artists)
    setKeepCommaArtists(artists)
    setShowCommaModal(false)
    // RightSidebar keeps its own copy of this list (loaded once at mount,
    // since it stays mounted across normal route navigation) so its artist
    // link can resolve comma-containing names the same way PlayerBar's
    // does. Without this, the fix only takes effect after a remount/reload.
    try { window.dispatchEvent(new CustomEvent('lokal:comma-artists-updated', { detail: artists })) } catch {}
  }

  const triggerDownload = (content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleHistoryExport = async (format = 'json') => {
    console.log("Export started for format:", format);
    setExportingHistory(true);
    setShowExportMenu(false);

    try {
        const uid = user?.id || 'guest';
        const data = await api.historyExport(uid, format);
        
        console.log("Data received from API:", data);

        if (!data || (Array.isArray(data) && data.length === 0)) {
            alert("No history found to export!");
            setExportingHistory(false);
            return;
        }

        if (data.error) {
            throw new Error(data.error);
        }

        const content = format === 'json' ? JSON.stringify(data, null, 2) : data;
        const type = format === 'json' ? 'application/json' : 'text/csv';
        const ext = format === 'json' ? 'json' : 'csv';

        triggerDownload(content, `lokal-history-${new Date().toISOString().split('T')[0]}.${ext}`, type)
        setHistoryExported(true);
        setTimeout(() => setHistoryExported(false), 3000);

    } catch (e) {
        console.error('Export error:', e);
        alert("Failed to export: " + e.message);
    } finally {
        setExportingHistory(false);
    }
  };

  const handleFullExport = async () => {
    setExportingAllData(true)
    try {
      const data = await api.exportAllData()
      if (!data || data.error) throw new Error(data?.error || 'Export failed')
      triggerDownload(
        JSON.stringify(data, null, 2),
        `lokal-app-data-${new Date().toISOString().split('T')[0]}.json`,
        'application/json'
      )
      setFullExported(true)
      setTimeout(() => setFullExported(false), 3000)
    } catch (e) {
      alert('Failed to export app data: ' + e.message)
    } finally {
      setExportingAllData(false)
    }
  }

  const handleDeleteUser = async () => {
    if (!userToDelete?.id) return
    const result = await api.deleteUser(userToDelete.id)
    if (result?.error) {
      setAccountStatus(result.error)
      return
    }
    if (user?.id === userToDelete.id) {
      logout()
    }
    setAccountStatus(`Deleted ${userToDelete.display_name || userToDelete.username}`)
    setUserToDelete(null)
    loadUsers()
    setTimeout(() => setAccountStatus(''), 4000)
  }

  const reloadAfterDataReplace = async () => {
    logout()
    try {
      localStorage.removeItem('lokal-queue')
      localStorage.removeItem('lokal-user')
      localStorage.removeItem(LASTFM_STATUS_KEY)
    } catch {}
    if (api.isElectron) {
      await api.relaunchApp()
      return
    }
    window.location.reload()
  }

  const readImportBackup = async () => {
    const fp = await api.openFile([{ name: 'Lokal Backup', extensions: ['json'] }])
    if (!fp) return
    try {
      const content = await api.readFileBinary(fp)
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid backup file')
      if (parsed.version !== 1) throw new Error('Unsupported backup version')
      setImportPreview({
        filePath: fp,
        data: parsed,
        summary: {
          users: Array.isArray(parsed.users) ? parsed.users.length : 0,
          artists: Array.isArray(parsed.artists) ? parsed.artists.length : 0,
          tracks: Array.isArray(parsed.tracks) ? parsed.tracks.length : 0,
          playlists: Array.isArray(parsed.playlists) ? parsed.playlists.length : 0,
          history: Array.isArray(parsed.play_history) ? parsed.play_history.length : 0,
        },
      })
      setShowImportModal(true)
    } catch (e) {
      alert('Failed to read backup: ' + e.message)
    }
  }

  const handleImportBackup = async () => {
    if (!importPreview?.data) return
    setImportingAllData(true)
    try {
      const result = await api.importAllData(importPreview.data)
      if (!result || result.error) throw new Error(result?.error || 'Import failed')
      setShowImportModal(false)
      setImportPreview(null)
      await reloadAfterDataReplace()
    } catch (e) {
      alert('Failed to import backup: ' + e.message)
    } finally {
      setImportingAllData(false)
    }
  }

  const handleFactoryReset = async () => {
    setFactoryResetting(true)
    try {
      const result = await api.factoryReset()
      if (!result || result.error) throw new Error(result?.error || 'Factory reset failed')
      setShowFactoryResetConfirmModal(false)
      setShowFactoryResetModal(false)
      setResetConfirmText('')
      setResetConfirmArmed(false)
      await reloadAfterDataReplace()
    } catch (e) {
      alert('Factory reset failed: ' + e.message)
    } finally {
      setFactoryResetting(false)
    }
  }

  const downloadYtDlpTool = async () => {
    if (toolsLoading) return
    setToolsLoading(true)
    setToolsError('')
    setToolsErrorTool(null)
    const result = await api.downloadYtDlp()
    if (result?.error) {
      setToolsError(`yt-dlp: ${result.error}`)
      setToolsErrorTool('yt-dlp')
    }
    setToolsLoading(false)
    setToolProgress(prev => ({ ...prev, 'yt-dlp': null }))
    api.getToolsStatus().then(setToolsStatus)
  }

  const downloadFfmpegTool = async () => {
    if (toolsLoading) return
    setToolsLoading(true)
    setToolsError('')
    setToolsErrorTool(null)
    const result = await api.downloadFfmpeg()
    if (result?.error) {
      setToolsError(`ffmpeg: ${result.error}`)
      setToolsErrorTool('ffmpeg')
    }
    setToolsLoading(false)
    api.getToolsStatus().then(setToolsStatus)
  }

  const retryToolDownload = () => {
    if (toolsErrorTool === 'yt-dlp') downloadYtDlpTool()
    else if (toolsErrorTool === 'ffmpeg') downloadFfmpegTool()
  }

  const setCustomToolPath = async (tool) => {
    const fp = await api.openFile()
    if (fp) {
      await api.setCustomToolPath(tool, fp)
      api.getToolsStatus().then(setToolsStatus)
    }
  }

  const handlePlatformFileSelect = async () => {
    const selected = await api.openFile({
      filters: [{ name: 'Import Files', extensions: ['csv', 'json', 'm3u', 'm3u8'] }],
      multiple: true,
    })
    const paths = Array.isArray(selected) ? selected : (selected ? [selected] : [])
    if (!paths.length) return
    try {
      const files = await Promise.all(paths.map(async (fp) => {
        const content = await api.readFileBinary(fp)
        const ext = fp.split('.').pop().toLowerCase()
        const fileType = ext === 'm3u8' ? 'm3u' : ext
        return {
          fileName: fp.split(/[/\\]/).pop(),
          fileContent: content,
          fileType,
        }
      }))
      const preview = await api.previewExternalPlaylistImport({
        files,
        sourcePlatform: platformImportPlatform,
      })
      if (preview?.error) {
        setPlatformImportStatus('Error: ' + preview.error)
        setPlatformImportPreview(null)
        return
      }
      setPlatformImportFiles(files)
      setPlatformImportFileName(files.length === 1 ? files[0].fileName : `${files.length} files selected`)
      setPlatformImportFileContent(files[0]?.fileContent || '')
      setPlatformImportFileType(files[0]?.fileType || 'csv')
      setPlatformImportPreview(preview)
      setPlatformImportStatus(preview.total
        ? `Ready to apply metadata to ${preview.total} tracks from ${preview.fileCount || files.length} file${(preview.fileCount || files.length) === 1 ? '' : 's'}`
        : 'No tracks found in selected files')
    } catch (e) {
      setPlatformImportStatus('Error reading file: ' + e.message)
      setPlatformImportPreview(null)
    }
  }

  const handlePlatformImport = async () => {
    const uid = user?.id
    if (!platformImportFiles.length && !platformImportFileContent) {
      setPlatformImportStatus('Please choose one or more CSV, JSON, or M3U files')
      return
    }
    setPlatformImporting(true)
    setPlatformImportStatus('Importing...')
    try {
      const payload = {
        files: platformImportFiles.length ? platformImportFiles : [{
          fileContent: platformImportFileContent,
          fileType: platformImportFileType,
          fileName: platformImportFileName,
        }],
        sourcePlatform: platformImportPlatform,
      }
      const result = await api.importExternalTrackMetadata(payload)
      if (result?.error) {
        setPlatformImportStatus('Error: ' + result.error)
      } else {
        setPlatformImportStatus(`Applied metadata to ${result.matched}/${result.total} tracks and saved ${result.savedForLater || 0} unmatched rows for future matches.`)
        setPlatformImportPreview(prev => prev ? {
          ...prev,
          imported: result,
        } : prev)
        window.dispatchEvent(new Event('lokal:refresh'))
      }
    } catch (e) {
      setPlatformImportStatus('Error: ' + e.message)
    } finally {
      setPlatformImporting(false)
    }
  }

  const handleBgUpload = async () => {
    const file = await api.openFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }])
    if (file) {
      const dataUrl = await api.readFileAsDataURL(file)
      if (dataUrl) {
        await saveOverride('--bg-image', `url('${dataUrl}')`)
      }
    }
  }

  const handleClearBg = async () => {
    await saveOverride('--bg-image', 'none')
  }

  const handleOpacityChange = async (e) => {
    const val = e.target.value
    await saveOverride('--bg-overlay', val)
  }

  const handleBlurChange = async (e) => {
    const val = e.target.value
    await saveOverride('--bg-blur', `${val}px`)
  }

  const exportMenuItems = [
    { label: 'Export as JSON', icon: <Download size={14} />, onClick: () => handleHistoryExport('json') },
    { label: 'Export as CSV', icon: <Download size={14} />, onClick: () => handleHistoryExport('csv') },
  ]
  const inCategory = (key) => activeCategory === key
  const lastfmConnected = Boolean(settings.lastfm_session_key && settings.lastfm_username)
  const usingDefaultDiscordId = settings.discord_use_default_app_id !== '0'

  return (
    <div ref={rootRef} className="p-6 space-y-6 pb-10">
      {/* The bar itself spans the page (so it still covers content scrolling
          under it). The title lines up with the cards' centred column (see
          Section); the category buttons use the full width, centred. */}
      <div className="space-y-3 sticky top-0 z-10 bg-bg/80 backdrop-blur-sm py-2">
        <div className="w-full max-w-2xl mx-auto flex items-center justify-between gap-3">
          <h1 className="font-display text-lg uppercase tracking-widest text-white">Settings</h1>
          <div className="flex items-center gap-3">
            {settingsLoadError && (
              <span className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle size={12} /> Couldn't load settings ({settingsLoadError})</span>
            )}
            {/* No Save button: changes save as they're made. */}
            <AnimatePresence mode="wait" initial={false}>
              {saveState?.error ? (
                <motion.span key="error" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="text-xs text-red-400 flex items-center gap-2">
                  <AlertTriangle size={12} /> Couldn't save ({saveState.error})
                  <button onClick={() => flushSettings()} className="px-2 py-0.5 rounded border border-red-400/40 hover:bg-red-400/10">Retry</button>
                </motion.span>
              ) : saveState === 'saving' ? (
                <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-xs text-muted">Saving...</motion.span>
              ) : saveState === 'saved' ? (
                <motion.span key="saved" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="text-xs text-accent flex items-center gap-1">
                  <CheckCircle size={12} /> Saved
                </motion.span>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="text-xs text-muted">Changes save automatically</motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {SETTINGS_CATEGORIES.filter(item => item.key !== 'about' || api.isElectron).map((item) => {
            const Icon = item.icon
            const active = activeCategory === item.key
            return (
              <button
                key={item.key}
                onClick={() => setActiveCategory(item.key)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-display uppercase tracking-wider transition-colors flex items-center gap-1.5 ${
                  active ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white hover:border-accent/30'
                }`}
              >
                <Icon size={13} />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Switching category: the new one fades in once its data is in, not
          through "Loading…" / "No … yet" first. */}
      <SectionSwap id={activeCategory} gated={['data', 'addons'].includes(activeCategory)} className="space-y-6">
      <ReadyWhen ready={
activeCategory === 'data' ? usersTried
          : activeCategory !== 'addons'
      } />
      {api.isElectron && inCategory('about') && (
        <Section title="About">
          <Row label="Version" desc="The version you're running.">
            <span className="text-sm text-muted font-mono">{appVersion || '1.0.0'}</span>
          </Row>
          <Row label="Check for Updates" desc={/-nightly\./i.test(appVersion || '') ? 'Nightly builds update from GitHub Releases, not from here.' : 'Look for a newer version now.'}>
            <div className="flex items-center gap-3">
              <button 
                onClick={checkForUpdates}
                disabled={checkingUpdate}
                className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 disabled:opacity-40 transition-colors"
              >
                <RefreshCcw size={13} className={checkingUpdate ? 'animate-spin' : ''} />
                {checkingUpdate ? 'Checking...' : /-nightly\./i.test(appVersion || '') ? 'Open Releases' : 'Check for updates'}
              </button>
              {updateCheckResult && (
                <span className="text-xs text-muted">{updateCheckResult}</span>
              )}
            </div>
          </Row>
          <Row label="Debug Logs" desc="Open the folder with Lokal's logs, to attach to a bug report.">
            <button 
              onClick={() => api.openLogs?.()}
              className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors"
            >
              <FolderOpen size={14} /> Show Logs
            </button>
          </Row>
          <Row label="Hardware Acceleration" desc={perfSaveError?.key === 'hardwareAcceleration' ? `Couldn't save (${perfSaveError.message})` : perfRestartNeeded ? 'Restart Lokal to apply this change' : 'Use the graphics card to draw the app. Turn off if the window flickers or shows glitches.'}>
            <div className="flex items-center gap-3">
              {perfRestartNeeded && (
                <button
                  onClick={() => api.relaunchApp()}
                  className="flex items-center gap-2 px-4 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white hover:border-accent/30 transition-colors"
                >
                  <RefreshCcw size={12} /> Restart now
                </button>
              )}
              <button
                onClick={() => setHardwareAcceleration(!perfSettings.hardwareAcceleration)}
                className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${perfSettings.hardwareAcceleration ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
                {perfSettings.hardwareAcceleration ? 'On' : 'Off'}
              </button>
            </div>
          </Row>
        </Section>
      )}

      {inCategory('library') && (
      <Section title="Maintenance">
         <Row label="Repair Missing Downloads" desc={`${missingRepairText} Known original sources are redownloaded and attached to the existing library entries; files that need manual matching are left untouched.`}>
           <button
             onClick={repairMissingLibraryFiles}
             disabled={!!missingRepairJob?.running || !missingRepairJob?.missing}
             className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-50"
           >
             {missingRepairJob?.running ? 'Repairing…' : 'Repair All'}
           </button>
         </Row>
        <Row label="Rescan Library">
          <button onClick={rescan} disabled={scanning || !settings.music_folder}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-white hover:border-accent/30 disabled:opacity-40 transition-colors">
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />{scanning ? 'Scanning…' : 'Rescan'}
          </button>
        </Row>
        <Row label="Find Duplicates" desc="Exact: the same title and artist. Similar: likely copies with close names and lengths, to check after the exact ones.">
          <div className="flex items-center gap-2">
            <button onClick={checkDuplicates}
              className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
              Exact
            </button>
            <button onClick={checkPossibleDuplicates}
              className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
              Similar
            </button>
          </div>
        </Row>
        {api.isElectron && (
        <Row label="Index Lyrics" desc={`Fetches and keeps the lyrics of every song in your library now, so they open at once later. ${indexText(lyricsIndexJob, 'lyrics')}`.trim()}>
          <button onClick={indexAllLyrics}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            {lyricsIndexJob?.running ? 'Stop' : 'Index All'}
          </button>
        </Row>
        )}
      </Section>
      )}

      {inCategory('library') && (
      <Section title="Downloads">
        <Row label="Download Format" desc={`What downloaded songs are saved as. ${(FORMATS.find(f => f.id === savedFormat(settings)) || FORMATS[0]).hint}`}>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {FORMATS.map(option => (
              <button key={option.id} onClick={() => set('download_format', option.id)} title={option.hint}
                className={`px-3 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${savedFormat(settings) === option.id ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
                {option.label}
              </button>
            ))}
            {savedFormat(settings) === 'mp3' && (
              <select value={MP3_BITRATES.includes(String(settings.download_quality)) ? String(settings.download_quality) : '320'} onChange={e => set('download_quality', e.target.value)}
                aria-label="MP3 bitrate"
                className="bg-elevated border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50">
                {MP3_BITRATES.map(rate => <option key={rate} value={rate}>{rate} kbps</option>)}
              </select>
            )}
          </div>
        </Row>
        <Row label="Simultaneous Downloads" desc="How many downloads run at once; the rest wait. A playlist counts as one.">
          <select
            value={settings.download_concurrency || '3'}
            onChange={e => set('download_concurrency', e.target.value)}
            className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50">
            {['1', '2', '3', '4', '5'].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
        <Row label="Add Lyrics to Downloads" desc="Save the lyrics inside each downloaded file, so other players can show them too.">
          <button
            onClick={() => set('download_embed_lyrics', settings.download_embed_lyrics === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.download_embed_lyrics !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.download_embed_lyrics !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Simpler Artist Names" desc="Use the main artist for downloaded songs, not every name the file lists.">
          <button
            onClick={() => set('clean_download_metadata', settings.clean_download_metadata === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.clean_download_metadata !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.clean_download_metadata !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Add Right Away" desc="When downloading a playlist or album, add each song to your library as soon as it's done, not all at the end.">
          <button
            onClick={() => set('index_while_downloading', settings.index_while_downloading === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.index_while_downloading === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.index_while_downloading === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        {settings.yt_cookies === '1' && ['chrome', 'edge', 'brave', 'opera'].includes(settings.yt_cookie_browser) && (
          <p className="text-[11px] text-muted -mt-1 mb-2">
            On Windows, Chrome-based browsers lock their cookies, so downloads go ahead without your YouTube sign-in. Use Firefox or a cookies.txt file to keep it.
          </p>
        )}
      </Section>
      )}

      {inCategory('library') && (
      <Section title="Genres">
        <Row label="Set Genres" desc="Choose the genre for an artist, album or song yourself.">
          <button 
            onClick={() => setShowGenreModal(true)}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center gap-2"
          >
            <Tags size={14} /> Configure Overrides
          </button>
        </Row>
        <Row label="Fill In Genres" desc={genreText || 'Look up a genre online for every song that has none, one album at a time. A big library takes a while; it runs in the background.'}>
          <button onClick={fillGenres} disabled={!!genreJob?.running}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-50">
            {genreJob?.running ? 'Running…' : 'Fill In'}
          </button>
        </Row>
      </Section>
      )}

      {inCategory('library') && (
      <Section title="Artists">
              <Row label="Names With a Comma" desc="Artists whose name has a comma, like Tyler, The Creator, so they aren't split into two artists.">
          <button onClick={() => setShowCommaModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Configure ({keepCommaArtists.length})
          </button>
        </Row>
        <Row label="Fill In Artist Pages" desc="When you open an artist, look up their bio and picture if they're missing.">
          <button
            onClick={() => set('auto_fetch_artist_metadata', settings.auto_fetch_artist_metadata === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.auto_fetch_artist_metadata === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.auto_fetch_artist_metadata === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row stacked label="Artist Info Source" desc="Where artist pictures and bios come from. Automatic tries the best source for each one.">
          <div className="inline-flex flex-wrap gap-1 p-0.5 bg-card rounded-lg border border-border">
            {ARTIST_SOURCES.map(([id, label]) => (
              <button key={id} onClick={() => set('artist_metadata_source', id)}
                className={`px-3 py-1 !text-[11px] font-display uppercase tracking-wider rounded transition-colors ${(settings.artist_metadata_source || 'either') === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </Section>
      )}

      {inCategory('library') && (
      <Section title="Library">
        <Row stacked label="Remove Duplicate Songs" desc="Choose a playlist to remove repeated songs from it. The first occurrence stays in its original position; other playlist entries are removed. Library files are not touched.">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Playlist to remove duplicates from"
              value={deduplicatePlaylistId}
              onChange={event => { setDeduplicatePlaylistId(event.target.value); setDeduplicateResult('') }}
              disabled={!deduplicatePlaylists.length || deduplicatingPlaylist}
              className="min-w-48 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-white outline-none focus:border-accent/50 disabled:opacity-50"
            >
              {!deduplicatePlaylists.length && <option value="">No regular playlists</option>}
              {deduplicatePlaylists.map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
            </select>
            <button
              type="button"
              onClick={removePlaylistDuplicates}
              disabled={!deduplicatePlaylistId || deduplicatingPlaylist}
              className="flex items-center gap-2 rounded-lg border border-accent/25 bg-accent/15 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/25 disabled:cursor-wait disabled:opacity-40"
            >
              <Trash2 size={14} /> {deduplicatingPlaylist ? 'Removing…' : 'Remove duplicates'}
            </button>
          </div>
          {deduplicateResult && <p role="status" className="text-xs text-muted">{deduplicateResult}</p>}
        </Row>
        <Row label="Delete Files Too" desc={api.isElectron
          ? 'Deleting a song in Lokal also moves its file to the Recycle Bin. Only files in your music folder.'
          : 'Deleting a song in Lokal also deletes its file from the server, for good. Only files in the music folder.'}>
          <button
            onClick={() => set('delete_files_from_disk', settings.delete_files_from_disk === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.delete_files_from_disk === '1' ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'border-border text-muted hover:text-white'}`}>
            {settings.delete_files_from_disk === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Look Up Missing Info" desc="Find a cover online when a song has none, and a genre for songs you stream.">
          <button
            onClick={() => set('fetch_online_artwork', settings.fetch_online_artwork === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.fetch_online_artwork !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.fetch_online_artwork !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Skip Sample Packs" desc="Leave out files named like drum kits, loops or samples, for producers who keep sample packs in their music folder.">
          <button
            onClick={() => set('skip_drumkit_pattern', settings.skip_drumkit_pattern === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.skip_drumkit_pattern === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.skip_drumkit_pattern === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Minimum Length" desc="Leave out files shorter than this when scanning, like sound effects or samples. 0 keeps everything.">
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={300} value={settings.min_duration ?? 0} onChange={e => set('min_duration', e.target.value)}
              className="w-16 bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white text-center outline-none focus:border-accent/50" />
            <span className="text-xs text-muted">sec</span>
          </div>
        </Row>
        <Row label="Music Folder">
          <div className="flex items-center gap-2">
            <input value={settings.music_folder || ''} onChange={e => set('music_folder', e.target.value)}
              placeholder="Choose your music folder"
              className="w-52 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            {api.isElectron && (
              <button onClick={async () => { const f = await api.openFolder(); if (f) set('music_folder', f) }}
                className="p-1.5 bg-card border border-border rounded-lg text-muted hover:text-white transition-colors">
                <FolderOpen size={14} />
              </button>
            )}
          </div>
        </Row>
      </Section>
      )}

      {inCategory('playback') && (
      <Section title="Equalizer">
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm text-white font-medium">10-Band EQ</p>
              <p className="text-xs text-muted mt-1">Preset: {eqPreset === 'custom' ? 'Custom' : EQ_PRESETS[eqPreset]?.label || EQ_PRESETS[DEFAULT_EQ_PRESET].label}</p>
            </div>
            <button onClick={() => applyEqGains(EQ_PRESETS[DEFAULT_EQ_PRESET].gains, DEFAULT_EQ_PRESET)}
              className="text-xs text-muted hover:text-white transition-colors">Reset</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(EQ_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyEqGains(preset.gains, key)}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${eqPreset === key ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-card border-border text-muted hover:text-white'}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-end justify-center gap-3 h-40 overflow-x-auto pb-2">
            {EQ_BANDS.map((band, i) => (
              <div key={band} className="flex flex-col items-center gap-2">
                <span className="text-xs font-display" style={{ color: '#e8ff57', fontSize: 10 }}>
                  {eqGains[i] > 0 ? '+' : ''}{(eqGains[i] || 0).toFixed(1)}
                </span>
                <input type="range" min={-12} max={12} step={0.5} value={eqGains[i] || 0}
                  onChange={e => setEQ(i, parseFloat(e.target.value))}
                  className="accent-accent"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 24, height: 104, cursor: 'pointer' }} />
                <span className="text-muted" style={{ fontSize: 9 }}>{band}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3 text-center opacity-50">The equalizer starts after your first click in the app.</p>
        </div>
      </Section>
      )}

      {inCategory('playback') && (
      <Section title="Playback">
        <OutputPrecisionSettings />
        <Row label="Crossfade" desc="Start the next song this many seconds before the current one ends. Skipping doesn't fade.">
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={20} step={0.5} value={settings.crossfade_seconds || 0}
              onChange={e => set('crossfade_seconds', e.target.value)} className="w-24 accent-accent" />
            <span className="text-xs text-muted w-10">{settings.crossfade_seconds || 0}s</span>
          </div>
        </Row>
        {crossfade.beforeEnd > CROSSFADE_MIN_S && (<>
          <Row label="Fade in" desc="How long the next song takes to reach full volume.">
            <div className="flex items-center gap-2">
              <input type="range" min={0} max={10} step={0.1} value={crossfade.fadeIn}
                onChange={e => set('crossfade_fade_in', e.target.value)} className="w-24 accent-accent" />
              <span className="text-xs text-muted w-10">{crossfade.fadeIn.toFixed(1)}s</span>
            </div>
          </Row>
          <Row label="Fade out" desc="How long the current song takes to fade away. It stops at the end of the song either way.">
            <div className="flex items-center gap-2">
              <input type="range" min={0.5} max={20} step={0.5} value={crossfade.fadeOut}
                onChange={e => set('crossfade_fade_out', e.target.value)} className="w-24 accent-accent" />
              <span className="text-xs text-muted w-10">{crossfade.fadeOut.toFixed(1)}s</span>
            </div>
          </Row>
          <Row label="Fade curve" desc="Logarithmic fades evenly to the ear. Linear stays loud, then drops off near the end.">
            <select
              value={crossfade.curve}
              onChange={e => set('crossfade_curve', e.target.value)}
              className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50"
            >
              <option value="logarithmic">Logarithmic</option>
              <option value="linear">Linear</option>
            </select>
          </Row>
        </>)}
        <Row label="Streaming Quality" desc="For songs played from YouTube Music. Data saver uses less than half the data. SoundCloud has one quality; addons have their own setting.">
          <select
            value={settings.online_quality || 'best'}
            onChange={e => set('online_quality', e.target.value)}
            className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50">
            <option value="best">Best</option>
            <option value="saver">Data saver</option>
          </select>
        </Row>
        {api.isElectron && (
        <Row label="Music Video Quality" desc="The most a music video's picture streams at. Lower uses less data and starts faster.">
          <select
            value={settings.video_quality || '1080'}
            onChange={e => set('video_quality', e.target.value)}
            className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50">
            <option value="1080">Up to 1080p</option>
            <option value="720">Up to 720p</option>
            <option value="480">Up to 480p</option>
          </select>
        </Row>
        )}
        <Row stacked label="Play From" desc="When a song isn't in your library, Lokal looks for it in these, top first. Addons you turn on are added here.">
          <PlaybackSourceSettings value={settings.playback_search_order} onChange={value => set('playback_search_order', value)} />
        </Row>
      </Section>
      )}

      {inCategory('playback') && (
      <Section title="Lyrics">
        <Row label="Auto-Translate" desc="Show the translation under each line when a song is in another language.">
          <button
            onClick={() => set('lyrics_auto_translate', settings.lyrics_auto_translate === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.lyrics_auto_translate === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.lyrics_auto_translate === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Translation Language" desc="The language lyrics are translated into.">
          <select value={settings.lyrics_translate_target || 'en'} onChange={e => set('lyrics_translate_target', e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent/50">
            {TRANSLATION_LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </Row>
        <Row label="Word-by-Word Sync" desc="Light up each word as it's sung, when the lyrics have word timing.">
          <button
            onClick={() => { const v = settings.word_sync === '0'; set('word_sync', v ? '1' : '0'); localStorage.setItem('word-sync', v ? '1' : '0') }}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.word_sync !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.word_sync !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Time Plain Lyrics" desc="Roughly time lyrics that have no timing, so they scroll with the song.">
          <button
            onClick={() => set('unsynced_auto_sync', settings.unsynced_auto_sync === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.unsynced_auto_sync === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.unsynced_auto_sync === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <LyricsSourcesSettings onPersist={(patch) => setSettings(s => ({ ...s, ...patch }))} />
        <Row label="Clear Lyrics Cache">
          <button onClick={() => api.clearLyricsDb()}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors flex items-center gap-2">
            <RefreshCw size={13} /> Clear
          </button>
        </Row>
      </Section>
      )}

      {inCategory('integrations') && (
      <Section title="Account Connections">
        <ProviderConnections settingsOverride={settings} onSettingsChanged={patch => setSettings(previous => ({ ...previous, ...patch }))} onListenBrainzChanged={setLbStatus} />
      </Section>
      )}

      {inCategory('integrations') && (
      <Section title="Scrobbling">
        <Row label="Last.fm" desc={lastfmConnected ? '' : 'Sign in to Last.fm in Account Connections first.'}>
          <button disabled={!lastfmConnected} aria-pressed={lastfmConnected && settings.lastfm_scrobbling === '1'}
            onClick={() => set('lastfm_scrobbling', settings.lastfm_scrobbling === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors disabled:opacity-40 ${lastfmConnected && settings.lastfm_scrobbling === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {lastfmConnected && settings.lastfm_scrobbling === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="ListenBrainz" desc={lbStatus?.connected ? (lbStatus.queued ? `${lbStatus.queued} listen${lbStatus.queued === 1 ? '' : 's'} waiting to be sent` : '') : 'Sign in to ListenBrainz in Account Connections first.'}>
          <button disabled={!lbStatus?.connected} aria-pressed={!!(lbStatus?.connected && lbStatus.enabled)}
            onClick={async () => {
              // Keep the current state if the change didn't go through.
              const next = await Promise.resolve(api.listenbrainzSetEnabled(!lbStatus.enabled)).catch(() => null)
              if (next && !next.error) setLbStatus(next)
            }}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors disabled:opacity-40 ${!!(lbStatus?.connected && lbStatus.enabled) ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {!!(lbStatus?.connected && lbStatus.enabled) ? 'On' : 'Off'}
          </button>
        </Row>
      </Section>
      )}

      {inCategory('integrations') && (
      <Section title="Discord Rich Presence">
        <Row label="Use Lokal's Discord App" desc="Show Lokal's name and icon on your Discord profile.">
          <button
            onClick={() => set('discord_use_default_app_id', usingDefaultDiscordId ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${usingDefaultDiscordId ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {usingDefaultDiscordId ? 'On' : 'Off'}
          </button>
        </Row>
        {!usingDefaultDiscordId && (
          <Row label="Your Own Discord App" desc="The ID of a Discord app you made, to show its name and icon instead.">
            <input value={settings.discord_client_id || ''} onChange={e => set('discord_client_id', e.target.value)}
              placeholder={DEFAULT_DISCORD_CLIENT_ID}
              className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
          </Row>
        )}
        <Row label="Connect on Startup" desc="Show what you're playing on Discord as soon as Lokal opens.">
          <button
            onClick={() => set('discord_auto_connect', settings.discord_auto_connect === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.discord_auto_connect === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.discord_auto_connect === '1' ? 'On' : 'Off'}
          </button>
        </Row>
      </Section>
      )}

      {inCategory('integrations') && (
        <Section title="Soulseek">
          <p className="text-xs text-muted leading-relaxed">
            Search and download from Soulseek, where lossless (FLAC) copies are common. Lokal talks to{' '}
            <span className="text-white">slskd</span>, a Soulseek client you run alongside it (github.com/slskd/slskd), using an API key from its config
            (<span className="font-mono text-[11px]">web.authentication.api_keys</span>). Soulseek is a sharing network: slskd shares folders back by default, and most of what's on it is copyrighted, so only download what you're allowed to.
          </p>
          <Row label="slskd Address" desc="The address of your slskd app.">
            <input value={settings.soulseek_url || ''} onChange={e => set('soulseek_url', e.target.value)}
              placeholder="http://localhost:5030" spellCheck={false}
              className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
          </Row>
          <Row label="API Key">
            <input type="password" value={settings.soulseek_api_key || ''} onChange={e => set('soulseek_api_key', e.target.value)}
              placeholder="From slskd.yml" spellCheck={false} autoComplete="off"
              className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
          </Row>
          <Row label="slskd Downloads Folder" desc="Where slskd saves files, as this computer sees it. Only needed when slskd runs in Docker or on another machine.">
            <div className="flex items-center gap-2">
              <input value={settings.soulseek_downloads_dir || ''} onChange={e => set('soulseek_downloads_dir', e.target.value)}
                placeholder="Automatic" spellCheck={false}
                className="w-48 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
              {api.isElectron && (
                <button onClick={async () => { const f = await api.openFolder(); if (f) set('soulseek_downloads_dir', f) }}
                  className="p-1.5 bg-card border border-border rounded-lg text-muted hover:text-white transition-colors">
                  <FolderOpen size={14} />
                </button>
              )}
            </div>
          </Row>
          <div className="flex items-center gap-3">
            <button onClick={testSoulseek} disabled={soulseekCheck?.loading}
              className="px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border border-accent/50 bg-accent/20 text-accent disabled:opacity-50">
              {soulseekCheck?.loading ? 'Checking...' : 'Save & Test'}
            </button>
            {soulseekCheck && !soulseekCheck.loading && (
              soulseekCheck.error
                ? <p className="text-xs text-red-400">{soulseekCheck.error}</p>
                : <p className={`text-xs ${soulseekCheck.loggedIn ? 'text-green-400' : 'text-yellow-300'}`}>
                    {soulseekCheck.loggedIn ? `Connected${soulseekCheck.username ? ` as ${soulseekCheck.username}` : ''}` : `The API key works, but slskd isn't logged in to Soulseek${soulseekCheck.serverState ? ` (${soulseekCheck.serverState})` : ''}. Check the soulseek: username and password in slskd.yml, and slskd's own page.`}
                    {soulseekCheck.version ? ` · slskd ${soulseekCheck.version}` : ''}
                    {soulseekCheck.downloadsDir && !soulseekCheck.downloadsDirReachable ? ` · Lokal can't see ${soulseekCheck.downloadsDir}; set the folder above` : ''}
                  </p>
            )}
          </div>
        </Section>
      )}

      {api.isElectron && inCategory('integrations') && (
        <Section title="External Tools">
          <p className="text-xs text-muted mb-4">The tools Lokal uses to download and convert songs.</p>
          {toolsError && (
            <div className="flex items-center justify-between gap-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
              <span>{toolsError}</span>
              {toolsErrorTool && (
                <button onClick={retryToolDownload} disabled={toolsLoading} className="shrink-0 px-2.5 py-1 bg-red-500/20 border border-red-500/30 rounded-md text-red-300 hover:bg-red-500/30 disabled:opacity-40">
                  Retry
                </button>
              )}
            </div>
          )}
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${toolsStatus?.ytdlp?.found ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-white">yt-dlp</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadYtDlpTool()} disabled={toolsLoading} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white disabled:opacity-40">
                  {toolsLoading ? progressLabel('yt-dlp') : toolsStatus?.ytdlp?.found ? 'Update / Re-download' : 'Download'}
                </button>
                <button onClick={() => setCustomToolPath('yt-dlp')} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white">Custom Path</button>
              </div>
            </div>
            {toolsStatus?.ytdlp?.path && (
              <p className="text-xs text-muted/50 truncate">
                {toolsStatus.ytdlp.path}{toolsStatus.ytdlp.version ? ` · v${toolsStatus.ytdlp.version}` : ''}
              </p>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${toolsStatus?.ffmpeg?.found ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-white">ffmpeg</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadFfmpegTool()} disabled={toolsLoading} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white disabled:opacity-40">
                  {toolsLoading ? progressLabel('ffmpeg') : toolsStatus?.ffmpeg?.found ? 'Re-download' : 'Download'}
                </button>
                <button onClick={() => setCustomToolPath('ffmpeg')} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white">Custom Path</button>
              </div>
            </div>
            {toolsStatus?.ffmpeg?.path && (
              <p className="text-xs text-muted/50 truncate">
                {toolsStatus.ffmpeg.path}{toolsStatus.ffmpeg.version ? ` · ${toolsStatus.ffmpeg.version}` : ''}
              </p>
            )}
          </div>
        </Section>
      )}

      {inCategory('addons') && (
      <Section title="Addons">
        <AddonsSettings />
      </Section>
      )}

      {inCategory('appearance') && (
      <Section title="Theme">
        <div className="space-y-4">
          <div>
            <p className="text-sm text-white font-medium mb-3">Theme</p>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(THEMES).map(([key, theme]) => (
                <button
                  key={key}
                  onClick={() => selectTheme(key)}
                  className={`p-3 rounded-lg border transition-all ${
                    themeName === key 
                      ? 'bg-accent/20 border-accent/50' 
                      : 'bg-card border-border hover:border-accent/30'
                  }`}
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="flex gap-1">
                      <div className="w-4 h-4 rounded" style={{ background: theme.vars['--bg'] }} />
                      <div className="w-4 h-4 rounded" style={{ background: theme.vars['--surface'] }} />
                      <div className="w-4 h-4 rounded" style={{ background: theme.vars['--surface2'] }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="w-2 h-2 rounded-full" style={{ background: theme.vars['--accent'] }} />
                      <span className={`text-xs ${themeName === key ? 'text-accent' : 'text-muted'}`}>
                        {theme.name}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          
          <div>
            <p className="text-sm text-white font-medium mb-3">Accent Color</p>
            <div className="flex flex-wrap gap-2">
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setAccent(color)}
                  className={`w-8 h-8 rounded-lg transition-all ${
                    themeOverrides['--accent'] === color.value
                      ? 'ring-2 ring-offset-2 ring-offset-elevated ring-white scale-110'
                      : 'hover:scale-110'
                  }`}
                  style={{ background: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm text-white font-medium mb-3">Text Size</p>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted">A</span>
              <input
                type="range"
                min="0.7"
                max="1.5"
                step="0.05"
                value={textScale}
                onChange={(e) => setTextScale(e.target.value)}
                className="flex-1 accent-accent"
              />
              <span className="text-lg text-muted">A</span>
              <span className="text-xs text-muted ml-2 w-12">
                {Math.round(parseFloat(textScale) * 100)}%
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted/50">Small</span>
              <span className="text-[10px] text-muted/50">Large</span>
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-border">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm text-white font-medium">Custom Background</p>
                <p className="text-xs text-muted">Set a custom image for the app background.</p>
              </div>
              <div className="flex gap-2">
                {bgImage && (
                  <button 
                    onClick={handleClearBg}
                    className="px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-xs hover:bg-red-500/20 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button 
                  onClick={handleBgUpload}
                  className="px-3 py-1.5 bg-card border border-border text-white rounded-lg text-xs hover:bg-elevated/80 transition-colors flex items-center gap-2"
                >
                  <ImageIcon size={14} />
                  {bgImage ? 'Change Image' : 'Upload Image'}
                </button>
              </div>
            </div>

            {bgImage && (
              <div className="space-y-4 mt-4">
                <div className="w-full aspect-video rounded-xl border border-border relative overflow-hidden bg-black">
                  <div 
                    className="absolute inset-0 bg-no-repeat"
                    style={{
                      backgroundImage: `url('${bgImage}')`,
                      backgroundSize: themeOverrides['--bg-size'] || 'cover',
                      backgroundPosition: themeOverrides['--bg-position'] || 'center',
                    }}
                  />
                  <div className="absolute inset-0 bg-bg transition-opacity duration-300" style={{ opacity: themeOverrides['--bg-overlay'] || 0, backdropFilter: `blur(${themeOverrides['--bg-blur'] || '0px'})` }} />
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Background Fade / Overlay</span>
                    <span>{Math.round((themeOverrides['--bg-overlay'] || 0) * 100)}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.05"
                    value={themeOverrides['--bg-overlay'] || 0}
                    onChange={handleOpacityChange}
                    className="w-full accent-accent h-1 bg-elevated rounded-lg appearance-none cursor-pointer"
                  />
                  <p className="text-[10px] text-muted">Adjusts the visibility of the solid background color over your image.</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted">
                    <span>Background Blur</span>
                    <span>{parseInt(themeOverrides['--bg-blur'] || '0')}px</span>
                  </div>
                  <input 
                    type="range" min="0" max="50" step="1"
                    value={parseInt(themeOverrides['--bg-blur'] || '0')} onChange={handleBlurChange}
                    className="w-full accent-accent h-1 bg-elevated rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">Image Fit</label>
                    <select 
                      value={themeOverrides['--bg-size'] || 'cover'}
                      onChange={(e) => saveOverride('--bg-size', e.target.value)}
                      className="w-full bg-elevated border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50"
                    >
                      <option value="cover">Cover (Fill)</option>
                      <option value="contain">Contain (Fit)</option>
                      <option value="auto">Auto (Original)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted uppercase tracking-wider block mb-1.5">Position</label>
                    <select 
                      value={themeOverrides['--bg-position'] || 'center'}
                      onChange={(e) => saveOverride('--bg-position', e.target.value)}
                      className="w-full bg-elevated border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50"
                    >
                      <option value="center">Center</option>
                      <option value="top">Top</option>
                      <option value="bottom">Bottom</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-border">
            <Row
              label="Tint App Logo"
              desc="Tint the logo with the theme's accent colour."
            >
              <button
                onClick={async () => {
                  const enabled = parseFloat(themeOverrides['--logo-mask-opacity'] || '0') > 0.05
                  if (enabled) {
                    await saveOverrides({
                      '--logo-image-filter': 'none',
                      '--logo-image-opacity': '1',
                      '--logo-mask-opacity': '0',
                      '--logo-wrap-bg': 'transparent',
                      '--logo-wrap-shadow': 'none',
                      '--logo-wrap-border': '1px solid transparent',
                    })
                  } else {
                    await saveOverrides({
                      '--logo-image-filter': 'grayscale(1) brightness(1.02) contrast(1.06)',
                      '--logo-image-opacity': '1',
                      '--logo-mask-opacity': '0.38',
                      '--logo-wrap-bg': 'rgba(var(--accent-rgb), 0.1)',
                      '--logo-wrap-shadow': '0 0 12px rgba(var(--accent-rgb), 0.1)',
                      '--logo-wrap-border': '1px solid rgba(var(--accent-rgb), 0.2)',
                    })
                  }
                }}
                className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${parseFloat(themeOverrides['--logo-mask-opacity'] || '0') > 0.05 ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}
              >
                {parseFloat(themeOverrides['--logo-mask-opacity'] || '0') > 0.05 ? 'On' : 'Off'}
              </button>
            </Row>
          </div>

          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-muted hover:text-white transition-colors"
          >
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            Advanced Options
          </button>

          {showAdvanced && (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-xs text-muted">Override CSS variables</p>
              {Object.keys(THEMES.dark.vars).filter(k => k !== '--accent' && k !== '--accent-dim').map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-xs text-muted w-24 truncate">{key}</span>
                  <input
                    type="text"
                    value={themeOverrides[key] || THEMES[themeName]?.vars[key] || ''}
                    onChange={(e) => saveOverride(key, e.target.value)}
                    className="flex-1 bg-card border border-border rounded px-2 py-1 text-xs text-white outline-none focus:border-accent/50"
                    placeholder={THEMES[themeName]?.vars[key]}
                  />
                </div>
              ))}
              <button
                onClick={resetTheme}
                className="text-xs text-muted hover:text-white transition-colors"
              >
                Reset Overrides
              </button>
            </div>
          )}
        </div>
      </Section>
      )}

      {inCategory('appearance') && (
      <Section title="Now Playing">
        <Row label="Colour Background" desc="Colour the side panel and full screen player from the album cover. Off: a dark background.">
          <button
            onClick={() => set('artwork_backdrop', settings.artwork_backdrop === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.artwork_backdrop !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.artwork_backdrop !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Moving Covers" desc="Play an album's animated cover in the side panel and full screen player, when there is one.">
          <button
            onClick={() => set('motion_covers', settings.motion_covers === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.motion_covers !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.motion_covers !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        {settings.motion_covers !== '0' && (() => {
          const all = [['apple', 'Apple Music', 'Animated album covers'], ['tidal', 'Tidal', 'Video album covers'], ['community', 'Community list', 'Clips shared by other listeners'], ['spotify', 'Spotify Canvas', 'Needs your Spotify cookie (below)']]
          let chosen = ['apple', 'tidal', 'community']
          try { const v = JSON.parse(settings.motion_cover_sources || 'null'); if (Array.isArray(v)) chosen = v } catch {}
          const toggle = (id) => set('motion_cover_sources', JSON.stringify(chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id]))
          return (
            <>
            <Row stacked label="Where to Look" desc="Where to find moving covers. These aren't official services, so one can stop working at any time.">
              <div className="flex flex-wrap gap-1.5">
                {all.map(([id, label, hint]) => (
                  <button key={id} onClick={() => toggle(id)} title={hint}
                    className={`px-3 py-1 rounded-lg text-xs border transition-colors ${chosen.includes(id) ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Row>
            {chosen.includes('spotify') && (
              <>
                <Row stacked label="Spotify Cookie" desc={"Spotify only shows Canvas to signed-in accounts. To sign in here: open open.spotify.com in your browser and sign in, press F12, go to Application (Storage in Firefox) › Cookies › open.spotify.com, and copy the value of sp_dc. It lasts about a year.\n\nIt stays on this computer and is only sent to Spotify."}>
                  <input type="password" value={settings.spotify_sp_dc || ''} onChange={e => { set('spotify_sp_dc', e.target.value); setSpotifyCheck(null) }}
                    placeholder="sp_dc value" spellCheck={false} autoComplete="off"
                    className="w-full max-w-md bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
                </Row>
                <Row label="Prioritize Spotify Canvas" desc="Ask Spotify first. It has Canvas for many more songs, but they're tall videos, cropped to a square here.">
                  <button
                    onClick={() => set('spotify_canvas_first', settings.spotify_canvas_first === '1' ? '0' : '1')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.spotify_canvas_first === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
                    {settings.spotify_canvas_first === '1' ? 'On' : 'Off'}
                  </button>
                </Row>
                <div className="flex items-center gap-3">
                  <button onClick={testSpotifyCanvas} disabled={spotifyCheck?.loading}
                    className="px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border border-accent/50 bg-accent/20 text-accent disabled:opacity-50">
                    {spotifyCheck?.loading ? 'Checking...' : 'Save & Test'}
                  </button>
                  {settings.spotify_sp_dc && (
                    <button onClick={async () => {
                      const saved = await api.saveSettings({ spotify_sp_dc: '' }).catch(e => ({ error: e?.message || 'Save failed' }))
                      if (saved?.error) { setSpotifyCheck({ error: `Couldn't remove the cookie: ${saved.error}` }); return }
                      set('spotify_sp_dc', ''); setSpotifyCheck(null)
                      window.dispatchEvent(new Event('lokal:settings-saved'))
                    }}
                      className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted hover:text-white transition-colors">
                      Remove
                    </button>
                  )}
                  {spotifyCheck && !spotifyCheck.loading && (
                    spotifyCheck.error
                      ? <p className="text-xs text-red-400">{spotifyCheck.error}</p>
                      : <p className="text-xs text-green-400">Signed in -- canvases will be looked up.</p>
                  )}
                </div>
              </>
            )}
            </>
          )
        })()}
      </Section>
      )}

      {inCategory('appearance') && (
      <Section title="Player Bar">
        <Row label="Glass" desc="The player bar floats over the page, blurred. Turn off for a plain bar, which is lighter if playback stutters.">
          <button
            onClick={() => set('glass_player_bar', settings.glass_player_bar === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.glass_player_bar !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.glass_player_bar !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Waveform" desc="Moving bars next to the volume while music plays.">
          <button
            onClick={() => set('player_waveform', settings.player_waveform === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.player_waveform !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.player_waveform !== '0' ? 'On' : 'Off'}
          </button>
        </Row>
      </Section>
      )}

      {inCategory('appearance') && (
      <Section title="Layout">
        <Row
          label="Side Panels"
          desc={"Merged: Queue and Lyrics open as tabs in the side panel. Independent: each opens in its own panel next to it."}
        >
          <div className="flex flex-col items-end gap-1">
          <div className="flex gap-0.5 p-0.5 bg-card rounded-lg border border-border/50">
            {[['1', 'Merged'], ['0', 'Independent']].map(([value, label]) => {
              // Read from the live store, not `settings` -- a click applies
              // the new mode to the store/localStorage immediately, but
              // `settings.exclusive_side_panels` only changes once the
              // backend save resolves (and reverts entirely if "Save
              // Settings" is never clicked), so deriving the highlight from
              // it could show the wrong button as active right after a
              // click, or after a reload before the save round-trips.
              const current = exclusiveSidePanels ? '1' : '0'
              return (
                <button
                  key={value}
                  onClick={() => {
                    set('exclusive_side_panels', value)
                    try { localStorage.setItem('lokal-exclusive-panels', value) } catch {}
                    setExclusiveSidePanels(value === '1')
                    // This takes effect instantly (localStorage + the live
                    // store above), unlike most settings on this page which
                    // wait for the "Save Settings" button -- but set() only
                    // updates this component's own local `settings` copy, so
                    // without this the backend's exclusive_side_panels stayed
                    // on the old value until the user happened to click Save
                    // Settings for some unrelated change. A fresh install, a
                    // browser with no localStorage entry yet, or any other
                    // consumer of the backend setting would then see the old
                    // choice despite the UI already showing the new one.
                    const seq = ++sidePanelsSaveSeq
                    sidePanelsSaveChain = sidePanelsSaveChain
                      .catch(() => {}) // a prior failure shouldn't block this attempt
                      .then(() => api.saveSettings({ exclusive_side_panels: value }))
                      .then(() => {
                        if (seq === sidePanelsSaveSeq) setSidePanelsSaveError(false)
                      })
                      .catch((err) => {
                        console.error('Failed to save Side Panels setting', err)
                        if (seq === sidePanelsSaveSeq) setSidePanelsSaveError(true)
                      })
                  }}
                  className={`px-3 py-1 rounded-md text-xs font-display uppercase tracking-wider transition-colors ${current === value ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          {sidePanelsSaveError && (
            <p className="text-[11px] text-red-400 flex items-center gap-1">
              <AlertTriangle size={11} /> Couldn't save -- will retry on next change
            </p>
          )}
          </div>
        </Row>
        <Row label="Open the Side Panel on Play" desc="Open the side panel when you start a song, album or playlist.">
          <button
            onClick={() => { const v = !autoOpenSidePanel; setAutoOpenSidePanel(v); set('auto_open_side_panel', v ? '1' : '0') }}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${autoOpenSidePanel ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {autoOpenSidePanel ? 'On' : 'Off'}
          </button>
        </Row>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="Accounts">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-white font-medium">Local Accounts</p>
            <button
              onClick={loadUsers}
              disabled={usersLoading}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors disabled:opacity-50"
            >
              {usersLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
          <p className="text-xs text-muted">
            Delete accounts directly from Lokal if one was created with the wrong password or is no longer needed.
          </p>
          {accountStatus && <p className="text-xs text-accent">{accountStatus}</p>}
          <div className="space-y-2">
            {!usersLoading && usersTried && appUsers.length === 0 && (
              <p className="text-xs text-muted">No local accounts found.</p>
            )}
            {appUsers.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card/40">
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">
                    {account.display_name || account.username}
                    {user?.id === account.id && <span className="text-xs text-accent ml-2">Current</span>}
                  </p>
                  <p className="text-xs text-muted truncate">@{account.username}</p>
                </div>
                <button
                  onClick={() => setUserToDelete(account)}
                  className="px-3 py-1.5 rounded-lg text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="Metadata">
        <Row label="Import Track Metadata" desc="Add genres, labels and other details from an export (like Exportify) to the songs you already have.">
          <button onClick={() => { setPlatformImportStatus(''); setPlatformImportPreview(null); setPlatformImportFiles([]); setPlatformImportFileName(''); setPlatformImportFileContent(''); setShowPlatformImportGuide(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors">
            <Link size={14} /> Import Metadata
          </button>
        </Row>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="Backup">
        <Row label="Full App Export" desc="Save everything (accounts, settings, themes, playlists, likes, history) to one file. Your music files aren't included.">
          <button
            onClick={handleFullExport}
            disabled={exportingAllData}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <Download size={13} /> {exportingAllData ? 'Exporting...' : 'Export All'}
            {fullExported && <span className="text-accent text-xs ml-1">✓</span>}
          </button>
        </Row>
        <Row label="Import Backup" desc="Restore from a backup file. You'll see what it holds before anything is replaced.">
          <button
            onClick={readImportBackup}
            disabled={importingAllData}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCcw size={13} /> {importingAllData ? 'Importing...' : 'Import'}
          </button>
        </Row>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="History">
        <Row label="Export History" desc="Save your listening history as a file.">
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors"
            >
              <Download size={13} /> Export
              {historyExported && <span className="text-accent text-xs ml-1">✓</span>}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 min-w-32 bg-elevated border border-border rounded-lg shadow-xl py-1 z-50">
                <button
                  onClick={() => handleHistoryExport('json')}
                  className="w-full px-3 py-2 text-left text-sm text-muted hover:text-white hover:bg-card flex items-center gap-2"
                >
                  <Download size={14} /> JSON
                </button>
                <button
                  onClick={() => handleHistoryExport('csv')}
                  className="w-full px-3 py-2 text-left text-sm text-muted hover:text-white hover:bg-card flex items-center gap-2"
                >
                  <Download size={14} /> CSV
                </button>
              </div>
            )}
          </div>
        </Row>
      </Section>
      )}

      {api.isElectron && inCategory('data') && (
      <Section title="Cache">
        <Row label="Cache Size Limit" desc="Moving covers, music videos, and converted copies of songs (Apple Lossless, WMA…) are kept so they load faster. Past this size, the oldest are removed.">
          <select aria-label="Cache size limit" value={String(Math.round((cacheInfo?.limit || 4096 * 1048576) / 1048576))} onChange={e => setCacheLimit(Number(e.target.value))}
            className="bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50">
            {(cacheInfo?.limits || [512, 1024, 2048, 4096, 8192, 16384]).map(mb => <option key={mb} value={String(mb)}>{mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}</option>)}
          </select>
        </Row>
        <Row label="In Use" desc={cacheInfo ? `Music videos ${fmtBytes(cacheInfo.musicVideo)} · Moving covers ${fmtBytes(cacheInfo.motion)} · Playable copies ${fmtBytes(cacheInfo.playback)} · Web cache ${fmtBytes(cacheInfo.web)}` : 'Measuring…'}>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white font-display">{cacheInfo ? fmtBytes((cacheInfo.motion || 0) + (cacheInfo.playback || 0) + (cacheInfo.musicVideo || 0) + (cacheInfo.web || 0)) : '—'}</span>
            <button onClick={clearCache} disabled={!cacheInfo || cacheInfo.busy}
              className="px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border border-border text-muted hover:text-white disabled:opacity-50 transition-colors">
              {cacheInfo?.busy ? 'Clearing…' : 'Clear Cache'}
            </button>
          </div>
        </Row>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="Danger Zone">
        <Row label="Clear Library" desc="Remove every song, playlist, like and play from Lokal, keeping your accounts and settings. Your music files aren't touched.">
          <button onClick={() => setShowClearModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/25 transition-colors">
            <Trash2 size={13} /> Clear
          </button>
        </Row>
        <Row label="Factory Reset Lokal" desc="Start over: erase everything Lokal keeps on this computer, accounts and settings included. Your music files aren't touched.">
          <button
            onClick={() => setShowFactoryResetModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/25 transition-colors"
          >
            <Trash2 size={13} /> Factory Reset
          </button>
        </Row>
      </Section>
      )}

      </SectionSwap>

      <Modal open={showClearModal} onClose={() => setShowClearModal(false)} title="Clear All Library Data?" width="max-w-sm">
        <div className="space-y-4">
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-white/70 leading-relaxed">Removes all tracks, artists, playlists, and history. Music files are untouched.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowClearModal(false)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={async () => { await api.clearTracks(); setShowClearModal(false) }}
              className="flex-1 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors">
              Clear Everything
            </button>
          </div>
        </div>
      </Modal>
      <Modal 
        open={showGenreModal} 
        onClose={() => { setShowGenreModal(false); setStatusMessage(''); }} 
        title="Manual Genre Assignment" 
        width="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">
            Overrides take priority over online fetching. Use this if iTunes or MusicBrainz can't find it.
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-display text-muted uppercase tracking-widest block mb-1.5">Artist (Required)</label>
                <input 
                  value={manualGenreArtist} 
                  onChange={e => setManualGenreArtist(e.target.value)}
                  placeholder="e.g. KENTENSHI"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" 
                />
              </div>
              <div>
                <label className="text-[10px] font-display text-muted uppercase tracking-widest block mb-1.5">Genre (Required)</label>
                <input 
                  value={manualGenreValue} 
                  onChange={e => setManualGenreValue(e.target.value)}
                  placeholder="e.g. Breakcore"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" 
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/50">
              <div>
                <label className="text-[10px] font-display text-muted/60 uppercase tracking-widest block mb-1.5">Track (Optional)</label>
                <input 
                  value={manualGenreTrack} 
                  onChange={e => setManualGenreTrack(e.target.value)}
                  placeholder="Song name"
                  className="w-full bg-card/40 border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/30" 
                />
              </div>
              <div>
                <label className="text-[10px] font-display text-muted/60 uppercase tracking-widest block mb-1.5">Album (Optional)</label>
                <input 
                  value={manualGenreAlbum} 
                  onChange={e => setManualGenreAlbum(e.target.value)}
                  placeholder="Album title"
                  className="w-full bg-card/40 border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/30" 
                />
              </div>
            </div>
          </div>

          {statusMessage && (
            <div className={`p-2.5 rounded-lg border text-center text-xs font-medium ${statusMessage.includes('Error') || statusMessage.includes('required') ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-accent/10 border-accent/20 text-accent'}`}>
              {statusMessage}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button 
              onClick={() => { setShowGenreModal(false); setStatusMessage(''); }} 
              className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={async () => {
                if (!manualGenreArtist || !manualGenreValue) {
                  setStatusMessage('Artist and Genre are required');
                  return;
                }
                const result = await api.setManualGenre({ 
                  artist: manualGenreArtist, 
                  track: manualGenreTrack || null,
                  album: manualGenreAlbum || null,
                  genre: manualGenreValue 
                });
                setStatusMessage(result?.error || `✓ Updated ${result?.updated || 0} track(s)`);
                
                if (!result?.error) {
                  setManualGenreArtist('');
                  setManualGenreTrack('');
                  setManualGenreAlbum('');
                  setManualGenreValue('');
                  setTimeout(() => setShowGenreModal(false), 1500);
                }
              }} 
              className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Apply Mapping
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showCommaModal} onClose={() => setShowCommaModal(false)} title="Keep Comma in Artist Names" width="max-w-md">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            These artists won't have their comma removed. This prevents "Tyler, The Creator" from becoming "Tyler" and "The Creator". Enter one artist per line.
          </p>
          <div className="bg-card/50 rounded-lg p-3 mb-2">
            <p className="text-xs text-muted mb-2">Examples (one per line):</p>
            <div className="flex flex-wrap gap-2">
              {['Tyler, The Creator', 'Earth, Wind & Fire'].map(ex => (
                <span key={ex} className="text-xs bg-accent/20 text-accent px-2 py-1 rounded">{ex}</span>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Artists (one per line)</label>
            <textarea value={commaInput} onChange={e => setCommaInput(e.target.value)}
              placeholder="Tyler, The Creator
Earth, Wind & Fire"
              rows={6}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCommaModal(false)} className="flex-1 py-2 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={saveCommaArtists}
              className="flex-1 py-2 bg-accent text-base rounded-xl text-sm font-medium transition-colors">
              Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showDups} onClose={() => { setShowDups(false); setMergeAllResult(null) }} title="Duplicate Tracks" width="max-w-2xl">
        {duplicateMessage && <p role="alert" className="text-sm text-amber-400 mb-3 break-words">{duplicateMessage}</p>}
        {dups?.length === 0 && <p className="text-accent text-sm text-center py-6">✓ No duplicates found!</p>}
        
        {dups?.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowMergeAllConfirm(true)}
              disabled={mergingAll || mergingDuplicate}
              className="flex items-center gap-2 px-4 py-2 bg-accent/20 border border-accent/50 text-accent rounded-lg text-sm font-medium hover:bg-accent/30 disabled:opacity-40 transition-colors"
            >
              <Zap size={14} />
              {mergingAll ? 'Merging...' : 'Smart Merge All'}
            </button>
            {mergeAllResult && (
              <p className={`text-xs mt-2 ${mergeAllResult.error ? 'text-red-400' : 'text-accent'}`}>
                {mergeAllResult.error ? `Error: ${mergeAllResult.error}` : `✓ Merged ${mergeAllResult.merged} tracks across ${mergeAllResult.groups} groups`}
              </p>
            )}
          </div>
        )}
        
        {dups?.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            <p className="text-xs text-muted mb-2">Merge keeps the selected copy and fills missing metadata from the others. Removed copies’ audio files go to Trash on desktop and are permanently deleted in web mode, even when “Delete files too” is off.</p>
            {dups.map((d, i) => {
              return (
                <div key={i} className="p-3 bg-card border border-border rounded-xl flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium">{d.title}</p>
                    <p className="text-xs text-muted">{d.artist} · {d.count} copies</p>
                    <p className="text-xs text-muted/40 mt-0.5 truncate">{d.paths}</p>
                  </div>
                  <button
                    disabled={mergingAll || mergingDuplicate}
                    onClick={() => mergeDup(d)}
                    className="flex-shrink-0 px-3 py-1.5 bg-accent/15 border border-accent/30 text-accent rounded-lg text-xs font-display uppercase tracking-wider hover:bg-accent/25 transition-colors"
                  >
                    Merge → Keep First
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      <Modal open={showMergeAllConfirm} onClose={() => setShowMergeAllConfirm(false)} title="Smart Merge All Duplicates?" width="max-w-sm">
        <div className="space-y-4">
          <div className="flex gap-3">
            <Zap size={18} className="text-accent flex-shrink-0 mt-0.5" />
            <div className="text-sm text-white/70 leading-relaxed">
              <p>This will automatically merge all duplicate tracks across your entire library using smart scoring:</p>
              <ul className="mt-2 text-xs text-muted space-y-1">
                <li>• Bitrate ÷ 100 points (320kbps = 3.2pts)</li>
                <li>• +10 points if has artwork</li>
                <li>• +5 points if has album</li>
                <li>• +3 points if has year</li>
                <li>• +2 points if has genre</li>
              </ul>
              <p className="mt-2">The highest scoring copy wins. Missing metadata is filled from the other copies, then their audio files are removed from your music folder (Trash on desktop; permanently deleted in web mode).</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowMergeAllConfirm(false)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={mergeAllDuplicates} className="flex-1 py-2.5 bg-accent/20 border border-accent/50 text-accent rounded-xl text-sm font-medium hover:bg-accent/30 transition-colors">
              Merge All
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showPossibleDups} onClose={() => setShowPossibleDups(false)} title="Possible Duplicates" width="max-w-4xl">
        {duplicateMessage && <p role="alert" className="text-sm text-amber-400 mb-3 break-words">{duplicateMessage}</p>}
        {possibleDups?.length === 0 && (
          <div className="space-y-2 py-4">
            <p className="text-accent text-sm text-center">✓ No possible duplicates found.</p>
            <p className="text-xs text-muted text-center">Run Exact first, then come back here for what's left.</p>
          </div>
        )}

        {possibleDups?.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              This pass is intentionally review-based. Run the exact duplicate checker first, then use this for tracks that look like the same song but do not have identical names. Keep This removes the other copies’ audio files from your music folder (Trash on desktop; permanently deleted in web mode), even when “Delete files too” is off.
            </p>
            <div className="space-y-3 max-h-[34rem] overflow-y-auto pr-1">
              {possibleDups.map((group) => (
                <div key={group.id} className="rounded-2xl border border-border bg-card/40 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-white font-medium">Possible match group</p>
                      <p className="text-xs text-muted mt-1">{group.summary}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-display uppercase tracking-widest text-accent">{group.confidence}% confidence</p>
                      <p className="text-[10px] text-muted mt-1">Suggested keep is marked below</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {group.tracks.map((track) => {
                      const suggested = track.id === group.suggestedKeepId
                      return (
                        <div key={track.id} className={`rounded-xl border px-3 py-3 flex items-center gap-3 ${suggested ? 'border-accent/40 bg-accent/10' : 'border-border bg-elevated/40'}`}>
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-card border border-border flex items-center justify-center flex-shrink-0">
                            {track.artwork_path ? (
                              <img src={api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)} className="w-full h-full object-cover" />
                            ) : (
                              <Music2 size={15} className="text-muted" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm text-white truncate">{track.title}</p>
                              {suggested && <span className="text-[10px] text-accent uppercase tracking-widest">Suggested</span>}
                            </div>
                            <p className="text-xs text-muted truncate">{track.artist}</p>
                            <p className="text-[10px] text-muted/70 truncate">
                              {track.album || 'No album'} · {track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : '--:--'} · {track.bitrate ? `${track.bitrate}kbps` : 'Unknown bitrate'}
                            </p>
                            <p className="text-[10px] text-muted/50 truncate mt-1">{track.file_path}</p>
                          </div>
                          <button
                            disabled={mergingDuplicate}
                            onClick={() => mergePossibleDup(group, track.id)}
                            className={`flex-shrink-0 px-3 py-2 rounded-lg text-xs font-display uppercase tracking-wider transition-colors ${suggested ? 'bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30' : 'bg-card border border-border text-muted hover:text-white hover:border-accent/30'}`}
                          >
                            Keep This
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showPlatformImportGuide} onClose={() => { setShowPlatformImportGuide(false); setPlatformImportStatus('') }} title="Import Track Metadata" width="max-w-5xl">
        <div className="flex max-h-[calc(100vh-8rem)] min-h-0 flex-col gap-5">
          <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
            <p className="text-sm text-white">Use CSV, JSON, or M3U exports to enrich songs already in your library.</p>
            <p className="text-xs text-muted leading-relaxed">
              {'Lokal will match each row against your library and apply imported metadata like genres, explicit flags, labels, and audio features. Unmatched rows are saved locally and retried later when those songs enter your library.'}
            </p>
          </div>

          <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(320px,1.1fr)]">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Source Platform</label>
                <select
                  value={platformImportPlatform}
                  onChange={e => setPlatformImportPlatform(e.target.value)}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                >
                  <option value="spotify">Spotify / Exportify CSV</option>
                  <option value="apple-music">Apple Music Export</option>
                  <option value="youtube-music">YouTube Music / Google Takeout</option>
                  <option value="lastfm">Last.fm Export</option>
                  <option value="generic">Generic CSV / JSON / M3U</option>
                </select>
              </div>
              <div className="rounded-xl border border-border bg-card/30 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white">Choose Export File</p>
                    <p className="text-xs text-muted mt-1">CSV works best. You can select multiple files at once and Lokal will merge them into one preview/import pass.</p>
                  </div>
                  <button
                    onClick={handlePlatformFileSelect}
                    className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center gap-2"
                  >
                    <ListMusic size={14} /> Choose Files
                  </button>
                </div>
                <div className="rounded-lg border border-border bg-elevated/70 px-3 py-2 text-xs text-muted">
                  {platformImportFileName || 'No files selected'}
                </div>
                {!!platformImportPreview?.files?.length && (
                  <div className="max-h-28 overflow-y-auto rounded-lg border border-border bg-elevated/40">
                    {platformImportPreview.files.map((file, index) => (
                      <div key={`${file.fileName || 'file'}-${index}`} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs text-muted last:border-b-0">
                        <span className="truncate">{file.fileName || `File ${index + 1}`}</span>
                        <span className="flex-shrink-0">{file.total} rows</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/30 p-4 space-y-3">
              <p className="text-sm text-white">What Lokal will do</p>
              <div className="space-y-2 text-xs text-muted leading-relaxed">
                <p>Matched songs stay in place and get enriched with imported metadata.</p>
                <p>Multi-genre values, explicit flags, labels, and audio features can then feed mixes and queue suggestions.</p>
                <p>Unmatched rows are stored locally so future downloads or imports can use that metadata automatically.</p>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2">
                <div className="rounded-lg bg-elevated/70 px-3 py-3 text-center">
                  <p className="text-lg text-white font-medium">{platformImportPreview?.total || 0}</p>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted">Rows</p>
                </div>
                <div className="rounded-lg bg-elevated/70 px-3 py-3 text-center">
                  <p className="text-lg text-white font-medium">{platformImportPreview?.matched || 0}</p>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted">Matched</p>
                </div>
                <div className="rounded-lg bg-elevated/70 px-3 py-3 text-center">
                  <p className="text-lg text-white font-medium">{platformImportPreview?.ghostable || 0}</p>
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted">Saved</p>
                </div>
              </div>
            </div>
          </div>

          <div className="min-h-0 rounded-xl border border-border bg-card/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-white font-medium">Preview</p>
                <p className="text-xs text-muted mt-1">{'This preview shows which rows Lokal can match now and which rows will be remembered for later.'}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">CSV</span>
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">JSON</span>
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">M3U</span>
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">Text</span>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="hidden gap-0 bg-elevated/80 px-4 py-3 text-[10px] uppercase tracking-[0.24em] text-muted md:grid md:grid-cols-[1.3fr_1.1fr_1.1fr_0.9fr_1.2fr]">
                <span>Track</span>
                <span>Artist</span>
                <span>Album</span>
                <span>Status</span>
                <span>What Lokal Does</span>
              </div>
              <div className="max-h-[34vh] overflow-y-auto divide-y divide-border bg-card/30">
                {(platformImportPreview?.rows || []).map((row) => (
                  <div key={`${row.artist}-${row.title}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1.3fr_1.1fr_1.1fr_0.9fr_1.2fr] md:gap-0">
                    <span className="text-white truncate pr-3">{row.title}</span>
                    <span className="text-muted truncate pr-3">{row.artist}</span>
                    <span className="text-muted truncate pr-3">{row.album}</span>
                    <span className="text-accent truncate pr-3">{row.status !== 'Matched' ? 'Saved for Later' : row.status}</span>
                    <span className="text-muted truncate">{row.status === 'Matched' ? 'Apply imported metadata' : 'Save for future match'}</span>
                  </div>
                ))}
                {!platformImportPreview?.rows?.length && (
                  <div className="px-4 py-8 text-center text-sm text-muted">
                    Choose an export file to preview the imported songs here.
                  </div>
                )}
              </div>
            </div>
          </div>

          {platformImportStatus && (
            <div className="rounded-xl border border-border bg-card/30 px-4 py-3 text-sm text-muted">
              {platformImportStatus}
            </div>
          )}

          <div className="sticky bottom-0 flex gap-2 border-t border-border bg-elevated pt-4">
            <button onClick={() => setShowPlatformImportGuide(false)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={handlePlatformImport} disabled={platformImporting || !platformImportPreview?.total} className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              {platformImporting ? 'Importing...' : 'Apply Metadata'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!userToDelete} onClose={() => setUserToDelete(null)} title="Delete Local Account?" width="max-w-sm">
        <div className="space-y-4">
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-white/70 leading-relaxed">
              <p>
                Delete <span className="text-white">{userToDelete?.display_name || userToDelete?.username}</span> from Lokal?
              </p>
              <p className="text-xs text-muted mt-2">
                This removes the local account record, playlists owned by that account, likes, history, saved user settings, and avatar data.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setUserToDelete(null)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={handleDeleteUser} className="flex-1 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors">
              Delete Account
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showImportModal} onClose={() => { if (!importingAllData) { setShowImportModal(false); setImportPreview(null) } }} title="Import Backup?" width="max-w-lg">
        <div className="space-y-4">
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-orange-300 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-white/70 leading-relaxed">
              <p>This will replace Lokal's current local database and settings with the selected backup.</p>
              <p className="text-xs text-muted mt-2">Current local data will be overwritten. Audio files on disk are not deleted.</p>
            </div>
          </div>
          {importPreview && (
            <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
              <p className="text-xs text-muted break-all">{importPreview.filePath}</p>
              <div className="grid grid-cols-5 gap-2 text-center">
                <div className="rounded-lg bg-card px-2 py-3">
                  <p className="text-lg text-white font-medium">{importPreview.summary.users}</p>
                  <p className="text-[10px] text-muted uppercase tracking-wider">Users</p>
                </div>
                <div className="rounded-lg bg-card px-2 py-3">
                  <p className="text-lg text-white font-medium">{importPreview.summary.artists}</p>
                  <p className="text-[10px] text-muted uppercase tracking-wider">Artists</p>
                </div>
                <div className="rounded-lg bg-card px-2 py-3">
                  <p className="text-lg text-white font-medium">{importPreview.summary.tracks}</p>
                  <p className="text-[10px] text-muted uppercase tracking-wider">Tracks</p>
                </div>
                <div className="rounded-lg bg-card px-2 py-3">
                  <p className="text-lg text-white font-medium">{importPreview.summary.playlists}</p>
                  <p className="text-[10px] text-muted uppercase tracking-wider">Playlists</p>
                </div>
                <div className="rounded-lg bg-card px-2 py-3">
                  <p className="text-lg text-white font-medium">{importPreview.summary.history}</p>
                  <p className="text-[10px] text-muted uppercase tracking-wider">History</p>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setShowImportModal(false); setImportPreview(null) }} disabled={importingAllData} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-50">Cancel</button>
            <button onClick={handleImportBackup} disabled={importingAllData || !importPreview} className="flex-1 py-2.5 bg-orange-500/20 border border-orange-500/30 text-orange-200 rounded-xl text-sm font-medium hover:bg-orange-500/30 transition-colors disabled:opacity-50">
              {importingAllData ? 'Importing...' : 'Replace with Backup'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showFactoryResetModal} onClose={() => setShowFactoryResetModal(false)} title="Factory Reset Lokal?" width="max-w-md">
        <div className="space-y-4">
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-white/70 leading-relaxed">
              <p>This will erase Lokal's local accounts, settings, themes, playlists, history, artists, tracks, and cached assets on this device.</p>
              <p className="text-xs text-muted mt-2">Your music files on disk will not be deleted.</p>
            </div>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3">
            <p className="text-xs text-red-200">Strongly recommended: export a full backup before continuing.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowFactoryResetModal(false)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={() => { setShowFactoryResetModal(false); setShowFactoryResetConfirmModal(true) }} className="flex-1 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors">
              Continue
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showFactoryResetConfirmModal} onClose={() => { if (!factoryResetting) { setShowFactoryResetConfirmModal(false); setResetConfirmText(''); setResetConfirmArmed(false) } }} title="Final Confirmation" width="max-w-md">
        <div className="space-y-4">
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 space-y-2">
            <p className="text-sm text-white">Type <span className="text-red-300 font-medium">RESET LOKAL</span> to confirm.</p>
            <p className="text-xs text-muted">This is intended to make accidental resets much harder.</p>
          </div>
          <input
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value)}
            placeholder="RESET LOKAL"
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-red-400/50"
          />
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={resetConfirmArmed}
              onChange={(e) => setResetConfirmArmed(e.target.checked)}
              className="accent-red-400"
            />
            I understand this cannot be undone.
          </label>
          <div className="flex gap-2">
            <button onClick={() => { setShowFactoryResetConfirmModal(false); setResetConfirmText(''); setResetConfirmArmed(false) }} disabled={factoryResetting} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-50">Cancel</button>
            <button
              onClick={handleFactoryReset}
              disabled={factoryResetting || resetConfirmText !== 'RESET LOKAL' || !resetConfirmArmed}
              className="flex-1 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
            >
              {factoryResetting ? 'Resetting...' : 'Factory Reset'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}
