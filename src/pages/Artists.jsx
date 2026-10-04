import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Clock, Grid2x2, Grid3x3, List, Loader2, Music, Play, Radio, RefreshCw, Search, Sparkles, Users } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { api } from '../api'
import { peekCache, writeCache, usePageReady } from '../pageCache'
import FadeImg from '../components/FadeImg'
import { PlayGlyph } from '../components/CoverPlay'
import ArtistRefreshAllModal from '../components/ArtistRefreshAllModal'
import ContextMenu, { useContextMenu } from '../components/ContextMenu'
import { openRadio } from '../radioActions'

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

// Cards on the first screen skip their own entrance: the page already fades
// in, and dozens of card animations running with it dropped frames.
const FIRST_SCREEN_CARDS = 24

function ArtistCard({ artist, onClick, onPlay, onContextMenu, rank, animateIn = true }) {
  const imgSrc = getArtistImage(artist)

  return (
    <motion.button
      initial={animateIn ? { opacity: 0, y: 10 } : false}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: '180px 0px' }}
      onClick={onClick}
      onContextMenu={event => onContextMenu?.(event, artist)}
      className="group relative flex flex-col items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-center transition-all duration-200 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.08]"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '190px' }}
    >
      {rank != null && (
        <div className="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] font-display text-white/70">
          {rank}
        </div>
      )}
      <div className="relative aspect-square w-full overflow-hidden rounded-full ring-1 ring-white/10 shadow-lg shadow-black/40 transition-all duration-200 group-hover:ring-white/25">
        {imgSrc ? (
          <FadeImg src={imgSrc} alt={artist.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" />
        ) : (
          <FallbackAvatar name={artist.name} />
        )}
        {/* Same play glyph as the album covers; the rest of the card opens the artist. */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <button
            type="button"
            aria-label={`Play ${artist.name}`}
            title={`Play ${artist.name}`}
            onClick={(event) => { event.stopPropagation(); onPlay?.() }}
            className="text-white transition-transform hover:scale-110 active:scale-95"
          >
            <PlayGlyph className="h-11 w-11 drop-shadow-[0_4px_14px_rgba(0,0,0,0.6)]" />
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

/** One artist as a list row: small avatar, full name (wraps instead of being cut), track count. */
function ArtistRow({ artist, onClick, onPlay, onContextMenu }) {
  const imgSrc = getArtistImage(artist)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onContextMenu={(event) => onContextMenu?.(event, artist)}
      onKeyDown={(event) => { if (event.key === 'Enter') onClick?.() }}
      className="group grid cursor-pointer grid-cols-[2.5rem_1fr_auto] items-center gap-3 rounded-lg px-3 py-1.5 transition-colors hover:bg-elevated"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '52px' }}
    >
      <div className="relative h-10 w-10 overflow-hidden rounded-full bg-card">
        {imgSrc ? <FadeImg src={imgSrc} className="h-full w-full object-cover" /> : <FallbackAvatar name={artist.name} />}
      </div>
      <div className="min-w-0">
        <p className="break-words text-sm font-medium leading-snug text-text" title={artist.name}>{artist.name}</p>
        <p className="text-xs text-muted">{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</p>
      </div>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onPlay?.() }}
        title={`Play ${artist.name}`}
        aria-label={`Play ${artist.name}`}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[rgb(var(--bg-rgb))] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
      >
        <Play size={13} fill="currentColor" className="translate-x-px" />
      </button>
    </div>
  )
}

/** First letter for list headers: A–Z, "#" for digits/symbols. */
function letterOf(name) {
  const c = String(name || '').trim().normalize('NFKD').charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : '#'
}

const VIEWS = [
  { id: 'spaced', label: 'Grid', icon: Grid2x2 },
  { id: 'compact', label: 'Compact grid', icon: Grid3x3 },
  { id: 'list', label: 'List', icon: List },
]

export default function Artists() {
  const [sort, setSort] = useState(() => localStorage.getItem('lokal-artists-sort') || 'name')
  // The unfiltered first page from last time, shown at once on the way back
  // (count included) while it refreshes, instead of "Loading artists...".
  const cached = peekCache(`artists:${sort}`)
  const [artists, setArtists] = useState(() => cached?.items || [])
  const [topArtists, setTopArtists] = useState(() => peekCache('artists:top') || [])
  const [total, setTotal] = useState(() => cached?.total || 0)
  const [hasMore, setHasMore] = useState(() => !!cached?.hasMore)
  const [loading, setLoading] = useState(!cached)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  usePageReady(!loading)
  const [density, setDensity] = useState(() => localStorage.getItem('lokal-artists-density') || 'spaced')
  const [refreshOpen, setRefreshOpen] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState(null)
  const loadMoreRef = useRef(null)
  // Only the latest request's answer applies (an earlier search can land late).
  const artistRequestRef = useRef({ id: 0, append: false })
  const navigate = useNavigate()
  const { playQueue } = usePlayerStore()
  const { user } = useAppStore()
  const menu = useContextMenu()

  const loadArtists = (search, offset, append, sortMode) => {
    const requestId = artistRequestRef.current.id + 1
    artistRequestRef.current = { id: requestId, append }
    // A superseded load-more still ends its own spinner, unless the newer
    // request is a load-more too (which owns that spinner now).
    const stale = () => {
      if (requestId === artistRequestRef.current.id) return false
      if (append && !artistRequestRef.current.append) setLoadingMore(false)
      return true
    }
    const setBusy = append ? setLoadingMore : setLoading
    // A refresh of what's already on screen happens quietly (no spinner), and
    // a sort seen before shows its last page at once, not the previous sort's.
    const seen = !append && !search ? peekCache(`artists:${sortMode}`) : null
    if (seen) {
      setArtists(seen.items)
      setTotal(seen.total)
      setHasMore(seen.hasMore)
      setBusy(false)
    } else setBusy(true)
    return api.getArtistsPage({ search, limit: PAGE_SIZE, offset, sort: sortMode }).then((result) => {
      if (stale()) return
      // A failed request keeps what's shown (and the cache) as it was.
      if (!Array.isArray(result?.items)) { setBusy(false); return }
      const items = result.items
      if (!append && !search) writeCache(`artists:${sortMode}`, { items, total: result?.total || 0, hasMore: !!result?.hasMore })
      setArtists((current) => (append ? [...current, ...items] : items))
      setTotal(result?.total || 0)
      setHasMore(!!result?.hasMore)
      setBusy(false)
    }).catch(() => {
      if (stale()) return
      setBusy(false)
    })
  }

  const loadTopArtists = () => {
    api.getArtistsPage({ search: '', limit: TOP_ARTISTS_LIMIT, offset: 0, sort: 'tracks' }).then((result) => {
      // A failed request keeps the top artists shown (and cached).
      if (!Array.isArray(result?.items)) return
      const top = result.items.filter((artist) => Number(artist.track_count) > 0)
      writeCache('artists:top', top)
      setTopArtists(top)
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

  // Grid, compact grid, or list (long names are easier to read and scan in a list).
  const changeView = (next) => {
    setDensity(next)
    try { localStorage.setItem('lokal-artists-density', next) } catch {}
  }

  // List view sorted by name: a letter header before each new first letter.
  const listRows = useMemo(() => {
    if (density !== 'list') return []
    const rows = []
    let last = null
    for (const artist of artists) {
      const letter = sort === 'name' ? letterOf(artist.name) : null
      if (letter && letter !== last) { rows.push({ type: 'letter', letter }); last = letter }
      rows.push({ type: 'artist', artist })
    }
    return rows
  }, [artists, density, sort])

  const playArtist = async (artist) => {
    const data = await api.getArtist(artist.id)
    const tracks = Array.isArray(data?.tracks) && data.tracks.length ? data.tracks : (Array.isArray(data?.topTracks) ? data.topTracks : [])
    if (tracks.length) playQueue(tracks, 0)
  }

  const openArtistMenu = (event, artist) => menu.open(event, [
    { label: 'Start artist radio', icon: Radio, onSelect: () => openRadio(navigate, { artist: artist.name, type: 'artist' }, user?.id) },
    { label: 'Open artist', icon: Users, onSelect: () => navigate(`/artist/${artist.id}`) },
  ])

  const emptyMessage = useMemo(() => {
    if (query.trim()) return 'No artists matched that search.'
    return 'No artists in your library yet.'
  }, [query])

  const gridClass = density === 'compact'
    ? 'grid grid-cols-4 gap-3 @sm:grid-cols-6 @md:grid-cols-8 @lg:grid-cols-10'
    : 'grid grid-cols-3 gap-4 @sm:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-8'

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 @md:flex-row @md:flex-wrap @md:items-end @md:justify-between">
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
              <button
                onClick={() => setRefreshOpen(true)}
                title={refreshStatus?.running ? `Refreshing artist info: ${refreshStatus.done}/${refreshStatus.total}` : 'Refresh artist info (pictures and bios)'}
                aria-label="Refresh artist info"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/60 transition-colors hover:border-white/25 hover:text-white"
              >
                <RefreshCw size={13} className={refreshStatus?.running ? 'animate-spin' : ''} />
              </button>
            </div>
            <p className="mt-3 text-sm text-muted">
              {loading ? '\u00a0' : `${total.toLocaleString()} artist${total === 1 ? '' : 's'}`}
            </p>
          </div>

          <div className="flex w-full flex-col gap-3 @sm:flex-row @sm:flex-wrap @sm:items-center @sm:justify-end @md:w-auto">
            <select
              value={sort}
              onChange={(event) => changeSort(event.target.value)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-accent/50"
            >
              <option value="name">Name (A–Z)</option>
              <option value="tracks">Most Tracks</option>
            </select>
            <div role="radiogroup" aria-label="Artists view" className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {VIEWS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={density === id}
                  onClick={() => changeView(id)}
                  title={label}
                  aria-label={label}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${density === id ? 'bg-accent/20 text-accent' : 'text-muted hover:text-text'}`}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <div className="relative w-full @sm:w-64 @sm:max-w-full">
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

        {!query.trim() && topArtists.length > 0 && density !== 'list' && (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h2 className="text-xs font-display text-muted uppercase tracking-widest">Top Artists</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-8">
              {topArtists.map((artist, index) => (
                <ArtistCard
                  key={artist.id}
                  artist={artist}
                  rank={index + 1}
                  onClick={() => navigate(`/artist/${artist.id}`)}
                  onPlay={() => playArtist(artist)}
                  onContextMenu={openArtistMenu}
                  animateIn={false}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          {!query.trim() && topArtists.length > 0 && density !== 'list' && (
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
              {density === 'list' ? (
                <div className="columns-1 gap-6 @lg:columns-2">
                  {listRows.map((row) => row.type === 'letter' ? (
                    <h3 key={`letter-${row.letter}`} className="break-after-avoid px-3 pb-1 pt-4 font-display text-xs uppercase tracking-[0.3em] text-accent first:pt-0">{row.letter}</h3>
                  ) : (
                    <div key={row.artist.id} className="break-inside-avoid">
                      <ArtistRow
                        artist={row.artist}
                        onClick={() => navigate(`/artist/${row.artist.id}`)}
                        onPlay={() => playArtist(row.artist)}
                        onContextMenu={openArtistMenu}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className={gridClass}>
                  {artists.map((artist, index) => (
                    <ArtistCard
                      key={artist.id}
                      artist={artist}
                      onClick={() => navigate(`/artist/${artist.id}`)}
                      onPlay={() => playArtist(artist)}
                      onContextMenu={openArtistMenu}
                      animateIn={index >= FIRST_SCREEN_CARDS}
                    />
                  ))}
                </div>
              )}
              {(hasMore || loadingMore) && (
                <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center">
                  {loadingMore ? <Loader2 size={18} className="animate-spin text-muted" /> : <p className="text-xs text-muted/60">Scroll for more</p>}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
      <ArtistRefreshAllModal open={refreshOpen} onClose={() => setRefreshOpen(false)} onStatus={setRefreshStatus} />
      <ContextMenu menu={menu} />
    </div>
  )
}
