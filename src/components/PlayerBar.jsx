import React, { useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Repeat1, Volume2, VolumeX, Heart, Mic2, PanelRight, Maximize2, ListMusic, Plus, Moon, X, Radio } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import Waveform from './Waveform'
import Modal from './Modal'

function fmt(s) { return `${Math.floor((s||0)/60)}:${Math.floor((s||0)%60).toString().padStart(2,'0')}` }

function artistToSlug(artistName, keepCommaArtists = []) {
  if (!artistName) return ''
  const lowerName = artistName.toLowerCase().trim()
  for (const keep of keepCommaArtists) {
    const lowerKeep = keep.toLowerCase().trim()
    if (lowerName === lowerKeep || lowerName.startsWith(lowerKeep + ' ') || lowerName.endsWith(' ' + lowerKeep)) {
      const slug = keep.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      return slug
    }
  }
  const firstPart = artistName.split(',')[0].trim()
  return firstPart.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export default function PlayerBar() {
  const nav = useNavigate()
  const {
    currentTrack, isPlaying, progress, duration, volume, shuffle, repeat,
    showRightSidebar, showQueue,
    togglePlay, next, prev, setProgress, setVolume, toggleShuffle, toggleRepeat,
    toggleLyricsFullscreen, toggleRightSidebar, toggleFullscreen, toggleQueue,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement,
    sleepTimerMinutes, sleepTimerEndTime, setSleepTimer, cancelSleepTimer,
    toggleMiniPlayer,
  } = usePlayerStore()
  const { user, openAddToPlaylist } = useAppStore()
  const [likeAnim, setLikeAnim] = useState(false)
  const [keepCommaArtists, setKeepCommaArtists] = useState([])
  const scrubbing = useRef(false)
  const [localProg, setLocalProg] = useState(null)
  const [showSleepTimer, setShowSleepTimer] = useState(false)
  const [sleepTimerDisplay, setSleepTimerDisplay] = useState(null)
  const display = localProg ?? progress
  const isLiked = currentTrack && likedIds.has(currentTrack.id)
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  useEffect(() => {
    if (!sleepTimerEndTime) {
      setSleepTimerDisplay(null)
      return
    }
    
    const updateDisplay = () => {
      const remaining = sleepTimerEndTime - Date.now()
      if (remaining <= 0) {
        setSleepTimerDisplay(null)
        return
      }
      const minutes = Math.floor(remaining / 60000)
      const seconds = Math.floor((remaining % 60000) / 1000)
      setSleepTimerDisplay(`${minutes}:${seconds.toString().padStart(2, '0')}`)
    }
    
    updateDisplay()
    const interval = setInterval(updateDisplay, 1000)
    return () => clearInterval(interval)
  }, [sleepTimerEndTime])

  useEffect(() => {
    return () => {
      if (sleepTimerEndTime && Date.now() >= sleepTimerEndTime) {
        cancelSleepTimer()
      }
    }
  }, [])

  useEffect(() => {
    api.getKeepCommaArtists().then(artists => {
      if (Array.isArray(artists)) {
        setKeepCommaArtists(artists)
      } else if (artists?.value) {
        try { setKeepCommaArtists(JSON.parse(artists.value)) } catch {}
      }
    }).catch(() => {})
  }, [])

  const getActiveEl = useCallback(() => {
    return activeAudioElement === 'primary' ? audioRef?.current : cfAudioRef?.current
  }, [activeAudioElement, audioRef, cfAudioRef])

  const handleScrub = useCallback((e) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    setLocalProg(t)
    if (scrubbing.current) { 
      const activeEl = getActiveEl()
      if (activeEl) { activeEl.currentTime = t; setProgress(t) }
    }
  }, [duration, getActiveEl, setProgress])

  const toggleLike = async () => {
    if (!currentTrack) return
    const r = await api.toggleLike(currentTrack.id, user?.id)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(currentTrack.id, liked)
    if (liked) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 600) }
  }

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const handleArtistClick = () => {
    if (!currentTrack) return
    const slug = artistToSlug(currentTrack.artist, keepCommaArtists)
    nav(`/artist/a-${slug}`)
  }

  return (
    <div className="h-20 border-t border-border flex items-center px-4 gap-4 flex-shrink-0 z-10" style={{ backgroundColor: 'rgba(var(--surface-rgb), 0.9)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-center gap-3 w-60 min-w-0">
        <button onClick={toggleFullscreen} disabled={!currentTrack}
          className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0 bg-elevated hover:ring-2 ring-accent/30 transition-all disabled:cursor-default">
          <AnimatePresence mode="wait">
            {artSrc ? (
              <motion.img key={currentTrack?.id} src={artSrc}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-subtle text-xl">♪</div>
            )}
          </AnimatePresence>
        </button>

        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div key={currentTrack?.id||'none'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              <p className="text-sm font-medium truncate text-white">{currentTrack?.title || '—'}</p>
              {currentTrack ? (
                <button onClick={handleArtistClick}
                  className="text-xs text-muted hover:text-accent transition-colors truncate max-w-full block text-left">
                  {currentTrack.artist}
                </button>
              ) : <p className="text-xs text-muted">No track playing</p>}
            </motion.div>
          </AnimatePresence>
        </div>

        {currentTrack && (
          <div className="relative flex-shrink-0">
            <motion.button onClick={toggleLike} whileTap={{ scale: 0.75 }}
              className={`transition-colors ${isLiked ? 'text-accent' : 'text-subtle hover:text-white'}`}>
              <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
            </motion.button>
            <AnimatePresence>
              {likeAnim && (
                <motion.div initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 2.8, opacity: 0 }} exit={{}}
                  transition={{ duration: 0.5 }}
                  className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <Heart size={16} className="text-accent" fill="currentColor" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        {currentTrack && (
          <button onClick={() => openAddToPlaylist(currentTrack)} title="Add to playlist"
            className="flex-shrink-0 text-subtle hover:text-accent transition-colors">
            <Plus size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-4">
          <button onClick={toggleShuffle} className={`transition-colors ${shuffle ? 'text-accent' : 'text-subtle hover:text-white'}`} title={shuffle ? "Shuffle on" : "Shuffle off"}><Shuffle size={15} /></button>
          <button onClick={prev} className="text-muted hover:text-white transition-colors" title="Previous"><SkipBack size={18} fill="currentColor" /></button>
          <motion.button onClick={togglePlay} disabled={!currentTrack} whileTap={{ scale: 0.88 }}
            className="w-9 h-9 bg-accent text-base rounded-full flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-40">
            {isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="translate-x-0.5" />}
          </motion.button>
          <button onClick={next} className="text-muted hover:text-white transition-colors" title="Next"><SkipForward size={18} fill="currentColor" /></button>
          <button onClick={toggleRepeat} className={`transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-subtle hover:text-white'}`} title={`Repeat: ${repeat}`}><RepeatIcon size={15} /></button>
        </div>
        <div className="flex items-center gap-2 w-full max-w-md">
          <span className="text-xs text-muted w-8 text-right font-display">{fmt(display)}</span>
          <div className="flex-1 h-1 bg-elevated rounded-full cursor-pointer group relative"
            onMouseMove={handleScrub}
            onMouseDown={e => { scrubbing.current = true; handleScrub(e) }}
            onMouseUp={() => { scrubbing.current = false; setLocalProg(null) }}
            onMouseLeave={() => { if (!scrubbing.current) setLocalProg(null) }}>
            <div className="h-full bg-accent rounded-full relative" style={{ width: `${duration ? (display/duration)*100 : 0}%` }}>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
          <span className="text-xs text-muted w-8 font-display">{fmt(duration)}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 w-52 justify-end">
        {currentTrack && (
          <div className="flex-shrink-0">
            <Waveform isPlaying={isPlaying} />
          </div>
        )}
        <button onClick={toggleLyricsFullscreen} className="text-subtle hover:text-accent transition-colors" title="Lyrics"><Mic2 size={16} /></button>
        <button onClick={toggleQueue} className={`transition-colors ${showQueue ? 'text-accent' : 'text-subtle hover:text-white'}`} title="Queue"><ListMusic size={16} /></button>
        <button onClick={toggleRightSidebar} className={`transition-colors ${showRightSidebar ? 'text-accent' : 'text-subtle hover:text-white'}`} title="Now Playing">< PanelRight size={16} /></button>
        <button onClick={toggleMiniPlayer} disabled={!currentTrack} className="text-subtle hover:text-accent transition-colors disabled:opacity-30" title="Mini Player"><Radio size={15} /></button>
        <button onClick={toggleFullscreen} disabled={!currentTrack} className="text-subtle hover:text-white transition-colors disabled:opacity-30" title="Fullscreen"><Maximize2 size={15} /></button>
        
        <div className="relative flex items-center justify-center">
          <button 
            onClick={() => setShowSleepTimer(!showSleepTimer)} 
            className={`flex items-center justify-center transition-colors ${sleepTimerEndTime ? 'text-accent' : 'text-subtle hover:text-white'}`} 
            title={sleepTimerEndTime ? `Sleep timer: ${sleepTimerDisplay}` : "Sleep Timer"}
          >
            <Moon size={16} />
          </button>
          {sleepTimerEndTime && (
            <span className="absolute -top-2 -right-3 text-[8px] text-accent font-mono bg-surface px-1 rounded-full">
              {sleepTimerDisplay}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1.5 ml-1">
          <button onClick={() => setVolume(volume > 0 ? 0 : 0.8)} className="text-muted hover:text-white transition-colors">
            {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <input type="range" min={0} max={1} step={0.01} value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            className="w-18 accent-accent cursor-pointer h-1" style={{ width: 72 }} />
        </div>
      </div>

      <Modal open={showSleepTimer} onClose={() => setShowSleepTimer(false)} title="Sleep Timer" width="max-w-xs">
        <div className="space-y-3">
          <p className="text-xs text-muted">
            Music will stop after the selected time. Use this if you would like the app to stop while you are sleeping. 
          </p>
          
          <div className="grid grid-cols-2 gap-2">
            {[5, 10, 15, 30, 45, 60].map(mins => (
              <button
                key={mins}
                onClick={() => { setSleepTimer(mins); setShowSleepTimer(false) }}
                className={`py-2.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                  sleepTimerMinutes === mins 
                    ? 'bg-accent text-base' 
                    : 'bg-card border border-border text-muted hover:text-white hover:border-accent/30'
                }`}
              >
                {mins} min
              </button>
            ))}
          </div>
          
          {sleepTimerEndTime && (
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-accent">Timer active: {sleepTimerDisplay}</span>
                <button 
                  onClick={() => { cancelSleepTimer(); setShowSleepTimer(false) }}
                  className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1"
                >
                  <X size={12} /> Cancel
                </button>
              </div>
            </div>
          )}
          
          <button 
            onClick={() => setShowSleepTimer(false)}
            className="w-full py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </Modal>
    </div>
  )
}
