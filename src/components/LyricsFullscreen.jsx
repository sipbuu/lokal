import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Download, RotateCcw, Search } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import { api } from '../api'

export default function LyricsFullscreen() {
  const { showLyricsFullscreen, toggleLyricsFullscreen, currentTrack, progress } = usePlayerStore()
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSearch, setShowSearch] = useState(false)
  const [settings, setSettings] = useState({})
  const wordSync = localStorage.getItem('word-sync') === '1'

  useEffect(() => {
    api.getSettings().then(s => setSettings(s || {}))
  }, [])

  const importLyrics = async () => {
    if (!currentTrack || !api.isElectron) return
    const fp = await api.openFile([{ name: 'Lyrics', extensions: ['lrc', 'txt', 'ttml', 'xml'] }])
    if (!fp) return
    const content = await api.readFileBinary(fp)
    if (!content) return
    const ext = fp.split('.').pop().toLowerCase()
    const type = ext === 'ttml' || ext === 'xml' ? 'ttml' : ext === 'lrc' ? 'lrc' : 'txt'
    await api.importLyrics(currentTrack.id, content, type)
    setRefreshKey(k => k + 1)
  }

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const handleSearchRequest = () => {
    setShowSearch(true)
  }

  const isAutoSynced = settings.unsynced_auto_sync === '1'

  return (
    <AnimatePresence>
      {showLyricsFullscreen && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden"
        >
          <div className="absolute inset-0 bg-black">
            {artSrc ? (
              <img src={artSrc} className="w-full h-full object-cover"
                style={{ filter: 'blur(80px) saturate(1.4) brightness(0.35)', transform: 'scale(1.1)' }} />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-neutral-900 to-black" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent" />
          </div>

          <div className="relative z-10 flex items-center justify-between px-8 py-5 flex-shrink-0">
            <div className="flex items-center gap-4">
              {artSrc && (
                <img src={artSrc} className="w-10 h-10 rounded-lg object-cover border border-white/10 flex-shrink-0" />
              )}
              <div>
                <p className="text-xs font-display text-white/30 uppercase tracking-widest">Lyrics</p>
                {currentTrack && <p className="text-sm text-white/60 mt-0.5 truncate max-w-sm">{currentTrack.title} — {currentTrack.artist}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {currentTrack && (
                <button onClick={() => setShowSearch(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
                  <Search size={12} /> Search
                </button>
              )}
              {api.isElectron && currentTrack && (
                <>
                  <button onClick={importLyrics}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/30 rounded-lg transition-colors">
                    <Download size={12} /> Import .lrc / .ttml
                  </button>
                  <button onClick={() => { api.clearLyricsCache(currentTrack.id); setRefreshKey(k => k + 1) }}
                    className="p-1.5 text-white/30 hover:text-white transition-colors rounded-lg hover:bg-white/8">
                    <RotateCcw size={14} />
                  </button>
                </>
              )}
              <button onClick={toggleLyricsFullscreen} className="p-1.5 text-white/30 hover:text-white transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="relative z-10 flex-1 min-h-0">
            <LyricsPanel
              key={`${currentTrack?.id}-${refreshKey}`}
              track={currentTrack}
              progress={progress}
              darkMode
              fullscreen
              wordSync={wordSync}
              onSearchRequest={handleSearchRequest}
              textScale={1.15}
              isAutoSynced={isAutoSynced}
            />
          </div>

          <AnimatePresence>
            {showSearch && currentTrack && (
              <SearchDrawer
                track={currentTrack}
                onClose={() => setShowSearch(false)}
                onSelect={(lyrics, type) => {
                  api.importLyrics(currentTrack.id, lyrics, type)
                  setRefreshKey(k => k + 1)
                  setShowSearch(false)
                }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function SearchDrawer({ track, onClose, onSelect }) {
  const [title, setTitle] = useState(track?.title || '')
  const [artist, setArtist] = useState(track?.artist || '')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const formatDuration = (d) => {
    if (!d) return '--:--'
    return Math.floor(d / 60) + ':' + String(Math.floor(d % 60)).padStart(2, '0')
  }

  const handleSearch = async () => {
    if (!title || !artist) return
    setLoading(true)
    setError(null)
    setResults([])

    try {
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`
      const res = await fetch(url)
      const data = await res.json()
      if (Array.isArray(data)) {
        setResults(data)
      } else {
        setResults([])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResultClick = (result) => {
    const lyrics = result.syncedLyrics || result.plainLyrics
    const type = result.syncedLyrics ? 'lrc' : 'txt'
    onSelect(lyrics, type)
  }

  return (
    <motion.div
      initial={{ x: 320 }}
      animate={{ x: 0 }}
      exit={{ x: 320 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="absolute top-0 right-0 h-full w-80 bg-black/95 backdrop-blur-xl border-l border-white/10 z-20 flex flex-col"
    >
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors">
          <X size={18} />
        </button>
        <h3 className="text-sm font-medium text-white">Search Lyrics</h3>
        <div className="w-5" />
      </div>

      <div className="p-4 space-y-3 border-b border-white/10">
        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Track title"
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          />
        </div>
        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">Artist</label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Artist name"
            className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-accent/50"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={!title || !artist || loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-accent text-base rounded-lg text-sm font-medium hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Searching...' : <><Search size={14} /> Search</>}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {results.length === 0 && !loading && !error && (
          <p className="text-xs text-white/30 text-center py-8">Enter title and artist to search</p>
        )}
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() => handleResultClick(r)}
            className="w-full p-3 text-left hover:bg-white/5 rounded-lg transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{r.trackName}</p>
                <p className="text-xs text-white/50 truncate">{r.artistName}</p>
                {r.albumName && <p className="text-xs text-white/30 truncate">{r.albumName}</p>}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-xs text-white/40">{formatDuration(r.duration)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${r.syncedLyrics ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'}`}>
                  {r.syncedLyrics ? 'Synced' : 'Unsynced'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </motion.div>
  )
}
