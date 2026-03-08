import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { LayoutGrid, List, Music, Disc3 } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import AlbumsModal from '../components/AlbumsModal'
import { api } from '../api'

export default function Library() {
  const [tracks, setTracks] = useState([])
  const [sort, setSort] = useState('added_at DESC')
  const [view, setView] = useState('list')
  const { openAlbums } = useAppStore()
  const { playQueue } = usePlayerStore()

  const load = () => {
    api.getTracks({ sort, limit: 500 }).then(t => setTracks(Array.isArray(t) ? t : []))
  }

  useEffect(() => {
    load()
    window.addEventListener('lokal:refresh', load)
    return () => window.removeEventListener('lokal:refresh', load)
  }, [sort])

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
            <p className="text-xs text-muted font-display">{tracks.length} tracks</p>
            <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">Play All</button>
          </div>
          <TrackList tracks={tracks} showAlbum />
        </>
      )}

      {tracks.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {tracks.map((t, i) => {
            const src = artSrc(t)
            return (
              <motion.button
                key={t.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i * 0.012, 0.3) }}
                whileHover={{ scale: 1.04 }}
                onDoubleClick={() => playQueue(tracks, i)}
                className="flex flex-col gap-2 text-left group"
              >
                <div className="w-full aspect-square rounded-xl bg-elevated border border-border overflow-hidden flex items-center justify-center">
                  {src ? <img src={src} className="w-full h-full object-cover" /> : <Music size={28} className="text-muted" />}
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
