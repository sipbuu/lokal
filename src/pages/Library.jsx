import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutGrid, List, Music, Disc3 } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import AlbumsModal from '../components/AlbumsModal'
import { api } from '../api'

const LIBRARY_PAGE_SIZE = 50
const HEAVY_GRID_THRESHOLD = 80

export default function Library() {
  const [tracks, setTracks] = useState([])
  const [sort, setSort] = useState('added_at DESC')
  const [view, setView] = useState('list')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const { openAlbums } = useAppStore()
  const { playQueue } = usePlayerStore()
  const offsetRef = useRef(0)
  const loadMoreRef = useRef(null)
  const requestIdRef = useRef(0)
  const shouldAnimateGrid = tracks.length <= HEAVY_GRID_THRESHOLD

  const load = async (append = false) => {
    if (loading && append) return
    const requestId = ++requestIdRef.current
    const nextOffset = append ? offsetRef.current : 0
    setLoading(true)
    try {
      const result = await api.getTracks({ sort, limit: LIBRARY_PAGE_SIZE, offset: nextOffset })
      if (requestId !== requestIdRef.current) return
      const items = (Array.isArray(result) ? result : []).filter(track => !String(track?.file_path || '').startsWith('ghost://'))
      offsetRef.current = nextOffset + items.length
      setTracks(prev => append ? [...prev, ...items] : items)
      setHasMore(items.length === LIBRARY_PAGE_SIZE)
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    offsetRef.current = 0
    setTracks([])
    setHasMore(true)
    load(false)
  }, [sort])

  useEffect(() => {
    const handleRefresh = () => {
      offsetRef.current = 0
      setTracks([])
      setHasMore(true)
      load(false)
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [sort])

  useEffect(() => {
    if (!hasMore || loading) return
    const node = loadMoreRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        load(true)
      }
    }, { rootMargin: '300px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, sort, tracks.length])

  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id))
    : null

  return (
    <div className="p-6 space-y-4 pb-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg uppercase tracking-widest text-white">Library</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => openAlbums()}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-elevated border border-border rounded-lg text-xs text-muted hover:text-white transition-colors">
            <Disc3 size={13} /> Albums
          </button>
          <select value={sort} onChange={e => setSort(e.target.value)}
            className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs text-muted outline-none focus:border-accent/50">
            <option value="added_at DESC">Recently Added</option>
            <option value="title ASC">Title A-Z</option>
            <option value="artist ASC">Artist A-Z</option>
            <option value="play_count DESC">Most Played</option>
            <option value="duration DESC">Longest</option>
          </select>
          <div className="flex bg-elevated border border-border rounded-lg overflow-hidden">
            <button onClick={() => setView('list')} className={`p-1.5 transition-colors ${view === 'list' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}><List size={14} /></button>
            <button onClick={() => setView('grid')} className={`p-1.5 transition-colors ${view === 'grid' ? 'bg-accent/20 text-accent' : 'text-muted hover:text-white'}`}><LayoutGrid size={14} /></button>
          </div>
        </div>
      </div>

      {tracks.length > 0 && view === 'list' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted font-display">{tracks.length} loaded tracks</p>
            <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">Play All</button>
          </div>
          <TrackList tracks={tracks} showAlbum reduceMotion={tracks.length > LIBRARY_PAGE_SIZE} />
        </>
      )}

      {tracks.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {tracks.map((t, i) => {
            const src = artSrc(t)
            return (
              <motion.button
                key={t.id}
                initial={shouldAnimateGrid ? { opacity: 0, scale: 0.9 } : false}
                animate={shouldAnimateGrid ? { opacity: 1, scale: 1 } : undefined}
                transition={shouldAnimateGrid ? { delay: Math.min(i * 0.012, 0.3) } : undefined}
                whileHover={shouldAnimateGrid ? { scale: 1.04 } : undefined}
                onDoubleClick={() => playQueue(tracks, i)}
                className="flex flex-col gap-2 text-left group"
              >
                <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center">
                  {src ? <img src={src} className="w-full h-full object-cover" alt="" loading="lazy" decoding="async" /> : <Music size={28} className="text-muted" />}
                </div>
                <div>
                  <p className="text-xs font-medium text-white truncate">{t.title}</p>
                  <p className="text-xs text-muted truncate">{t.artist}</p>
                </div>
              </motion.button>
            )
          })}
        </div>
      )}

      {(hasMore || loading) && (
        <div ref={loadMoreRef} className="flex justify-center pt-2 min-h-10">
          {loading && <p className="text-xs text-muted">Loading more tracks...</p>}
        </div>
      )}

      {!tracks.length && (
        <div className="text-center py-24 text-muted">
          <Music size={48} className="mx-auto mb-4 opacity-20" />
          <p>No tracks yet — scan your music folder from Home.</p>
        </div>
      )}

      <AlbumsModal />
    </div>
  )
}
