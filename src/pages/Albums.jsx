import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Disc3, Loader2, Play, Search } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { api } from '../api'

const PAGE_SIZE = 48

function getAlbumArtwork(album) {
  if (!album?.artwork_path) return null
  return api.isElectron ? `file://${album.artwork_path}` : api.artworkURL(album.artwork_path)
}

function releaseLabel(type) {
  if (type === 'single') return 'Single'
  if (type === 'ep') return 'EP'
  return 'Album'
}

function AlbumHero({ album, trackCount, onBack, onPlay }) {
  const artSrc = getAlbumArtwork(album)

  return (
    <div className="relative overflow-hidden rounded-[2.25rem] border border-border bg-surface/80">
      <div
        className="absolute inset-0 scale-110 blur-3xl"
        style={{
          backgroundImage: artSrc ? `url("${artSrc}")` : 'none',
          backgroundPosition: 'center',
          backgroundSize: 'cover',
          opacity: artSrc ? 0.75 : 0,
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-black/20 via-black/35 to-black/80" />
      <div className="relative grid gap-6 p-6 md:grid-cols-[220px_minmax(0,1fr)] md:items-end md:p-8">
        <div className="justify-self-start space-y-4">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:text-white"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div className="h-44 w-44 overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/25 shadow-2xl md:h-[220px] md:w-[220px]">
            {artSrc ? (
              <img src={artSrc} alt={album.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Disc3 size={58} className="text-white/35" />
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 self-stretch rounded-[1.8rem] border border-white/10 bg-black/25 p-6 backdrop-blur-xl">
          <p className="text-[11px] font-display uppercase tracking-[0.34em] text-white/55">{releaseLabel(album.release_type)}</p>
          <h1 className="mt-3 text-3xl font-display uppercase tracking-[0.08em] text-white md:text-5xl">
            {album.title}
          </h1>
          <p className="mt-4 truncate text-sm text-white/75 md:text-base">
            {album.artists || album.album_artist || 'Unknown Artist'}
          </p>
          <p className="mt-3 text-xs uppercase tracking-[0.24em] text-white/45">
            {trackCount} tracks{album.year ? ` • ${album.year}` : ''}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onPlay}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-transform hover:scale-[1.02]"
            >
              <Play size={15} fill="currentColor" />
              Play
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AlbumCard({ album, onClick, onPlay }) {
  const artSrc = getAlbumArtwork(album)

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: '180px 0px' }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.985 }}
      onClick={onClick}
      className="group overflow-hidden rounded-[1.5rem] border border-border bg-card/60 text-left transition-colors hover:border-accent/35"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}
    >
      <div className="relative aspect-square overflow-hidden bg-black/20">
        {artSrc ? (
          <>
            <div
              className="absolute inset-0 scale-110 blur-xl"
              style={{
                backgroundImage: `url("${artSrc}")`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
                opacity: 0.7,
              }}
            />
            <img src={artSrc} alt={album.title} className="relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={34} className="text-muted" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
        <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/35 px-2.5 py-1 text-[10px] font-display uppercase tracking-[0.22em] text-white/85 backdrop-blur-md">
          {releaseLabel(album.release_type)}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onPlay?.()
          }}
          className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition-transform group-hover:scale-105"
        >
          <Play size={15} fill="currentColor" className="translate-x-px" />
        </button>
      </div>
      <div className="relative overflow-hidden px-4 py-3">
        <div
          className="absolute inset-0 scale-110 blur-xl"
          style={{
            backgroundImage: artSrc ? `url("${artSrc}")` : 'none',
            backgroundPosition: 'center',
            backgroundSize: 'cover',
            opacity: artSrc ? 0.18 : 0,
          }}
        />
        <div className="absolute inset-0 bg-black/35" />
        <div className="relative space-y-1">
          <p className="truncate text-sm font-medium text-white">{album.title}</p>
          <p className="truncate text-xs text-muted">{album.artists || album.album_artist || 'Unknown Artist'}</p>
          <p className="text-[11px] uppercase tracking-[0.22em] text-muted/70">
            {album.track_count} tracks{album.year ? ` • ${album.year}` : ''}
          </p>
        </div>
      </div>
    </motion.button>
  )
}

export default function Albums() {
  const [albums, setAlbums] = useState([])
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  const [albumTracks, setAlbumTracks] = useState([])
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const [loadingTracks, setLoadingTracks] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const [hoveredTrack, setHoveredTrack] = useState(null)
  const [visibleByType, setVisibleByType] = useState({ all: PAGE_SIZE, album: PAGE_SIZE, ep: PAGE_SIZE, single: PAGE_SIZE })
  const [settings, setSettings] = useState({})
  const loadMoreRef = useRef(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { playQueue, currentTrack, isPlaying, togglePlay, playTrack } = usePlayerStore()

  useEffect(() => {
    let active = true
    Promise.all([api.getAllAlbums(), api.getSettings().catch(() => ({}))]).then(([result, loadedSettings]) => {
      if (!active) return
      setAlbums(Array.isArray(result) ? result : [])
      setSettings(loadedSettings || {})
      setLoadingAlbums(false)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!albums.length) return
    const incomingAlbum = location.state?.album
    if (!incomingAlbum) return
    const match = albums.find((album) => album.title === incomingAlbum.title)
    setSelectedAlbum(match || incomingAlbum)
    navigate(location.pathname, { replace: true, state: {} })
  }, [albums, location.pathname, location.state, navigate])

  const showSingles = settings.show_singles_in_albums !== '0'
  const separateByType = settings.separate_album_types !== '0'

  const filteredAlbums = useMemo(() => {
    const lower = query.trim().toLowerCase()
    return albums.filter((album) => {
      if (!showSingles && album.release_type === 'single') return false
      if (!lower) return true
      const title = String(album.title || '').toLowerCase()
      const artists = String(album.artists || album.album_artist || '').toLowerCase()
      return title.includes(lower) || artists.includes(lower)
    })
  }, [albums, query, showSingles])

  useEffect(() => {
    setVisibleByType({ all: PAGE_SIZE, album: PAGE_SIZE, ep: PAGE_SIZE, single: PAGE_SIZE })
    setLoadingMore(false)
  }, [filteredAlbums, separateByType])

  const sectionSource = useMemo(() => {
    if (!separateByType) {
      return [{ key: 'all', label: 'Releases', items: filteredAlbums }]
    }
    return [
      { key: 'album', label: 'Albums', items: filteredAlbums.filter((album) => album.release_type === 'album') },
      { key: 'ep', label: 'EPs', items: filteredAlbums.filter((album) => album.release_type === 'ep') },
      { key: 'single', label: 'Singles', items: filteredAlbums.filter((album) => album.release_type === 'single') },
    ].filter((group) => group.items.length > 0)
  }, [filteredAlbums, separateByType])

  const groupedAlbums = useMemo(() => {
    return sectionSource.map((group) => ({
      ...group,
      items: group.items.slice(0, visibleByType[group.key] || PAGE_SIZE),
    }))
  }, [sectionSource, visibleByType])

  const hasMore = useMemo(() => {
    return sectionSource.some((group) => (visibleByType[group.key] || PAGE_SIZE) < group.items.length)
  }, [sectionSource, visibleByType])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return
    const root = document.querySelector('main.flex-1.overflow-y-auto') || null
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || loadingMore) return
      setLoadingMore(true)
      window.setTimeout(() => {
        setVisibleByType((current) => {
          const next = { ...current }
          for (const group of sectionSource) {
            next[group.key] = Math.min((current[group.key] || PAGE_SIZE) + PAGE_SIZE, group.items.length)
          }
          return next
        })
        setLoadingMore(false)
      }, 80)
    }, { root, rootMargin: '800px 0px', threshold: 0.01 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, sectionSource])

  useEffect(() => {
    if (!selectedAlbum?.title) {
      setAlbumTracks([])
      return
    }
    let active = true
    setLoadingTracks(true)
    api.getAlbumTracks(selectedAlbum.title).then((tracks) => {
      if (!active) return
      setAlbumTracks(Array.isArray(tracks) ? tracks : [])
      setLoadingTracks(false)
    })
    return () => {
      active = false
    }
  }, [selectedAlbum?.title])

  const handleTrackPlay = (track, index, event) => {
    event?.stopPropagation?.()
    if (currentTrack?.id === track.id) {
      togglePlay()
      return
    }
    playTrack(track, albumTracks)
  }

  const playAlbumRelease = async (album) => {
    const tracks = await api.getAlbumTracks(album.title)
    if (Array.isArray(tracks) && tracks.length) {
      playQueue(tracks, 0)
    }
  }

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">Collection</p>
            <h1 className="mt-2 font-display text-3xl uppercase tracking-[0.14em] text-white">Albums</h1>
            <p className="mt-3 text-sm text-muted">
              {loadingAlbums ? 'Loading releases...' : `${filteredAlbums.length} visible releases`}
            </p>
          </div>
          <div className="relative w-full max-w-xl">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search albums, singles, EPs, or artists..."
              className="w-full rounded-2xl border border-border bg-elevated/90 pl-11 pr-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
            />
          </div>
        </div>

        {selectedAlbum ? (
          <div className="space-y-6">
            <AlbumHero
              album={selectedAlbum}
              trackCount={albumTracks.length || selectedAlbum.track_count || 0}
              onBack={() => setSelectedAlbum(null)}
              onPlay={() => albumTracks.length && playQueue(albumTracks, 0)}
            />

            <div className="overflow-hidden rounded-[1.75rem] border border-border bg-surface/80">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">Tracklist</p>
                  <p className="mt-1 text-sm text-white/65">
                    {loadingTracks ? 'Loading tracks...' : `${albumTracks.length} tracks`}
                  </p>
                </div>
                {albumTracks.length > 0 && (
                  <button
                    onClick={() => playQueue(albumTracks, 0)}
                    className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-white transition-colors hover:border-accent/40"
                  >
                    <Play size={14} fill="currentColor" />
                    Play
                  </button>
                )}
              </div>

              {loadingTracks ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-muted" />
                </div>
              ) : albumTracks.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-muted">No tracks found for this release.</div>
              ) : (
                <div className="divide-y divide-border/60">
                  {albumTracks.map((track, index) => {
                    const isCurrent = currentTrack?.id === track.id
                    const isHovered = hoveredTrack === track.id
                    return (
                      <button
                        key={track.id}
                        type="button"
                        onClick={(event) => handleTrackPlay(track, index, event)}
                        onDoubleClick={() => playQueue(albumTracks, index)}
                        onMouseEnter={() => setHoveredTrack(track.id)}
                        onMouseLeave={() => setHoveredTrack(null)}
                        className={`flex w-full items-center gap-4 px-6 py-3 text-left transition-colors ${isCurrent ? 'bg-accent/10' : 'hover:bg-elevated/80'}`}
                      >
                        <div className="flex w-8 items-center justify-center">
                          {isHovered || isCurrent ? (
                            <span className={isCurrent ? 'text-accent' : 'text-white'}>
                              {isCurrent && isPlaying ? (
                                <Disc3 size={14} className="animate-spin" />
                              ) : (
                                <Play size={14} fill="currentColor" className="translate-x-px" />
                              )}
                            </span>
                          ) : (
                            <span className={`text-xs font-display ${isCurrent ? 'text-accent' : 'text-muted'}`}>
                              {track.display_track_num || track.track_num || index + 1}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm ${isCurrent ? 'text-accent' : 'text-white'}`}>{track.title}</p>
                          <p className="truncate text-xs text-muted">{track.artist}</p>
                        </div>
                        <span className="text-xs text-muted">
                          {track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : loadingAlbums ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 size={28} className="animate-spin text-muted" />
          </div>
        ) : filteredAlbums.length === 0 ? (
          <div className="py-24 text-center">
            <Disc3 size={42} className="mx-auto mb-4 text-muted/30" />
            <p className="text-sm text-muted">{query.trim() ? 'No releases matched that search.' : 'No releases in your library yet.'}</p>
          </div>
        ) : (
          <div className="space-y-10">
            {groupedAlbums.map((group) => (
              <section key={group.key} className="space-y-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">{group.label}</p>
                    <p className="mt-1 text-sm text-white/60">{group.items.length} shown</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                  {group.items.map((album, index) => (
                    <AlbumCard
                      key={`${group.key}-${album.title}-${album.album_artist || album.artists || 'release'}-${index}`}
                      album={album}
                      onClick={() => setSelectedAlbum(album)}
                      onPlay={() => playAlbumRelease(album)}
                    />
                  ))}
                </div>
              </section>
            ))}
            {(hasMore || loadingMore) && (
              <div ref={loadMoreRef} className="flex min-h-20 items-center justify-center">
                {loadingMore ? <Loader2 size={18} className="animate-spin text-muted" /> : <p className="text-xs text-muted/60">Scroll for more</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
