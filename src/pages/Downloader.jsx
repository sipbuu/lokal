import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Download, X, CheckCircle, AlertCircle, ListMusic, Music, AlertTriangle, RefreshCw, Youtube } from 'lucide-react'
import { api } from '../api'

const DISCLAIMER_KEY = 'lokal-dl-accepted'
function fmt(s) { if (!s) return ''; return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` }

function DownloadItem({ d, onRemove }) {
  const [showDetails, setShowDetails] = useState(false)
  
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
      className="flex items-center gap-3 p-3 bg-card border border-border rounded-xl">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{d.title}</p>
        {d.song && <p className="text-xs text-accent mt-0.5 truncate">{d.song}</p>}
        {d.message && <p className="text-xs text-muted mt-0.5 truncate">{d.message}</p>}
        
        {d.downloadedTracks && d.downloadedTracks.filter(track => !track.toLowerCase().endsWith('.webm')).length > 0 && (
          <div className="mt-2">
            <button 
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-accent hover:text-accent/70 flex items-center gap-1"
            >
              <ListMusic size={12} />
              {showDetails ? 'Hide' : 'Show'} downloaded tracks ({d.downloadedTracks.filter(track => !track.toLowerCase().endsWith('.webm')).length})
            </button>
            {showDetails && (
              <div className="mt-1.5 max-h-64 overflow-y-auto bg-elevated rounded-lg p-2 space-y-0.5">
                {d.downloadedTracks
                  .filter(track => !track.toLowerCase().endsWith('.webm'))
                  .map((track, i) => (
                    <p key={i} className="text-xs text-muted truncate">
                      <span className="text-accent/60 mr-1">{i + 1}.</span>{track}
                    </p>
                  ))}
              </div>
            )}
          </div>
        )}

        {d.indexedTracks && d.indexedTracks.length > 0 && (
          <div className="mt-2">
            <button 
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-green-400 hover:text-green-300 flex items-center gap-1"
            >
              <CheckCircle size={12} />
              {showDetails ? 'Hide' : 'Show'} indexed tracks ({d.indexedTracks.length})
            </button>
            {showDetails && (
              <div className="mt-1.5 max-h-64 overflow-y-auto bg-elevated rounded-lg p-2 space-y-0.5">
                {d.indexedTracks.map((track, i) => (
                  <p key={i} className="text-xs text-green-500/80 truncate">
                    <span className="text-green-400 mr-1">{i + 1}.</span>{track.title || track.filepath?.split(/[/\\]/).pop()}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        
        {d.status === 'downloading' && (
          <div className="mt-1.5 w-full">
            <div className="h-1 bg-border rounded-full overflow-hidden">
              <motion.div className="h-full bg-accent rounded-full"
                animate={{ width: d.progress > 0 ? `${d.progress}%` : ['0%','30%','60%','30%','0%'] }}
                transition={d.progress > 0 ? { duration: 0.3 } : { duration: 2, repeat: Infinity }} />
            </div>
            {d.progress > 0 && (
              <p className="text-xs text-muted mt-0.5">
                {d.message?.includes('Skipping') 
                  ? <span className="text-accent/80 font-medium">{d.message}</span> 
                  : `${Math.round(d.progress)}% · ${d.speed || ''}`}
              </p>
            )}
          </div>
        )}
        {d.error && <p className="text-xs text-red-400 mt-0.5 truncate">{d.error}</p>}
        {d.output && (
          <details className="mt-1">
            <summary className="text-xs text-muted cursor-pointer">Show log</summary>
            <pre className="text-xs text-muted whitespace-pre-wrap max-h-40 overflow-y-auto">{d.output}</pre>
          </details>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {d.status === 'done' && <CheckCircle size={15} className="text-accent" />}
        {d.status === 'error' && <AlertCircle size={15} className="text-red-400" />}
        {d.status === 'downloading' && <span className="text-xs text-muted font-display">{Math.round(d.progress || 0)}%</span>}
        <button onClick={onRemove} className="text-subtle hover:text-white transition-colors"><X size={13} /></button>
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
  const [currentPage, setCurrentPage] = useState(1)
  const [continuationToken, setContinuationToken] = useState(null)
  const [artistQuery, setArtistQuery] = useState('')
  const [artistResults, setArtistResults] = useState([])
  const [searchingArtist, setSearchingArtist] = useState(false)
  const [artistPage, setArtistPage] = useState(1)
  const [artistHasMore, setArtistHasMore] = useState(false)
  const [loadingMoreArtist, setLoadingMoreArtist] = useState(false)
  const [artistCurrentPage, setArtistCurrentPage] = useState(1)
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [format, setFormat] = useState('mp3')
  const [quality, setQuality] = useState('320')
  const [downloads, setDownloads] = useState(() => {
    try {
      const saved = localStorage.getItem('lokal-downloads')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    const unsub = api.onDownloadProgress((_, data) => {
      setDownloads(prev => prev.map(d => {
        if (d.id !== data.id) return d
        return {
          ...d,
          progress: data.progress ?? d.progress,
          speed: data.speed || d.speed,
          message: data.message || d.message,
          song: data.song || d.song,
          output: data.output || d.output,
          downloadedTracks: data.downloadedTracks || d.downloadedTracks,
          indexedTracks: data.indexedTracks || d.indexedTracks,
          status: data.done ? 'done' : data.error ? 'error' : 'downloading',
          error: data.error || d.error,
        }
      }))
    })
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  useEffect(() => {
    const fetchQueue = async () => {
      try {
        const queue = await api.getDownloadQueue()
        setDownloads(prev => {
          const updated = prev.map(d => {
            const q = queue.find(qq => qq.id === d.id)
            if (q) {
              return {
                ...d,
                progress: q.progress ?? d.progress,
                status: q.status || d.status,
                message: q.message || d.message,
                song: q.song || d.song,
                output: q.output || d.output,
              }
            }
            return d
          })
          const existingIds = new Set(prev.map(d => d.id))
          const newDownloads = queue.filter(q => !existingIds.has(q.id)).map(q => ({
            id: q.id,
            title: q.url,
            progress: q.progress,
            status: q.status,
            url: q.url,
            message: q.message,
            song: q.song,
            output: q.output,
          }))
          return [...updated, ...newDownloads]
        })
      } catch (e) {
      }
    }
    fetchQueue()
    const interval = setInterval(fetchQueue, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    try {
      const toSave = downloads.map(d => ({ ...d, output: d.output ? d.output.slice(-1000) : undefined }))
      localStorage.setItem('lokal-downloads', JSON.stringify(toSave))
    } catch (e) {
      console.warn('Failed to save downloads to localStorage', e)
    }
  }, [downloads])

  const rescan = async () => {
    const s = await api.getSettings()
    if (s?.music_folder) api.scanFolder(s.music_folder)
  }

  const search = async (page = 1) => {
    if (!query.trim()) return
    if (page === 1) {
      setResults([])
    }
    setSearching(true)
    setSearchPage(page)
    setCurrentPage(page)
    const r = await api.searchYTPaginated(query, page)
    if (r && r.results) {
      setResults(page === 1 ? r.results : prev => [...(prev || []), ...r.results])
      setHasMore(r.hasMore || false)
    } else if (Array.isArray(r)) {
      setResults(page === 1 ? r : prev => [...(prev || []), ...r])
      setHasMore(false)
    } else {
      setResults([])
      setHasMore(false)
    }
    setSearching(false)
  }

  const loadMore = async () => {
    if (!query.trim() || loadingMore || !hasMore) return
    setLoadingMore(true)
    const nextPage = searchPage + 1
    const r = await api.searchYTPaginated(query, nextPage)
    if (r && r.results && r.results.length > 0) {
      const lastResultId = results[results.length - 1]?.id
      const hasNewResults = r.results.some(result => result.id !== lastResultId)
      
      if (hasNewResults) {
        setResults(prev => [...(prev || []), ...r.results])
        setSearchPage(nextPage)
        setCurrentPage(nextPage)
        setHasMore(r.hasMore || false)
      } else {
        setHasMore(false)
      }
    } else {
      setHasMore(false)
    }
    setLoadingMore(false)
  }

  const searchArtist = async (page = 1) => {
    if (!artistQuery.trim()) return
    if (page === 1) {
      setArtistResults([])
    }
    setSearchingArtist(true)
    setArtistPage(page)
    setArtistCurrentPage(page)
    const r = await api.searchYTArtist(artistQuery, page)
    if (r && r.results) {
      setArtistResults(page === 1 ? r.results : prev => [...(prev || []), ...r.results])
      setArtistHasMore(r.hasMore || false)
    } else if (Array.isArray(r)) {
      setArtistResults(page === 1 ? r : prev => [...(prev || []), ...r])
      setArtistHasMore(false)
    } else {
      setArtistResults([])
      setArtistHasMore(false)
    }
    setSearchingArtist(false)
  }

  const loadMoreArtist = async () => {
    if (!artistQuery.trim() || loadingMoreArtist || !artistHasMore) return
    setLoadingMoreArtist(true)
    const nextPage = artistPage + 1
    const r = await api.searchYTArtist(artistQuery, nextPage)
    if (r && r.results) {
      setArtistResults(prev => [...(prev || []), ...r.results])
      setArtistPage(nextPage)
      setArtistCurrentPage(nextPage)
      setArtistHasMore(r.hasMore || false)
    } else if (Array.isArray(r)) {
      setArtistResults(prev => [...(prev || []), ...r])
      setArtistHasMore(false)
    }
    setLoadingMoreArtist(false)
  }

  const downloadSingle = async (item) => {
    const id = 'dl-' + Date.now()
    setDownloads(prev => [...prev, { id, title: item.title, progress: 0, status: 'downloading', url: item.url }])
    const r = await api.downloadYT(item.url, { format, quality, id })
    if (r?.error) setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'error', error: r.error } : d))
    else { setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'done', progress: 100 } : d)) }
  }

  const downloadPlaylistFn = async (url) => {
    if (!url?.trim()) return
    const id = 'pl-' + Date.now()
    setDownloads(prev => [...prev, { id, title: 'Playlist / Album', progress: 0, status: 'downloading', url, message: 'Starting…' }])
    const r = await api.downloadPlaylist(url, { format, quality, id })
    if (r?.error) setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'error', error: r.error } : d))
    else { setDownloads(prev => prev.map(d => d.id === id ? { ...d, status: 'done', progress: 100, message: `${r.count || ''} tracks downloaded` } : d)) }
  }

  const removeDownload = async (id) => {
    await api.cancelDownload(id)
    setDownloads(prev => prev.filter(d => d.id !== id))
  }
  const clearDone = () => setDownloads(prev => prev.filter(d => d.status === 'downloading'))

  const loadDownloadedPlaylists = () => {
    setLoadingPlaylists(true)
    api.getDownloadedPlaylists()
      .then(r => { setDownloadedPlaylists(r || []); setLoadingPlaylists(false) })
      .catch(() => setLoadingPlaylists(false))
  }

  const handleRedownload = (playlistId) => {
    api.redownloadPlaylist(playlistId).then(() => loadDownloadedPlaylists())
  }

  const handleRemovePlaylist = (playlistId) => {
    if (confirm('Delete this playlist from library?')) {
      api.deleteDownloadedPlaylist(playlistId).then(() => loadDownloadedPlaylists())
    }
  }

  if (showDisclaimer) return (
    <div className="p-8 max-w-md">
      <h1 className="font-display text-lg uppercase tracking-widest text-white mb-5">Downloader</h1>
      <div className="bg-elevated border border-yellow-500/30 rounded-xl p-5 space-y-4">
        <div className="flex gap-3">
          <AlertTriangle size={18} className="text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-yellow-400 font-medium text-sm mb-2">Legal Notice</p>
            <p className="text-sm text-muted leading-relaxed">This tool downloads audio from YouTube via yt-dlp. Only download content you own or that is licensed for free download. Downloading copyrighted content without permission may violate laws in your jurisdiction.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { localStorage.setItem(DISCLAIMER_KEY,'1'); setShowDisclaimer(false) }}
            className="flex-1 px-4 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent/80 transition-colors">
            I Understand
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-3xl space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-lg uppercase tracking-widest text-white">Downloader</h1>
        <div className="flex gap-1 p-0.5 bg-elevated border border-border rounded-xl">
          {[['search','Search'],['artist','Artist'],['playlist','Playlist / Album'],['library','Library']].map(([id, label]) => (
            <button key={id} onClick={() => { setTab(id); if (id === 'library') loadDownloadedPlaylists() }}
              className={`px-3 py-1.5 text-xs font-display uppercase tracking-wider rounded-lg transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 p-3 bg-elevated border border-border rounded-xl">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted font-display uppercase tracking-widest">Format</span>
          {['mp3','flac','m4a','opus'].map(f => (
            <button key={f} onClick={() => setFormat(f)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${format === f ? 'bg-accent text-base' : 'text-muted border border-border hover:text-white'}`}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        {format === 'mp3' && (
          <div className="flex items-center gap-2 ml-4">
            <span className="text-xs text-muted font-display uppercase tracking-widest">Quality</span>
            {['128','192','320'].map(q => (
              <button key={q} onClick={() => setQuality(q)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${quality === q ? 'bg-accent/20 text-accent border border-accent/30' : 'text-muted border border-border hover:text-white'}`}>
                {q}k
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'search' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Search YouTube…"
                className="w-full bg-elevated border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted" />
            </div>
            <button onClick={search} disabled={searching || !query}
              className="px-4 py-2 bg-accent text-base rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-accent/80 transition-colors">
              {searching ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          <div className="space-y-2">
            {results.map(r => {
              const isDownloading = downloads.some(d => d.url === r.url && d.status === 'downloading')
              const isDone = downloads.some(d => d.url === r.url && d.status === 'done')
              return (
                <motion.div key={r.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-3 p-3 bg-elevated border border-border rounded-xl">
                  {r.thumbnail && <img src={r.thumbnail} className="w-14 h-10 rounded-lg object-cover flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.title}</p>
                    <p className="text-xs text-muted">{r.channel}{r.duration ? ` · ${fmt(r.duration)}` : ''}</p>
                  </div>
                  <button onClick={() => !isDownloading && !isDone && downloadSingle(r)} disabled={isDownloading || isDone}
                    className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${isDone ? 'text-accent cursor-default' : isDownloading ? 'text-muted cursor-default' : 'bg-accent/15 text-accent hover:bg-accent/25'}`}>
                    {isDone ? <CheckCircle size={13} /> : isDownloading ? <RefreshCw size={13} className="animate-spin" /> : <><Download size={12} />Download</>}
                  </button>
                </motion.div>
              )
            })}
            {!results.length && !searching && query && (
              <p className="text-center text-muted text-sm py-8">No results. Try a different search.</p>
            )}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-4 py-2 bg-elevated border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/50 transition-colors disabled:opacity-40"
                >
                  {loadingMore ? <RefreshCw size={14} className="animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'playlist' && (
        <div className="space-y-4">
          <div className="p-4 bg-elevated border border-border rounded-xl space-y-4">
            <div>
              <label className="text-xs font-display text-muted uppercase tracking-widest block mb-2">YouTube Playlist / Album URL</label>
              <input value={playlistUrl} onChange={e => setPlaylistUrl(e.target.value)}
                placeholder="https://www.youtube.com/playlist?list=..."
                className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted" />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">Downloads entire playlist to your music folder.</p>
              <button onClick={() => downloadPlaylistFn(playlistUrl)} disabled={!playlistUrl.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent text-base rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-accent/80 transition-colors flex-shrink-0">
                <Download size={13} /> Download All
              </button>
            </div>
          </div>

          <div className="p-4 bg-elevated/50 border border-border/50 rounded-xl">
            <p className="text-xs text-muted/70 font-display uppercase tracking-widest mb-2">Tips</p>
            <ul className="text-xs text-muted space-y-1">
              <li>• Supports YouTube playlists and individual album pages</li>
              <li>• Also works with Soundcloud, Bandcamp, and other yt-dlp sources</li>
              <li>• Files are saved to your configured music folder</li>
              <li>• FLAC is lossless but much larger (yt-dlp re-encodes from best source)</li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'library' && (
        <div className="space-y-4">
          <div className="p-4 bg-elevated border border-border rounded-xl">
            <h3 className="text-sm font-medium text-white mb-3">Downloaded Playlists</h3>
            {loadingPlaylists ? (
              <p className="text-sm text-muted">Loading...</p>
            ) : downloadedPlaylists.length === 0 ? (
              <p className="text-sm text-muted">No playlists downloaded yet. Download a playlist to see it here.</p>
            ) : (
              <div className="space-y-2">
                {downloadedPlaylists.map(pl => (
                  <div key={pl.id} className="flex items-center justify-between p-3 bg-card border border-border rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{pl.title || 'Untitled Playlist'}</p>
                      <p className="text-xs text-muted">{pl.downloaded_count || 0} tracks · {pl.status}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRedownload(pl.id)}
                        className="px-3 py-1.5 text-xs bg-accent/15 text-accent hover:bg-accent/25 rounded-lg"
                      >
                        Re-download
                      </button>
                      <button
                        onClick={() => handleRemovePlaylist(pl.id)}
                        className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-4 bg-elevated/50 border border-border/50 rounded-xl">
            <p className="text-xs text-muted/70 font-display uppercase tracking-widest mb-2">How it works</p>
            <ul className="text-xs text-muted space-y-1">
              <li>• Each playlist gets its own archive file</li>
              <li>• Re-download clears the archive and re-fetches all tracks</li>
              <li>• Remove deletes the playlist from library (not files)</li>
              <li>• If you deleted files, use Re-download to get them back</li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'artist' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={artistQuery}
              onChange={e => setArtistQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchArtist()}
              placeholder="Search for artist..."
              className="flex-1 bg-elevated border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted"
            />
            <button
              onClick={searchArtist}
              disabled={searchingArtist || !artistQuery.trim()}
              className="px-4 py-2 bg-accent text-base rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-accent/80 transition-colors"
            >
              {searchingArtist ? <RefreshCw size={14} className="animate-spin" /> : 'Search'}
            </button>
          </div>

          <div className="space-y-2">
            {artistResults.map(item => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-3 p-3 bg-elevated border border-border rounded-xl"
              >
                {item.thumbnail && (
                  <img src={item.thumbnail} className="w-14 h-10 rounded-lg object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.title}</p>
                  <p className="text-xs text-muted">
                    {item.type === 'channel' ? 'Channel' : 'Playlist'}
                    {item.videoCount ? ` · ${item.videoCount} videos` : ''}
                  </p>
                </div>
                <button
                  onClick={() => downloadPlaylistFn(item.url)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors"
                >
                  <Download size={12} /> Download
                </button>
              </motion.div>
            ))}
            {!artistResults.length && artistQuery && !searchingArtist && (
              <p className="text-center text-muted text-sm py-8">No channels or playlists found.</p>
            )}
            {artistHasMore && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={loadMoreArtist}
                  disabled={loadingMoreArtist}
                  className="px-4 py-2 bg-elevated border border-border rounded-xl text-sm text-muted hover:text-white hover:border-accent/50 transition-colors disabled:opacity-40"
                >
                  {loadingMoreArtist ? <RefreshCw size={14} className="animate-spin" /> : 'Load More'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {downloads.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-display text-muted uppercase tracking-widest">Downloads</h2>
            {downloads.some(d => d.status !== 'downloading') && (
              <button onClick={clearDone} className="text-xs text-muted hover:text-white transition-colors">Clear finished</button>
            )}
          </div>
          <AnimatePresence>
            {downloads.map(d => <DownloadItem key={d.id} d={d} onRemove={() => removeDownload(d.id)} />)}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
