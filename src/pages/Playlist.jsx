import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Heart, Music, Play, Shuffle, Trash2, Edit2, Check, X, RefreshCw, Plus, Image as ImageIcon } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import PlaylistCover from '../components/PlaylistCover'
import AddTracksToPlaylistModal from '../components/AddTracksToPlaylistModal'
import { api } from '../api'

export default function Playlist() {
  const { id } = useParams()
  const nav = useNavigate()
  const [tracks, setTracks] = useState([])
  const [playlist, setPlaylist] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [recommendations, setRecommendations] = useState([])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [showAddSongs, setShowAddSongs] = useState(false)
  const { playQueue } = usePlayerStore()
  const { user } = useAppStore()
  const isLiked = id === 'liked'
  const playableTracks = tracks.filter(track => !String(track.file_path || '').startsWith('ghost://'))

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
    const handleChange = (e) => {
      const playlistId = e?.detail?.playlistId;
      if (playlistId) {
        if (String(playlistId) === String(id)) {
          load();
        }
      } else {
        load();
      }
    };

    const handleDeleted = (e) => {
      const playlistId = e?.detail?.playlistId;
      if (playlistId && String(playlistId) === String(id)) {
        nav('/');
      } else {
        load();
      }
    };

    window.addEventListener('lokal:playlist-updated', handleChange);
    window.addEventListener('lokal:playlist-created', handleChange);
    window.addEventListener('lokal:playlists-changed', handleChange);
    window.addEventListener('lokal:playlist-deleted', handleDeleted);
    window.addEventListener('lokal:refresh', handleChange);

    return () => {
      window.removeEventListener('lokal:playlist-updated', handleChange);
      window.removeEventListener('lokal:playlist-created', handleChange);
      window.removeEventListener('lokal:playlists-changed', handleChange);
      window.removeEventListener('lokal:playlist-deleted', handleDeleted);
      window.removeEventListener('lokal:refresh', handleChange);
    };
  }, [id, load, nav]);

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

    window.dispatchEvent(
      new CustomEvent('lokal:playlists-changed', {
        detail: { playlistId: id, action: 'deleted' }
      })
    )

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

  const fetchRecommendations = useCallback(async () => {
    if (isLiked) return
    setLoadingRecs(true)
    try {
      const allTracks = await api.getTracks()
      if (Array.isArray(allTracks)) {
        const currentIds = new Set(tracks.map(t => t.id))
        const currentArtists = new Set(tracks.map(t => t.artist))
        
        const available = allTracks.filter(t => !currentIds.has(t.id))
        const related = available.filter(t => currentArtists.has(t.artist))
        const others = available.filter(t => !currentArtists.has(t.artist))
        
        const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5)
        
        let recs = shuffle(related).slice(0, 5)
        if (recs.length < 5) {
          recs = [...recs, ...shuffle(others).slice(0, 5 - recs.length)]
        }
        setRecommendations(recs)
      }
    } catch (e) { console.error(e) }
    setLoadingRecs(false)
  }, [tracks, isLiked])

  useEffect(() => {
    if (!isLiked && tracks.length > 0 && tracks.length <= 300 && recommendations.length === 0) fetchRecommendations()
  }, [tracks.length, isLiked, recommendations.length, fetchRecommendations])

  const addRecommendation = async (track) => {
    await api.addToPlaylist(id, track.id)
    setRecommendations(p => p.filter(t => t.id !== track.id))
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const totalDuration = tracks.reduce((s, t) => s + (t.duration || 0), 0)
  const fmt = (s) => `${Math.floor(s / 3600) > 0 ? Math.floor(s / 3600) + 'h ' : ''}${Math.floor((s % 3600) / 60)}m`
  const shuffleTracks = () => {
    if (!playableTracks.length) return
    const shuffled = [...playableTracks].sort(() => Math.random() - 0.5)
    playQueue(shuffled, 0)
  }

  const uploadPlaylistPhoto = async () => {
    if (!api.isElectron || isLiked) return
    const fp = await api.openFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    const dataUrl = await api.readFileAsDataURL(fp)
    if (!dataUrl) return
    const updated = await api.updatePlaylist(id, { coverData: dataUrl })
    if (updated?.id) setPlaylist(updated)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const clearPlaylistPhoto = async () => {
    if (isLiked) return
    const updated = await api.updatePlaylist(id, { clearCover: true })
    if (updated?.id) setPlaylist(updated)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const handleTrackAdded = () => {
    load()
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  return (
    <div className="p-6 pb-10">
      {}
      <div className="flex items-end gap-5 mb-8">
        <div className="relative w-36 h-36 flex-shrink-0 group">
          <div className="w-36 h-36 rounded-2xl overflow-hidden bg-elevated border border-border flex items-center justify-center shadow-xl">
            {isLiked
              ? <Heart size={52} className="text-accent" fill="currentColor" />
              : <PlaylistCover playlistId={id} coverPath={playlist?.cover_path} size={144} className="w-full h-full object-cover" />
            }
          </div>
          {!isLiked && (
            <button
              onClick={uploadPlaylistPhoto}
              className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center"
              title={playlist?.cover_path ? 'Change playlist photo' : 'Upload playlist photo'}
            >
              <span className="w-11 h-11 rounded-full bg-white/12 border border-white/15 text-white hover:bg-white/20 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center">
                <ImageIcon size={17} />
              </span>
            </button>
          )}
          {!isLiked && playlist?.cover_path && (
            <div className="absolute top-3 right-3">
              <button
                onClick={(e) => { e.stopPropagation(); clearPlaylistPhoto() }}
                className="w-9 h-9 rounded-full bg-red-500/20 border border-red-400/25 text-red-200 hover:bg-red-500/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
                title="Reset playlist photo"
              >
                <X size={15} />
              </button>
            </div>
          )}
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
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button onClick={() => playQueue(playableTracks, 0)} disabled={!playableTracks.length}
          className="flex items-center gap-2 px-6 py-2.5 bg-accent text-base rounded-full font-medium text-sm hover:bg-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Play size={16} fill="currentColor" className="translate-x-px" /> Play All
        </button>
        <button onClick={shuffleTracks} disabled={!playableTracks.length}
          className="flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          <Shuffle size={15} /> Shuffle
        </button>
        {!isLiked && (
          <>
            <button onClick={() => setShowAddSongs(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors">
              <Plus size={15} /> Add Songs
            </button>
            <button onClick={deletePlaylist}
              className="flex items-center gap-2 px-4 py-2.5 text-red-400 border border-red-400/30 rounded-full text-sm hover:bg-red-400/10 transition-colors">
              <Trash2 size={14} /> Delete Playlist
            </button>
          </>
        )}
      </div>

      <TrackList
        tracks={tracks}
        showAlbum
        onRemove={!isLiked ? removeTrack : null}
        playlistId={!isLiked ? id : null}
        onReorder={!isLiked ? handleReorder : null}
      />

      {!isLiked && tracks.length <= 300 && (tracks.length > 0 || recommendations.length > 0) && (
        <div className="mt-12 mb-6">
  <div className="flex items-center justify-between mb-4 px-2">
    <h2 className="text-lg font-display text-white">Recommended Songs</h2>
    <button onClick={fetchRecommendations} disabled={loadingRecs}
      className="p-2 hover:bg-elevated rounded-full transition-colors text-muted hover:text-white">
      <RefreshCw size={16} className={loadingRecs ? 'animate-spin' : ''} />
    </button>
  </div>
  
  <TrackList 
    tracks={recommendations} 
    showAlbum={false}
    playlistId={null}
    onQuickAdd={!isLiked ? addRecommendation : null}
  />
</div>
      )}

      {!tracks.length && (
        <div className="text-center py-20 text-muted">
          <Music size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">{isLiked ? 'Like some tracks to see them here.' : 'This playlist is empty. Use Add Songs to build it.'}</p>
        </div>
      )}

      {!isLiked && (
        <AddTracksToPlaylistModal
          open={showAddSongs}
          onClose={() => setShowAddSongs(false)}
          playlistId={id}
          existingTrackIds={tracks.map(track => track.id)}
          onAdded={handleTrackAdded}
        />
      )}
    </div>
  )
}
