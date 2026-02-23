import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Heart, Music, Play, Trash2, Edit2, Check, X } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import PlaylistCover from '../components/PlaylistCover'
import { api } from '../api'

export default function Playlist() {
  const { id } = useParams()
  const nav = useNavigate()
  const [tracks, setTracks] = useState([])
  const [playlist, setPlaylist] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const { playQueue } = usePlayerStore()
  const { user } = useAppStore()
  const isLiked = id === 'liked'

  const load = useCallback(() => {
  
    if (isLiked) {
      api.getLikedTracks(user?.id).then(t => {
        setTracks(Array.isArray(t) ? t : [])
      })
    } else {
      api.getPlaylistTracks(id).then(t => {
        setTracks(Array.isArray(t) ? t : [])
      })
      api.getPlaylists(user?.id).then(pls => {
        const pl = (Array.isArray(pls) ? pls : []).find(p => String(p.id) === String(id))
        if (pl) { setPlaylist(pl); setNameVal(pl.name) }
      })
    }
  }, [id, user?.id, isLiked])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handlePlaylistUpdated = (e) => {
      const updatedPlaylistId = e.detail?.playlistId
      if (updatedPlaylistId && String(updatedPlaylistId) === String(id)) {
        load()
      }
    }
    window.addEventListener('lokal:playlist-updated', handlePlaylistUpdated)
    return () => window.removeEventListener('lokal:playlist-updated', handlePlaylistUpdated)
  }, [id, load])

  const removeTrack = async (track) => {
    await api.removeFromPlaylist(id, track.playlist_track_id)
    setTracks(t => t.filter(tr => tr.playlist_track_id !== track.playlist_track_id))
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const saveName = async () => {
    if (!nameVal.trim() || !playlist) return
    await api.updatePlaylist(id, { name: nameVal.trim() })
    setPlaylist(p => ({ ...p, name: nameVal.trim() }))
    setEditingName(false)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const deletePlaylist = async () => {
    if (!confirm('Delete this playlist?')) return
    await api.deletePlaylist(id)
    window.dispatchEvent(new CustomEvent('lokal:playlist-deleted', { detail: { playlistId: id } }))
    nav('/')
  }

  const handleReorder = async (newTrackIds) => {
    try {
      await api.reorderPlaylist(id, newTrackIds)
      const reorderedTracks = newTrackIds.map(tid => tracks.find(t => t.id === tid)).filter(Boolean)
      setTracks(reorderedTracks)
    } catch (err) {
      console.error('Failed to reorder playlist:', err)
    }
  }

  const totalDuration = tracks.reduce((s, t) => s + (t.duration || 0), 0)
  const fmt = (s) => `${Math.floor(s / 3600) > 0 ? Math.floor(s / 3600) + 'h ' : ''}${Math.floor((s % 3600) / 60)}m`

  return (
    <div className="p-6 pb-10">
      {}
      <div className="flex items-end gap-5 mb-8">
        <div className="w-36 h-36 rounded-2xl overflow-hidden flex-shrink-0 bg-elevated border border-border flex items-center justify-center shadow-xl">
          {isLiked
            ? <Heart size={52} className="text-accent" fill="currentColor" />
            : <PlaylistCover playlistId={id} size={144} className="w-full h-full object-cover" />
          }
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-display text-muted uppercase tracking-widest mb-2">Playlist</p>
          {!isLiked && editingName ? (
            <div className="flex items-center gap-2 mb-2">
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
                className="bg-elevated border border-accent/50 rounded-lg px-3 py-1.5 text-xl text-white font-display outline-none" />
              <button onClick={saveName} className="text-accent hover:text-accent/70 transition-colors"><Check size={18} /></button>
              <button onClick={() => setEditingName(false)} className="text-muted hover:text-white transition-colors"><X size={18} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-3xl font-display text-white truncate">
                {isLiked ? 'Liked Songs' : (playlist?.name || 'Playlist')}
              </h1>
              {!isLiked && <button onClick={() => setEditingName(true)} className="text-muted hover:text-white transition-colors flex-shrink-0"><Edit2 size={14} /></button>}
            </div>
          )}
          <p className="text-sm text-muted">{tracks.length} tracks{totalDuration > 0 ? ` · ${fmt(totalDuration)}` : ''}</p>
        </div>
      </div>

      {}
      {tracks.length > 0 && (
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => playQueue(tracks, 0)}
            className="flex items-center gap-2 px-6 py-2.5 bg-accent text-base rounded-full font-medium text-sm hover:bg-accent/80 transition-colors">
            <Play size={16} fill="currentColor" className="translate-x-px" /> Play All
          </button>
          {!isLiked && (
            <button onClick={deletePlaylist}
              className="flex items-center gap-2 px-4 py-2.5 text-red-400 border border-red-400/30 rounded-full text-sm hover:bg-red-400/10 transition-colors">
              <Trash2 size={14} /> Delete Playlist
            </button>
          )}
        </div>
      )}

      <TrackList
        tracks={tracks}
        showAlbum
        onRemove={!isLiked ? removeTrack : null}
        playlistId={!isLiked ? id : null}
        onReorder={!isLiked ? handleReorder : null}
      />

      {!tracks.length && (
        <div className="text-center py-20 text-muted">
          <Music size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">{isLiked ? 'Like some tracks to see them here.' : 'This playlist is empty. Right-click any track to add it.'}</p>
        </div>
      )}
    </div>
  )
}
