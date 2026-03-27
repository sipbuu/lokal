import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Heart, Plus, Camera, Trash2, Music, LibraryBig, Clock, ListEnd, GripVertical, X, Check, Edit2, Search, Download, AlertCircle } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { api } from '../api'
import TrackEditModal from './TrackEditModal'
import BatchEditModal from './BatchEditModal'
import Modal from './Modal'

const RECENT_ITEMS_KEY = 'lokal-recent-items'
const MAX_RECENT = 5
const LARGE_LIST_STEP = 200

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

export default function TrackList({ tracks = [], showAlbum = true, onRemove = null, showPlayNext = true, showAddToQueue = true, playlistId = null, onReorder = null, onQuickAdd = null, reduceMotion = false }) {
  const { currentTrack, isPlaying, playTrack, togglePlay, likedIds, setLiked, playNext, addToQueue, syncTrack } = usePlayerStore()
  const { user, openAddToPlaylist, openAddMultipleToPlaylist } = useAppStore()
  const [hoveredId, setHoveredId] = useState(null)
  const [likeAnim, setLikeAnim] = useState(null)
  const [quickAddAnim, setQuickAddAnim] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [editingTrack, setEditingTrack] = useState(null)
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  const [trackToDelete, setTrackToDelete] = useState(null)
  const [trackOverrides, setTrackOverrides] = useState({})
  const [visibleCount, setVisibleCount] = useState(LARGE_LIST_STEP)
  const [ghostTrack, setGhostTrack] = useState(null)
  const [ghostQuery, setGhostQuery] = useState('')
  const [ghostSearchResults, setGhostSearchResults] = useState([])
  const [ghostSearchLoading, setGhostSearchLoading] = useState(false)
  const [ghostLocalResults, setGhostLocalResults] = useState([])
  const [ghostLocalLoading, setGhostLocalLoading] = useState(false)
  const [ghostActionStatus, setGhostActionStatus] = useState('')
  const loaderRef = useRef(null)
  const shouldAnimateRows = !reduceMotion && tracks.length <= 120
  const mergedTracks = tracks.map(track => trackOverrides[track.id] ? { ...track, ...trackOverrides[track.id] } : track)
  const isLargeList = mergedTracks.length > LARGE_LIST_STEP
  const visibleTracks = isLargeList ? mergedTracks.slice(0, visibleCount) : mergedTracks

  useEffect(() => {
    setVisibleCount(LARGE_LIST_STEP)
  }, [tracks.length])

  useEffect(() => {
    if (!isLargeList || !loaderRef.current) return
    const node = loaderRef.current
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting) {
        setVisibleCount(v => Math.min(v + LARGE_LIST_STEP, mergedTracks.length))
      }
    }, { rootMargin: '600px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [isLargeList, mergedTracks.length, visibleCount])

  useEffect(() => {
    if (!ghostTrack) {
      setGhostQuery('')
      setGhostSearchResults([])
      setGhostSearchLoading(false)
      setGhostLocalResults([])
      setGhostLocalLoading(false)
      setGhostActionStatus('')
      return
    }
    const run = async () => {
      setGhostSearchLoading(true)
      setGhostLocalLoading(true)
      setGhostActionStatus('')
      try {
        const query = [ghostTrack.artist, ghostTrack.title].filter(Boolean).join(' - ')
        setGhostQuery(query)
        const result = await api.searchYT(query, 1)
        setGhostSearchResults(Array.isArray(result?.results) ? result.results.slice(0, 6) : Array.isArray(result) ? result.slice(0, 6) : [])
        const localResult = await api.searchTracks(query)
        setGhostLocalResults(Array.isArray(localResult?.tracks) ? localResult.tracks.slice(0, 8) : [])
      } catch (e) {
        setGhostActionStatus('Search failed: ' + e.message)
      } finally {
        setGhostSearchLoading(false)
        setGhostLocalLoading(false)
      }
    }
    run()
  }, [ghostTrack])

  const refreshGhostMatches = async (queryOverride = '') => {
    const query = String(queryOverride || ghostQuery || [ghostTrack?.artist, ghostTrack?.title].filter(Boolean).join(' - ')).trim()
    if (!query) {
      setGhostActionStatus('Enter a search query first.')
      return
    }
    setGhostSearchLoading(true)
    setGhostLocalLoading(true)
    setGhostActionStatus('')
    try {
      const result = await api.searchYT(query, 1)
      setGhostSearchResults(Array.isArray(result?.results) ? result.results.slice(0, 6) : Array.isArray(result) ? result.slice(0, 6) : [])
      const localResult = await api.searchTracks(query)
      setGhostLocalResults(Array.isArray(localResult?.tracks) ? localResult.tracks.slice(0, 8) : [])
    } catch (e) {
      setGhostActionStatus('Search failed: ' + e.message)
    } finally {
      setGhostSearchLoading(false)
      setGhostLocalLoading(false)
    }
  }

  const isGhostTrack = (track) => String(track?.file_path || '').startsWith('ghost://')

  const handlePlay = (track, e) => {
    e.stopPropagation()
    if (isGhostTrack(track)) {
      setGhostTrack(track)
      return
    }
    saveRecentTrack(track)
    if (currentTrack?.id === track.id) togglePlay()
    else playTrack(track, mergedTracks)
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
      api.trackSetArtwork(track.id, c.toDataURL('image/jpeg', 0.85)).then((updatedTrack) => {
        if (updatedTrack?.id) {
          syncTrack(updatedTrack)
          setTrackOverrides(prev => ({ ...prev, [updatedTrack.id]: updatedTrack }))
        }
      })
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
      const trackIds = mergedTracks.map(t => t.id)
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
    if (isGhostTrack(track)) {
      setGhostTrack(track)
      return
    }
    if (selectedIds.size > 1) {
      const selectedTracks = mergedTracks.filter(t => selectedIds.has(t.id))
      selectedTracks.filter(t => !isGhostTrack(t)).forEach(t => playNext(t))
    } else {
      playNext(track)
    }
  }

  const handleAddToQueue = (track, e) => {
    e.stopPropagation()
    if (isGhostTrack(track)) {
      setGhostTrack(track)
      return
    }
    if (selectedIds.size > 1) {
      const selectedTracks = mergedTracks.filter(t => selectedIds.has(t.id))
      selectedTracks.filter(t => !isGhostTrack(t)).forEach(t => addToQueue(t))
    } else {
      addToQueue(track)
    }
  }

  const artSrc = (t) => t.artwork_path ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id)) : null

  const handleSelectedAddToPlaylist = () => {
      const trackIds = Array.from(selectedIds)
      if (trackIds.length === 1) {
      const track = mergedTracks.find(t => t.id === trackIds[0])
      if (track) openAddToPlaylist(track)
    } else if (trackIds.length > 1) {
      openAddMultipleToPlaylist(trackIds)
    }
  }

  const handleSelectedDelete = async () => {
    if (onRemove && selectedIds.size > 0) {
      for (const trackId of selectedIds) {
        const track = mergedTracks.find(t => t.id === trackId)
        if (track) await onRemove(track)
      }
      setSelectedIds(new Set())
    }
  }

  const handleBatchSave = (updatedTracks) => {
    if (!Array.isArray(updatedTracks) || !updatedTracks.length) return
    const nextOverrides = {}
    for (const updatedTrack of updatedTracks) {
      if (!updatedTrack?.id) continue
      syncTrack(updatedTrack)
      nextOverrides[updatedTrack.id] = updatedTrack
    }
    setTrackOverrides(prev => ({ ...prev, ...nextOverrides }))
  }

  const handleQuickAdd = async (track, e) => {
    e?.stopPropagation()
    if (!onQuickAdd) return
    
    setQuickAddAnim(track.id)
    
    await onQuickAdd(track)
    
    setTimeout(() => setQuickAddAnim(null), 600)
  }

  const downloadGhostResult = async (item) => {
    if (!item?.url) return
    setGhostActionStatus('Starting download...')
    try {
      const result = await api.downloadYT(item.url, {})
      if (result?.error) {
        setGhostActionStatus('Download failed: ' + result.error)
        return
      }
      setGhostActionStatus('Download started. Resolve this ghost track after the song finishes indexing.')
    } catch (e) {
      setGhostActionStatus('Download failed: ' + e.message)
    }
  }

  const assignGhostTrack = async (track) => {
    if (!ghostTrack?.id || !track?.id) return
    setGhostActionStatus('Assigning track...')
    try {
      const result = await api.resolveGhostTrack(ghostTrack.id, track.id)
      if (result?.error) {
        setGhostActionStatus('Assign failed: ' + result.error)
        return
      }
      setGhostActionStatus('Assigned successfully.')
      window.dispatchEvent(new Event('lokal:refresh'))
      if (playlistId) {
        window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId } }))
      }
      setGhostTrack(null)
    } catch (e) {
      setGhostActionStatus('Assign failed: ' + e.message)
    }
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
            <button onClick={() => setShowBatchEdit(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-border text-muted rounded-lg text-xs hover:text-white transition-colors">
              <Edit2 size={12} /> Batch Edit
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

      {visibleTracks.map((track, i) => {
        const isCurrent = currentTrack?.id === track.id
        const isHov = hoveredId === track.id
        const isSelected = selectedIds.has(track.id)
        const isDragging = draggedId === track.id
        const isDragOver = dragOverId === track.id
        const liked = likedIds.has(track.id)
        const src = artSrc(track)
        const isGhost = isGhostTrack(track)
        const RowComponent = shouldAnimateRows ? motion.div : 'div'
        const motionProps = shouldAnimateRows ? {
          initial: { opacity: 0, y: 2 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: Math.min(i * 0.01, 0.2) },
        } : {}

        return (
          <RowComponent key={`${track.id}-${i}`}
            {...motionProps}
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
            style={{ contentVisibility: 'auto', containIntrinsicSize: '44px' }}
            className={`grid gap-2 px-4 py-1.5 rounded-lg items-center cursor-default group transition-colors ${isCurrent ? 'bg-accent/8' : 'hover:bg-elevated'} ${isSelected ? 'bg-accent/15' : ''} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-accent' : ''} ${isGhost ? 'opacity-75' : ''} ${playlistId ? 'grid-cols-[2rem_1.5rem_1fr_auto_5rem]' : 'grid-cols-[2rem_1fr_auto_5rem]'}`}
          >
            {playlistId && (
              <div className="flex items-center justify-center w-6 text-muted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing">
                <GripVertical size={14} />
              </div>
            )}

            <div className="flex items-center justify-center w-7 h-7 text-xs text-muted font-display">
              {isGhost ? (
                <button onClick={e => { e.stopPropagation(); setGhostTrack(track) }} className="text-yellow-300 hover:text-yellow-200 transition-colors" title="Ghost song">
                  <AlertCircle size={14} />
                </button>
              ) : isHov || isCurrent ? (
                <button onClick={e => handlePlay(track, e)} className={isCurrent ? 'text-accent' : 'text-white'}>
                  {isCurrent && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-px" />}
                </button>
              ) : <span className={isCurrent ? 'text-accent' : ''}>{i + 1}</span>}
            </div>

            <div className="min-w-0 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden bg-card relative">
                {src ? <img src={src} className="w-full h-full object-cover" alt="" loading="lazy" decoding="async" /> : <div className="w-full h-full flex items-center justify-center text-muted"><Music size={11} /></div>}
                {api.isElectron && isHov && (
                  <button onClick={e => replaceArtwork(track, e)} className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={10} className="text-white" />
                  </button>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className={`text-sm font-medium truncate ${isCurrent ? 'text-accent' : 'text-white'}`}>{track.title}</p>
                  {!!track.explicit && <span className="px-1.5 py-0.5 rounded border border-border bg-card text-[10px] font-display uppercase tracking-wide text-muted flex-shrink-0">E</span>}
                  {isGhost && <span className="px-1.5 py-0.5 rounded-full bg-yellow-400/10 border border-yellow-400/20 text-[10px] uppercase tracking-wide text-yellow-200 flex-shrink-0">Ghost</span>}
                </div>
                <p className="text-xs text-muted truncate">{track.artist}</p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 pr-1">
              {showAlbum && <p className="text-xs text-muted truncate max-w-32 hidden md:block mr-2">{track.album}</p>}
              {playlistId && track.added_at && (
                <p className="text-xs text-muted/60 mr-2 hidden lg:block">{fmtAddedAt(track.added_at)}</p>
              )}
              {showPlayNext && !isGhost && (
                <button onClick={e => handlePlayNext(track, e)}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all">
                  <Clock size={14} />
                </button>
              )}
              {showAddToQueue && !isGhost && (
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
                    {quickAddAnim === track.id ? <Check size={14} /> : <LibraryBig size={14} />}
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
              {!playlistId && !onRemove && (
                <button onClick={e => { e.stopPropagation(); setTrackToDelete(track) }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all" title="Delete from Library">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <span className="text-xs text-muted text-right font-display">{fmt(track.duration)}</span>
          </RowComponent>
        )
      })}

      {isLargeList && visibleCount < mergedTracks.length && (
        <div ref={loaderRef} className="flex justify-center pt-4">
          <button
            onClick={() => setVisibleCount(v => Math.min(v + LARGE_LIST_STEP, mergedTracks.length))}
            className="px-4 py-2 rounded-xl bg-card border border-border text-sm text-muted hover:text-white hover:border-accent/30 transition-colors"
          >
            Show More ({mergedTracks.length - visibleCount} left)
          </button>
        </div>
      )}
      
      <TrackEditModal 
        track={editingTrack} 
        open={!!editingTrack} 
        onClose={() => setEditingTrack(null)} 
        onSave={(updatedTrack) => {
          if (!updatedTrack?.id) return
          setTrackOverrides(prev => ({ ...prev, [updatedTrack.id]: updatedTrack }))
          setEditingTrack(updatedTrack)
        }}
      />

      <BatchEditModal
        tracks={mergedTracks.filter(track => selectedIds.has(track.id))}
        open={showBatchEdit}
        onClose={() => setShowBatchEdit(false)}
        onSave={handleBatchSave}
      />

      <Modal 
        open={!!trackToDelete} 
        onClose={() => setTrackToDelete(null)} 
        title="Delete from Library?" 
        width="max-w-sm"
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="p-3 bg-red-500/10 rounded-full h-fit flex-shrink-0">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <div className="space-y-1">
              <p className="text-sm text-white font-medium">{trackToDelete?.title}</p>
              <p className="text-xs text-muted leading-relaxed">
                Are you sure you want to delete this track? This will remove it from your library, playlists, and play history.
              </p>
              <p className="text-[10px] text-muted/60 pt-1">
                The file on your computer will NOT be deleted.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTrackToDelete(null)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={async () => { if (trackToDelete?.file_path) { await api.deleteTrackByPath(trackToDelete.file_path); window.dispatchEvent(new Event('lokal:refresh')) }; setTrackToDelete(null) }} className="flex-1 py-2.5 bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/30 transition-colors">Delete</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!ghostTrack}
        onClose={() => setGhostTrack(null)}
        title="Resolve Ghost Song"
        width="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={18} className="text-yellow-200" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white font-medium">{ghostTrack?.title}</p>
                <p className="text-xs text-muted mt-1">{ghostTrack?.artist || 'Unknown Artist'}{ghostTrack?.album ? ` · ${ghostTrack.album}` : ''}</p>
                <p className="text-xs text-muted mt-2">This song was imported from another platform but Lokal could not match it to a local file yet. It stays in the playlist as a placeholder until you resolve it.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => refreshGhostMatches()}
              className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center gap-2"
            >
              <Search size={14} /> Refresh Matches
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={ghostQuery}
              onChange={e => setGhostQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') refreshGhostMatches(e.currentTarget.value) }}
              placeholder="Search manually for a better match"
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
            />
            <button
              onClick={() => refreshGhostMatches()}
              className="px-3 py-2 rounded-lg bg-accent/15 border border-accent/25 text-accent text-sm hover:bg-accent/25 transition-colors"
            >
              Search
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted font-display">Assign Existing Local Track</div>
            <div className="divide-y divide-border">
              {ghostLocalLoading && (
                <div className="px-4 py-6 text-sm text-muted">Searching local library…</div>
              )}
              {!ghostLocalLoading && ghostLocalResults.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{item.title}</p>
                    <p className="text-xs text-muted truncate">{item.artist}{item.album ? ` · ${item.album}` : ''}</p>
                  </div>
                  <button
                    onClick={() => assignGhostTrack(item)}
                    className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-accent text-xs hover:bg-accent/25 transition-colors flex items-center gap-1.5"
                  >
                    <Check size={12} /> Assign
                  </button>
                </div>
              ))}
              {!ghostLocalLoading && !ghostLocalResults.length && (
                <div className="px-4 py-6 text-sm text-muted">No strong local matches yet. If you just downloaded the song, try Refresh Matches after indexing finishes.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted font-display">Suggested Downloads</div>
            <div className="divide-y divide-border">
              {ghostSearchLoading && (
                <div className="px-4 py-6 text-sm text-muted">Searching…</div>
              )}
              {!ghostSearchLoading && ghostSearchResults.map((item) => (
                <div key={item.id || item.url} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{item.title}</p>
                    <p className="text-xs text-muted truncate">{item.channel || item.artist || item.url}</p>
                  </div>
                  <button
                    onClick={() => downloadGhostResult(item)}
                    className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-accent text-xs hover:bg-accent/25 transition-colors flex items-center gap-1.5"
                  >
                    <Download size={12} /> Download
                  </button>
                </div>
              ))}
              {!ghostSearchLoading && !ghostSearchResults.length && (
                <div className="px-4 py-6 text-sm text-muted">No suggestions yet. Try Search YouTube.</div>
              )}
            </div>
          </div>

          {ghostActionStatus && <p className="text-xs text-muted">{ghostActionStatus}</p>}

          <div className="flex gap-2">
            <button onClick={() => setGhostTrack(null)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Close</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
