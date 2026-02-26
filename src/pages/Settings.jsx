import React, { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Save, Tags, FolderOpen, RefreshCw, Trash2, AlertTriangle, Link, CheckCircle, Disc3, Zap, Download, Music2, X, MoreHorizontal, ListMusic, Palette, ChevronDown, ChevronUp, RefreshCcw } from 'lucide-react'
import { api } from '../api'
import { useAppStore } from '../store/player'
import Modal from '../components/Modal'
import ArtistManageModal from '../components/ArtistManageModal'
import { THEMES, ACCENT_COLORS, applyTheme } from '../theme'
import { useTheme } from '../themeHooks'

const EQ_BANDS = ['60Hz', '230Hz', '910Hz', '3.6kHz', '14kHz']

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

export default function Settings() {
  const [settings, setSettings] = useState({})
  const [saved, setSaved] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [showGenreModal, setShowGenreModal] = useState(false)
  const [eqGains, setEqGains] = useState([0, 0, 0, 0, 0])
  const [showClearModal, setShowClearModal] = useState(false)
  const [artists, setArtists] = useState([])
  const [manageArtist, setManageArtist] = useState(null)
  const [artistSearch, setArtistSearch] = useState('')
  const [discordStatus, setDiscordStatus] = useState('')
  const [lastfmStatus, setLastfmStatus] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [urlTarget, setUrlTarget] = useState({ type: '', id: '', url: '' })
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [dups, setDups] = useState(null)
  const [showDups, setShowDups] = useState(false)
  const [mergingAll, setMergingAll] = useState(false)
  const [mergeAllResult, setMergeAllResult] = useState(null)
  const [showMergeAllConfirm, setShowMergeAllConfirm] = useState(false)
  const [keepCommaArtists, setKeepCommaArtists] = useState([])
  const [commaInput, setCommaInput] = useState('')
  const [showCommaModal, setShowCommaModal] = useState(false)
  const [exportingHistory, setExportingHistory] = useState(false)
  const [historyExported, setHistoryExported] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [toolsStatus, setToolsStatus] = useState(null)
  const [toolsLoading, setToolsLoading] = useState(false)
  const [showPlaylistImportModal, setShowPlaylistImportModal] = useState(false)
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
  const [manualGenreTrack, setManualGenreTrack] = useState('')
  const [manualGenreAlbum, setManualGenreAlbum] = useState('')
  const [manualGenreValue, setManualGenreValue] = useState('')

  
  const { openAlbums, user } = useAppStore()
  const fileInputRef = useRef(null)
  const { themeName, themeOverrides, showAdvanced, setShowAdvanced, selectTheme, setAccent, saveOverride, resetTheme } = useTheme()

  useEffect(() => {

    api.getSettings().then(s => setSettings(s || {}))

    api.getArtists().then(a => setArtists(Array.isArray(a) ? a : []))

    api.getKeepCommaArtists().then(a => {

      const defaults = ['Tyler, The Creator', 'Earth, Wind & Fire']

      const combined = [...defaults, ...(a || [])]

      setKeepCommaArtists(combined)

      setCommaInput(combined.join('\n'))

    })

    try { setEqGains(JSON.parse(localStorage.getItem('lokal-eq') || '[]') || [0,0,0,0,0]) } catch {}

    if (api.isElectron) {

      api.getToolsStatus().then(setToolsStatus)
      api.getVersion().then(v => setAppVersion(v || '1.0.0'))

      /*api.getPerfSettings().then(s => {

        if (s) setPerfSettings(s)             comment out for now, need to rethink how we handle perfomance settings eventually (original test failed)

      })
      */
    }

  }, []) 

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
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const setEQ = (i, v) => {
    const next = [...eqGains]; next[i] = v; setEqGains(next)
    window.__lokaleq?.setGain(i, v)
  }

  const rescan = async () => {
    if (!settings.music_folder) return
    setScanning(true)
    await api.scanFolder(settings.music_folder)
    setScanning(false)
    api.getArtists().then(a => setArtists(Array.isArray(a) ? a : []))
  }

  const connectDiscord = async () => {
    const id = settings.discord_client_id
    if (!id) { setDiscordStatus('Enter a Client ID first'); return }
    await api.saveSettings({ discord_client_id: id })
    setDiscordStatus('Connecting…')
    const ok = await api.discordConnect(id)
    setDiscordStatus(ok ? '✓ Connected!' : '✗ Failed — is Discord open?')
    setTimeout(() => setDiscordStatus(''), 6000)
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
    api.getArtists().then(a => setArtists(Array.isArray(a) ? a : []))
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

  const saveCommaArtists = async () => {
    const artists = commaInput.split('\n').map(s => s.trim()).filter(Boolean)
    await api.setKeepCommaArtists(artists)
    setKeepCommaArtists(artists)
    setShowCommaModal(false)
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

        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `lokal-history-${new Date().toISOString().split('T')[0]}.${ext}`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        URL.revokeObjectURL(url);
        setHistoryExported(true);
        setTimeout(() => setHistoryExported(false), 3000);

    } catch (e) {
        console.error('Export error:', e);
        alert("Failed to export: " + e.message);
    } finally {
        setExportingHistory(false);
    }
  };

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

  const filtered = artists.filter(a => a.name.toLowerCase().includes(artistSearch.toLowerCase()))

  const exportMenuItems = [
    { label: 'Export as JSON', icon: <Download size={14} />, onClick: () => handleHistoryExport('json') },
    { label: 'Export as CSV', icon: <Download size={14} />, onClick: () => handleHistoryExport('csv') },
  ]

  return (
    <div className="p-6 max-w-2xl space-y-6 pb-10">
      <h1 className="font-display text-lg uppercase tracking-widest text-white">Settings</h1>

      {api.isElectron && (
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
        </Section>
      )}

      <Section title="Library">
        <Row label="Fetch Online Artwork" desc="Try iTunes/MusicBrainz if no embedded artwork found">
          <button
            onClick={() => set('fetch_online_artwork', settings.fetch_online_artwork === '0' ? '1' : '0')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.fetch_online_artwork !== '0' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.fetch_online_artwork !== '0' ? 'On' : 'Off'}
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
        <Row label="Use YouTube Cookies" desc="Pass cookies to yt-dlp to bypass rate limiting, access private playlists and liked music. Not shared elsewhere.">
          <div className="flex items-center gap-2">
            <button
              onClick={() => set('yt_cookies', settings.yt_cookies === '0' ? '1' : '0')}
              className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.yt_cookies === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
              {settings.yt_cookies === '1' ? 'On' : 'Off'}
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
        <Row label="Index While Downloading" desc="Index each track immediately as it downloads (playlist). Makes tracks available in library faster.">
          <button
            onClick={() => set('index_while_downloading', settings.index_while_downloading === '1' ? '0' : '1')}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.index_while_downloading === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.index_while_downloading === '1' ? 'On' : 'Off'}
          </button>
        </Row>
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
        <Row label="Albums Browser" desc="Browse all albums in your library">
          <button onClick={openAlbums}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors">
            <Disc3 size={14} /> Browse Albums
          </button>
        </Row>
        <Row label="Check Duplicates" desc="Find tracks with same title & artist">
          <button onClick={checkDuplicates}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Check
          </button>
        </Row>
        <Row label="Clear All Data" desc="Wipes DB — files untouched">
          <button onClick={() => setShowClearModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-red-500/15 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/25 transition-colors">
            <Trash2 size={13} /> Clear
          </button>
        </Row>
      </Section>

      <Section title="Artist Photos">
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
          <button onClick={() => setShowUrlModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            <Link size={13} /> Set URL
          </button>
        </Row>
      </Section>

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

      <Section title="Playlists">
        <Row label="Import Playlist" desc="Create playlist from text entries (Artist - Title per line)">
          <button onClick={() => setShowPlaylistImportModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white hover:border-accent/30 transition-colors">
            <ListMusic size={14} /> Import
          </button>
        </Row>
      </Section>

      {api.isElectron && (
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

      <Section title="Artist Name Filtering">
        <Row label="Keep Comma in Artist Names" desc="Prevents splitting artists like 'Tyler, The Creator'">
          <button onClick={() => setShowCommaModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors">
            Configure ({keepCommaArtists.length})
          </button>
        </Row>
      </Section>

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
        <Row label="Clear Lyrics Cache">
          <button onClick={() => api.clearLyricsDb()}
            className="px-4 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors flex items-center gap-2">
            <RefreshCw size={13} /> Clear
          </button>
        </Row>
      </Section>

      <Section title="Playback & EQ">
        <Row label="Crossfade" desc="Fades into next track automatically — never on manual skip">
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={12} step={0.5} value={settings.crossfade_seconds || 0}
              onChange={e => set('crossfade_seconds', e.target.value)} className="w-24 accent-accent" />
            <span className="text-xs text-muted w-10">{settings.crossfade_seconds || 0}s</span>
          </div>
        </Row>
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-white font-medium">5-Band EQ</p>
            <button onClick={() => { setEqGains([0,0,0,0,0]); [0,0,0,0,0].forEach((_,i) => window.__lokaleq?.setGain(i,0)) }}
              className="text-xs text-muted hover:text-white transition-colors">Reset</button>
          </div>
          <div className="flex items-end justify-center gap-6 h-32">
            {EQ_BANDS.map((band, i) => (
              <div key={band} className="flex flex-col items-center gap-2">
                <span className="text-xs font-display" style={{ color: '#e8ff57', fontSize: 10 }}>
                  {eqGains[i] > 0 ? '+' : ''}{Math.round(eqGains[i] || 0)}
                </span>
                <input type="range" min={-12} max={12} step={0.5} value={eqGains[i] || 0}
                  onChange={e => setEQ(i, parseFloat(e.target.value))}
                  className="accent-accent"
                  style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 24, height: 88, cursor: 'pointer' }} />
                <span className="text-muted" style={{ fontSize: 9 }}>{band}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-3 text-center opacity-50">Click anywhere in app once to activate EQ</p>
        </div>
      </Section>

      <Section title="Discord Rich Presence">
        <Row label="App Client ID" desc="Create at discord.com/developers/applications">
          <input value={settings.discord_client_id || ''} onChange={e => set('discord_client_id', e.target.value)}
            placeholder="1473597925581131919"
            className="w-48 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
        </Row>
        <Row label="Connect">
          <div className="flex items-center gap-3">
            <button onClick={connectDiscord}
              className="px-4 py-2 bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#7289da] rounded-lg text-sm hover:bg-[#5865F2]/30 transition-colors">
              Connect
            </button>
            {discordStatus && (
              <span className={`text-xs ${discordStatus.startsWith('✓') ? 'text-accent' : discordStatus.startsWith('✗') ? 'text-red-400' : 'text-muted'}`}>
                {discordStatus}
              </span>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Last.fm">
        <Row label="API Key" desc="Get from last.fm/api">
          <input value={settings.lastfm_api_key || ''} onChange={e => set('lastfm_api_key', e.target.value)}
            placeholder="Your Last.fm API key"
            className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
        </Row>
        <Row label="API Secret" desc="Keep secret - used for scrobbling">
          <input value={settings.lastfm_api_secret || ''} onChange={e => set('lastfm_api_secret', e.target.value)}
            placeholder="Your API secret"
            className="w-56 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
        </Row>
        <Row label="Username" desc="Your Last.fm username">
          <input value={settings.lastfm_username || ''} onChange={e => set('lastfm_username', e.target.value)}
            placeholder="username"
            className="w-40 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
        </Row>
        <Row label="Scrobbling" desc="Submit plays to Last.fm when tracks finish">
          <button
            onClick={() => { const v = settings.lastfm_scrobbling !== '1'; set('lastfm_scrobbling', v ? '1' : '0') }}
            className={`px-4 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border transition-colors ${settings.lastfm_scrobbling === '1' ? 'bg-accent/20 border-accent/50 text-accent' : 'border-border text-muted hover:text-white'}`}>
            {settings.lastfm_scrobbling === '1' ? 'On' : 'Off'}
          </button>
        </Row>
        <Row label="Auth Token" desc="Get token from last.fm/api/auth, paste here to get session">
          <div className="flex items-center gap-2">
            <input value={settings.lastfm_auth_token || ''} onChange={e => set('lastfm_auth_token', e.target.value)}
              placeholder="Paste auth token"
              className="w-44 bg-card border border-border rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-accent/50" />
            <button 
              onClick={async () => {
                if (!settings.lastfm_api_key || !settings.lastfm_api_secret || !settings.lastfm_auth_token) {
                  setLastfmStatus('Need API key, secret, and token')
                  return
                }
                setLastfmStatus('Connecting...')
                const result = await api.lastfmConnect(settings.lastfm_api_key, settings.lastfm_api_secret, settings.lastfm_auth_token)
                if (result.sessionKey) {
                  await api.saveSettings({ 
                    lastfm_session_key: result.sessionKey,
                    lastfm_username: result.username || settings.lastfm_username
                  })
                  setLastfmStatus('✓ Connected as ' + (result.username || settings.lastfm_username))
                } else {
                  setLastfmStatus(result.error || 'Failed')
                }
                setTimeout(() => setLastfmStatus(''), 5000)
              }}
              className="px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white transition-colors">
              Connect
            </button>
            {lastfmStatus && (
              <span className={`text-xs ${lastfmStatus.startsWith('✓') ? 'text-accent' : 'text-muted'}`}>
                {lastfmStatus}
              </span>
            )}
          </div>
        </Row>
      </Section>

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

      <Section title="Artist Management">
        <input value={artistSearch} onChange={e => setArtistSearch(e.target.value)}
          placeholder="Search artists…"
          className="w-full bg-card border border-border rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-accent/50" />
        <div className="space-y-0.5 max-h-64 overflow-y-auto">
          {filtered.slice(0, 60).map(a => (
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
      </Section>

      <div className="flex items-center gap-3 pt-2">
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

      <ArtistManageModal
        artist={manageArtist}
        allArtists={artists}
        open={!!manageArtist}
        onClose={() => setManageArtist(null)}
        onChanged={() => { api.getArtists().then(a => setArtists(Array.isArray(a) ? a : [])); setManageArtist(null) }}
      />
    </div>
  )
}
