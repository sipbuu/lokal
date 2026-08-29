import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Loader2, Music, Search, Users } from 'lucide-react'
import { api } from '../api'

const PAGE_SIZE = 60

function getArtistImage(artist) {
  if (!artist?.image_path) return null
  return api.isElectron ? `file://${artist.image_path}` : `/api/artist-image/${encodeURIComponent(artist.id)}`
}

function ArtistCard({ artist, onClick }) {
  const imgSrc = getArtistImage(artist)

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12, margin: '180px 0px' }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="group flex flex-col items-center gap-3 rounded-2xl border border-transparent p-3 text-center transition-colors hover:border-border hover:bg-card/50"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '180px' }}
    >
      <div className="aspect-square w-full overflow-hidden rounded-full border border-border bg-elevated flex items-center justify-center text-muted transition-colors group-hover:border-accent/40">
        {imgSrc ? (
          <img src={imgSrc} alt={artist.name} className="h-full w-full object-cover" />
        ) : (
          <Music size={28} />
        )}
      </div>
      <div className="min-w-0 w-full">
        <p className="truncate text-sm font-medium text-white">{artist.name}</p>
        <p className="truncate text-xs text-muted">{artist.track_count} {artist.track_count === 1 ? 'track' : 'tracks'}</p>
      </div>
    </motion.button>
  )
}

export default function Artists() {
  const [artists, setArtists] = useState([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [query, setQuery] = useState('')
  const loadMoreRef = useRef(null)
  const navigate = useNavigate()

  const loadArtists = (search, offset, append) => {
    const setBusy = append ? setLoadingMore : setLoading
    setBusy(true)
    return api.getArtistsPage({ search, limit: PAGE_SIZE, offset }).then((result) => {
      const items = Array.isArray(result?.items) ? result.items : []
      setArtists((current) => (append ? [...current, ...items] : items))
      setTotal(result?.total || 0)
      setHasMore(!!result?.hasMore)
      setBusy(false)
    }).catch(() => {
      setBusy(false)
    })
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      loadArtists(query.trim(), 0, false)
    }, query ? 200 : 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    const handleRefresh = () => loadArtists(query.trim(), 0, false)
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return
    const root = document.querySelector('main.flex-1.overflow-y-auto') || null
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting || loadingMore || loading) return
      loadArtists(query.trim(), artists.length, true)
    }, { root, rootMargin: '800px 0px', threshold: 0.01 })
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, loading, artists.length, query])

  const emptyMessage = useMemo(() => {
    if (query.trim()) return 'No artists matched that search.'
    return 'No artists in your library yet.'
  }, [query])

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">Collection</p>
            <h1 className="mt-2 font-display text-3xl uppercase tracking-[0.14em] text-white">Artists</h1>
            <p className="mt-3 text-sm text-muted">
              {loading ? 'Loading artists...' : `${total} artist${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="relative w-full max-w-sm">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search artists..."
              className="w-full rounded-2xl border border-border bg-elevated/90 pl-11 pr-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
            />
          </div>
        </div>

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
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {artists.map((artist) => (
                <ArtistCard key={artist.id} artist={artist} onClick={() => navigate(`/artist/${artist.id}`)} />
              ))}
            </div>
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
