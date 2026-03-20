import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Download, X, CheckCircle, AlertCircle, ListMusic, AlertTriangle, RefreshCw, Library, UserRound, Disc3, Link2 } from 'lucide-react'
import { api } from '../api'

const DISCLAIMER_KEY = 'lokal-dl-accepted'

function fmt(seconds) {
  if (!seconds) return ''
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function prettifySlug(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase())
}

function inferTitleFromUrl(url, fallback = 'Download') {
  if (!url) return fallback
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    const listId = parsed.searchParams.get('list')

    if (host.includes('youtube') || host === 'youtu.be') {
      if (parsed.pathname.includes('/channel/') || parsed.pathname.includes('/c/') || parsed.pathname.includes('/@')) {
        const segment = parsed.pathname.split('/').filter(Boolean).pop()
        return segment ? prettifySlug(segment.replace(/^@/, '')) : 'YouTube Channel'
      }
      if (listId) return `YouTube Playlist ${listId.slice(0, 8)}`
      if (parsed.pathname.includes('/playlist')) return 'YouTube Playlist'
      if (parsed.pathname.includes('/watch')) return 'YouTube Track'
      if (parsed.hostname.includes('music.youtube')) return 'YouTube Music Release'
      return 'YouTube Download'
    }

    if (host.includes('soundcloud')) return 'SoundCloud Download'
    if (host.includes('bandcamp')) return 'Bandcamp Download'
    return prettifySlug(host.split('.').slice(0, -1).join(' ')) || fallback
  } catch {
    return fallback
  }
}

function isGenericTitle(title) {
  const normalized = String(title || '').trim().toLowerCase()
  return !normalized || normalized === 'download' || normalized === 'playlist / album'
}

function displayTitle(item, fallback = 'Download') {
  if (!item) return fallback
  if (!isGenericTitle(item.title) && item.title !== item.url) return item.title
  return inferTitleFromUrl(item.url, fallback)
}

function normalizeArtistResults(items) {
  const seen = new Set()
  return (Array.isArray(items) ? items : [])
    .filter(item => item?.title && item?.url && (item.type === 'channel' || item.type === 'playlist'))
    .filter(item => {
      const key = `${item.type}:${item.id || item.url}:${item.url}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function mergeDownload(existing, incoming) {
  if (!existing) return incoming
  return {
    ...existing,
    ...incoming,
    title: incoming.title || existing.title,
    status: incoming.status || existing.status,
    progress: incoming.progress ?? existing.progress ?? 0,
    speed: incoming.speed ?? existing.speed ?? null,
    eta: incoming.eta ?? existing.eta ?? null,
    message: incoming.message ?? existing.message ?? null,
    song: incoming.song ?? existing.song ?? null,
    output: incoming.output ?? existing.output ?? '',
    error: incoming.error ?? existing.error ?? null,
    downloadedTracks: Array.isArray(incoming.downloadedTracks) ? incoming.downloadedTracks : (existing.downloadedTracks || []),
    indexedTracks: Array.isArray(incoming.indexedTracks) ? incoming.indexedTracks : (existing.indexedTracks || []),
    totalTracks: incoming.totalTracks ?? existing.totalTracks ?? null,
    currentTrack: incoming.currentTrack ?? existing.currentTrack ?? null,
    kind: incoming.kind || existing.kind || 'single',
  }
}

function normalizeDownload(item) {
  const normalizedStatus = item.status === 'cancelled' || item.status === 'incomplete'
    ? item.status
    : item.status || 'downloading'
  const normalized = {
    id: item.id,
    url: item.url,
    title: item.title || item.url || 'Download',
    kind: item.kind || 'single',
    status: normalizedStatus,
    progress: item.progress ?? 0,
    speed: item.speed ?? null,
    eta: item.eta ?? null,
    message: item.message ?? null,
    song: item.song ?? null,
    output: item.output ?? '',
    error: item.error ?? null,
    downloadedTracks: Array.isArray(item.downloadedTracks) ? item.downloadedTracks : [],
    indexedTracks: Array.isArray(item.indexedTracks) ? item.indexedTracks : [],
    totalTracks: item.totalTracks ?? null,
    currentTrack: item.currentTrack ?? null,
  }
  return {
    ...normalized,
    title: displayTitle(normalized),
  }
}

function upsertDownloads(current, incomingItems) {
  const map = new Map(current.map(item => [item.id, item]))
  for (const raw of incomingItems) {
    const item = normalizeDownload(raw)
    map.set(item.id, mergeDownload(map.get(item.id), item))
  }
  return Array.from(map.values()).sort((a, b) => {
    const aActive = a.status === 'downloading' ? 0 : 1
    const bActive = b.status === 'downloading' ? 0 : 1
    return aActive - bActive
  })
}

function DownloadItem({ d, onRemove }) {
  const [showDownloaded, setShowDownloaded] = useState(false)
  const [showIndexed, setShowIndexed] = useState(false)
  const visibleDownloadedTracks = d.downloadedTracks.filter(track => !track.toLowerCase().endsWith('.webm'))
  const hasDownloadedTracks = visibleDownloadedTracks.length > 0
  const hasIndexedTracks = d.indexedTracks.length > 0
  const isStopped = d.status === 'cancelled' || d.status === 'incomplete'
  const accentTone = d.status === 'error'
    ? 'from-red-500/20 to-red-500/5 border-red-500/20'
    : d.status === 'done'
      ? 'from-green-500/15 to-emerald-500/5 border-green-500/20'
      : isStopped
        ? 'from-yellow-500/15 to-amber-500/5 border-yellow-500/20'
        : 'from-accent/20 to-transparent border-accent/20'
  const statusLabel = d.status === 'incomplete'
    ? 'Incomplete'
    : d.status === 'cancelled'
      ? 'Cancelled'
      : d.kind === 'playlist'
        ? 'Playlist Download'
        : 'Track Download'

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={`rounded-2xl border bg-gradient-to-br ${accentTone} p-4`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl border border-white/10 bg-black/20 p-2">
          {d.kind === 'playlist' ? <Library size={16} className="text-white" /> : <Disc3 size={16} className="text-white" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{displayTitle(d)}</p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-muted">{statusLabel}</p>
            </div>
            <div className="flex items-center gap-2">
              {d.status === 'done' && <CheckCircle size={16} className="text-green-400" />}
              {d.status === 'error' && <AlertCircle size={16} className="text-red-400" />}
              {isStopped && <AlertTriangle size={16} className="text-yellow-300" />}
              {d.status === 'downloading' && <span className="text-xs font-display text-muted">{Math.round(d.progress || 0)}%</span>}
              <button onClick={onRemove} className="text-subtle transition-colors hover:text-white">
                <X size={13} />
              </button>
            </div>
          </div>

          {d.song && <p className="mt-2 truncate text-xs text-accent">{d.song.split(/[/\\]/).pop()}</p>}
          {d.message && <p className="mt-1 truncate text-xs text-muted">{d.message}</p>}
          {d.totalTracks ? (
            <p className="mt-1 text-xs text-muted">
              {d.currentTrack ? `${Math.min(d.currentTrack, d.totalTracks)} / ${d.totalTracks} tracks` : `${d.totalTracks} tracks`}
            </p>
          ) : null}

          {d.status === 'downloading' && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="h-full rounded-full bg-accent"
                  animate={{ width: d.progress > 0 ? `${d.progress}%` : '8%' }}
                  transition={{ duration: 0.25 }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {d.progress > 0 ? `${Math.round(d.progress)}%` : 'Working...'}
                {d.speed ? ` · ${d.speed}` : ''}
                {d.eta ? ` · ETA ${d.eta}` : ''}
              </p>
            </div>
          )}

          {d.error && <p className="mt-2 truncate text-xs text-red-400">{d.error}</p>}
          {isStopped && !d.error && <p className="mt-2 truncate text-xs text-yellow-200">This download did not finish and can be restarted.</p>}

          {hasDownloadedTracks && (
            <div className="mt-3">
              <button onClick={() => setShowDownloaded(!showDownloaded)} className="flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent/70">
                <ListMusic size={12} />
                {showDownloaded ? 'Hide' : 'Show'} files ({visibleDownloadedTracks.length})
              </button>
              {showDownloaded && (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border bg-black/15 p-2">
                  {visibleDownloadedTracks.map((track, index) => (
                    <p key={`${track}-${index}`} className="truncate text-xs text-muted">
                      <span className="mr-1 text-accent/70">{index + 1}.</span>{track}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {hasIndexedTracks && (
            <div className="mt-3">
              <button onClick={() => setShowIndexed(!showIndexed)} className="flex items-center gap-1 text-xs text-green-400 transition-colors hover:text-green-300">
                <CheckCircle size={12} />
                {showIndexed ? 'Hide' : 'Show'} indexed tracks ({d.indexedTracks.length})
              </button>
              {showIndexed && (
                <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl border border-border bg-black/15 p-2">
                  {d.indexedTracks.map((track, index) => (
                    <p key={`${track.id || track.filepath}-${index}`} className="truncate text-xs text-green-300/80">
                      <span className="mr-1 text-green-400">{index + 1}.</span>{track.title || track.filepath?.split(/[/\\]/).pop()}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {d.output && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">Show log</summary>
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-black/20 p-2 text-xs text-muted">{d.output}</pre>
            </details>
          )}
        </div>
      </div>
    </motion.div>
  )
}

export default function Downloader() {
  const [accepted] = useState(() => localStorage.getItem(DISCLAIMER_KEY) === '1')
  const [showDisclaimer, setShowDisclaimer] = useState(!accepted)
  const [tab, setTab] = useState('search')
  const [downloadedPlaylists, setDownloadedPlaylists] = useState([])
  const [loadingPlaylists, setLoadingPlaylists] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchPage, setSearchPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [artistQuery, setArtistQuery] = useState('')
  const [artistResults, setArtistResults] = useState([])
  const [searchingArtist, setSearchingArtist] = useState(false)
  const [artistPage, setArtistPage] = useState(1)
  const [artistHasMore, setArtistHasMore] = useState(false)
  const [loadingMoreArtist, setLoadingMoreArtist] = useState(false)
  const [artistError, setArtistError] = useState('')
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [format, setFormat] = useState('mp3')
  const [quality, setQuality] = useState('320')
  const [downloads, setDownloads] = useState(() => {
    try {
      const saved = localStorage.getItem('lokal-downloads')
      const parsed = saved ? JSON.parse(saved) : []
      return Array.isArray(parsed) ? parsed.map(normalizeDownload) : []
    } catch {
      return []
    }
  })

  const manualPlaylistTitle = inferTitleFromUrl(playlistUrl, 'Playlist / Album')

  const refreshQueue = async () => {
    try {
      const queue = await api.getDownloadQueue()
      if (!Array.isArray(queue)) return
      setDownloads(prev => upsertDownloads(prev, queue))
    } catch {}
  }

  useEffect(() => {
    const unsub = api.onDownloadProgress((_, data) => {
      setDownloads(prev => upsertDownloads(prev, [data]))
    })
    return () => {
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  useEffect(() => {
    refreshQueue()
    const interval = setInterval(refreshQueue, api.isElectron ? 5000 : 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    try {
      const toSave = downloads.map(download => ({
        ...download,
        output: download.output ? download.output.slice(-1000) : '',
      }))
      localStorage.setItem('lokal-downloads', JSON.stringify(toSave))
    } catch {}
  }, [downloads])

  const search = async (page = 1) => {
    if (!query.trim()) return
    if (page === 1) {
      setResults([])
      setSearchError('')
    }
    setSearching(page === 1)
    const response = await api.searchYTPaginated(query, page)
    if (response?.error) {
      setResults([])
      setHasMore(false)
      setSearchError(response.error)
      setSearching(false)
      return
    }
    const nextResults = Array.isArray(response) ? response : response?.results || []
    setResults(prev => page === 1 ? nextResults : [...prev, ...nextResults])
    setSearchPage(page)
    setHasMore(Boolean(response?.hasMore))
    setSearching(false)
  }

  const loadMore = async () => {
    if (!query.trim() || loadingMore || !hasMore) return
    setLoadingMore(true)
    await search(searchPage + 1)
    setLoadingMore(false)
  }

  const searchArtist = async (page = 1) => {
    if (!artistQuery.trim()) return
    if (page === 1) {
      setArtistResults([])
      setArtistError('')
    }
    setSearchingArtist(page === 1)
    const response = await api.searchYTArtist(artistQuery, page)
    if (response?.error) {
      setArtistResults([])
      setArtistHasMore(false)
      setArtistError(response.error)
      setSearchingArtist(false)
      return
    }
    const nextResults = normalizeArtistResults(Array.isArray(response) ? response : response?.results || [])
    setArtistResults(prev => page === 1 ? nextResults : normalizeArtistResults([...prev, ...nextResults]))
    setArtistPage(page)
    setArtistHasMore(Boolean(response?.hasMore))
    setSearchingArtist(false)
  }

  const loadMoreArtist = async () => {
    if (!artistQuery.trim() || loadingMoreArtist || !artistHasMore) return
    setLoadingMoreArtist(true)
    await searchArtist(artistPage + 1)
    setLoadingMoreArtist(false)
  }

  const beginDownload = (item) => {
    setDownloads(prev => upsertDownloads(prev, [item]))
  }

  const downloadSingle = async (item) => {
    const id = `dl-${Date.now()}`
    const resolvedTitle = displayTitle(item)
    beginDownload({
      id,
      title: resolvedTitle,
      url: item.url,
      kind: 'single',
      status: 'downloading',
      progress: 0,
      message: 'Starting...',
    })
    const result = await api.downloadYT(item.url, { format, quality, id, title: resolvedTitle })
    if (result?.error) {
      setDownloads(prev => upsertDownloads(prev, [{
        id,
        title: resolvedTitle,
        url: item.url,
        status: 'error',
        error: result.error,
        message: result.error,
      }]))
      return
    }
    refreshQueue()
  }

  const downloadPlaylistFn = async (url, title = 'Playlist / Album') => {
    if (!url?.trim()) return
    const resolvedTitle = isGenericTitle(title) ? inferTitleFromUrl(url, 'Playlist / Album') : title
    const id = `pl-${Date.now()}`
    beginDownload({
      id,
      title: resolvedTitle,
      url,
      kind: 'playlist',
      status: 'downloading',
      progress: 0,
      message: 'Starting...',
    })
    const result = await api.downloadPlaylist(url, { format, quality, id, title: resolvedTitle })
    if (result?.error) {
      setDownloads(prev => upsertDownloads(prev, [{
        id,
        title: resolvedTitle,
        url,
        status: 'error',
        error: result.error,
        message: result.error,
      }]))
      return
    }
    refreshQueue()
    if (tab === 'library') loadDownloadedPlaylists()
  }

  const removeDownload = async (id) => {
    const target = downloads.find(download => download.id === id)
    if (target?.status === 'downloading') {
      try { await api.cancelDownload(id) } catch {}
    }
    setDownloads(prev => prev.filter(download => download.id !== id))
  }

  const clearDone = () => {
    setDownloads(prev => prev.filter(download => download.status === 'downloading'))
  }

  const loadDownloadedPlaylists = () => {
    setLoadingPlaylists(true)
    api.getDownloadedPlaylists()
      .then(response => {
        setDownloadedPlaylists(Array.isArray(response) ? response : [])
        setLoadingPlaylists(false)
      })
      .catch(() => setLoadingPlaylists(false))
  }

  const handleRedownload = async (playlistId) => {
    await api.redownloadPlaylist(playlistId)
    refreshQueue()
    loadDownloadedPlaylists()
  }

  const handleRemovePlaylist = (playlistId) => {
    if (!confirm('Delete this playlist from library?')) return
    api.deleteDownloadedPlaylist(playlistId).then(() => loadDownloadedPlaylists())
  }

  if (showDisclaimer) {
    return (
      <div className="max-w-lg p-8">
        <div className="overflow-hidden rounded-[28px] border border-yellow-500/20 bg-gradient-to-br from-yellow-500/10 via-card to-card shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="border-b border-yellow-500/15 px-6 py-5">
            <h1 className="font-display text-lg uppercase tracking-[0.35em] text-white">Downloader</h1>
          </div>
          <div className="space-y-5 px-6 py-6">
            <div className="flex gap-3">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0 text-yellow-400" />
              <div>
                <p className="mb-2 text-sm font-medium text-yellow-300">Legal Notice</p>
                <p className="text-sm leading-relaxed text-muted">This tool downloads audio via yt-dlp. Only download content you own or are allowed to save. Copyright rules depend on your location and the source.</p>
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.setItem(DISCLAIMER_KEY, '1')
                setShowDisclaimer(false)
              }}
              className="w-full rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80"
            >
              I Understand
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6 px-4 pb-12 pt-6 lg:max-w-[58rem]">
      <section className="rounded-[24px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-lg uppercase tracking-[0.28em] text-white">Downloader</h1>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {[['search', 'Search'], ['artist', 'Artist'], ['playlist', 'Playlist / Album'], ['library', 'Library']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id)
                  if (id === 'library') loadDownloadedPlaylists()
                }}
                className={`rounded-full px-4 py-2 text-xs font-display uppercase tracking-[0.2em] transition-all ${tab === id ? 'bg-accent text-base' : 'border border-border bg-card/70 text-muted hover:text-white'}`}
              >
                {label}
              </button>
            ))}
            <button onClick={refreshQueue} className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-white">
              <RefreshCw size={13} />
              Refresh
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-display uppercase tracking-[0.26em] text-muted">Format</span>
            {['mp3', 'flac', 'm4a', 'opus'].map(option => (
              <button
                key={option}
                onClick={() => setFormat(option)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${format === option ? 'bg-accent text-base' : 'border border-border text-muted hover:text-white'}`}
              >
                {option.toUpperCase()}
              </button>
            ))}
          </div>
          {format === 'mp3' && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-display uppercase tracking-[0.26em] text-muted">Quality</span>
              {['128', '192', '320'].map(option => (
                <button
                  key={option}
                  onClick={() => setQuality(option)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${quality === option ? 'border border-accent/30 bg-accent/15 text-accent' : 'border border-border text-muted hover:text-white'}`}
                >
                  {option}k
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {tab === 'search' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
            <Search size={14} />
            <span>Track Search</span>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && search(1)}
                placeholder="Search YouTube tracks..."
                className="w-full rounded-2xl border border-border bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
            <button
              onClick={() => search(1)}
              disabled={searching || !query.trim()}
              className="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80 disabled:opacity-40"
            >
              {searching ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          {searchError && <p className="mt-3 text-sm text-red-400">{searchError}</p>}

          <div className="mt-4 space-y-3">
            {results.map(result => {
              const matchingDownload = downloads.find(download => download.url === result.url)
              const isDownloading = matchingDownload?.status === 'downloading'
              const isDone = matchingDownload?.status === 'done'

              return (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-black/15 p-3"
                >
                  {result.thumbnail && <img src={result.thumbnail} className="h-12 w-16 flex-shrink-0 rounded-xl object-cover" />}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{result.title}</p>
                    <p className="mt-1 text-xs text-muted">{result.channel}{result.duration ? ` · ${fmt(result.duration)}` : ''}</p>
                  </div>
                  <button
                    onClick={() => !isDownloading && !isDone && downloadSingle(result)}
                    disabled={isDownloading || isDone}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${isDone ? 'text-green-400' : isDownloading ? 'text-muted' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}
                  >
                    {isDone ? <CheckCircle size={13} /> : isDownloading ? <RefreshCw size={13} className="animate-spin" /> : <><Download size={12} />Download</>}
                  </button>
                </motion.div>
              )
            })}

            {!results.length && !searching && query && !searchError && (
              <p className="py-8 text-center text-sm text-muted">No results. Try a different search.</p>
            )}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-2xl border border-border bg-black/15 px-4 py-2 text-sm text-muted transition-colors hover:border-accent/50 hover:text-white disabled:opacity-40"
                >
                  {loadingMore ? <RefreshCw size={14} className="animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'playlist' && (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
              <Link2 size={14} />
              <span>Playlist / Album URL</span>
            </div>
            <div>
              <input
                value={playlistUrl}
                onChange={event => setPlaylistUrl(event.target.value)}
                placeholder="https://www.youtube.com/playlist?list=..."
                className="w-full rounded-2xl border border-border bg-black/20 px-4 py-3 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
            <div className="mt-4 rounded-2xl border border-border bg-black/15 p-4">
              <p className="text-[11px] uppercase tracking-[0.24em] text-muted">Library Name Preview</p>
              <p className="mt-2 text-lg font-semibold text-white">{manualPlaylistTitle}</p>
              <p className="mt-2 text-sm text-muted">If the source exposes a real playlist title, the backend will replace this preview automatically.</p>
            </div>
            <button
              onClick={() => downloadPlaylistFn(playlistUrl, manualPlaylistTitle)}
              disabled={!playlistUrl.trim()}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80 disabled:opacity-40"
            >
              <Download size={13} /> Download All
            </button>
          </div>

          <div className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
              <Library size={14} />
              <span>Sources</span>
            </div>
            <ul className="space-y-3 text-sm text-muted">
              <li>YouTube playlists, albums, videos, channels, and YouTube Music releases.</li>
              <li>SoundCloud, Bandcamp, Mixcloud, and other sources yt-dlp supports.</li>
              <li>Downloads are saved to your music folder and then indexed into the library.</li>
              <li>Use MP3 for compatibility, or FLAC if you want larger lossless files.</li>
            </ul>
          </div>
        </section>
      )}

      {tab === 'library' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
            <Library size={14} />
            <span>Downloaded Playlists</span>
          </div>
            {loadingPlaylists ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : downloadedPlaylists.length === 0 ? (
              <p className="text-sm text-muted">No playlists downloaded yet. Download a playlist to see it here.</p>
            ) : (
              <div className="space-y-3">
                {downloadedPlaylists.map(playlist => (
                  <div key={playlist.id} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-black/15 p-4">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{displayTitle(playlist, 'Playlist')}</p>
                      <p className="mt-1 text-xs text-muted">{playlist.downloaded_count || 0} tracks · {playlist.status}</p>
                      {playlist.url ? <p className="mt-2 truncate text-[11px] text-muted">{playlist.url}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRedownload(playlist.id)}
                        className="rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/25"
                      >
                        Re-download
                      </button>
                      <button
                        onClick={() => handleRemovePlaylist(playlist.id)}
                        className="rounded-xl px-3 py-2 text-xs font-semibold text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </section>
      )}

      {tab === 'artist' && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
            <UserRound size={14} />
            <span>Artist Search</span>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <UserRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={artistQuery}
                onChange={event => setArtistQuery(event.target.value)}
                onKeyDown={event => event.key === 'Enter' && searchArtist(1)}
                placeholder="Search artist channels and playlists..."
                className="w-full rounded-2xl border border-border bg-black/20 py-3 pl-10 pr-4 text-sm text-white outline-none transition-colors focus:border-accent/50 placeholder:text-muted"
              />
            </div>
            <button
              onClick={() => searchArtist(1)}
              disabled={searchingArtist || !artistQuery.trim()}
              className="rounded-2xl bg-accent px-5 py-3 text-sm font-semibold text-base transition-colors hover:bg-accent/80 disabled:opacity-40"
            >
              {searchingArtist ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          {artistError && <p className="mt-3 text-sm text-red-400">{artistError}</p>}

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {artistResults.map(item => (
              <motion.div
                key={`${item.type}-${item.id}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-4"
              >
                <div className="flex items-start gap-3">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-black/20">
                      {item.type === 'channel' ? <UserRound size={20} className="text-muted" /> : <Library size={20} className="text-muted" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] ${item.type === 'channel' ? 'bg-accent/15 text-accent' : 'bg-white/10 text-white'}`}>
                        {item.type}
                      </span>
                      {item.videoCount ? <span className="text-xs text-muted">{item.videoCount} videos</span> : null}
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-white">{item.title}</p>
                    {item.channel && item.channel !== item.title ? <p className="mt-1 truncate text-xs text-muted">{item.channel}</p> : null}
                    <p className="mt-2 truncate text-[11px] text-muted">{item.url}</p>
                  </div>
                </div>
                <button
                  onClick={() => downloadPlaylistFn(item.url, item.title)}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent/15 px-3 py-2 text-xs font-semibold text-accent transition-colors hover:bg-accent/25"
                >
                  <Download size={12} /> Download To Library
                </button>
              </motion.div>
            ))}

            {!artistResults.length && artistQuery && !searchingArtist && !artistError && (
              <p className="py-8 text-center text-sm text-muted md:col-span-2">No usable artist channels or playlists found for that search.</p>
            )}

            {artistHasMore && (
              <div className="flex justify-center pt-2 md:col-span-2">
                <button
                  onClick={loadMoreArtist}
                  disabled={loadingMoreArtist}
                  className="rounded-2xl border border-border bg-black/15 px-4 py-2 text-sm text-muted transition-colors hover:border-accent/50 hover:text-white disabled:opacity-40"
                >
                  {loadingMoreArtist ? <RefreshCw size={14} className="animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {downloads.length > 0 && (
        <section className="rounded-[28px] border border-border bg-card/60 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted">
              <Download size={14} />
              <span>Download Queue</span>
            </div>
            {downloads.some(download => download.status !== 'downloading') && (
              <button onClick={clearDone} className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-white">
                Clear finished
              </button>
            )}
          </div>
          <AnimatePresence>
            <div className="space-y-3">
              {downloads.map(download => (
                <DownloadItem key={download.id} d={download} onRemove={() => removeDownload(download.id)} />
              ))}
            </div>
          </AnimatePresence>
        </section>
      )}
    </div>
  )
}
