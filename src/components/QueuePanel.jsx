import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Music, GripVertical, Plus, Clock, ListPlus, ListStart, FolderPlus } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { api } from '../api'

export default function QueuePanel() {
  const { 
    showQueue, toggleQueue, queue, queueIndex, playQueue, currentTrack, 
    shuffle, shuffleQueue, shuffleIndex, playNext, addToQueue, reorderQueue, removeFromQueue 
  } = usePlayerStore()
  const { openAddToPlaylist } = useAppStore()
  
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const displayQueue = shuffle ? shuffleQueue : queue
  const displayIndex = shuffle ? shuffleIndex : queueIndex

  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id))
    : null

  const handleDragStart = (e, index) => {
    if (shuffle) return
    setDraggedIndex(index)
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'track',
      track: displayQueue[index]
    }))
    e.dataTransfer.effectAllowed = 'both'
  }

  const handleDragOver = (e, index) => {
    if (shuffle || draggedIndex === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDrop = (e, index) => {
    e.preventDefault()
    if (shuffle || draggedIndex === null) return
    
    console.log(`Moving from ${draggedIndex} to ${index}`)
    
    reorderQueue(draggedIndex, index)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handlePlayNext = (track, e) => {
    e.stopPropagation()
    playNext(track)
  }

  const handleAddToQueue = (track, e) => {
    e.stopPropagation()
    addToQueue(track)
  }

  const handleDragToPlaylist = (track, e) => {
    e.stopPropagation()
    openAddToPlaylist(track)
  }

  const handleRemove = (trackId, e) => {
    e.stopPropagation()
    removeFromQueue(trackId)
  }

  return (
    <AnimatePresence>
      {showQueue && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 320, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="bg-surface border-l border-border overflow-hidden flex-shrink-0 flex flex-col"
          style={{ minWidth: 320 }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div>
              <p className="text-xs font-display text-muted uppercase tracking-widest">
                {shuffle ? 'Up Next (Shuffled)' : 'Queue'} ({displayQueue.length})
              </p>
              {shuffle && (
                <p className="text-[10px] text-accent/70">Drag disabled in shuffle mode</p>
              )}
            </div>
            <button onClick={toggleQueue} className="text-muted hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {!displayQueue.length && (
              <p className="text-xs text-muted text-center py-8">Queue is empty</p>
            )}
            {displayQueue.map((track, i) => {
  const isCurrent = i === displayIndex
  const src = artSrc(track)
  const isDragging = draggedIndex === i
  const isDragOver = dragOverIndex === i
  const isHovered = hoveredIndex === i

  return (
    <motion.div
      layout 
      key={`${track.id}-${i}`}
      draggable={!shuffle}
      onDragStart={(e) => handleDragStart(e, i)}
      onDragOver={(e) => handleDragOver(e, i)}
      onDrop={(e) => handleDrop(e, i)}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => setHoveredIndex(i)}
      onMouseLeave={() => setHoveredIndex(null)}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-left group relative border-t-2 ${
        isCurrent ? 'bg-accent/15' : 'hover:bg-elevated'
      } ${
        isDragging ? 'opacity-20 scale-[0.98]' : 'opacity-100'
      } ${
        isDragOver ? 'border-t-accent' : 'border-t-transparent'
      }`}
    >
      {!shuffle && (
        <div 
          className={`flex-shrink-0 cursor-grab active:cursor-grabbing p-1 z-20 transition-opacity ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          onMouseDown={(e) => e.stopPropagation()} 
        >
          <GripVertical size={14} className="text-muted" />
        </div>
      )}
      
      <div 
        className="flex flex-1 items-center gap-2 min-w-0 cursor-pointer z-10" 
        onClick={() => shuffle ? playQueue(shuffleQueue, i) : playQueue(queue, i)}
      >
        <span className="text-xs text-muted w-5 text-center flex-shrink-0 font-display">
          {isCurrent ? '▶' : i + 1}
        </span>

        <div className="w-9 h-9 rounded bg-card overflow-hidden flex-shrink-0 flex items-center justify-center text-subtle relative">
          {src ? (
            <img src={src} className="w-full h-full object-cover" />
          ) : (
            <Music size={12} />
          )}
          {isCurrent && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className={`text-xs font-medium truncate ${isCurrent ? 'text-accent' : 'text-white'}`}>
            {track.title}
          </p>
          <p className="text-xs text-muted truncate">{track.artist}</p>
        </div>
      </div>

      {(isHovered || isCurrent) && (
        <div 
          className="flex-shrink-0 flex items-center gap-1 z-20" 
          onClick={(e) => e.stopPropagation()} 
        >
          <button
            onClick={(e) => handlePlayNext(track, e)}
            title="Play next"
            className="p-1 rounded hover:bg-accent/20 text-muted hover:text-accent transition-colors"
          >
            <ListStart size={14} />
          </button>
          
          <button
            onClick={(e) => handleAddToQueue(track, e)}
            title="Add to queue"
            className="p-1 rounded hover:bg-accent/20 text-muted hover:text-accent transition-colors"
          >
            <ListPlus size={14} />
          </button>
          
          <button
            onClick={(e) => handleDragToPlaylist(track, e)}
            title="Add to playlist"
            className="p-1 rounded hover:bg-accent/20 text-muted hover:text-accent transition-colors"
          >
            <FolderPlus size={14} />
          </button>

          {!isCurrent && (
            <button
              onClick={(e) => handleRemove(track.id, e)}
              title="Remove from queue"
              className="p-1 rounded hover:bg-red-500/20 text-muted hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
          </motion.div>
        )
      })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
