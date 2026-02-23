import React, { useState } from 'react'
import Modal from './Modal'
import { useAppStore } from '../store/player'
import { api } from '../api'

export default function CreatePlaylistModal({ onCreated }) {
  const { showCreatePlaylistModal, closeCreatePlaylist, user } = useAppStore()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    const pl = await api.createPlaylist(name.trim(), user?.id)
    setLoading(false)
    setName('')
    closeCreatePlaylist()
    onCreated?.(pl)
    window.dispatchEvent(new Event('lokal:playlist-created'))
  }

  return (
    <Modal open={showCreatePlaylistModal} onClose={closeCreatePlaylist} title="New Playlist" width="max-w-xs">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Playlist"
            className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder-subtle outline-none focus:border-accent/60 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={closeCreatePlaylist} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() || loading} className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40">
            Create
          </button>
        </div>
      </form>
    </Modal>
  )
}
