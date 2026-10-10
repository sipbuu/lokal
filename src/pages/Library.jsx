import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutGrid, List, Music, Disc3 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import TrackList from '../components/TrackList'
import FadeImg from '../components/FadeImg'
import ScanBanner from '../components/ScanBanner'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'

const LIBRARY_PAGE_SIZE = 50
const HEAVY_GRID_THRESHOLD = 80

export default function Library() {
  // Kept across visits (with the sort and view they were shown in), so coming
  // back paints the list at once instead of "No tracks yet" first.
  const [tracks, setTracks, wasCached] = useCachedState('library:tracks', [])
  const [sort, setSort] = useCachedState('library:sort', 'added_at DESC')
  // Where the songs came from (see sourceFilter in electron/ipc/scanner.js).
  const [source, setSource] = useCachedState('library:source', 'all')
  // One genre, or '' for all (matches a song's main genre or any of its genres).
  const [genre, setGenre] = useCachedState('library:genre', '')
  const [genres, setGenres] = useCachedState('library:genres', [])
  // One audio quality tier, or '' for all (the Audio Quality page's tiers).
  const [quality, setQuality] = useCachedState('library:quality', '')
  const [includeGhosts, setIncludeGhosts] = useCachedState('library:includeGhosts', false)
  const [view, setView] = useCachedState('library:view', 'list')
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useCachedState('library:hasMore', true)
  // The empty state waits for the first answer instead of showing meanwhile.
  const [loaded, setLoaded] = useState(wasCached)
  usePageReady(loaded)
  const playQueue = usePlayerStore(s => s.playQueue)
  const navigate = useNavigate()
  const offsetRef = useRef(tracks.length)
  const loadingRef = useRef(false)
  const loadMoreRef = useRef(null)
  const requestIdRef = useRef(0)
  const shouldAnimateGrid = tracks.length <= HEAVY_GRID_THRESHOLD

  const load = async (append = false) => {
    // Synchronous in-flight check: the observer's `loading` can be stale, and a
    // load-more mustn't supersede the first-page refresh (or run twice).
    if (loadingRef.current && append) return
    const requestId = ++requestIdRef.current
    const nextOffset = append ? offsetRef.current : 0
    loadingRef.current = true
    setLoading(true)
    try {
      const result = await api.getTracks({ sort, limit: LIBRARY_PAGE_SIZE, offset: nextOffset, ...(source !== 'all' ? { source } : {}), ...(genre ? { genre } : {}), ...(quality ? { quality } : {}), ...(includeGhosts ? { includeGhosts: true } : {}) })
      if (requestId !== requestIdRef.current) return
      // A failed request keeps the list already shown (and cached).
      if (!Array.isArray(result)) return
      const items = includeGhosts ? result : result.filter(track => !String(track?.file_path || '').startsWith('ghost://'))
      offsetRef.current = nextOffset + items.length
      setTracks(prev => append ? [...prev, ...items] : items)
      setHasMore(items.length === LIBRARY_PAGE_SIZE)
      // Only a real answer ends the first load ("No tracks yet" must be true).
      setLoaded(true)
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  // The list on screen (from last time, or the previous sort) stays until
  // the new first page replaces it; a failed request leaves it as it is.
  useEffect(() => {
    // Another sort or source: nothing more is fetched (or appended) until its
    // first page is in, so two lists are never mixed.
    offsetRef.current = 0
    setHasMore(false)
    load(false)
  }, [sort, source, genre, quality, includeGhosts])

  useEffect(() => {
    const handleRefresh = () => { load(false); loadGenres() }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [sort, source, genre, quality, includeGhosts])

  // The genres to pick from: every one in the library, on opening and after a refresh.
  const loadGenres = () => Promise.resolve(api.getAllGenres())
    .then(list => { if (Array.isArray(list)) setGenres(list.filter(g => typeof g === 'string' && g.trim())) })
    .catch(() => {})
  useEffect(() => { loadGenres() }, [])

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
  }, [hasMore, loading, sort, source, genre, quality, includeGhosts, tracks.length])

  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id))
    : null

  return (
    <div className="p-6 space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-lg uppercase tracking-widest text-white">Library</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={() => navigate('/albums')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-elevated border border-border rounded-lg text-xs text-muted hover:text-white transition-colors">
            <Disc3 size={13} /> Albums
          </button>
          <select value={source} onChange={e => setSource(e.target.value)} aria-label="Source"
            className="bg-elevated border border-border rounded-lg px-3 py-1.5 text-xs text-muted outline-none focus:border-accent/50">
            <option value="all">All sources</option>
            <option value="local">Music folder</option>
            <option value="yt">YouTube</option>
            <option value="sc">SoundCloud</option>
            <option value="addon">Addons</option>
            <option value="soulseek">Soulseek</option>
            <option value="web">Other sites</option>
          </select>
          <select value={genre} onChange={e => setGenre(e.target.value)} aria-label="Genre"
            className={`max-w-[11rem] truncate bg-elevated border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50 ${genre ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
            <option value="">All genres</option>
            {/* The one picked stays listed even if no song has it any more. */}
            {genre && !genres.some(g => g.toLowerCase() === genre.toLowerCase()) && <option value={genre}>{genre}</option>}
            {genres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={quality} onChange={e => setQuality(e.target.value)} aria-label="Quality"
            className={`bg-elevated border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-accent/50 ${quality ? 'border-accent/40 text-accent' : 'border-border text-muted'}`}>
            <option value="">All qualities</option>
            <option value="hires">Hi-res</option>
            <option value="lossless">Lossless</option>
            <option value="high">High</option>
            <option value="low">Low</option>
            <option value="suspect">Suspect</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={includeGhosts} onChange={e => setIncludeGhosts(e.target.checked)} className="accent-accent" />Show ghost songs</label>
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"
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

      <ScanBanner />

      {tracks.length > 0 && view === 'list' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted font-display">{tracks.length} loaded tracks</p>
            <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">Play All</button>
          </div>
          {/* No per-row entrance: the page fades in as a whole, and 50 row
              animations in the same frames made that fade stutter. */}
          <TrackList tracks={tracks} showQuality reduceMotion />
        </>
      )}

      {tracks.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-3 @sm:grid-cols-4 @md:grid-cols-5 gap-3">
          {tracks.map((t, i) => {
            const src = artSrc(t)
            return (
              <motion.button
                key={t.id}
                initial={false}
                whileHover={shouldAnimateGrid ? { scale: 1.04 } : undefined}
                onDoubleClick={() => playQueue(tracks, i)}
                className="flex flex-col gap-2 text-left group"
              >
                <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center">
                  {src ? <FadeImg src={src} className="w-full h-full object-cover" /> : <Music size={28} className="text-muted" />}
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
          {loading && tracks.length > 0 && <p className="text-xs text-muted">Loading more tracks...</p>}
        </div>
      )}

      {loaded && !loading && !tracks.length && (
        <div className="text-center py-24 text-muted">
          <Music size={48} className="mx-auto mb-4 opacity-20" />
          <p>{source === 'all' && !genre && !quality ? 'No tracks yet — pick your music folder above.' : quality ? 'No songs of this quality with these filters.' : genre ? `No ${genre} songs${source === 'all' ? '' : ' from this source'}.` : 'No songs from this source.'}</p>
          {genre && (
            <button onClick={() => setGenre('')} className="mt-3 text-xs text-accent transition-colors hover:text-accent/70">Show all genres</button>
          )}
          {quality && (
            <button onClick={() => setQuality('')} className="mt-3 ml-3 text-xs text-accent transition-colors hover:text-accent/70">Show all qualities</button>
          )}
        </div>
      )}
    </div>
  )
}
