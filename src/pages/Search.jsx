import React, { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Search as SearchIcon, Music, Disc3, Shuffle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../store/player'
import TrackList from '../components/TrackList'
import AlbumsModal from '../components/AlbumsModal'
import { api } from '../api'

export default function Search() {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [albums, setAlbums] = useState([])
  const [searching, setSearching] = useState(false)
  const [albumDetail, setAlbumDetail] = useState(null)
  const [randomLoading, setRandomLoading] = useState(false)
  const nav = useNavigate()
  const { playQueue } = usePlayerStore()

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
    const t = setTimeout(() => doSearch(query), 220)
    return () => clearTimeout(t)
  }, [query])

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

  return (
    <div className="p-6 space-y-6 pb-10">
      <div className="relative">
        <SearchIcon size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tracks, artists, albums…"
          className="w-full bg-elevated border border-border rounded-2xl pl-10 pr-5 py-3 text-sm text-white outline-none focus:border-accent/50 placeholder:text-muted"
        />
        {searching && <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />}
      </div>

      {!query && (
        <div className="space-y-6">
          <p className="text-muted text-sm text-center py-4">Start typing to search your library…</p>
          
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

      {artists.length > 0 && (
        <section>
          <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Artists</h2>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-3">
            {artists.map((a, i) => (
              <motion.button key={a.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }}
                onClick={() => nav(`/artist/${a.id}`)} className="flex flex-col items-center gap-2 group">
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
                onClick={() => setAlbumDetail(a)}
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

      {albumDetail && (
        <AlbumsModal open={true} onClose={() => setAlbumDetail(null)} />
      )}
    </div>
  )
}
