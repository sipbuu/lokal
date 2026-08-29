import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Clock, LayoutGrid, List, Loader2, Music, Play, Search, Sparkles, Users } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { api } from '../api'

const PAGE_SIZE = 60
const TOP_ARTISTS_LIMIT = 8

function getArtistImage(artist) {
  if (!artist?.image_path) return null
  return api.isElectron ? `file://${artist.image_path}` : `/api/artist-image/${encodeURIComponent(artist.id)}`
}

// Deterministic hash so the same artist always gets the same generated color,
// instead of a flat placeholder circle when there's no real artwork.
function hashStringToHue(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 360
}

function FallbackAvatar({ name }) {
  const hue = hashStringToHue(name || '?')
  const hue2 = (hue + 50) % 360
  return (
    <div
      className="flex h-full w-full items-center justify-center text-white/85"
      style={{ background: `linear-gradient(140deg, hsl(${hue}, 62%, 40%) 0%, hsl(${hue2}, 68%, 26%) 100%)` }}
    >
      <span className="font-display text-lg uppercase tracking-wide">{(name || '?').trim().charAt(0) || <Music size={20} />}</span>
    </div>
  )
}

function ArtistCard({ artist, onClick, onPlay, rank }) {
  const imgSrc = getArtistImage(artist)

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: '180px 0px' }}
      onClick={onClick}
      className="group relative flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-center backdrop-blur-sm transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.08]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '190px' }}
    >
      {rank != null && (
        <div className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-[10px] font-display text-white/70 backdrop-blur-sm">
          {rank}
        </div>
      )}
      <div className="relative aspect-square w-full overflow-hidden rounded-full ring-1 ring-white/10 shadow-lg shadow-black/40 transition-all duration-200 group-hover:ring-white/25">
        {imgSrc ? (
          <img src={imgSrc} alt={artist.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" />
        ) : (
          <FallbackAvatar name={artist.name} />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onPlay?.() }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-xl transition-transform hover:scale-105"
          >
            <Play size={15} fill="currentColor" className="translate-x-px" />
          </button>
        </div>
      </div>
      <div className="min-w-0 w-full">
        <p className="truncate text-sm font-medium text-white">{artist.name}</p>
        <p className="truncate text-xs text-white/55">{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</p>
      </div>
    </motion.button>
  )
}

export default function Artists() {
  const [artists, setArtists] = useState([])
  const [topArtists, setTopArtists] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(() => localStorage.getItem('lokal-artists-sort') || 'name')
  const [density, setDensity] = useState(() => localStorage.getItem('lokal-artists-density') || 'spaced')
  const loadMoreRef = useRef(null)
  const navigate = useNavigate()
  const { playQueue } = usePlayerStore()

  const loadArtists = (search, offset, append, sortMode) => {
    const setBusy = append ? setLoadingMore : setLoading
    setBusy(true)
    return api.getArtistsPage({ search, limit: PAGE_SIZE, offset, sort: sortMode }).then((result) => {
      const items = Array.isArray(result?.items) ? result.items : []
      setArtists((current) => (append ? [...current, ...items] : items))
      setTotal(result?.total || 0)
      setHasMore(!!result?.hasMore)
      setBusy(false)
    }).catch(() => {
      setBusy(false)
    })
  }

  const loadTopArtists = () => {
    api.getArtistsPage({ search: '', limit: TOP_ARTISTS_LIMIT, offset: 0, sort: 'tracks' }).then((result) => {
      const items = Array.isArray(result?.items) ? result.items : []
      setTopArtists(items.filter((artist) => Number(artist.track_count) > 0))
    }).catch(() => {})
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadArtists(query.trim(), 0, false, sort)
    }, query ? 200 : 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort])

  useEffect(() => { loadTopArtists() }, [])

  useEffect(() => {
    const handleRefresh = () => {
      loadArtists(query.trim(), 0, false, sort)
      loadTopArtists()
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return
    const root = document.querySelector('main.flex-1.overflow-y-auto') || null
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || loadingMore || loading) return
      loadArtists(query.trim(), artists.length, true, sort)
    }, { root, rootMargin: '800px 0px', threshold: 0.01 })
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, loading, artists.length, query, sort])

  const changeSort = (value) => {
    setSort(value)
    localStorage.setItem('lokal-artists-sort', value)
  }

  const toggleDensity = () => {
    const next = density === 'spaced' ? 'compact' : 'spaced'
    setDensity(next)
    localStorage.setItem('lokal-artists-density', next)
  }

  const playArtist = async (artist) => {
    const data = await api.getArtist(artist.id)
    const tracks = Array.isArray(data?.tracks) && data.tracks.length ? data.tracks : (Array.isArray(data?.topTracks) ? data.topTracks : [])
    if (tracks.length) playQueue(tracks, 0)
  }

  const emptyMessage = useMemo(() => {
    if (query.trim()) return 'No artists matched that search.'
    return 'No artists in your library yet.'
  }, [query])

  const gridClass = density === 'compact'
    ? 'grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10'
    : 'grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8'

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">Collection</p>
            <div className="mt-2 flex items-center gap-2.5">
              <h1 className="font-display text-3xl uppercase tracking-[0.14em] text-white">Artists</h1>
              <button
                onClick={() => navigate('/', { state: { tab: 'history' } })}
                title="Listening history"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-white/25 hover:text-white"
              >
                <Clock size={13} />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted">
              {loading ? 'Loading artists...' : `${total} artist${total === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end md:w-auto">
            <select
              value={sort}
              onChange={(event) => changeSort(event.target.value)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-accent/50"
            >
              <option value="name">Name (A–Z)</option>
              <option value="tracks">Most Tracks</option>
            </select>
            <button
              onClick={toggleDensity}
              title={density === 'spaced' ? 'Switch to compact grid' : 'Switch to spaced grid'}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white/70 transition-colors hover:border-white/25 hover:text-white"
            >
              {density === 'spaced' ? <LayoutGrid size={15} /> : <List size={15} />}
            </button>
            <div className="relative w-full sm:w-64">
              <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search artists..."
                className="w-full rounded-2xl border border-white/10 bg-white/5 pl-11 pr-4 py-2.5 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
          </div>
        </div>

        {!query.trim() && topArtists.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h2 className="text-xs font-display text-muted uppercase tracking-widest">Top Artists</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
              {topArtists.map((artist, index) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  rank={index + 1}
                  onClick={() => navigate(`/artist/${artist.id}`)}
                  onPlay={() => playArtist(artist)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          {!query.trim() && topArtists.length > 0 && (
            <h2 className="text-xs font-display text-muted uppercase tracking-widest">All Artists</h2>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 size={28} className="animate-spin text-muted" />
            </div>
          ) : artists.length === 0 ? (
            <div className="py-24 text-center">
              <Users size={42} className="mx-auto mb-4 text-muted/30" />
              <p className="text-sm text-muted">{emptyMessage}</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className={gridClass}>
                {artists.map((artist) => (
                  <ArtistCard
                    key={artist.id}
                    artist={artist}
                    onClick={() => navigate(`/artist/${artist.id}`)}
                    onPlay={() => playArtist(artist)}
                  />
                ))}
              </div>
              {(hasMore || loadingMore) && (
                <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center">
                  {loadingMore ? <Loader2 size={18} className="animate-spin text-muted" /> : <p className="text-xs text-muted/60">Scroll for more</p>}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
