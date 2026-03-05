import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, X, Volume2, VolumeX } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { api } from '../api'

function fmt(s) { return `${Math.floor((s||0)/60)}:${Math.floor((s||0)%60).toString().padStart(2,'0')}` }

export default function MiniPlayer() {
  const {
    currentTrack, isPlaying, progress, duration, volume,
    togglePlay, next, prev, setProgress, setVolume,
    showMiniPlayer, toggleMiniPlayer,
  } = usePlayerStore()

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const handleScrub = (e) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    setProgress(t)
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-4 right-4 w-72 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden z-50"
    >
      <div className="flex items-center justify-between px-3 py-2 bg-elevated border-b border-border">
        <span className="text-xs text-muted font-medium">Mini Player</span>
        <button 
          onClick={toggleMiniPlayer}
          className="text-muted hover:text-white transition-colors p-1"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-3 flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-card">
          {artSrc ? (
            <img src={artSrc} alt="Artwork" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-subtle text-2xl">♪</div>
          )}
        </div>
        
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate text-white">{currentTrack?.title || '—'}</p>
          <p className="text-xs text-muted truncate">{currentTrack?.artist || 'No track'}</p>
        </div>
      </div>

      <div className="px-3">
        <div 
          className="h-1.5 bg-elevated rounded-full cursor-pointer group"
          onClick={handleScrub}
        >
          <div 
            className="h-full bg-accent rounded-full relative"
            style={{ width: `${duration ? (progress/duration)*100 : 0}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-muted mt-1">
          <span>{fmt(progress)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>

      <div className="px-3 pb-3 pt-2 flex items-center justify-between">
        <button 
          onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
          className="text-muted hover:text-white transition-colors p-2"
        >
          {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={prev}
            className="text-muted hover:text-white transition-colors p-2"
          >
            <SkipBack size={18} fill="currentColor" />
          </button>
          
          <button 
            onClick={togglePlay}
            disabled={!currentTrack}
            className="w-10 h-10 bg-accent text-base rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-40"
          >
            {isPlaying ? (
              <Pause size={18} fill="currentColor" />
            ) : (
              <Play size={18} fill="currentColor" className="translate-x-0.5" />
            )}
          </button>
          
          <button 
            onClick={next}
            className="text-muted hover:text-white transition-colors p-2"
          >
            <SkipForward size={18} fill="currentColor" />
          </button>
        </div>

        {/* Volume slider */}
        <input 
          type="range" 
          min={0} 
          max={1} 
          step={0.01} 
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-16 accent-accent cursor-pointer h-1"
        />
      </div>
    </motion.div>
  )
}

