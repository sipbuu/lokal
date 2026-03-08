import React, { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search as SearchIcon, Music, Disc3, Shuffle, Clock, User, X, Play } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import AlbumsModal from '../components/AlbumsModal'
import { api } from '../api'

const RECENT_SEARCHES_KEY = 'lokal-recent-searches'
const RECENT_ITEMS_KEY = 'lokal-recent-items'
const MAX_RECENT = 5

function getRecentSearches() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
  } catch {
    return []
  }
}

function saveRecentSearch(query) {
  if (!query.trim()) return
  const recent = getRecentSearches()
  const filtered = recent.filter(r => r.query.toLowerCase() !== query.toLowerCase())
  const newRecent = [{ query, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(newRecent))
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY)
}

function getRecentItems() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_ITEMS_KEY) || '[]')
  } catch {
    return []
  }
}

function saveRecentItem(item) {
  if (!item?.id) return
  const recent = getRecentItems()
  const filtered = recent.filter(r => r.id !== item.id)
  const newRecent = [item, ...filtered].slice(0, MAX_RECENT)
  localStorage.setItem(RECENT_ITEMS_KEY, JSON.stringify(newRecent))
}

export default function Search() {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [albums, setAlbums] = useState([])
  const [searching, setSearching] = useState(false)
  const [randomLoading, setRandomLoading] = useState(false)
  const [recentSearches, setRecentSearches] = useState([])
  const [recentItems, setRecentItems] = useState([])
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [isSearchStarted, setIsSearchStarted] = useState(false)
  const searchInputRef = useRef(null)
  const nav = useNavigate()
  const { playQueue, queue, playTrack } = usePlayerStore()
  const { openAlbums } = useAppStore()

  useEffect(() => {
    setRecentSearches(getRecentSearches())
    setRecentItems(getRecentItems())
  }, [])

   useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target)) {
        setShowSearchDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setTracks([]); setArtists([]); setAlbums([]); return }
    setSearching(true)
    const [res, albumRes] = await Promise.all([
      api.searchTracks(q),
      api.searchAlbums(q),
    ])
    if (res?.artists) { setArtists(res.artists || []); setTracks(res.tracks || []) }
    else { setArtists([]); setTracks(Array.isArray(res) ? res : []) }
    setAlbums(Array.isArray(albumRes) ? albumRes : [])
    setSearching(false)
  }, [])

  useEffect(() => {
    if (isSearchStarted && query) {
      const t = setTimeout(() => doSearch(query), 300)
      return () => clearTimeout(t)
    }
  }, [query, isSearchStarted])

  const artSrc = (a) => a.image_path ? (api.isElectron ? `file://${a.image_path}` : null) : null
  const albumArt = (a) => a.artwork_path ? (api.isElectron ? `file://${a.artwork_path}` : api.artworkURL(a.id)) : null

  const playRandom = async () => {
    setRandomLoading(true)
    const track = await api.getRandomTrack()
    if (track) {
      playQueue([track], 0)
    }
    setRandomLoading(false)
  }

  const handleArtistClick = (artist) => {
    saveRecentSearch(artist.name)
    saveRecentItem({ 
      id: artist.id, 
      name: artist.name, 
      image_path: artist.image_path,
      type: 'artist'
    })
    nav(`/artist/${artist.id}`)
  }

  const handleAlbumClick = (album) => {
    saveRecentSearch(album.title)
    saveRecentItem({
      id: album.title,
      title: album.title,
      artwork_path: album.artwork_path,
      track_count: album.track_count,
      year: album.year,
      type: 'album'
    })
    openAlbums(album)
  }

  const handleRecentSearchClick = (recent) => {
    setQuery(recent.query)
    setShowSearchDropdown(false)
  }

  const handleRecentItemClick = (item) => {
    if (item.type === 'artist') {
      nav(`/artist/${item.id}`)
    } else if (item.type === 'track') {
      const trackIndex = queue.findIndex(t => t.id === item.id)
      if (trackIndex >= 0) {
        playQueue(queue, trackIndex)
      }
    } else if (item.type === 'album') {
      openAlbums(item)
    }
  }

  const handleInputFocus = () => {
    if (recentSearches.length > 0) {
      setShowSearchDropdown(true)
    }
  }

  const handleInputChange = (e) => {
    const value = e.target.value
    setQuery(value)
    setIsSearchStarted(true)
    
    if (value === '' && recentSearches.length > 0) {
      setShowSearchDropdown(true)
    } else if (value === '') {
      setIsSearchStarted(false)
      setTracks([])
      setArtists([])
      setAlbums([])
    } else {
      setShowSearchDropdown(false)
    }
  }

  const showSearchResults = isSearchStarted && query && (tracks.length > 0 || artists.length > 0 || albums.length > 0 || searching)

  return (
    <div className="p-6 space-y-6 pb-10">
      <div className="relative" ref={searchInputRef}>
        <SearchIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder="Search tracks, artists, albums…"
          onKeyDown={(e) => { if (e.key === 'Enter' && query.trim()) saveRecentSearch(query.trim()) }}
          className="w-full bg-elevated border border-border rounded-2xl pl-10 pr-5 py-3 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted"
        />
        {searching && <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
        
        <AnimatePresence>
          {showSearchDropdown && recentSearches.length > 0 && !query && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 right-0 mt-2 bg-elevated border border-border rounded-xl shadow-xl z-50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                <span className="text-xs text-muted flex items-center gap-2">
                  <Clock size={10} /> Recent Searches
                </span>
                <button 
                  onClick={() => { clearRecentSearches(); setRecentSearches([]); setShowSearchDropdown(false) }}
                  className="text-xs text-muted hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="py-1">
                {recentSearches.map((recent, i) => (
                  <button
                    key={`${recent.query}-${i}`}
                    onClick={() => handleRecentSearchClick(recent)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-card transition-colors"
                  >
                    <Clock size={12} className="text-muted" />
                    <span className="text-sm text-white">{recent.query}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!showSearchResults && (
        <div className="space-y-6">
          {recentItems.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3 flex items-center gap-2">
                <Clock size={12} /> Recent
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {recentItems.map((item, i) => (
                  <motion.button
                    key={`${item.id}-${i}`}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => handleRecentItemClick(item)}
                    className="flex flex-col items-center gap-2 group min-w-0"
                  >
                    <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center text-muted group-hover:border-accent/40 transition-colors relative">
                      {item.type === 'artist' ? (
                        artSrc(item) ? (
                          <img src={artSrc(item)} className="w-full h-full object-cover" />
                        ) : (
                          <User size={20} />
                        )
                      ) : item.type === 'album' ? (
                        item.artwork_path ? (
                          <img src={api.isElectron ? `file://${item.artwork_path}` : api.artworkURL(item.id)} className="w-full h-full object-cover" />
                        ) : (
                          <Disc3 size={20} />
                        )
                      ) : (
                        item.artwork_path ? (
                          <img src={api.isElectron ? `file://${item.artwork_path}` : api.artworkURL(item.id)} className="w-full h-full object-cover" />
                        ) : (
                          <Music size={20} />
                        )
                      )}
                      {item.type === 'track' && (
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Play size={16} fill="currentColor" className="text-white" />
                        </div>
                      )}
                    </div>
                    <div className="text-center w-full min-w-0">
                      <p className="text-xs text-white truncate w-full max-w-full">{item.name || item.title}</p>
                      {item.type === 'track' && item.artist && (
                        <p className="text-[10px] text-muted truncate w-full max-w-full">{item.artist}</p>
                      )}
                      {item.type === 'artist' && (
                        <p className="text-[10px] text-muted">Artist</p>
                      )}
                      {item.type === 'album' && (
                        <p className="text-[10px] text-muted">Album</p>
                      )}
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}
          
          {recentItems.length === 0 && (
            <p className="text-muted text-sm text-center py-4">Start typing to search your library…</p>
          )}
          
          <div className="flex justify-center">
            <button 
              onClick={playRandom} 
              disabled={randomLoading}
              className="flex items-center gap-2 px-6 py-3 bg-accent/20 border border-accent/40 text-accent rounded-full text-sm font-medium hover:bg-accent/30 transition-colors disabled:opacity-50"
            >
              <Shuffle size={16} />
              {randomLoading ? 'Finding...' : 'Play Random Song'}
            </button>
          </div>
        </div>
      )}

      {showSearchResults && (
        <>
          {artists.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Artists</h2>
              <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3">
                {artists.map((a, i) => (
                  <motion.button key={a.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                    onClick={() => handleArtistClick(a)} className="flex flex-col items-center gap-2 group">
                    <div className="w-full aspect-square rounded-full bg-elevated border border-border overflow-hidden flex items-center justify-center text-muted group-hover:border-accent/40 transition-colors">
                      {artSrc(a) ? <img src={artSrc(a)} className="w-full h-full object-cover" /> : <Music size={20} />}
                    </div>
                    <p className="text-xs text-center text-muted group-hover:text-white truncate w-full">{a.name}</p>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {albums.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Albums</h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                {albums.map((a, i) => (
                  <motion.button key={`${a.title}-${i}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.03 }}
                    onClick={() => handleAlbumClick(a)}
                    whileHover={{ scale: 1.04 }} className="flex flex-col gap-2 text-left group">
                    <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center">
                      {albumArt(a) ? <img src={albumArt(a)} className="w-full h-full object-cover" /> : <Disc3 size={28} className="text-muted" />}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-white truncate">{a.title}</p>
                      <p className="text-xs text-muted">{a.track_count} tracks</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {tracks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Tracks</h2>
                <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">Play All</button>
              </div>
              <TrackList tracks={tracks} showAlbum />
            </section>
          )}

          {query && !searching && !tracks.length && !artists.length && !albums.length && (
            <div className="text-center py-16 text-muted">
              <Music size={36} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm">No results for "{query}"</p>
            </div>
          )}
        </>
      )}

      <AlbumsModal />
    </div>
  )
}
