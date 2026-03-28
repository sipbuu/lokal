import React, { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDeferredValue } from 'react'
import { Save, Tags, FolderOpen, RefreshCw, Trash2, AlertTriangle, Link, CheckCircle, Disc3, Zap, Download, Music2, X, MoreHorizontal, ListMusic, Palette, ChevronDown, ChevronUp, RefreshCcw, Image as ImageIcon, Puzzle } from 'lucide-react'
import { api } from '../api'
import { useAppStore } from '../store/player'
import Modal from '../components/Modal'
import ArtistManageModal from '../components/ArtistManageModal'
import { THEMES, ACCENT_COLORS, applyTheme } from '../theme'
import { useTheme } from '../themeHooks'

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
const ARTISTS_PAGE_SIZE = 60
const DEFAULT_DISCORD_CLIENT_ID = '1473597925581131919'
const LASTFM_STATUS_KEY = 'lokal-lastfm-status-feed'
const SETTINGS_CATEGORIES = [
  { key: 'library', label: 'Library', icon: Music2 },
  { key: 'artists', label: 'Artists', icon: Tags },
  { key: 'playback', label: 'Playback', icon: Disc3 },
  { key: 'integrations', label: 'Integrations', icon: Zap },
  { key: 'plugins', label: 'Plugins', icon: Puzzle },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'data', label: 'Data', icon: Download },
]

function Section({ title, children }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-display text-muted uppercase tracking-widest">{title}</h2>
      <div className="bg-elevated border border-border rounded-xl p-5 space-y-5">{children}</div>
    </div>
  )
}
function Row({ label, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white font-medium">{label}</p>
        {desc && <p className="text-xs text-muted mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
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

export default function Settings() {
  const [settings, setSettings] = useState({})
  const [saved, setSaved] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [showGenreModal, setShowGenreModal] = useState(false)
  const [eqGains, setEqGains] = useState(EQ_PRESETS[DEFAULT_EQ_PRESET].gains)
  const [eqPreset, setEqPreset] = useState(DEFAULT_EQ_PRESET)
  const [showClearModal, setShowClearModal] = useState(false)
  const [artists, setArtists] = useState([])
  const [artistsLoading, setArtistsLoading] = useState(false)
  const [artistsHasMore, setArtistsHasMore] = useState(false)
  const [artistsTotal, setArtistsTotal] = useState(0)
  const [manageArtist, setManageArtist] = useState(null)
  const [artistSearch, setArtistSearch] = useState('')
  const [discordStatus, setDiscordStatus] = useState('')
  const [lastfmStatus, setLastfmStatus] = useState('')
  const [lastfmFeed, setLastfmFeed] = useState([])
  const [lastfmAuthorizing, setLastfmAuthorizing] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [urlTarget, setUrlTarget] = useState({ type: '', id: '', url: '' })
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [dups, setDups] = useState(null)
  const [showDups, setShowDups] = useState(false)
  const [possibleDups, setPossibleDups] = useState(null)
  const [showPossibleDups, setShowPossibleDups] = useState(false)
  const [mergingAll, setMergingAll] = useState(false)
  const [mergeAllResult, setMergeAllResult] = useState(null)
  const [showMergeAllConfirm, setShowMergeAllConfirm] = useState(false)
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
  const [appUsers, setAppUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [accountStatus, setAccountStatus] = useState('')
  const [userToDelete, setUserToDelete] = useState(null)
  const [showFactoryResetModal, setShowFactoryResetModal] = useState(false)
  const [showFactoryResetConfirmModal, setShowFactoryResetConfirmModal] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetConfirmArmed, setResetConfirmArmed] = useState(false)
  const [factoryResetting, setFactoryResetting] = useState(false)
  const [toolsStatus, setToolsStatus] = useState(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [showPlaylistImportModal, setShowPlaylistImportModal] = useState(false)
  const [showPlatformImportGuide, setShowPlatformImportGuide] = useState(false)
  const [platformImportMode, setPlatformImportMode] = useState('playlist')
  const [platformImportName, setPlatformImportName] = useState('')
  const [platformImportPlatform, setPlatformImportPlatform] = useState('spotify')
  const [platformImportFileName, setPlatformImportFileName] = useState('')
  const [platformImportFileContent, setPlatformImportFileContent] = useState('')
  const [platformImportFileType, setPlatformImportFileType] = useState('csv')
  const [platformImportPreview, setPlatformImportPreview] = useState(null)
  const [platformImportStatus, setPlatformImportStatus] = useState('')
  const [platformImporting, setPlatformImporting] = useState(false)
  const [playlistImportName, setPlaylistImportName] = useState('')
  const [playlistImportEntries, setPlaylistImportEntries] = useState('')
  const [playlistImportStatus, setPlaylistImportStatus] = useState('')
  const [playlistImportResult, setPlaylistImportResult] = useState(null)
  const [perfSettings, setPerfSettings] = useState({ hardwareAcceleration: true, performanceMode: false })
  const [relaunchMsg, setRelaunchMsg] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateCheckResult, setUpdateCheckResult] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [manualGenreArtist, setManualGenreArtist] = useState('')
  const [bgImage, setBgImage] = useState(null)
  const [manualGenreTrack, setManualGenreTrack] = useState('')
  const [manualGenreAlbum, setManualGenreAlbum] = useState('')
  const [manualGenreValue, setManualGenreValue] = useState('')
  const [plugins, setPlugins] = useState([])
  const [pluginsLoading, setPluginsLoading] = useState(false)
  const [pluginStatus, setPluginStatus] = useState('')
  const [pluginInstallFolder, setPluginInstallFolder] = useState('')
  const [activeCategory, setActiveCategory] = useState('library')

  
  const { openAlbums, user, logout } = useAppStore()
  const fileInputRef = useRef(null)
  const artistOffsetRef = useRef(0)
  const artistRequestRef = useRef(0)
  const deferredArtistSearch = useDeferredValue(artistSearch)
  const { themeName, themeOverrides, showAdvanced, setShowAdvanced, selectTheme, setAccent, saveOverride, saveOverrides, resetTheme, textScale, setTextScale } = useTheme()

  const pushLastfmFeed = (entry) => {
    setLastfmFeed(prev => {
      const next = [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          time: Date.now(),
          ...entry,
        },
        ...prev,
      ].slice(0, 10)
      try {
        localStorage.setItem(LASTFM_STATUS_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  }

  useEffect(() => {

    api.getSettings().then(s => setSettings({
      ...(s || {}),
      discord_use_default_app_id: s?.discord_use_default_app_id ?? '1',
      discord_client_id: s?.discord_client_id || DEFAULT_DISCORD_CLIENT_ID,
      discord_auto_connect: s?.discord_auto_connect ?? '0',
    }))

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

      /*api.getPerfSettings().then(s => {

        if (s) setPerfSettings(s)             comment out for now, need to rethink how we handle perfomance settings eventually (original test failed)

      })
      */
    }

    try {
      setLastfmFeed(JSON.parse(localStorage.getItem(LASTFM_STATUS_KEY) || '[]'))
    } catch {}

  }, []) 

  useEffect(() => {
    const offAuth = api.onLastfmAuthToken?.(async (token) => {
      if (!token) return
      set('lastfm_auth_token', token)
      setLastfmAuthorizing(false)
      pushLastfmFeed({
        level: 'info',
        label: 'Authorization',
        message: 'Authorization callback received from Last.fm'
      })
      if (!settings.lastfm_api_key || !settings.lastfm_api_secret) {
        setLastfmStatus('Need API key and secret')
        pushLastfmFeed({
          level: 'error',
          label: 'Authorization',
          message: 'Missing API key or secret for session exchange'
        })
        return
      }
      setLastfmStatus('Finishing Last.fm connection...')
      const result = await api.lastfmConnect(settings.lastfm_api_key, settings.lastfm_api_secret, token)
      if (result.sessionKey) {
        await api.saveSettings({
          lastfm_session_key: result.sessionKey,
          lastfm_username: result.username || settings.lastfm_username,
          lastfm_auth_token: token
        })
        setSettings(prev => ({
          ...prev,
          lastfm_auth_token: token,
          lastfm_session_key: result.sessionKey,
          lastfm_username: result.username || prev.lastfm_username
        }))
        setLastfmStatus('✓ Connected as ' + (result.username || settings.lastfm_username))
        pushLastfmFeed({
          level: 'success',
          label: 'Connection',
          message: `Connected as ${result.username || settings.lastfm_username || 'Last.fm user'}`
        })
      } else {
        setLastfmStatus(result.error || 'Failed')
        pushLastfmFeed({
          level: 'error',
          label: 'Connection',
          message: result.error || 'Failed to exchange Last.fm token'
        })
      }
    })

    const onStatus = (event) => {
      const next = event.detail
      if (Array.isArray(next)) {
        setLastfmFeed(next)
      }
    }

    window.addEventListener('lokal:lastfm-status', onStatus)
    return () => {
      offAuth?.()
      window.removeEventListener('lokal:lastfm-status', onStatus)
    }
  }, [settings.lastfm_api_key, settings.lastfm_api_secret, settings.lastfm_username])

  const loadArtists = async () => {
    const requestId = ++artistRequestRef.current
    const offset = artistOffsetRef.current
    setArtistsLoading(true)
    try {
      const result = await api.getArtistsPage({ search: deferredArtistSearch, limit: ARTISTS_PAGE_SIZE, offset })
      if (requestId !== artistRequestRef.current) return
      const nextItems = Array.isArray(result?.items) ? result.items : Array.isArray(result) ? result : []
      artistOffsetRef.current = offset + nextItems.length
      setArtists(prev => offset === 0 ? nextItems : [...prev, ...nextItems])
      setArtistsHasMore(Boolean(result?.hasMore))
      setArtistsTotal(Number(result?.total) || nextItems.length)
    } finally {
      if (requestId === artistRequestRef.current) {
        setArtistsLoading(false)
      }
    }
  }

  const refreshArtists = async () => {
    artistOffsetRef.current = 0
    setArtists([])
    await loadArtists()
  }

  const loadPlugins = async () => {
    setPluginsLoading(true)
    const result = await api.pluginsList()
    if (Array.isArray(result)) {
      setPlugins(result)
      setPluginStatus('')
    } else {
      setPlugins([])
      setPluginStatus(result?.error || 'Failed to load plugins')
    }
    setPluginsLoading(false)
  }

  const loadUsers = async () => {
    setUsersLoading(true)
    const result = await api.listUsers()
    setAppUsers(Array.isArray(result) ? result : [])
    setUsersLoading(false)
  }

  useEffect(() => {
    if (activeCategory === 'artists') {
      refreshArtists()
    }
  }, [activeCategory, deferredArtistSearch])

  useEffect(() => {
    if (activeCategory === 'plugins') {
      loadPlugins()
    }
  }, [activeCategory])

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
      await api.updaterCheck()
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

  const savePerfSettings = async (newSettings) => {
    const changed = newSettings.hardwareAcceleration !== perfSettings.hardwareAcceleration
    setPerfSettings(newSettings)
    await api.savePerfSettings(newSettings)
    if (changed) {
      setRelaunchMsg('Restart required to apply hardware acceleration change')
      setTimeout(() => setRelaunchMsg(''), 5000)
    }
  }

  const set = (k, v) => setSettings(s => ({ ...s, [k]: v }))

  const save = async () => {
    await api.saveSettings(settings)
    localStorage.setItem('lokal-eq', JSON.stringify(eqGains))
    localStorage.setItem('lokal-eq-preset', eqPreset)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const openLastfmPage = async (url) => {
    await api.openExternal(url)
  }

  const applyEqGains = (nextGains, presetKey = getEqPresetKey(nextGains)) => {
    const normalized = normalizeEqGains(nextGains)
    setEqGains(normalized)
    setEqPreset(presetKey)
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
    if (activeCategory === 'artists') {
      refreshArtists()
    }
  }

  const connectDiscord = async () => {
    const id = settings.discord_use_default_app_id === '0'
      ? settings.discord_client_id
      : DEFAULT_DISCORD_CLIENT_ID
    if (!id) { setDiscordStatus('Enter a Client ID first'); return }
    await api.saveSettings({ discord_client_id: id })
    setDiscordStatus('Resetting previous session…')
    await api.discordDisconnect()
    setDiscordStatus('Connecting…')
    const ok = await api.discordConnect(id)
    setDiscordStatus(ok ? '✓ Connected!' : '✗ Failed — is Discord open?')
    setTimeout(() => setDiscordStatus(''), 6000)
  }

  const disconnectDiscord = async () => {
    setDiscordStatus('Disconnecting…')
    await api.discordDisconnect()
    setDiscordStatus('✓ Disconnected')
    setTimeout(() => setDiscordStatus(''), 4000)
  }

  const importPhotos = async () => {
    setImportStatus('Importing…')
    const dir = settings.photos_dir || 'C:\\Users\\sipbuu\\lokal\\src\\photos'
    const r = await api.importPhotosDir(dir)
    if (r?.error) setImportStatus('Error: ' + r.error)
    else setImportStatus(`✓ Matched ${r.matched}/${r.total}`)
    setTimeout(() => setImportStatus(''), 5000)
  }

  const applyImageUrl = async () => {
    if (!urlTarget.type || !urlTarget.id || !urlTarget.url) return
    if (urlTarget.type === 'artist') await api.artistSetImageUrl(urlTarget.id, urlTarget.url)
    setShowUrlModal(false)
    setUrlTarget({ type: '', id: '', url: '' })
    refreshArtists()
  }

  const checkDuplicates = async () => {
    const d = await api.checkDuplicates()
    setDups(Array.isArray(d) ? d : [])
    setShowDups(true)
  }

  const mergeDup = async (group) => {
    const ids = group.ids.split(',')
    const keepId = ids[0]
    const removeIds = ids.slice(1)
    await api.mergeDuplicates(keepId, removeIds)
    setDups(prev => prev.filter(d => d.ids !== group.ids))
  }

  const mergeAllDuplicates = async () => {
    setMergingAll(true)
    setShowMergeAllConfirm(false)
    try {
      const result = await api.mergeAllDuplicates()
      setMergeAllResult(result)
      const d = await api.checkDuplicates()
      setDups(Array.isArray(d) ? d : [])
    } catch (e) {
      setMergeAllResult({ error: e.message })
    }
    setMergingAll(false)
  }

  const checkPossibleDuplicates = async () => {
    const groups = await api.checkPossibleDuplicates()
    setPossibleDups(Array.isArray(groups) ? groups : [])
    setShowPossibleDups(true)
  }

  const mergePossibleDup = async (group, keepId) => {
    const removeIds = (group?.tracks || []).map(track => track.id).filter(id => id !== keepId)
    if (!removeIds.length) return
    await api.mergeDuplicates(keepId, removeIds)
    setPossibleDups(prev => prev.filter(item => item.id !== group.id))
  }

  const saveCommaArtists = async () => {
    const artists = commaInput.split('\n').map(s => s.trim()).filter(Boolean)
    await api.setKeepCommaArtists(artists)
    setKeepCommaArtists(artists)
    setShowCommaModal(false)
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
    setToolsLoading(true)
    await api.downloadYtDlp()
    setToolsLoading(false)
    api.getToolsStatus().then(setToolsStatus)
  }

  const downloadFfmpegTool = async () => {
    setToolsLoading(true)
    await api.downloadFfmpeg()
    setToolsLoading(false)
    api.getToolsStatus().then(setToolsStatus)
  }

  const setCustomToolPath = async (tool) => {
    const fp = await api.openFile()
    if (fp) {
      await api.setCustomToolPath(tool, fp)
      api.getToolsStatus().then(setToolsStatus)
    }
  }

  const handlePlaylistImport = async (fileContent, fileType) => {
    const uid = user?.id
    if (!playlistImportName.trim()) {
      setPlaylistImportStatus('Please enter a playlist name')
      return
    }
    if (!fileContent && !playlistImportEntries.trim()) {
      setPlaylistImportStatus('Please select a file or enter entries')
      return
    }
    setPlaylistImportStatus('Importing...')
    try {
      let result
      if (fileContent && fileType) {
        result = await api.playlistImportFile(playlistImportName.trim(), fileContent, fileType, uid)
      } else {
        const entries = playlistImportEntries.split('\n')
          .map(line => line.trim())
          .filter(Boolean)
          .map(line => {
            const dashIndex = line.lastIndexOf(' - ')
            if (dashIndex > 0) {
              return {
                artist: line.substring(0, dashIndex).trim(),
                title: line.substring(dashIndex + 3).trim()
              }
            }
            return { title: line }
          })
        result = await api.playlistImport(playlistImportName.trim(), entries, uid)
      }
      if (result.error) {
        setPlaylistImportStatus('Error: ' + result.error)
      } else {
        setPlaylistImportStatus(`✓ Imported ${result.matched}/${result.total} tracks`)
        setPlaylistImportResult(result)
        if (result.unmatched && result.unmatched.length > 0) {
          setPlaylistImportStatus(`Imported ${result.matched}/${result.total} tracks`)
        } else {
          setTimeout(() => {
            setShowPlaylistImportModal(false)
            setPlaylistImportName('')
            setPlaylistImportEntries('')
            setPlaylistImportStatus('')
            setPlaylistImportResult(null)
          }, 2000)
        }

        window.dispatchEvent(
          new CustomEvent('lokal:playlists-changed', {
            detail: { playlistId: result.playlistId, action: 'imported' }
          })
        )

      }
    } catch (e) {
      setPlaylistImportStatus('Error: ' + e.message)
    }
  }

  const handleFileSelect = async () => {
    const fp = await api.openFile([{ name: 'Playlist Files', extensions: ['m3u', 'm3u8', 'csv', 'json'] }])
    if (fp) {
      try {
        const content = await api.readFileBinary(fp)
        const ext = fp.split('.').pop().toLowerCase()
        const fileType = ext === 'm3u8' ? 'm3u' : ext
        await handlePlaylistImport(content, fileType)
      } catch (e) {
        setPlaylistImportStatus('Error reading file: ' + e.message)
      }
    }
  }

  const handlePlatformFileSelect = async () => {
    const fp = await api.openFile([{ name: 'Import Files', extensions: ['csv', 'json', 'm3u', 'm3u8'] }])
    if (!fp) return
    try {
      const content = await api.readFileBinary(fp)
      const ext = fp.split('.').pop().toLowerCase()
      const fileType = ext === 'm3u8' ? 'm3u' : ext
      const preview = await api.previewExternalPlaylistImport({
        fileContent: content,
        fileType,
        sourcePlatform: platformImportPlatform,
      })
      if (preview?.error) {
        setPlatformImportStatus('Error: ' + preview.error)
        setPlatformImportPreview(null)
        return
      }
      setPlatformImportFileName(fp.split(/[/\\]/).pop())
      setPlatformImportFileContent(content)
      setPlatformImportFileType(fileType)
      setPlatformImportPreview(preview)
      setPlatformImportStatus(preview.total ? `Ready to ${platformImportMode === 'metadata' ? 'apply metadata to' : 'import'} ${preview.total} tracks` : 'No tracks found in file')
      if (platformImportMode !== 'metadata' && !platformImportName.trim()) {
        const baseName = fp.split(/[/\\]/).pop().replace(/\.[^.]+$/, '')
        setPlatformImportName(baseName)
      }
    } catch (e) {
      setPlatformImportStatus('Error reading file: ' + e.message)
      setPlatformImportPreview(null)
    }
  }

  const handlePlatformImport = async () => {
    const uid = user?.id
    if (platformImportMode !== 'metadata' && !platformImportName.trim()) {
      setPlatformImportStatus('Please enter a playlist name')
      return
    }
    if (!platformImportFileContent) {
      setPlatformImportStatus('Please choose a CSV, JSON, or M3U file')
      return
    }
    setPlatformImporting(true)
    setPlatformImportStatus('Importing...')
    try {
      const result = platformImportMode === 'metadata'
        ? await api.importExternalTrackMetadata({
            fileContent: platformImportFileContent,
            fileType: platformImportFileType,
            sourcePlatform: platformImportPlatform,
          })
        : await api.importExternalPlaylist({
            name: platformImportName.trim(),
            fileContent: platformImportFileContent,
            fileType: platformImportFileType,
            userId: uid || 'guest',
            sourcePlatform: platformImportPlatform,
          })
      if (result?.error) {
        setPlatformImportStatus('Error: ' + result.error)
      } else {
        setPlatformImportStatus(platformImportMode === 'metadata'
          ? `Applied metadata to ${result.matched}/${result.total} matched tracks. Skipped ${result.skipped || 0}.`
          : `Imported ${result.matched}/${result.total} matches with ${result.ghosted || 0} ghost songs`)
        setPlatformImportPreview(prev => prev ? {
          ...prev,
          imported: result,
        } : prev)
        if (platformImportMode === 'metadata') {
          window.dispatchEvent(new Event('lokal:refresh'))
        } else {
          window.dispatchEvent(
            new CustomEvent('lokal:playlists-changed', {
              detail: { playlistId: result.playlistId, action: 'imported' }
            })
          )
        }
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

  const handlePluginReload = async () => {
    setPluginsLoading(true)
    const result = await api.pluginsReload()
    if (result?.error) {
      setPluginStatus(result.error)
    } else {
      const list = Array.isArray(result?.plugins) ? result.plugins : await api.pluginsList()
      setPlugins(Array.isArray(list) ? list : [])
      setPluginStatus('Plugins reloaded')
      setTimeout(() => setPluginStatus(''), 2500)
    }
    setPluginsLoading(false)
  }

  const handlePluginEnableToggle = async (plugin) => {
    const action = plugin.enabled ? api.pluginsDisable : api.pluginsEnable
    const result = await action(plugin.id)
    if (result?.error) {
      setPluginStatus(result.error)
      return
    }
    await loadPlugins()
  }

  const handlePluginRemove = async (pluginId) => {
    const result = await api.pluginsRemove(pluginId)
    if (result?.error) {
      setPluginStatus(result.error)
      return
    }
    setPluginStatus('Plugin removed')
    await loadPlugins()
  }

  const choosePluginFolder = async () => {
    const selected = await api.openFolder()
    if (selected) setPluginInstallFolder(selected)
  }

  const handlePluginInstall = async () => {
    if (!pluginInstallFolder.trim()) {
      setPluginStatus('Enter a plugin folder path')
      return
    }
    const result = await api.pluginsInstallFromFolder(pluginInstallFolder.trim())
    if (result?.error) {
      setPluginStatus(result.error)
      return
    }
    setPluginStatus('Plugin installed')
    setPluginInstallFolder('')
    await loadPlugins()
  }

  const filtered = artists

  const exportMenuItems = [
    { label: 'Export as JSON', icon: <Download size={14} />, onClick: () => handleHistoryExport('json') },
    { label: 'Export as CSV', icon: <Download size={14} />, onClick: () => handleHistoryExport('csv') },
  ]
  const inCategory = (key) => activeCategory === key
  const usingDefaultDiscordId = settings.discord_use_default_app_id !== '0'

  return (
    <div className="p-6 max-w-2xl space-y-6 pb-10">
      <div className="space-y-3 sticky top-0 z-10 bg-bg/80 backdrop-blur-sm py-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-lg uppercase tracking-widest text-white">Settings</h1>
          <div className="flex items-center gap-3">
            <button onClick={save}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent/80 transition-colors">
              <Save size={14} /> Save Settings
            </button>
            <AnimatePresence>
              {saved && (
                <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="text-xs text-accent flex items-center gap-1">
                  <CheckCircle size={12} /> Saved
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SETTINGS_CATEGORIES.map((item) => {
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

      {api.isElectron && inCategory('library') && (
        <Section title="About">
          <Row label="Version" desc="Current app version">
            <span className="text-sm text-muted font-mono">{appVersion || '1.0.0'}</span>
          </Row>
          <Row label="Check for Updates" desc="Manually check for new versions">
            <div className="flex items-center gap-3">
              <button 
                onClick={checkForUpdates}
                disabled={checkingUpdate}
                className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 disabled:opacity-40 transition-colors"
              >
                <RefreshCcw size={13} className={checkingUpdate ? 'animate-spin' : ''} />
                {checkingUpdate ? 'Checking...' : 'Check for updates'}
              </button>
              {updateCheckResult && (
                <span className="text-xs text-muted">{updateCheckResult}</span>
              )}
            </div>
          </Row>
          <Row label="Debug Logs" desc="Open the folder containing application logs">
            <button 
              onClick={() => api.openLogs?.()}
              className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors"
            >
              <FolderOpen size={14} /> Show Logs
            </button>
          </Row>
        </Section>
      )}

      {inCategory('library') && (
      <Section title="Library">
        <Row label="Music Folder">
          <div className="flex items-center gap-2">
            <input value={settings.music_folder || ''} onChange={e => set('music_folder', e.target.value)}
              placeholder="C:\Users\sipbuu\Music"
              className="w-52 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            {api.isElectron && (
              <button onClick={async () => { const f = await api.openFolder(); if (f) set('music_folder', f) }}
                className="p-1.5 bg-card border border-border rounded-lg text-muted hover:text-white transition-colors">
                <FolderOpen size={14} />
              </button>
            )}
          </div>
        </Row>
        <Row label="Fetch Online Artwork" desc="Try iTunes/MusicBrainz if no embedded artwork found">
          <button
            onClick={() => set('fetch_online_artwork', settings.fetch_online_artwork === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.fetch_online_artwork !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.fetch_online_artwork !== '0' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Show Singles in Albums" desc="Include one-track releases inside the Albums page instead of hiding them from that browser.">
          <button
            onClick={() => set('show_singles_in_albums', settings.show_singles_in_albums === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.show_singles_in_albums !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.show_singles_in_albums !== '0' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Separate Albums by Type" desc="Split the Albums page into Albums, EPs, and Singles instead of mixing every release together.">
          <button
            onClick={() => set('separate_album_types', settings.separate_album_types === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.separate_album_types !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.separate_album_types !== '0' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Use YouTube Cookies" desc="Pass cookies to yt-dlp to bypass rate limiting, access private playlists and liked music. Not shared elsewhere.">
          <div className="flex items-center gap-2">
            <button
              onClick={() => set('yt_cookies', settings.yt_cookies === '0' ? '1' : '0')}
              className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.yt_cookies === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
              {settings.yt_cookies === '1' ? 'Yes' : 'No'}
            </button>
            {settings.yt_cookies === '1' && (
              <select
                value={settings.yt_cookie_browser || 'firefox'}
                onChange={e => set('yt_cookie_browser', e.target.value)}
                className="bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50">
                <option value="firefox">Firefox</option>
                <option value="chrome">Chrome</option>
                <option value="edge">Edge</option>
                <option value="brave">Brave</option>
                <option value="opera">Opera</option>
              </select>
            )}
          </div>
        </Row>
        <Row label="Index While Downloading" desc="Index tracks as soon as they finish downloading. Makes them appear in the library faster.">
          <button
            onClick={() => set('index_while_downloading', settings.index_while_downloading === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.index_while_downloading === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.index_while_downloading === '1' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Prefer Cleaner Download Metadata" desc="Choose whether Lokal should prefer a simpler artist name when indexing yt-dlp downloads instead of using every embedded contributor from the file metadata.">
          <button
            onClick={() => set('clean_download_metadata', settings.clean_download_metadata === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.clean_download_metadata !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.clean_download_metadata !== '0' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Skip Drum-kit Pattern" desc="Skip tracks with drum-kit/loop/sample keywords in title">
          <button
            onClick={() => set('skip_drumkit_pattern', settings.skip_drumkit_pattern === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.skip_drumkit_pattern !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.skip_drumkit_pattern !== '0' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Auto-fetch Genres" desc="Fill in missing genres from iTunes for tracks without one">
          <button onClick={async () => { const result = await api.fetchMissingGenres(); setStatusMessage(`Updated ${result?.updated || 0} of ${result?.total || 0} tracks`) }}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Fetch Missing
          </button>
        </Row>
        <Row label="Manual Genre Assignment" desc="Set specific genre overrides for artists, tracks, or albums">
          <button 
            onClick={() => setShowGenreModal(true)}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center gap-2"
          >
            <Tags size={14} /> Configure Overrides
          </button>
        </Row>
        {statusMessage && <p className="text-xs text-accent ml-2">{statusMessage}</p>}
        <Row label="Min. Duration" desc="Skip tracks shorter than this (filters sample packs)">
          <div className="flex items-center gap-2">
            <input type="number" min={0} max={300} value={settings.min_duration || 60} onChange={e => set('min_duration', e.target.value)}
              className="w-16 bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white text-center outline-none focus:border-accent/50" />
            <span className="text-xs text-muted">sec</span>
          </div>
        </Row>
        <Row label="Rescan Library">
          <button onClick={rescan} disabled={scanning || !settings.music_folder}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-white hover:border-accent/30 disabled:opacity-40 transition-colors">
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />{scanning ? 'Scanning…' : 'Rescan'}
          </button>
        </Row>
        <Row label="Check Duplicates" desc="Find tracks with same title & artist">
          <button onClick={checkDuplicates}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Check
          </button>
        </Row>
        <Row label="Possible Duplicates" desc="Use this after the normal duplicate checker. Finds likely leftovers with similar names and durations, then lets you review which copy to keep.">
          <button onClick={checkPossibleDuplicates}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Review
          </button>
        </Row>
        <Row label="Clear All Data" desc="Wipes DB — files untouched">
          <button onClick={() => setShowClearModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/25 transition-colors">
            <Trash2 size={13} /> Clear
          </button>
        </Row>
      </Section>
      )}

      {inCategory('artists') && (
      <Section title="Artist Photos">
        <Row label="Auto Add Artist Bio & Image" desc="When opening an artist page, try to fetch a missing bio and a better artist image automatically. Default is off.">
          <button
            onClick={() => set('auto_fetch_artist_metadata', settings.auto_fetch_artist_metadata === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.auto_fetch_artist_metadata === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.auto_fetch_artist_metadata === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Photos folder" desc="Folder containing artist images named after artists (Drake.jpg etc)">
          <div className="flex items-center gap-2">
            <input value={settings.photos_dir || ''} onChange={e => set('photos_dir', e.target.value)}
              placeholder="C:\Users\sipbuu\lokal\src\photos"
              className="w-52 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            {api.isElectron && (
              <button onClick={async () => { const f = await api.openFolder(); if (f) set('photos_dir', f) }}
                className="p-1.5 bg-card border border-border rounded-lg text-muted hover:text-white transition-colors">
                <FolderOpen size={14} />
              </button>
            )}
          </div>
        </Row>
        <Row label="Auto-import Photos">
          <div className="flex items-center gap-3">
            <button onClick={importPhotos} className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
              Import All
            </button>
            {importStatus && <span className={`text-xs ${importStatus.startsWith('✓') ? 'text-accent' : 'text-muted'}`}>{importStatus}</span>}
          </div>
        </Row>
        <Row label="Set Image by URL" desc="Download image from URL, assign to artist">
          <button onClick={async () => { if (!artists.length) await refreshArtists(); setShowUrlModal(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            <Link size={13} /> Set URL
          </button>
        </Row>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="Backup">
        <Row label="Full App Export" desc="Exports local users, settings, themes, playlists, likes, history, artists, and tracks into one JSON backup.">
          <button
            onClick={handleFullExport}
            disabled={exportingAllData}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <Download size={13} /> {exportingAllData ? 'Exporting...' : 'Export All'}
            {fullExported && <span className="text-accent text-xs ml-1">✓</span>}
          </button>
        </Row>
        <Row label="Import Backup" desc="Replaces current Lokal data with a backup JSON after review and confirmation.">
          <button
            onClick={readImportBackup}
            disabled={importingAllData}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCcw size={13} /> {importingAllData ? 'Importing...' : 'Import'}
          </button>
        </Row>
        <p className="text-xs text-muted">
          This is a local JSON snapshot of app data, not your actual audio files.
        </p>
      </Section>
      )}

      {inCategory('data') && (
      <Section title="History">
        <Row label="Export History" desc="Download your listen history">
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

      {inCategory('data') && (
      <Section title="Playlists">
        <Row label="Import Playlist" desc="Create playlist from text entries (Artist - Title per line)">
          <button onClick={() => setShowPlaylistImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors">
            <ListMusic size={14} /> Import
          </button>
        </Row>
        <Row label="Import from Other Platforms" desc="Import CSV, JSON, or M3U exports from tools like Exportify, Google Takeout, and other playlist export services, then resolve anything missing inside Lokal.">
          <button onClick={() => { setPlatformImportMode('playlist'); setPlatformImportStatus(''); setPlatformImportPreview(null); setShowPlatformImportGuide(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors">
            <Link size={14} /> Import
          </button>
        </Row>
        <Row label="Import Track Metadata" desc="Apply genres, explicit flags, labels, and audio-feature data from exports like Exportify onto songs already in your Lokal library.">
          <button onClick={() => { setPlatformImportMode('metadata'); setPlatformImportStatus(''); setPlatformImportPreview(null); setShowPlatformImportGuide(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors">
            <Link size={14} /> Import Metadata
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
            {!usersLoading && appUsers.length === 0 && (
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
      <Section title="Danger Zone">
        <Row label="Factory Reset Lokal" desc="Erases local accounts, settings, themes, playlists, history, artists, tracks, and cached assets on this device. Music files are not deleted.">
          <button
            onClick={() => setShowFactoryResetModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/25 transition-colors"
          >
            <Trash2 size={13} /> Factory Reset
          </button>
        </Row>
      </Section>
      )}

      {api.isElectron && inCategory('integrations') && (
        <Section title="External Tools">
          <p className="text-xs text-muted mb-4">Manage yt-dlp and ffmpeg for downloading YouTube videos.</p>
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${toolsStatus?.ytdlp?.found ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-white">yt-dlp</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadYtDlpTool()} disabled={toolsLoading} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white disabled:opacity-40">
                  {toolsLoading ? 'Downloading...' : toolsStatus?.ytdlp?.found ? 'Re-download' : 'Download'}
                </button>
                <button onClick={() => setCustomToolPath('yt-dlp')} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white">Custom Path</button>
              </div>
            </div>
            {toolsStatus?.ytdlp?.path && <p className="text-xs text-muted/50 truncate">{toolsStatus.ytdlp.path}</p>}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${toolsStatus?.ffmpeg?.found ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-white">ffmpeg</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadFfmpegTool()} disabled={toolsLoading} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white disabled:opacity-40">
                  {toolsLoading ? 'Downloading...' : toolsStatus?.ffmpeg?.found ? 'Re-download' : 'Download'}
                </button>
                <button onClick={() => setCustomToolPath('ffmpeg')} className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white">Custom Path</button>
              </div>
            </div>
            {toolsStatus?.ffmpeg?.path && <p className="text-xs text-muted/50 truncate">{toolsStatus.ffmpeg.path}</p>}
          </div>
        </Section>
      )}

      {inCategory('artists') && (
      <Section title="Artist Name Filtering">
        <Row label="Keep Comma in Artist Names" desc="Prevents splitting artists like 'Tyler, The Creator'">
          <button onClick={() => setShowCommaModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Configure ({keepCommaArtists.length})
          </button>
        </Row>
      </Section>
      )}

      {inCategory('playback') && (
      <Section title="Lyrics">
        <Row label="Source">
          <select value={settings.lyrics_source || 'lrclib'} onChange={e => set('lyrics_source', e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent/50">
            <option value="lrclib">LRCLIB (synced)</option>
            <option value="lyricsovh">lyrics.ovh (plain)</option>
            <option value="both">Both (LRCLIB first)</option>
          </select>
        </Row>
        <Row label="Word-by-Word Sync" desc="Animate individual words (synced lyrics only)">
          <button
            onClick={() => { const v = settings.word_sync !== '1'; set('word_sync', v ? '1' : '0'); localStorage.setItem('word-sync', v ? '1' : '0') }}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.word_sync === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.word_sync === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Unsynced Lyrics Auto-Sync" desc="Rough estimation to sync plain lyrics">
          <button
            onClick={() => set('unsynced_auto_sync', settings.unsynced_auto_sync === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.unsynced_auto_sync === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.unsynced_auto_sync === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Clear Lyrics Cache">
          <button onClick={() => api.clearLyricsDb()}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors flex items-center gap-2">
            <RefreshCw size={13} /> Clear
          </button>
        </Row>
      </Section>
      )}

      {inCategory('playback') && (
      <Section title="Playback & EQ">
        <Row label="Crossfade" desc="Fades into next track automatically — never on manual skip">
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={12} step={0.5} value={settings.crossfade_seconds || 0}
              onChange={e => set('crossfade_seconds', e.target.value)} className="w-24 accent-accent" />
            <span className="text-xs text-muted w-10">{settings.crossfade_seconds || 0}s</span>
          </div>
        </Row>
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
          <p className="text-xs text-muted mt-3 text-center opacity-50">Click anywhere in app once to activate EQ</p>
        </div>
      </Section>
      )}

      {inCategory('integrations') && (
      <Section title="Discord Rich Presence">
        <Row label="Use Default App ID" desc="Uses your built-in Discord app ID by default">
          <button
            onClick={() => set('discord_use_default_app_id', usingDefaultDiscordId ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${usingDefaultDiscordId ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {usingDefaultDiscordId ? 'Yes' : 'No'}
          </button>
        </Row>
        {!usingDefaultDiscordId && (
          <Row label="Custom App Client ID" desc="Optional override if you want to use your own Discord app">
            <input value={settings.discord_client_id || ''} onChange={e => set('discord_client_id', e.target.value)}
              placeholder={DEFAULT_DISCORD_CLIENT_ID}
              className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
          </Row>
        )}
        <Row label="Connect On Startup" desc="Automatically tries to start Discord Rich Presence when Lokal opens">
          <button
            onClick={() => set('discord_auto_connect', settings.discord_auto_connect === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.discord_auto_connect === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.discord_auto_connect === '1' ? 'Yes' : 'No'}
          </button>
        </Row>
        <Row label="Connect">
          <div className="flex items-center gap-3">
            <button onClick={connectDiscord}
              className="px-4 py-2 bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#7289da] rounded-lg text-sm hover:bg-[#5865F2]/30 transition-colors">
              Connect
            </button>
            <button onClick={disconnectDiscord}
              className="px-4 py-2 bg-card border border-border text-muted rounded-lg text-sm hover:text-white hover:border-accent/30 transition-colors">
              Kill Previous
            </button>
            {discordStatus && (
              <span className={`text-xs ${discordStatus.startsWith('✓') ? 'text-accent' : discordStatus.startsWith('✗') ? 'text-red-400' : 'text-muted'}`}>
                {discordStatus}
              </span>
            )}
          </div>
        </Row>
      </Section>
      )}

      {inCategory('integrations') && (
      <Section title="Last.fm">
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <div>
            <p className="text-sm text-white font-medium">Quick Setup</p>
            <p className="text-xs text-muted mt-0.5">Need your API app or Last.fm profile details first? These shortcuts open the right pages.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => openLastfmPage('https://www.last.fm/api/account/create')}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              Create API App
            </button>
            <button
              onClick={() => openLastfmPage('https://www.last.fm/api/accounts')}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              API Dashboard
            </button>
            <button
              onClick={() => openLastfmPage('https://www.last.fm/user')}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              Find Username
            </button>
          </div>
        </div>
        <Row label="API Key" desc="Open API Dashboard if you need to copy it from your Last.fm app settings">
          <div className="flex items-center gap-2">
            <input value={settings.lastfm_api_key || ''} onChange={e => set('lastfm_api_key', e.target.value)}
              placeholder="Your Last.fm API key"
              className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            <button
              onClick={() => openLastfmPage('https://www.last.fm/api/accounts')}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              Open
            </button>
          </div>
        </Row>
        <Row label="API Secret" desc="Open API Dashboard if you need to copy the matching secret">
          <div className="flex items-center gap-2">
            <input value={settings.lastfm_api_secret || ''} onChange={e => set('lastfm_api_secret', e.target.value)}
              placeholder="Your API secret"
              className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            <button
              onClick={() => openLastfmPage('https://www.last.fm/api/accounts')}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              Open
            </button>
          </div>
        </Row>
        <Row label="Username" desc="Open your Last.fm profile if you need to confirm the exact username">
          <div className="flex items-center gap-2">
            <input value={settings.lastfm_username || ''} onChange={e => set('lastfm_username', e.target.value)}
              placeholder="username"
              className="w-40 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            <button
              onClick={() => openLastfmPage('https://www.last.fm/user')}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              Open
            </button>
          </div>
        </Row>
        <Row label="Scrobbling" desc="Submit plays to Last.fm when tracks finish">
          <button
            onClick={() => { const v = settings.lastfm_scrobbling !== '1'; set('lastfm_scrobbling', v ? '1' : '0') }}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.lastfm_scrobbling === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.lastfm_scrobbling === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Authorization" desc="Open Last.fm in your browser and let Lokal finish the connection automatically">
          <div className="flex flex-col items-start gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  if (!settings.lastfm_api_key || !settings.lastfm_api_secret) {
                    setLastfmStatus('Need API key and secret')
                    pushLastfmFeed({
                      level: 'error',
                      label: 'Authorization',
                      message: 'Add your API key and secret before authorizing'
                    })
                    return
                  }
                  setLastfmAuthorizing(true)
                  setLastfmStatus('Waiting for browser authorization...')
                  pushLastfmFeed({
                    level: 'info',
                    label: 'Authorization',
                    message: 'Opened Last.fm authorization in your browser'
                  })
                  await api.lastfmAuthorize(settings.lastfm_api_key)
                }}
                className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
              >
                {lastfmAuthorizing ? 'Waiting...' : 'Authorize in Browser'}
              </button>
              <input value={settings.lastfm_auth_token || ''} onChange={e => set('lastfm_auth_token', e.target.value)}
                placeholder="Manual token fallback"
                className="w-44 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
              <button 
                onClick={async () => {
                  if (!settings.lastfm_api_key || !settings.lastfm_api_secret || !settings.lastfm_auth_token) {
                    setLastfmStatus('Need API key, secret, and token')
                    pushLastfmFeed({
                      level: 'error',
                      label: 'Connection',
                      message: 'Missing API key, secret, or auth token'
                    })
                    return
                  }
                  setLastfmStatus('Connecting...')
                  pushLastfmFeed({
                    level: 'info',
                    label: 'Connection',
                    message: 'Exchanging manual Last.fm token for a session'
                  })
                  const result = await api.lastfmConnect(settings.lastfm_api_key, settings.lastfm_api_secret, settings.lastfm_auth_token)
                  if (result.sessionKey) {
                    await api.saveSettings({ 
                      lastfm_session_key: result.sessionKey,
                      lastfm_username: result.username || settings.lastfm_username,
                      lastfm_auth_token: settings.lastfm_auth_token
                    })
                    setSettings(prev => ({
                      ...prev,
                      lastfm_session_key: result.sessionKey,
                      lastfm_username: result.username || prev.lastfm_username
                    }))
                    setLastfmStatus('✓ Connected as ' + (result.username || settings.lastfm_username))
                    pushLastfmFeed({
                      level: 'success',
                      label: 'Connection',
                      message: `Connected as ${result.username || settings.lastfm_username || 'Last.fm user'}`
                    })
                  } else {
                    setLastfmStatus(result.error || 'Failed')
                    pushLastfmFeed({
                      level: 'error',
                      label: 'Connection',
                      message: result.error || 'Failed to connect to Last.fm'
                    })
                  }
                }}
                className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors">
                Connect
              </button>
            </div>
            {lastfmStatus && (
              <span className={`text-xs leading-relaxed ${lastfmStatus.startsWith('✓') ? 'text-accent' : lastfmStatus.startsWith('Need') || lastfmStatus.startsWith('Failed') ? 'text-red-400' : 'text-muted'}`}>
                {lastfmStatus}
              </span>
            )}
          </div>
        </Row>
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-white font-medium">Last.fm Status</p>
              <p className="text-xs text-muted mt-0.5">Connection, now playing, and scrobble events from this session.</p>
            </div>
            <div className="text-right text-xs text-muted">
              <div>{settings.lastfm_session_key ? 'Session ready' : 'No session'}</div>
              <div>{settings.lastfm_username ? `User: ${settings.lastfm_username}` : 'User: not connected'}</div>
            </div>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {!lastfmFeed.length && (
              <div className="text-xs text-muted">No Last.fm events yet.</div>
            )}
            {lastfmFeed.map(item => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-black/20 px-3 py-2">
                <div className="min-w-0">
                  <div className={`text-xs ${item.level === 'success' ? 'text-accent' : item.level === 'error' ? 'text-red-400' : 'text-white/80'}`}>
                    {item.label}
                  </div>
                  <div className="text-xs text-muted break-words">{item.message}</div>
                </div>
                <div className="text-[10px] text-muted whitespace-nowrap">
                  {new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>
      )}

      {inCategory('plugins') && (
      <Section title="Plugins">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              value={pluginInstallFolder}
              onChange={e => setPluginInstallFolder(e.target.value)}
              placeholder="C:\\Users\\you\\MyPluginFolder"
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-accent/50"
            />
            {api.isElectron && (
              <button
                onClick={choosePluginFolder}
                className="px-3 py-2 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
              >
                Browse
              </button>
            )}
            <button
              onClick={handlePluginInstall}
              className="px-3 py-2 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors"
            >
              Install
            </button>
            <button
              onClick={handlePluginReload}
              disabled={pluginsLoading}
              className="px-3 py-2 bg-card border border-border rounded-lg text-xs text-muted hover:text-white disabled:opacity-40 transition-colors"
            >
              {pluginsLoading ? 'Loading...' : 'Reload'}
            </button>
          </div>
          {pluginStatus && <p className="text-xs text-muted">{pluginStatus}</p>}
        </div>

        <div className="space-y-2">
          <p className="text-sm text-white font-medium">Installed Plugins</p>
          {pluginsLoading && <p className="text-xs text-muted">Loading plugins...</p>}
          {!pluginsLoading && plugins.length === 0 && (
            <p className="text-xs text-muted">No plugins installed yet.</p>
          )}
          {!pluginsLoading && plugins.length > 0 && (
            <div className="space-y-2">
              {plugins.map((plugin) => (
                <div key={plugin.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card/40">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{plugin.name} <span className="text-xs text-muted">v{plugin.version}</span></p>
                    <p className="text-xs text-muted truncate">{plugin.id}</p>
                    {plugin.description && <p className="text-xs text-muted/80 truncate">{plugin.description}</p>}
                    {plugin.loadError && <p className="text-xs text-red-400 truncate">{plugin.loadError}</p>}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handlePluginEnableToggle(plugin)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${plugin.enabled ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-card border-border text-muted hover:text-white'}`}
                    >
                      {plugin.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => handlePluginRemove(plugin.id)}
                      className="px-3 py-1.5 rounded-lg text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-border">
          <p className="text-sm text-white font-medium">Developer Setup</p>
          <div className="text-xs text-muted space-y-1">
            <p>1. Create a folder with plugin.json and index.js.</p>
            <p>2. Use Install with that folder path.</p>
            <p>3. Reload plugins after edits.</p>
          </div>
          <pre className="bg-card border border-border rounded-lg p-3 text-[11px] text-muted overflow-x-auto">
{`plugin.json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "entry": "index.js",
  "hooks": ["onTrackIndexed"]
}

index.js
module.exports = {
  async onTrackIndexed(track, sdk) {
    const state = sdk.storage.get()
    sdk.storage.set({ ...state, lastTrack: track.id })
    sdk.log("Indexed", track.title)
  }
}`}
          </pre>
          <p className="text-xs text-muted">Hook payload includes id, title, artist, album, genre, duration, and filePath.</p>
        </div>
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
              desc="Try to color-shift the PNG logo toward the current theme accent. Best effort only."
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

      {inCategory('artists') && (
      <Section title="Artist Management">
        <div className="space-y-3">
          <input value={artistSearch} onChange={e => setArtistSearch(e.target.value)}
            placeholder="Search artists…"
            className="w-full bg-card border border-border rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-accent/50" />
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{artistsLoading ? 'Loading artists...' : `${filtered.length} loaded${artistsTotal ? ` of ${artistsTotal}` : ''}`}</span>
            {!!artistSearch.trim() && <span>Searching server-side</span>}
          </div>
        </div>
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {filtered.map(a => (
            <div key={a.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-card group transition-colors">
              <div>
                <p className="text-sm text-white">{a.name}</p>
                <p className="text-xs text-muted">{a.track_count} tracks</p>
              </div>
              <button onClick={() => setManageArtist(a)}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted hover:text-white px-2 py-1 rounded border border-border transition-all">
                Manage
              </button>
            </div>
          ))}
        </div>
        {!artistsLoading && !filtered.length && (
          <p className="text-sm text-muted text-center py-4">No artists found.</p>
        )}
        {artistsHasMore && (
          <button
            onClick={loadArtists}
            disabled={artistsLoading}
            className="w-full py-2 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            {artistsLoading ? 'Loading...' : 'Load More Artists'}
          </button>
        )}
      </Section>
      )}

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
              className="flex-1 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity"
            >
              Apply Mapping
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showUrlModal} onClose={() => setShowUrlModal(false)} title="Set Image from URL" width="max-w-md">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Artist</label>
            <select value={urlTarget.id} onChange={e => setUrlTarget(t => ({ ...t, type: 'artist', id: e.target.value }))}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none">
              <option value="">Select artist…</option>
              {artists.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Image URL</label>
            <input value={urlTarget.url} onChange={e => setUrlTarget(t => ({ ...t, url: e.target.value }))}
              placeholder="https://…"
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowUrlModal(false)} className="flex-1 py-2 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={applyImageUrl} disabled={!urlTarget.id || !urlTarget.url}
              className="flex-1 py-2 bg-accent text-base rounded-xl text-sm font-medium disabled:opacity-40 transition-colors">
              Apply
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
        {dups?.length === 0 && <p className="text-accent text-sm text-center py-6">✓ No duplicates found!</p>}
        
        {dups?.length > 0 && (
          <div className="mb-4">
            <button
              onClick={() => setShowMergeAllConfirm(true)}
              disabled={mergingAll}
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
            <p className="text-xs text-muted mb-2">Click Merge to keep the best copy based on bitrate, artwork, album, year, genre. Loser metadata is patched to winner before deletion.</p>
            {dups.map((d, i) => {
              return (
                <div key={i} className="p-3 bg-card border border-border rounded-xl flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium">{d.title}</p>
                    <p className="text-xs text-muted">{d.artist} · {d.count} copies</p>
                    <p className="text-xs text-muted/40 mt-0.5 truncate">{d.paths}</p>
                  </div>
                  <button
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
              <p className="mt-2">The highest scoring copy wins. Loser metadata (artwork, album, year, genre) is patched to winner before deletion.</p>
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
        {possibleDups?.length === 0 && (
          <div className="space-y-2 py-4">
            <p className="text-accent text-sm text-center">✓ No possible duplicates found.</p>
            <p className="text-xs text-muted text-center">Use the regular duplicate checker first for exact matches, then come back here for the leftovers.</p>
          </div>
        )}

        {possibleDups?.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              This pass is intentionally review-based. Run the exact duplicate checker first, then use this for tracks that look like the same song but do not have identical names.
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

      <Modal open={showPlaylistImportModal} onClose={() => { setShowPlaylistImportModal(false); setPlaylistImportStatus(''); setPlaylistImportResult(null) }} title="Import Playlist" width="max-w-md">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Playlist Name</label>
            <input 
              value={playlistImportName} 
              onChange={e => setPlaylistImportName(e.target.value)}
              placeholder="My Imported Playlist"
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50" 
            />
          </div>
          
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Import from File</label>
            <p className="text-xs text-muted mb-2">Select .m3u, .m3u8, .csv, or .json file</p>
            <button 
              onClick={handleFileSelect}
              className="w-full py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center justify-center gap-2"
            >
              <ListMusic size={14} /> Choose File
            </button>
          </div>
          
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-elevated px-2 text-muted">OR enter manually</span>
            </div>
          </div>
          
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Tracks (one per line)</label>
            <p className="text-xs text-muted mb-2">Format: "Artist - Title" or just "Title" or file path</p>
            <textarea 
              value={playlistImportEntries} 
              onChange={e => setPlaylistImportEntries(e.target.value)}
              placeholder="The Beatles - Hey Jude
Pink Floyd - Comfortably Numb
Stairway to Heaven"
              rows={6}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 resize-none font-mono" 
            />
          </div>
          
          {playlistImportStatus && (
            <p className={`text-xs ${playlistImportStatus.startsWith('✓') || playlistImportStatus.includes('Imported') ? 'text-accent' : 'text-red-400'}`}>
              {playlistImportStatus}
            </p>
          )}
          
          {playlistImportResult && playlistImportResult.unmatched && playlistImportResult.unmatched.length > 0 && (
            <div className="bg-card/50 rounded-lg p-3 max-h-32 overflow-y-auto">
              <p className="text-xs text-muted mb-2">Unmatched tracks ({playlistImportResult.unmatched.length}):</p>
              {playlistImportResult.unmatched.slice(0, 10).map((u, i) => (
                <p key={i} className="text-xs text-muted/70 truncate">
                  {u.artist ? `${u.artist} - ` : ''}{u.title}
                </p>
              ))}
              {playlistImportResult.unmatched.length > 10 && (
                <p className="text-xs text-muted/50">...and {playlistImportResult.unmatched.length - 10} more</p>
              )}
            </div>
          )}
          
          <div className="flex gap-2">
            <button onClick={() => { setShowPlaylistImportModal(false); setPlaylistImportStatus(''); setPlaylistImportResult(null) }} className="flex-1 py-2 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={() => handlePlaylistImport()} className="flex-1 py-2 bg-accent text-base rounded-xl text-sm font-medium transition-colors">
              Import
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showPlatformImportGuide} onClose={() => { setShowPlatformImportGuide(false); setPlatformImportStatus('') }} title={platformImportMode === 'metadata' ? 'Import Track Metadata' : 'Import from Other Platforms'} width="max-w-3xl">
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card/40 p-4 space-y-2">
            <p className="text-sm text-white">{platformImportMode === 'metadata' ? 'Use CSV, JSON, or M3U exports to enrich songs already in your library.' : 'Bring in playlists from Spotify, Apple Music, YouTube Music, Last.fm exports, and other CSV-style sources.'}</p>
            <p className="text-xs text-muted leading-relaxed">
              {platformImportMode === 'metadata'
                ? 'Lokal will match each row against your library and apply imported metadata like genres, explicit flags, labels, and audio features. Unmatched rows are skipped without creating ghosts.'
                : 'Lokal will try to match each imported row to your library first. If it cannot find a confident match, it keeps the song in the playlist as a ghost entry so the structure is preserved and you can resolve it later.'}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-4">
            <div className="space-y-4">
              {platformImportMode !== 'metadata' && (
              <div>
                <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Playlist Name</label>
                <input
                  value={platformImportName}
                  onChange={e => setPlatformImportName(e.target.value)}
                  placeholder="Imported Playlist"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                />
              </div>
              )}
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
                    <p className="text-xs text-muted mt-1">CSV works best. For Spotify, Exportify is the easiest option. Google Takeout works well for YouTube Music. JSON and M3U are supported too.</p>
                  </div>
                  <button
                    onClick={handlePlatformFileSelect}
                    className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center gap-2"
                  >
                    <ListMusic size={14} /> Choose File
                  </button>
                </div>
                <div className="rounded-lg border border-border bg-elevated/70 px-3 py-2 text-xs text-muted">
                  {platformImportFileName || 'No file selected'}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/30 p-4 space-y-3">
              <p className="text-sm text-white">What Lokal will do</p>
              <div className="space-y-2 text-xs text-muted leading-relaxed">
                {platformImportMode === 'metadata' ? (
                  <>
                    <p>Matched songs stay in place and get enriched with imported metadata.</p>
                    <p>Multi-genre values, explicit flags, labels, and audio features can then feed mixes and queue suggestions.</p>
                    <p>Unmatched rows are skipped cleanly without creating playlist entries or ghost songs.</p>
                  </>
                ) : (
                  <>
                    <p>Matched songs go straight into the playlist using your existing local tracks.</p>
                    <p>Unmatched songs become ghost entries so the playlist stays complete.</p>
                    <p>Ghost songs can later be replaced by a local file or downloaded with the YouTube downloader.</p>
                  </>
                )}
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
                  <p className="text-[10px] uppercase tracking-[0.22em] text-muted">{platformImportMode === 'metadata' ? 'Skipped' : 'Ghosts'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-white font-medium">Preview</p>
                <p className="text-xs text-muted mt-1">{platformImportMode === 'metadata' ? 'This preview shows which rows Lokal can match before applying imported metadata.' : 'This is what the imported playlist will look like before unresolved songs get filled in later.'}</p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">CSV</span>
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">JSON</span>
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">M3U</span>
                <span className="px-2.5 py-1 rounded-full border border-border text-[10px] uppercase tracking-[0.22em] text-muted">Text</span>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[1.3fr_1.1fr_1.1fr_0.9fr_1.2fr] gap-0 bg-elevated/80 px-4 py-3 text-[10px] uppercase tracking-[0.24em] text-muted">
                <span>Track</span>
                <span>Artist</span>
                <span>Album</span>
                <span>Status</span>
                <span>What Lokal Does</span>
              </div>
              <div className="divide-y divide-border bg-card/30">
                {(platformImportPreview?.rows || []).map((row) => (
                  <div key={`${row.artist}-${row.title}`} className="grid grid-cols-[1.3fr_1.1fr_1.1fr_0.9fr_1.2fr] gap-0 px-4 py-3 text-sm">
                    <span className="text-white truncate pr-3">{row.title}</span>
                    <span className="text-muted truncate pr-3">{row.artist}</span>
                    <span className="text-muted truncate pr-3">{row.album}</span>
                    <span className="text-accent truncate pr-3">{row.status}</span>
                    <span className="text-muted truncate">{platformImportMode === 'metadata' ? (row.status === 'Matched' ? 'Apply imported metadata' : 'Skip row') : row.action}</span>
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

          <div className="flex gap-2">
            <button onClick={() => setShowPlatformImportGuide(false)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={handlePlatformImport} disabled={platformImporting || !platformImportPreview?.total} className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
              {platformImporting ? 'Importing...' : platformImportMode === 'metadata' ? 'Apply Metadata' : 'Import Playlist'}
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

      <ArtistManageModal
        artist={manageArtist}
        open={!!manageArtist}
        onClose={() => setManageArtist(null)}
        onChanged={() => { refreshArtists(); setManageArtist(null) }}
      />
    </div>
  )
}
