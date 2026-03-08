import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, X, Volume2, VolumeX } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { api } from '../api'

function fmt(s) { return `${Math.floor((s||0)/60)}:${Math.floor((s||0)%60).toString().padStart(2,'0')}` }

export default function MiniPlayer({ windowed = false }) {
  const {
    currentTrack, isPlaying, progress, duration, volume,
    togglePlay, next, prev, setProgressWithAudioUpdate, setVolume,
    showMiniPlayer, toggleMiniPlayer
  } = usePlayerStore()

  const prevWindowSize = useRef(null)
  const [lyricsLines, setLyricsLines] = useState([])
  const [lyricsType, setLyricsType] = useState(null)
  const [lyricsCurrent, setLyricsCurrent] = useState('')
  const [lyricsNext, setLyricsNext] = useState('')

  useEffect(() => {
    const electron = window.electron
    if (!electron || !showMiniPlayer) {
      return
    }
    if (electron.getWindowSize) {
      electron.getWindowSize().then(size => {
        prevWindowSize.current = size
      }).catch(() => {})
    }
    if (electron.setMiniMode) {
      electron.setMiniMode(true).catch(() => {})
    } else {
      if (electron.setAlwaysOnTop) electron.setAlwaysOnTop(true).catch(() => {})
      if (electron.setWindowSize) electron.setWindowSize(360, 220).catch(() => {})
    }
    return () => {
      if (electron.setMiniMode) {
        electron.setMiniMode(false).catch(() => {})
      } else {
        if (electron.setAlwaysOnTop) electron.setAlwaysOnTop(false).catch(() => {})
        if (prevWindowSize.current && electron.setWindowSize) {
          electron.setWindowSize(prevWindowSize.current[0], prevWindowSize.current[1]).catch(() => {})
        }
      }
    }
  }, [showMiniPlayer])

  useEffect(() => {
    if (!currentTrack?.id) {
      setLyricsLines([])
      setLyricsType(null)
      setLyricsCurrent('')
      setLyricsNext('')
      return
    }
    let active = true
    api.getLyrics(
      currentTrack.id,
      currentTrack.title,
      currentTrack.artist,
      currentTrack.album,
      currentTrack.duration,
      currentTrack.file_path
    ).then((r) => {
      if (!active) return
      if (!Array.isArray(r?.lines) || r.lines.length === 0) {
        setLyricsLines([])
        setLyricsType(null)
        setLyricsCurrent('')
        setLyricsNext('')
        return
      }
      setLyricsLines(r.lines)
      setLyricsType(r.type || null)
    }).catch(() => {
      if (!active) return
      setLyricsLines([])
      setLyricsType(null)
      setLyricsCurrent('')
      setLyricsNext('')
    })
    return () => { active = false }
  }, [currentTrack?.id])

  useEffect(() => {
    if (!lyricsLines.length) {
      setLyricsCurrent('')
      setLyricsNext('')
      return
    }
    if (lyricsType === 'synced') {
      let idx = 0
      for (let i = 0; i < lyricsLines.length; i++) {
        if ((lyricsLines[i].time ?? 0) <= progress) idx = i
        else break
      }
      setLyricsCurrent(lyricsLines[idx]?.text || '')
      setLyricsNext(lyricsLines[idx + 1]?.text || '')
      return
    }
    const idx = Math.max(0, Math.min(lyricsLines.length - 1, Math.floor(progress / 4)))
    setLyricsCurrent(lyricsLines[idx]?.text || lyricsLines[0]?.text || '')
    setLyricsNext(lyricsLines[idx + 1]?.text || '')
  }, [lyricsLines, lyricsType, progress])

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const handleScrub = (e) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    setProgressWithAudioUpdate(t)
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={windowed
        ? 'h-full w-full bg-surface border border-border rounded-none shadow-none overflow-hidden'
        : 'fixed bottom-4 right-4 w-72 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden z-50'}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-elevated border-b border-border" style={windowed && api.isElectron ? { WebkitAppRegion: 'drag' } : undefined}>
        <span className="text-xs text-muted font-medium">Mini Player</span>
        <button 
          onClick={toggleMiniPlayer}
          className="text-muted hover:text-white transition-colors p-1"
          style={windowed && api.isElectron ? { WebkitAppRegion: 'no-drag' } : undefined}
        >
          <X size={14} />
        </button>
      </div>

      <div className={`flex items-center gap-3 ${windowed ? 'p-4' : 'p-3'}`}>
        <div className={`${windowed ? 'w-20 h-20' : 'w-16 h-16'} rounded-lg overflow-hidden flex-shrink-0 bg-card`}>
          {artSrc ? (
            <img src={artSrc} alt="Artwork" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-subtle text-2xl">-</div>
          )}
        </div>
        
        <div className="min-w-0 flex-1">
          <p className={`${windowed ? 'text-base' : 'text-sm'} font-medium truncate text-white`}>{currentTrack?.title || '-'}</p>
          <p className={`${windowed ? 'text-sm' : 'text-xs'} text-muted truncate`}>{currentTrack?.artist || 'No track'}</p>
          {lyricsCurrent ? <p className={`${windowed ? 'text-xs mt-1' : 'text-[10px] mt-0.5'} text-white/75 truncate italic`}>{lyricsCurrent}</p> : null}
          {lyricsNext ? <p className={`${windowed ? 'text-[11px]' : 'text-[9px]'} text-white/35 truncate italic`}>{lyricsNext}</p> : null}
        </div>
      </div>

      <div className={windowed ? 'px-4' : 'px-3'}>
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

      <div className={`${windowed ? 'px-4 pb-4 pt-3' : 'px-3 pb-3 pt-2'} flex items-center justify-between`}>
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

        <input 
          type="range" 
          min={0} 
          max={1} 
          step={0.01} 
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className={windowed ? 'w-24 accent-accent cursor-pointer h-1' : 'w-16 accent-accent cursor-pointer h-1'}
        />
      </div>
    </motion.div>
  )
}
