import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Play, Pause, Disc3 } from 'lucide-react'
import { useAppStore } from '../store/player'
import { usePlayerStore } from '../store/player'
import { api } from '../api'

function AlbumCard({ album, onClick }) {
  const artSrc = album.artwork_path
    ? (api.isElectron ? `file://${album.artwork_path}` : api.artworkURL(album.artwork_path))
    : null

  return (
    <motion.button
      whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="flex flex-col gap-2 p-3 bg-elevated border border-border rounded-xl hover:border-accent/30 transition-all text-left group"
    >
      <div className="w-full aspect-square rounded-lg overflow-hidden bg-card flex items-center justify-center relative">
        {artSrc
          ? <img src={artSrc} className="w-full h-full object-cover" />
          : <Disc3 size={40} className="text-subtle" />
        }
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center shadow-xl">
            <Play size={16} fill="currentColor" className="text-base translate-x-px" />
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1 max-w-full">
        <p className="text-xs font-medium text-white truncate">{album.title}</p>
        <p className="text-[10px] text-muted truncate">{album.artists || album.album_artist}</p>
        <p className="text-[10px] text-muted/60">{album.track_count} tracks{album.year ? ` · ${album.year}` : ''}</p>
      </div>
    </motion.button>
  )
}

function AlbumDetail({ album, onClose }) {
  const [tracks, setTracks] = useState([])
  const [hoveredTrack, setHoveredTrack] = useState(null)
  const { playQueue, currentTrack, isPlaying, playTrack, togglePlay } = usePlayerStore()

  useEffect(() => {
    api.getAlbumTracks(album.title).then(t => setTracks(Array.isArray(t) ? t : []))
  }, [album.title])

  const handlePlay = (track, index, e) => {
    e.stopPropagation()
    if (currentTrack?.id === track.id) togglePlay()
    else playTrack(track, tracks)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-4 p-6 border-b border-border flex-shrink-0 overflow-hidden">
        <button onClick={onClose} className="text-muted hover:text-white transition-colors">← Back</button>
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-card flex items-center justify-center flex-shrink-0">
          {album.artwork_path
            ? <img src={api.isElectron ? `file://${album.artwork_path}` : api.artworkURL(album.artwork_path)} className="w-full h-full object-cover" />
            : <Disc3 size={28} className="text-subtle" />
          }
        </div>
        <div className="min-w-0 flex-1 max-w-full">
          <h2 className="text-lg font-display text-white truncate">{album.title}</h2>
          <p className="text-sm text-muted truncate">{album.artists || album.album_artist}</p>
          <p className="text-xs text-muted/60">{album.track_count} tracks{album.year ? ` · ${album.year}` : ''}</p>
        </div>
        {tracks.length > 0 && (
          <button onClick={() => playQueue(tracks, 0)} className="flex items-center gap-2 px-4 py-2 bg-accent text-base rounded-full text-sm font-medium flex-shrink-0">
            <Play size={14} fill="currentColor" /> Play
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tracks.map((t, i) => {
          const isCurrent = currentTrack?.id === t.id
          const isHov = hoveredTrack === t.id
          return (
            <button 
              key={t.id} 
              onDoubleClick={() => playQueue(tracks, i)}
              onMouseEnter={() => setHoveredTrack(t.id)}
              onMouseLeave={() => setHoveredTrack(null)}
              onClick={(e) => handlePlay(t, i, e)}
              className={`w-full flex items-center gap-3 px-6 py-2.5 hover:bg-elevated transition-colors group text-left ${isCurrent ? 'bg-accent/8' : ''}`}
            >
              <div className="w-5 flex items-center justify-center">
                {isHov || isCurrent ? (
                  <button onClick={e => handlePlay(t, i, e)} className={isCurrent ? 'text-accent' : 'text-white'}>
                    {isCurrent && isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="translate-x-px" />}
                  </button>
                ) : (
                  <span className={`text-xs text-muted font-display ${isCurrent ? 'text-accent' : ''}`}>{t.track_num || i + 1}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${isCurrent ? 'text-accent' : 'text-white'}`}>{t.title}</p>
                <p className="text-xs text-muted truncate">{t.artist}</p>
              </div>
              <span className="text-xs text-muted">{t.duration ? `${Math.floor(t.duration/60)}:${String(Math.floor(t.duration%60)).padStart(2,'0')}` : ''}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function AlbumsModal() {
  const { showAlbumsModal, closeAlbums } = useAppStore()
  const [albums, setAlbums] = useState([])
  const [filtered, setFiltered] = useState([])
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!showAlbumsModal) return
    setLoading(true); setSelected(null); setQ('')
    api.getAllAlbums().then(a => { const arr = Array.isArray(a) ? a : []; setAlbums(arr); setFiltered(arr); setLoading(false) })
  }, [showAlbumsModal])

  const search = useCallback((val) => {
    setQ(val)
    if (!val.trim()) { setFiltered(albums); return }
    const lower = val.toLowerCase()
    setFiltered(albums.filter(a => (a.title||'').toLowerCase().includes(lower) || (a.artists||'').toLowerCase().includes(lower)))
  }, [albums])

  return (
    <AnimatePresence>
      {showAlbumsModal && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={closeAlbums}
        >
          <motion.div
            initial={{ scale: 0.93, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
            className="bg-surface border border-border rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {selected ? (
              <AlbumDetail album={selected} onClose={() => setSelected(null)} />
            ) : (
              <>
                <div className="flex items-center gap-4 p-5 border-b border-border flex-shrink-0">
                  <h2 className="font-display text-base text-white uppercase tracking-widest flex-1">Albums</h2>
                  <div className="relative w-56">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                      value={q} onChange={e => search(e.target.value)}
                      placeholder="Search albums…"
                      className="w-full bg-card border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-accent/50 placeholder-muted"
                    />
                  </div>
                  <button onClick={closeAlbums} className="text-muted hover:text-white transition-colors">
                    <X size={16} />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-5">
                  {loading && <p className="text-center text-muted text-sm py-10">Loading…</p>}
                  {!loading && !filtered.length && <p className="text-center text-muted text-sm py-10">No albums found.</p>}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {filtered.map((a, i) => (
                      <AlbumCard key={a.title + i} album={a} onClick={() => setSelected(a)} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
