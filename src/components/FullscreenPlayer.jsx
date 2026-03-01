import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Play, Pause, SkipBack, SkipForward, Heart, Shuffle, Repeat, Repeat1, Mic2, ListMusic, Search } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import { api } from '../api'

function fmt(s) {
  if (!s || isNaN(s)) return '0:00'
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

export default function FullscreenPlayer() {
  const {
    showFullscreen, toggleFullscreen, currentTrack, isPlaying,
    progress, duration, volume, shuffle, repeat, showQueue,
    togglePlay, next, prev, setProgress, toggleShuffle, toggleRepeat,
    likedIds, setLiked, audioRef, cfAudioRef, activeAudioElement, toggleQueue,
  } = usePlayerStore()
  const { user, openAddToPlaylist } = useAppStore()
  const wordSync = localStorage.getItem('word-sync') === '1'
  const [likeAnim, setLikeAnim] = useState(false)
  const [bgLoaded, setBgLoaded] = useState(false)
  const [hasLyrics, setHasLyrics] = useState(false)
  const [settings, setSettings] = useState({})
  const prevTrackId = useRef(null)

  useEffect(() => {
    api.getSettings().then(s => setSettings(s || {}))
  }, [])

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') toggleFullscreen() }
    if (showFullscreen) document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [showFullscreen])

  useEffect(() => {
    if (currentTrack?.id !== prevTrackId.current) {
      setBgLoaded(false)
      setHasLyrics(false) 
      prevTrackId.current = currentTrack?.id
    }
  }, [currentTrack?.id])

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const isLiked = currentTrack && likedIds.has(currentTrack.id)
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat

  const scrub = (e) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    const { audioRef, cfAudioRef, activeAudioElement } = usePlayerStore.getState()
    const activeEl = activeAudioElement === 'primary' ? audioRef?.current : cfAudioRef?.current
    if (activeEl) activeEl.currentTime = t
    setProgress(t)
  }

  const toggleLike = async () => {
    if (!currentTrack) return
    const r = await api.toggleLike(currentTrack.id, user?.id)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(currentTrack.id, liked)
    if (liked) { setLikeAnim(true); setTimeout(() => setLikeAnim(false), 700) }
  }

  const isAutoSynced = settings.unsynced_auto_sync === '1'
  const showLyricsPanel = hasLyrics && currentTrack

  return (
    <AnimatePresence>
      {showFullscreen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex overflow-hidden"
        >
          <div className="absolute inset-0 bg-black">
            <AnimatePresence mode="wait">
              {artSrc ? (
                <motion.img
                  key={currentTrack?.id}
                  src={artSrc}
                  onLoad={() => setBgLoaded(true)}
                  initial={{ opacity: 0, scale: 1.15 }}
                  animate={{ opacity: bgLoaded ? 0.45 : 0, scale: 1.08 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.8 }}
                  className="w-full h-full object-cover"
                  style={{ filter: 'blur(72px) saturate(1.6) brightness(0.5)' }}
                />
              ) : (
                <motion.div
                  key="no-art"
                  className="w-full h-full bg-gradient-to-br from-neutral-900 to-black"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                />
              )}
            </AnimatePresence>
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/30" />
          </div>

          <button onClick={toggleFullscreen}
            className="absolute top-5 left-5 z-20 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors backdrop-blur-sm">
            <X size={15} />
          </button>

          <div className={`relative z-10 flex flex-col items-center justify-center flex-1 px-12 py-8 ${showLyricsPanel ? 'mr-auto pl-48' : 'mx-auto'}`}>
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTrack?.id || 'none'}
                initial={{ opacity: 0, scale: 0.92, y: 16 }}
                animate={{ opacity: 1, scale: isPlaying ? 1 : 0.96, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ type: 'spring', stiffness: 200, damping: 26 }}
                className={`rounded-2xl overflow-hidden shadow-[0_32px_80px_rgba(0,0,0,0.8)] border border-white/10 mb-8 flex-shrink-0 bg-white/5 flex items-center justify-center ${showLyricsPanel ? 'w-64 h-64' : 'w-80 h-80'}`}
              >
                {artSrc
                  ? <img src={artSrc} className="w-full h-full object-cover" alt="" />
                  : <span className="text-white/10 text-7xl">♪</span>
                }
              </motion.div>
            </AnimatePresence>

            <AnimatePresence mode="wait">
              <motion.div key={currentTrack?.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="w-full text-center mb-6">
                <h2 className="text-2xl font-display text-white leading-tight truncate">{currentTrack?.title || '—'}</h2>
                <p className="text-sm text-white/50 mt-1 truncate">{currentTrack?.artist}</p>
                {currentTrack?.album && <p className="text-xs text-white/30 mt-0.5 truncate">{currentTrack.album}</p>}
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center gap-5 mb-6">
              <div className="relative">
                <motion.button onClick={toggleLike}
                  whileTap={{ scale: 0.8 }}
                  className={`transition-colors ${isLiked ? 'text-accent' : 'text-white/35 hover:text-white/70'}`}>
                  <Heart size={22} fill={isLiked ? 'currentColor' : 'none'} />
                </motion.button>
                <AnimatePresence>
                  {likeAnim && (
                    <motion.div initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 2.5, opacity: 0 }} exit={{}}
                      transition={{ duration: 0.5 }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Heart size={22} className="text-accent" fill="currentColor" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <button onClick={() => openAddToPlaylist(currentTrack)}
                className="text-white/35 hover:text-white/70 transition-colors text-xs font-display uppercase tracking-wider">
                + Playlist
              </button>
              <button onClick={toggleQueue}
                className={`transition-colors ${showQueue ? 'text-accent' : 'text-white/35 hover:text-white/70'}`}>
                <ListMusic size={18} />
              </button>
            </div>

            <div className="w-64 space-y-1.5 mb-4">
              <div className="w-full h-0.5 bg-white/15 rounded-full cursor-pointer group" onClick={scrub}>
                <div className="h-full bg-white rounded-full relative transition-none"
                  style={{ width: `${duration ? (progress / duration) * 100 : 0}%` }}>
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100" />
                </div>
              </div>
              <div className="flex justify-between text-xs font-display text-white/35">
                <span>{fmt(progress)}</span><span>{fmt(duration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <button onClick={toggleShuffle} className={`transition-colors ${shuffle ? 'text-accent' : 'text-white/35 hover:text-white'}`}>
                <Shuffle size={20} />
              </button>
              <button onClick={prev} className="text-white/60 hover:text-white transition-colors">
                <SkipBack size={28} fill="currentColor" />
              </button>
              <motion.button onClick={togglePlay} whileTap={{ scale: 0.9 }}
                className="w-16 h-16 bg-white text-black rounded-full flex items-center justify-center hover:scale-105 shadow-2xl transition-transform">
                {isPlaying ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" className="translate-x-0.5" />}
              </motion.button>
              <button onClick={() => next(false)} className="text-white/60 hover:text-white transition-colors">
                <SkipForward size={28} fill="currentColor" />
              </button>
              <button onClick={toggleRepeat} className={`transition-colors ${repeat !== 'none' ? 'text-accent' : 'text-white/35 hover:text-white'}`}>
                <RepeatIcon size={20} />
              </button>
            </div>

            {!showLyricsPanel && currentTrack && (
              <button 
                onClick={() => {
                }}
                className="mt-6 flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/20 transition-colors"
              >
                <Search size={14} />
                No lyrics found
              </button>
            )}
          </div>

          {currentTrack && (
              <div 
                className={`relative z-10 flex flex-col overflow-hidden transition-all duration-500 ${hasLyrics ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} 
                style={{ width: hasLyrics ? '420px' : '0px' }}
              >
                <div className="px-8 pt-6 pb-3 flex-shrink-0">
                  <p className="text-xs font-display text-white/30 uppercase tracking-[0.2em]">Lyrics</p>
                  <p className="text-xs text-white/20 mt-0.5 truncate">{currentTrack.title} — {currentTrack.artist}</p>
                </div>

                <div className="flex-1 min-h-0">
                  <LyricsPanel 
                    track={currentTrack} 
                    progress={progress} 
                    darkMode 
                    fullscreen 
                    wordSync={wordSync} 
                    onLyricsAvailable={setHasLyrics} 
                    textScale={1.15}
                    isAutoSynced={isAutoSynced}
                  />
                </div>
              </div>
            )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
