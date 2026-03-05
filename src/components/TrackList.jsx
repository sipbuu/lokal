import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Heart, Plus, Camera, Trash2, Music, Clock, ListEnd, GripVertical, X, Check, Edit2 } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { api } from '../api'
import TrackEditModal from './TrackEditModal'

const RECENT_ITEMS_KEY = 'lokal-recent-items'
const MAX_RECENT = 5

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

function saveRecentTrack(track) {
  saveRecentItem({
    id: track.id,
    name: track.title,
    artist: track.artist,
    artwork_path: track.artwork_path,
    type: 'track'
  })
}

function fmt(s) { return s ? `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` : '' }

function fmtAddedAt(ts) {
  if (!ts) return ''
  const date = new Date(ts)
  const now = new Date()
  const diffMs = now - date
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default function TrackList({ tracks = [], showAlbum = true, onRemove = null, showPlayNext = true, showAddToQueue = true, playlistId = null, onReorder = null, onQuickAdd = null }) {
  const { currentTrack, isPlaying, playTrack, togglePlay, likedIds, setLiked, playNext, addToQueue } = usePlayerStore()
  const { user, openAddToPlaylist, openAddMultipleToPlaylist } = useAppStore()
  const [hoveredId, setHoveredId] = useState(null)
  const [likeAnim, setLikeAnim] = useState(null)
  const [quickAddAnim, setQuickAddAnim] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [editingTrack, setEditingTrack] = useState(null)

  const handlePlay = (track, e) => {
    e.stopPropagation()
    saveRecentTrack(track)
    if (currentTrack?.id === track.id) togglePlay()
    else playTrack(track, tracks)
  }

  const toggleLike = async (track, e) => {
    e.stopPropagation()
    const r = await api.toggleLike(track.id, user?.id)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(track.id, liked)
    if (liked) { setLikeAnim(track.id); setTimeout(() => setLikeAnim(null), 600) }
  }

  const replaceArtwork = async (track, e) => {
    e.stopPropagation()
    if (!api.isElectron) return
    const fp = await api.openFile([{ name: 'Images', extensions: ['jpg','jpeg','png','webp'] }])
    if (!fp) return
    const img = new Image(); img.src = `file://${fp}`
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      c.getContext('2d').drawImage(img, 0, 0)
      api.trackSetArtwork(track.id, c.toDataURL('image/jpeg', 0.85))
    }
  }

  const handleTrackClick = (track, e) => {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation()
      const newSelected = new Set(selectedIds)
      if (newSelected.has(track.id)) {
        newSelected.delete(track.id)
      } else {
        newSelected.add(track.id)
      }
      setSelectedIds(newSelected)
    } else if (e.shiftKey && selectedIds.size > 0) {
      e.stopPropagation()
      const trackIds = tracks.map(t => t.id)
      const lastSelected = Array.from(selectedIds).pop()
      const lastIndex = trackIds.indexOf(lastSelected)
      const currentIndex = trackIds.indexOf(track.id)
      const start = Math.min(lastIndex, currentIndex)
      const end = Math.max(lastIndex, currentIndex)
      const newSelected = new Set(selectedIds)
      for (let i = start; i <= end; i++) {
        newSelected.add(trackIds[i])
      }
      setSelectedIds(newSelected)
    } else if (!e.shiftKey) {
      setSelectedIds(new Set())
    }
  }

  const handleContainerClick = (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelectedIds(new Set())
    }
  }

  const handleDragStart = (e, track) => {
    setDraggedId(track.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', track.id)
    
    const tracksToDrag = selectedIds.has(track.id) 
      ? tracks.filter(t => selectedIds.has(t.id)).map(t => ({ id: t.id, title: t.title, artist: t.artist }))
      : [{ id: track.id, title: track.title, artist: track.artist }]
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'tracks', tracks: tracksToDrag }))
  }

  const handleDragOver = (e, track) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== track.id) {
      setDragOverId(track.id)
    }
  }

  const handleDragLeave = () => {
    setDragOverId(null)
  }

  const handleDrop = (e, targetTrack) => {
    e.preventDefault()
    setDragOverId(null)
    if (!draggedId || draggedId === targetTrack.id) {
      setDraggedId(null)
      return
    }

    let tracksToMove
    if (selectedIds.has(draggedId)) {
      tracksToMove = tracks.filter(t => selectedIds.has(t.id))
    } else {
      const draggedTrack = tracks.find(t => t.id === draggedId)
      tracksToMove = draggedTrack ? [draggedTrack] : []
    }

    const targetIndex = tracks.findIndex(t => t.id === targetTrack.id)
    const draggedIndex = tracks.findIndex(t => t.id === draggedId)

    if (targetIndex === -1 || draggedIndex === -1) {
      setDraggedId(null)
      return
    }

    const newTracks = [...tracks]
    for (const track of tracksToMove) {
      const idx = newTracks.findIndex(t => t.id === track.id)
      if (idx !== -1) newTracks.splice(idx, 1)
    }

    let insertIndex = newTracks.findIndex(t => t.id === targetTrack.id)
    if (insertIndex === -1) insertIndex = newTracks.length

    if (draggedIndex < targetIndex) {
      insertIndex = newTracks.findIndex(t => t.id === targetTrack.id)
    }

    for (let i = tracksToMove.length - 1; i >= 0; i--) {
      newTracks.splice(insertIndex, 0, tracksToMove[i])
    }

    if (onReorder) {
      onReorder(newTracks.map(t => t.id))
    }

    setDraggedId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  const handlePlayNext = (track, e) => {
    e.stopPropagation()
    if (selectedIds.size > 1) {
      const selectedTracks = tracks.filter(t => selectedIds.has(t.id))
      selectedTracks.forEach(t => playNext(t))
    } else {
      playNext(track)
    }
  }

  const handleAddToQueue = (track, e) => {
    e.stopPropagation()
    if (selectedIds.size > 1) {
      const selectedTracks = tracks.filter(t => selectedIds.has(t.id))
      selectedTracks.forEach(t => addToQueue(t))
    } else {
      addToQueue(track)
    }
  }

  const artSrc = (t) => t.artwork_path ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id)) : null

  const handleSelectedAddToPlaylist = () => {
    const trackIds = Array.from(selectedIds)
    if (trackIds.length === 1) {
      const track = tracks.find(t => t.id === trackIds[0])
      if (track) openAddToPlaylist(track)
    } else if (trackIds.length > 1) {
      openAddMultipleToPlaylist(trackIds)
    }
  }

  const handleSelectedDelete = async () => {
    if (onRemove && selectedIds.size > 0) {
      for (const trackId of selectedIds) {
        const track = tracks.find(t => t.id === trackId)
        if (track) await onRemove(track)
      }
      setSelectedIds(new Set())
    }
  }

  const handleQuickAdd = async (track, e) => {
    e?.stopPropagation()
    if (!onQuickAdd) return
    
    setQuickAddAnim(track.id)
    
    await onQuickAdd(track)
    
    setTimeout(() => setQuickAddAnim(null), 600)
  }

  return (
    <div className="w-full" onClick={handleContainerClick}>
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 mb-2 bg-accent/10 border border-accent/30 rounded-xl">
          <span className="text-sm text-accent font-medium">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={handleSelectedAddToPlaylist} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/20 text-accent rounded-lg text-xs hover:bg-accent/30 transition-colors">
              <Plus size={12} /> Add to Playlist
            </button>
            {onRemove && (
              <button onClick={handleSelectedDelete} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/30 transition-colors">
                <Trash2 size={12} /> Remove
              </button>
            )}
            <button onClick={() => setSelectedIds(new Set())} className="p-1.5 text-muted hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <div className={`grid gap-2 px-4 py-1.5 text-xs text-muted uppercase tracking-widest border-b border-border font-display mb-0.5 ${playlistId ? 'grid-cols-[2rem_1.5rem_1fr_auto_5rem]' : 'grid-cols-[2rem_1fr_auto_5rem]'}`}>
        {playlistId && <span></span>}
        <span>#</span><span>Title</span>
        <span>{showAlbum ? 'Album' : ''}</span>
        <span className="text-right">Time</span>
      </div>

      {tracks.map((track, i) => {
        const isCurrent = currentTrack?.id === track.id
        const isHov = hoveredId === track.id
        const isSelected = selectedIds.has(track.id)
        const isDragging = draggedId === track.id
        const isDragOver = dragOverId === track.id
        const liked = likedIds.has(track.id)
        const src = artSrc(track)

        return (
          <motion.div key={`${track.id}-${i}`}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.01, 0.2) }}
            draggable={!!playlistId}
            onDragStart={(e) => handleDragStart(e, track)}
            onDragOver={(e) => handleDragOver(e, track)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, track)}
            onDragEnd={handleDragEnd}
            onMouseEnter={() => setHoveredId(track.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => handleTrackClick(track, e)}
            onDoubleClick={e => handlePlay(track, e)}
            className={`grid gap-2 px-4 py-1.5 rounded-lg items-center cursor-default group transition-colors ${isCurrent ? 'bg-accent/8' : 'hover:bg-elevated'} ${isSelected ? 'bg-accent/15' : ''} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-accent' : ''} ${playlistId ? 'grid-cols-[2rem_1.5rem_1fr_auto_5rem]' : 'grid-cols-[2rem_1fr_auto_5rem]'}`}
          >
            {playlistId && (
              <div className="flex items-center justify-center w-6 text-muted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing">
                <GripVertical size={14} />
              </div>
            )}

            <div className="flex items-center justify-center w-7 h-7 text-xs text-muted font-display">
              {isHov || isCurrent ? (
                <button onClick={e => handlePlay(track, e)} className={isCurrent ? 'text-accent' : 'text-white'}>
                  {isCurrent && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-px" />}
                </button>
              ) : <span className={isCurrent ? 'text-accent' : ''}>{i + 1}</span>}
            </div>

            <div className="min-w-0 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden bg-card relative">
                {src ? <img src={src} className="w-full h-full object-cover" alt="" /> : <div className="w-full h-full flex items-center justify-center text-muted"><Music size={11} /></div>}
                {api.isElectron && isHov && (
                  <button onClick={e => replaceArtwork(track, e)} className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={10} className="text-white" />
                  </button>
                )}
              </div>
              <div className="min-w-0">
                <p className={`text-sm font-medium truncate ${isCurrent ? 'text-accent' : 'text-white'}`}>{track.title}</p>
                <p className="text-xs text-muted truncate">{track.artist}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 pr-1">
              {showAlbum && <p className="text-xs text-muted truncate max-w-32 hidden md:block mr-2">{track.album}</p>}
              {playlistId && track.added_at && (
                <p className="text-xs text-muted/60 mr-2 hidden lg:block">{fmtAddedAt(track.added_at)}</p>
              )}
              {showPlayNext && (
                <button onClick={e => handlePlayNext(track, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all">
                  <Clock size={14} />
                </button>
              )}
              {showAddToQueue && (
                <button onClick={e => handleAddToQueue(track, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all">
                  <ListEnd size={14} />
                </button>
              )}
              <div className="relative">
                <button onClick={e => toggleLike(track, e)}
                  className={`transition-all ${liked ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100 hover:text-white'}`}>
                  <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
                </button>
                <AnimatePresence>
                  {likeAnim === track.id && (
                    <motion.div initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 2.5, opacity: 0 }} exit={{}}
                      transition={{ duration: 0.5 }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Heart size={13} className="text-accent" fill="currentColor" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {onQuickAdd && (
                <div className="relative">
                  <button onClick={e => handleQuickAdd(track, e)}
                    className={`opacity-0 group-hover:opacity-100 transition-all ${quickAddAnim === track.id ? 'text-green-400' : 'text-muted hover:text-green-400'}`}>
                    {quickAddAnim === track.id ? <Check size={14} /> : <Plus size={14} />}
                  </button>
                  <AnimatePresence>
                    {quickAddAnim === track.id && (
                      <motion.div 
                        initial={{ scale: 0.5, opacity: 1 }} 
                        animate={{ scale: 2, opacity: 0 }} 
                        exit={{}}
                        transition={{ duration: 0.4 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Check size={14} className="text-green-400" />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              <button onClick={e => { e.stopPropagation(); openAddToPlaylist(track) }}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all"
                title="Add to another playlist">
                <Plus size={14} />
              </button>
              <button 
                onClick={e => { e.stopPropagation(); setEditingTrack(track) }}
                className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all"
                title="Edit track info"
              >
                <Edit2 size={14} />
              </button>
              {onRemove && (
                <button onClick={e => { e.stopPropagation(); onRemove(track) }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <span className="text-xs text-muted text-right font-display">{fmt(track.duration)}</span>
          </motion.div>
        )
      })}
      
      <TrackEditModal 
        track={editingTrack} 
        open={!!editingTrack} 
        onClose={() => setEditingTrack(null)} 
      />
    </div>
  )
}
