import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Check, Music, Heart } from 'lucide-react'
import { useAppStore, usePlayerStore } from '../store/player'
import { api } from '../api'

export default function AddToPlaylistModal() {
  const { addToPlaylistTrack, addToPlaylistTrackIds, closeAddToPlaylist, user } = useAppStore()
  const { likedIds, setLiked } = usePlayerStore()
  const [playlists, setPlaylists] = useState([])
  const [added, setAdded] = useState(new Set())
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState(null)
  const track = addToPlaylistTrack
  const trackCount = addToPlaylistTrackIds.length > 1 ? addToPlaylistTrackIds.length : (track ? 1 : 0)

  useEffect(() => {
    if (!track && addToPlaylistTrackIds.length === 0) { setAdded(new Set()); return }
    api.getPlaylists(user?.id).then(p => setPlaylists(Array.isArray(p) ? p : []))
  }, [track?.id, addToPlaylistTrackIds.length, user?.id])

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1800) }

  const addTrack = async (playlist) => {
    if (addToPlaylistTrackIds.length > 1) {
      await api.addMultipleToPlaylist(playlist.id, addToPlaylistTrackIds)
    } else if (track) {
      await api.addToPlaylist(playlist.id, track.id)
    }
    setAdded(s => new Set([...s, playlist.id]))
    showToast(`Added ${addToPlaylistTrackIds.length > 1 ? addToPlaylistTrackIds.length : 1} track(s) to "${playlist.name}"`)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: playlist.id } }))
  }

  const toggleLike = async () => {
    if (addToPlaylistTrackIds.length > 1) {
      for (const tid of addToPlaylistTrackIds) {
        await api.toggleLike(tid, user?.id)
      }
      showToast(`Added ${addToPlaylistTrackIds.length} tracks to Liked Songs`)
    } else if (track) {
      const r = await api.toggleLike(track.id, user?.id)
      const liked = typeof r === 'boolean' ? r : r?.liked ?? false
      setLiked(track.id, liked)
      showToast(liked ? 'Added to Liked Songs' : 'Removed from Liked Songs')
    }
  }

  const createAndAdd = async () => {
    if (!newName.trim()) return
    setCreating(true)
    const pl = await api.createPlaylist(newName.trim(), user?.id)
    if (pl?.id) {
      if (addToPlaylistTrackIds.length > 1) {
        await api.addMultipleToPlaylist(pl.id, addToPlaylistTrackIds)
      } else if (track) {
        await api.addToPlaylist(pl.id, track.id)
      }
      setPlaylists(prev => [...prev, pl])
      setAdded(s => new Set([...s, pl.id]))
      showToast(`Added ${addToPlaylistTrackIds.length > 1 ? addToPlaylistTrackIds.length : 1} track(s) to "${pl.name}"`)
      window.dispatchEvent(new Event('lokal:playlist-created'))
    }
    setNewName(''); setCreating(false)
  }

  return (
    <>
      <AnimatePresence>
        {(track || addToPlaylistTrackIds.length > 0) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={closeAddToPlaylist}>
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="bg-surface border border-border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl"
              onClick={e => e.stopPropagation()}>

              <div className="flex items-center justify-between p-5 border-b border-border">
                <div className="min-w-0">
                  <p className="text-xs font-display text-muted uppercase tracking-widest">Add to Playlist</p>
                  {trackCount > 1 ? (
                    <p className="text-sm text-white mt-0.5 truncate font-medium">{trackCount} tracks selected</p>
                  ) : (
                    <>
                      <p className="text-sm text-white mt-0.5 truncate font-medium">{track?.title}</p>
                      <p className="text-xs text-muted truncate">{track?.artist}</p>
                    </>
                  )}
                </div>
                <button onClick={closeAddToPlaylist} className="text-muted hover:text-white transition-colors ml-3 flex-shrink-0">
                  <X size={16} />
                </button>
              </div>

              <button onClick={toggleLike}
                className="w-full flex items-center gap-3 px-5 py-3 border-b border-border hover:bg-elevated transition-colors">
                <div className="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0">
                  <Heart size={15} className={track && likedIds.has(track?.id) ? 'text-accent' : 'text-muted'} fill={track && likedIds.has(track?.id) ? 'currentColor' : 'none'} />
                </div>
                <span className="text-sm text-white">Liked Songs</span>
                {track && likedIds.has(track?.id) && <Check size={14} className="text-accent ml-auto" />}
              </button>

              <div className="px-4 py-3 border-b border-border">
                <div className="flex gap-2">
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && createAndAdd()}
                    placeholder="New playlist name…"
                    className="flex-1 bg-card border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-accent/60 placeholder:text-muted/60" />
                  <motion.button onClick={createAndAdd} disabled={!newName.trim() || creating}
                    whileTap={{ scale: 0.9 }}
                    className="px-3 py-2 bg-accent text-base rounded-xl text-sm font-medium disabled:opacity-40 transition-colors hover:bg-accent/80">
                    <Plus size={16} />
                  </motion.button>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto p-2">
                {!playlists.length && (
                  <p className="text-center text-muted text-xs py-5">No playlists yet. Create one above.</p>
                )}
                {playlists.map(pl => {
                  const done = added.has(pl.id)
                  return (
                    <motion.button key={pl.id} onClick={() => !done && addTrack(pl)} whileTap={{ scale: 0.97 }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${done ? 'opacity-50' : 'hover:bg-elevated'}`}>
                      <div className="w-9 h-9 rounded-lg bg-card flex items-center justify-center flex-shrink-0 border border-border">
                        <Music size={14} className="text-muted" />
                      </div>
                      <span className="text-sm text-white flex-1 text-left truncate">{pl.name}</span>
                      <AnimatePresence>
                        {done && (
                          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                            <Check size={14} className="text-accent flex-shrink-0" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  )
                })}
              </div>

              <div className="p-3 pt-1">
                <button onClick={closeAddToPlaylist} className="w-full py-2 text-sm text-muted hover:text-white transition-colors">Done</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-card border border-border text-white text-xs px-4 py-2 rounded-full shadow-xl z-[200] whitespace-nowrap">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
