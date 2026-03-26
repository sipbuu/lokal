import React, { useEffect, useMemo, useState } from 'react'
import { Music, Plus, Search } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'

export default function AddTracksToPlaylistModal({ open, onClose, playlistId, existingTrackIds = [], onAdded }) {
  const [tracks, setTracks] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setQuery('')
    api.getTracks({ limit: 5000 }).then(result => {
      setTracks(Array.isArray(result) ? result : [])
      setLoading(false)
    }).catch(() => {
      setTracks([])
      setLoading(false)
    })
  }, [open])

  const existingIds = useMemo(() => new Set(existingTrackIds), [existingTrackIds])

  const filteredTracks = useMemo(() => {
    const available = tracks.filter(track => !existingIds.has(track.id))
    if (!query.trim()) return available.slice(0, 80)
    const lower = query.trim().toLowerCase()
    return available.filter(track =>
      (track.title || '').toLowerCase().includes(lower) ||
      (track.artist || '').toLowerCase().includes(lower) ||
      (track.album || '').toLowerCase().includes(lower)
    ).slice(0, 120)
  }, [tracks, existingIds, query])

  const addTrack = async (trackId) => {
    if (!playlistId) return
    setAddingId(trackId)
    await api.addToPlaylist(playlistId, trackId)
    setAddingId(null)
    onAdded?.()
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Songs" width="max-w-2xl">
      <div className="space-y-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks, artists, or albums"
            className="w-full bg-card border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-accent/50"
          />
        </div>

        <div className="max-h-[28rem] overflow-y-auto space-y-2">
          {loading && (
            <p className="text-sm text-muted text-center py-10">Loading library...</p>
          )}
          {!loading && !filteredTracks.length && (
            <div className="text-center py-10 text-muted">
              <Music size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No matching tracks available to add.</p>
            </div>
          )}
          {!loading && filteredTracks.map(track => (
            <div key={track.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-3 py-2">
              <div className="w-10 h-10 rounded-lg bg-elevated border border-border overflow-hidden flex items-center justify-center flex-shrink-0">
                {track.artwork_path ? (
                  <img src={api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)} className="w-full h-full object-cover" />
                ) : (
                  <Music size={16} className="text-muted" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{track.title}</p>
                <p className="text-xs text-muted truncate">{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
              </div>
              <button
                onClick={() => addTrack(track.id)}
                disabled={addingId === track.id}
                className="flex items-center gap-1.5 rounded-lg bg-accent/15 border border-accent/30 px-3 py-1.5 text-xs text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
              >
                <Plus size={12} />
                {addingId === track.id ? 'Adding...' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
