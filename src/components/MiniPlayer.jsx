import React, { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, X, Volume2, VolumeX, Heart } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import { api } from '../api'

function fmt(s) { return `${Math.floor((s||0)/60)}:${Math.floor((s||0)%60).toString().padStart(2,'0')}` }

export default function MiniPlayer({ windowed = false }) {
  const {
    currentTrack, isPlaying, progress, duration, volume,
    togglePlay, next, prev, setProgressWithAudioUpdate, setVolume,
    showMiniPlayer, toggleMiniPlayer, likedIds, setLiked
  } = usePlayerStore()
  const { user } = useAppStore()

  const prevWindowSize = useRef(null)
  const [lyricsLines, setLyricsLines] = useState([])
  const [lyricsType, setLyricsType] = useState(null)
  const [lyricsCurrent, setLyricsCurrent] = useState('')
  const [lyricsNext, setLyricsNext] = useState('')
  const [lyricsWords, setLyricsWords] = useState([])
  const [activeWordIdx, setActiveWordIdx] = useState(-1)
  const [activeCharCount, setActiveCharCount] = useState(0)
  const [bgVars, setBgVars] = useState({
    image: '',
    blur: '0px',
    size: 'cover',
    position: 'center',
    overlay: '0.7'
  })

  const wordSyncEnabled = useMemo(() => {
    try {
      return localStorage.getItem('word-sync') === '1'
    } catch {
      return false
    }
  }, [])

  const isLiked = currentTrack && likedIds.has(currentTrack.id)

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
      setLyricsWords([])
      setActiveWordIdx(-1)
      setActiveCharCount(0)
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
        setLyricsWords([])
        setActiveWordIdx(-1)
        setActiveCharCount(0)
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
      setLyricsWords([])
      setActiveWordIdx(-1)
      setActiveCharCount(0)
    })
    return () => { active = false }
  }, [currentTrack?.id])

  useEffect(() => {
    if (!lyricsLines.length) {
      setLyricsCurrent('')
      setLyricsNext('')
      setLyricsWords([])
      setActiveWordIdx(-1)
      setActiveCharCount(0)
      return
    }

    if (lyricsType === 'synced') {
      let idx = 0
      for (let i = 0; i < lyricsLines.length; i++) {
        if ((lyricsLines[i].time ?? 0) <= progress) idx = i
        else break
      }
      const line = lyricsLines[idx] || {}
      const nextLine = lyricsLines[idx + 1] || {}
      const words = Array.isArray(line.words) ? line.words.filter(w => w?.word) : []

      setLyricsCurrent(line.text || '')
      setLyricsNext(nextLine.text || '')
      setLyricsWords(words)

      if (!words.length) {
        setActiveWordIdx(-1)
        setActiveCharCount(0)
        return
      }

      let wIdx = 0
      for (let i = 0; i < words.length; i++) {
        const start = words[i].time ?? 0
        const end = words[i].end ?? start
        if (progress >= start || progress >= end) wIdx = i
        if (progress < start) break
      }
      setActiveWordIdx(wIdx)
      const aw = words[wIdx]
      const start = aw?.time ?? 0
      const end = aw?.end ?? start
      const denom = Math.max(0.01, end - start)
      const ratio = Math.max(0, Math.min(1, (progress - start) / denom))
      const count = Math.max(0, Math.min(aw?.word?.length || 0, Math.ceil((aw?.word?.length || 0) * ratio)))
      setActiveCharCount(count)
      return
    }

    const idx = Math.max(0, Math.min(lyricsLines.length - 1, Math.floor(progress / 4)))
    setLyricsCurrent(lyricsLines[idx]?.text || lyricsLines[0]?.text || '')
    setLyricsNext(lyricsLines[idx + 1]?.text || '')
    setLyricsWords([])
    setActiveWordIdx(-1)
    setActiveCharCount(0)
  }, [lyricsLines, lyricsType, progress])

  useEffect(() => {
    const syncBgVars = () => {
      try {
        const root = getComputedStyle(document.documentElement)
        const image = root.getPropertyValue('--bg-image').trim()
        const blur = root.getPropertyValue('--bg-blur').trim() || '0px'
        const size = root.getPropertyValue('--bg-size').trim() || 'cover'
        const position = root.getPropertyValue('--bg-position').trim() || 'center'
        const overlay = root.getPropertyValue('--bg-overlay').trim() || '0.7'
        setBgVars({ image, blur, size, position, overlay })
      } catch {}
    }
    syncBgVars()
    const id = setInterval(syncBgVars, 1200)
    return () => clearInterval(id)
  }, [])

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  const handleScrub = (e) => {
    if (!duration) return
    const r = e.currentTarget.getBoundingClientRect()
    const t = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
    setProgressWithAudioUpdate(t)
  }

  const toggleLike = async () => {
    if (!currentTrack) return
    const r = await api.toggleLike(currentTrack.id, user?.id)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(currentTrack.id, liked)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={windowed
        ? 'relative h-full w-full bg-transparent border border-border rounded-none shadow-none overflow-hidden'
        : 'fixed bottom-4 right-4 w-72 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden z-50'}
    >
      {windowed && (
        <>
          <div
            className="absolute inset-0 bg-no-repeat -z-10"
            style={{
              backgroundImage: bgVars.image || (artSrc ? `url("${artSrc}")` : 'none'),
              filter: `blur(${bgVars.blur})`,
              transform: 'scale(1.05)',
              backgroundSize: bgVars.size,
              backgroundPosition: bgVars.position
            }}
          />
          <div className="absolute inset-0 bg-bg -z-10" style={{ opacity: Math.min(0.55, parseFloat(bgVars.overlay || '0.55')) }} />
          <div className="absolute inset-0 bg-black/20 -z-10" />
        </>
      )}

      <div className="flex items-center justify-between px-3 py-2 bg-black/25 backdrop-blur-sm border-b border-white/10" style={windowed && api.isElectron ? { WebkitAppRegion: 'drag' } : undefined}>
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

          {wordSyncEnabled && lyricsType === 'synced' && lyricsWords.length > 0 ? (
            <p className={`${windowed ? 'text-xs mt-1' : 'text-[10px] mt-0.5'} truncate`}>
              {lyricsWords.map((w, i) => (
                <span key={`${w.word}-${i}`} className={i <= activeWordIdx ? 'text-white/85 italic' : 'text-white/35 italic'}>
                  {i > 0 ? ' ' : ''}
                  {i === activeWordIdx
                    ? w.word.split('').map((ch, ci) => (
                        <span key={`${w.word}-${ci}`} className={ci < activeCharCount ? 'text-white/95' : 'text-white/45'}>
                          {ch}
                        </span>
                      ))
                    : w.word}
                </span>
              ))}
            </p>
          ) : (
            <>
              {lyricsCurrent ? <p className={`${windowed ? 'text-xs mt-1' : 'text-[10px] mt-0.5'} text-white/75 truncate italic`}>{lyricsCurrent}</p> : null}
              {lyricsNext ? <p className={`${windowed ? 'text-[11px]' : 'text-[9px]'} text-white/35 truncate italic`}>{lyricsNext}</p> : null}
            </>
          )}
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
        <div className="flex items-center gap-1">
          <button
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            className="text-muted hover:text-white transition-colors p-2"
          >
            {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={toggleLike}
            disabled={!currentTrack}
            className={`transition-colors p-2 disabled:opacity-40 ${isLiked ? 'text-accent' : 'text-muted hover:text-white'}`}
          >
            <Heart size={16} fill={isLiked ? 'currentColor' : 'none'} />
          </button>
        </div>

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
