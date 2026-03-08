import React, { useEffect, useRef, useCallback, useState } from 'react'
import { MemoryRouter as Router, Routes, Route, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Sidebar from './components/Sidebar'
import PlayerBar from './components/PlayerBar'
import TitleBar from './components/TitleBar'
import RightSidebar from './components/RightSidebar'
import FullscreenPlayer from './components/FullscreenPlayer'
import LyricsFullscreen from './components/LyricsFullscreen'
import QueuePanel from './components/QueuePanel'
import AuthModal from './components/AuthModal'
import ProfileModal from './components/ProfileModal'
import StatsModal from './components/StatsModal'
import AddToPlaylistModal from './components/AddToPlaylistModal'
import MiniPlayer from './components/MiniPlayer'
import Onboarding, { useOnboarding } from './components/Onboarding'
import Home from './pages/Home'
import Library from './pages/Library'
import Search from './pages/Search'
import Artist from './pages/Artist'
import Playlist from './pages/Playlist'
import Downloader from './pages/Downloader'
import Settings from './pages/Settings'
import { usePlayerStore, useAppStore } from './store/player'
import { api } from './api'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Home /></motion.div>} />
        <Route path="/library" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Library /></motion.div>} />
        <Route path="/search" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Search /></motion.div>} />
        <Route path="/artist/:id" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Artist /></motion.div>} />
        <Route path="/playlist/:id" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Playlist /></motion.div>} />
        <Route path="/downloader" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Downloader /></motion.div>} />
        <Route path="/settings" element={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}><Settings /></motion.div>} />
      </Routes>
    </AnimatePresence>
  )
}

export default function App() {
  const audioRef = useRef(null)
  const cfAudioRef = useRef(null)
  const gainNodeRef = useRef(null)
  const cfGainNodeRef = useRef(null)
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const isCrossfadingRef = useRef(false)
  const audioSourcesInitializedRef = useRef(false)
  const playSecsRef = useRef(0)
  const playTimerRef = useRef(null)
  const userRef = useRef(null)
  const currentTrackRef = useRef(null)
  const prevTrackIdRef = useRef(null)
  const artworkCacheRef = useRef({})
  const eqFiltersRef = useRef([])
  const justCrossfadedRef = useRef(false)
  const activeElementRef = useRef('primary')
  const pauseSuppressRef = useRef(false)

  const [updateState, setUpdateState] = useState({
    status: 'idle',
    info: null,
    progress: 0,
    error: null,
  })
  const [changelog, setChangelog] = useState('')
  const [loadingChangelog, setLoadingChangelog] = useState(false)

  const getArtworkDataURL = useCallback(async (artworkPath) => {
    if (!artworkPath) return null
    if (artworkCacheRef.current[artworkPath]) return artworkCacheRef.current[artworkPath]
    try {
      let dataUrl = null
      if (api.isElectron && window.electron?.readFileAsDataURL) {
        dataUrl = await window.electron.readFileAsDataURL(artworkPath)
      }
      if (dataUrl) {
        artworkCacheRef.current[artworkPath] = dataUrl
      }
      return dataUrl
    } catch (e) {
      console.error('Error reading artwork:', e)
      return null
    }
  }, [])

  const {
    currentTrack, isPlaying, volume, repeat,
    autoNext, setProgress, setDuration, setIsPlaying,
    setAudioRef, setCfAudioRef, initLiked, setCrossfade, crossfadeSeconds,
    setActiveAudioElement,
    shuffle, playNext, addToQueue, skipAhead,
    showMiniPlayer,
  } = usePlayerStore()
  const { user } = useAppStore()
  const { showOnboarding, completeOnboarding, loading: onboardingLoading } = useOnboarding()

  const isEventFromActive = useCallback((e) => {
    const activeSide = usePlayerStore.getState().activeAudioElement
    const isPrimary = e.target === audioRef.current
    return (activeSide === 'primary' && isPrimary) || (activeSide === 'cf' && !isPrimary)
  }, [])

  const fetchChangelog = useCallback(async () => {
    if (!api.isElectron) return;
    setLoadingChangelog(true);
    try {
      const response = await fetch('https://api.github.com/repos/sipbuu/lokal/releases/latest');
      if (!response.ok) throw new Error('Failed to fetch release info');
      const data = await response.json();
      const fullBody = data.body || '';

      const sectionMatch = fullBody.match(/(?:##|###) (?:Changelog|Changes|What's New)([\s\S]*?)(?=(?:##|###) (?:Setup|Binary Checksums|Full Changelog)|---|$)/i);
      
      let extracted = sectionMatch ? sectionMatch[1].trim() : '';

      if (!extracted) {
        extracted = fullBody.split(/## Setup|### Binary Checksums|---/)[0].trim();
      }

      setChangelog(extracted);
    } catch (err) {
      console.error('[updater] Failed to fetch changelog:', err);
      setChangelog('• Bug fixes and performance improvements\n• Stability updates');
    } finally {
      setLoadingChangelog(false);
    }
  }, []);

  useEffect(() => {
    if (!api.isElectron) return

    const cleanup = api.onUpdaterEvent((event, data) => {
      console.log('[updater] event:', event, data)
      switch (event) {
        case 'available':
          setUpdateState({
            status: 'available',
            info: data,
            progress: 0,
            error: null,
          })
          fetchChangelog()
          break
        case 'progress':
          setUpdateState(prev => ({
            ...prev,
            status: 'downloading',
            progress: data && data.percent ? Math.floor(data.percent) : prev.progress,
          }))
          break
        case 'ready':
          setUpdateState(prev => ({
            ...prev,
            status: 'ready',
            progress: 100,
          }))
          break
        case 'error':
          console.error('[updater] error:', data)
          setUpdateState(prev => ({
            ...prev,
            status: 'error',
            error: data,
          }))
          break
        default:
          break
      }
    })

    return cleanup
  }, [fetchChangelog])

  const handleInstallUpdate = async () => {
    await api.updaterInstall()
  }

  const handleDismissUpdate = () => {
    setUpdateState({
      status: 'idle',
      info: null,
      progress: 0,
      error: null,
    })
    setChangelog('')
  }

  const initAudioCtx = useCallback(() => {
  if (audioSourcesInitializedRef.current) return
  if (!audioRef.current || !cfAudioRef.current) return

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    audioCtxRef.current = ctx

    const bands = [60, 230, 910, 3600, 14000]
    const nodes = bands.map(freq => {
      const f = ctx.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = freq
      f.Q.value = 1.4
      f.gain.value = 0
      return f
    })

    const cfNodes = bands.map((freq, i) => {
      const f = ctx.createBiquadFilter()
      f.type = 'peaking'
      f.frequency.value = freq
      f.Q.value = 1.4
      f.gain.value = nodes[i].gain.value
      return f
    })

    eqFiltersRef.current = { primary: nodes, cf: cfNodes }

    const primarySource = ctx.createMediaElementSource(audioRef.current)
    const cfSource = ctx.createMediaElementSource(cfAudioRef.current)

    const primaryGain = ctx.createGain()
    const cfGain = ctx.createGain()
    gainNodeRef.current = primaryGain
    cfGainNodeRef.current = cfGain

    primaryGain.gain.value = volume
    cfGain.gain.value = 0

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    analyserRef.current = analyser
    window.__lokalAnalyser = analyser

    if (isIOS) {
      primarySource.connect(ctx.destination)
      cfSource.connect(ctx.destination)
    } else {
      let prev = primarySource
      for (const n of nodes) { prev.connect(n); prev = n }
      prev.connect(primaryGain)
      primaryGain.connect(analyser)
      analyser.connect(ctx.destination)

      let cfPrev = cfSource
      for (const n of cfNodes) { cfPrev.connect(n); cfPrev = n }
      cfPrev.connect(cfGain)
      cfGain.connect(ctx.destination)
    }

    try {
      const stored = JSON.parse(localStorage.getItem('lokal-eq') || '[]')
      stored.forEach((v, i) => {
        if (nodes[i]) nodes[i].gain.value = v
        if (cfNodes[i]) cfNodes[i].gain.value = v
      })
    } catch (err) {
    }

    window.__lokaleq = {
      setGain: (i, v) => {
        if (nodes[i]) nodes[i].gain.value = v
        if (cfNodes[i]) cfNodes[i].gain.value = v
      }
    }

    audioSourcesInitializedRef.current = true
  } catch (e) {
    console.error('Failed to initialize AudioContext:', e)
  }
}, [volume])

  useEffect(() => {
    const resumeAudio = () => {
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {})
      }
    }

    window.addEventListener('focus', resumeAudio)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resumeAudio()
    })

    return () => {
      window.removeEventListener('focus', resumeAudio)
    }
  }, [])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    if (!currentTrack) return

    const updateMetadata = async () => {
      let artworkSrc = '/fallback_nopfp.png'
      if (currentTrack.artwork_path) {
        const dataUrl = await getArtworkDataURL(currentTrack.artwork_path)
        if (dataUrl) {
          artworkSrc = dataUrl
        }
      }
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: currentTrack.title || '',
        artist: currentTrack.artist || '',
        album: currentTrack.album || '',
        artwork: [{ src: artworkSrc, sizes: '512x512', type: 'image/png' }]
      })
    }

    updateMetadata()
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch {}
    
    const getActiveAudio = () => {
      const state = usePlayerStore.getState()
      return state.activeAudioElement === 'primary' ? audioRef.current : cfAudioRef.current
    }

    if (audioRef.current && typeof navigator.mediaSession.setPositionState === 'function') {
      try {
        navigator.mediaSession.setPositionState({
          duration: audioRef.current.duration || 0,
          playbackRate: audioRef.current.playbackRate || 1,
          position: audioRef.current.currentTime || 0
        })
      } catch {}
    }
    navigator.mediaSession.setActionHandler('play', () => { 
      const activeEl = getActiveAudio()
      activeEl?.play() 
    })
    navigator.mediaSession.setActionHandler('pause', () => { 
      const activeEl = getActiveAudio()
      activeEl?.pause() 
    })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      const activeEl = getActiveAudio()
      if (activeEl && typeof details.seekTime === 'number') activeEl.currentTime = details.seekTime
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      usePlayerStore.getState().prev()
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      usePlayerStore.getState().next()
    })
  }, [currentTrack, isPlaying])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    
    const activeEl = usePlayerStore.getState().activeAudioElement === 'primary' ? audioRef.current : cfAudioRef.current
    if (!activeEl) return

    const update = () => {
      if (typeof navigator.mediaSession.setPositionState === 'function') {
        try {
          navigator.mediaSession.setPositionState({
            duration: activeEl.duration || 0,
            playbackRate: activeEl.playbackRate || 1,
            position: activeEl.currentTime || 0
          })
        } catch {}
      }
    }

    activeEl.addEventListener('timeupdate', update)
    return () => activeEl.removeEventListener('timeupdate', update)
  }, [])

  useEffect(() => { userRef.current = user }, [user])
  useEffect(() => { currentTrackRef.current = currentTrack }, [currentTrack])

  useEffect(() => {
    api.getLikedTracks(user?.id).then(t => initLiked((t || []).map(x => x.id)))
  }, [user?.id])

  useEffect(() => {
    setAudioRef(audioRef)
    setCfAudioRef(cfAudioRef)
    api.getSettings().then(s => {
      if (s?.crossfade_seconds) setCrossfade(parseFloat(s.crossfade_seconds) || 0)
    })
  }, [])

  const startTimer = useCallback(() => {
    if (playTimerRef.current) return
    playTimerRef.current = setInterval(() => { playSecsRef.current++ }, 1000)
  }, [])

  const stopTimer = useCallback(() => {
    clearInterval(playTimerRef.current); playTimerRef.current = null
  }, [])

  const flushTime = useCallback((trackId) => {
    const secs = playSecsRef.current
    playSecsRef.current = 0
    if (secs >= 10 && trackId) api.incrementPlayTime(trackId, userRef.current?.id, secs)
  }, [])

  const triggerCrossfade = useCallback((nextTrack) => {
    if (isCrossfadingRef.current) return
    if (!cfAudioRef.current || !audioRef.current || !nextTrack || !audioCtxRef.current) return
    if (!gainNodeRef.current || !cfGainNodeRef.current) return

    isCrossfadingRef.current = true
    const ctx = audioCtxRef.current
    const cfDuration = usePlayerStore.getState().crossfadeSeconds || 3

    const isPrimaryActive = usePlayerStore.getState().activeAudioElement === 'primary'
    const fadeOutEl = isPrimaryActive ? audioRef.current : cfAudioRef.current
    const fadeInEl = isPrimaryActive ? cfAudioRef.current : audioRef.current
    const fadeOutGain = isPrimaryActive ? gainNodeRef.current : cfGainNodeRef.current
    const fadeInGain = isPrimaryActive ? cfGainNodeRef.current : gainNodeRef.current

    const encodedPath = nextTrack.file_path.replace(/\\/g, '/').split('/').map(p => encodeURIComponent(p)).join('/').replace(/%3A/g, ':')
    const encodedSrc = api.isElectron ? `file://${encodedPath}` : api.streamURL(nextTrack)
    
    fadeInEl.src = encodedSrc
    fadeInEl.load()

    const waitForCanplay = new Promise((resolve) => {
      const onReady = () => {
        fadeInEl.removeEventListener('canplay', onReady)
        resolve()
      }
      fadeInEl.addEventListener('canplay', onReady)
      setTimeout(resolve, 1500)
    })

    waitForCanplay.then(() => {
      if (!isCrossfadingRef.current) return

      flushTime(currentTrackRef.current?.id)

      const nextSide = isPrimaryActive ? 'cf' : 'primary'
      setActiveAudioElement(nextSide)
      activeElementRef.current = nextSide

      const state = usePlayerStore.getState()
      const nextIdx = state.shuffle ? state.shuffleIndex + 1 : state.queueIndex + 1
      usePlayerStore.setState({
        currentTrack: nextTrack,
        queueIndex: !state.shuffle ? nextIdx : state.queueIndex,
        shuffleIndex: state.shuffle ? nextIdx : state.shuffleIndex,
        isPlaying: true,
      })

      if (fadeInEl.readyState >= 2) {
        fadeInEl.play().catch(() => {})
      }

      const rampNow = ctx.currentTime
      fadeOutGain.gain.cancelScheduledValues(rampNow)
      fadeOutGain.gain.setValueAtTime(fadeOutGain.gain.value, rampNow)
      fadeOutGain.gain.linearRampToValueAtTime(0, rampNow + cfDuration)
      fadeInGain.gain.cancelScheduledValues(rampNow)
      fadeInGain.gain.setValueAtTime(0, rampNow)
      fadeInGain.gain.linearRampToValueAtTime(volume, rampNow + cfDuration)

      setTimeout(() => {
        if (!isCrossfadingRef.current) return

        const endNow = ctx.currentTime
        fadeInGain.gain.cancelScheduledValues(endNow)
        fadeOutGain.gain.cancelScheduledValues(endNow)
        
        if (fadeInGain === gainNodeRef.current) {
          gainNodeRef.current.gain.setValueAtTime(volume, endNow)
          cfGainNodeRef.current.gain.setValueAtTime(0, endNow)
        } else {
          cfGainNodeRef.current.gain.setValueAtTime(volume, endNow)
          gainNodeRef.current.gain.setValueAtTime(0, endNow)
        }

        justCrossfadedRef.current = true
        isCrossfadingRef.current = false

        pauseSuppressRef.current = true
        try { fadeOutEl.pause() } catch {}
        try { fadeOutEl.src = '' } catch {}
        try { fadeOutEl.currentTime = 0 } catch {}
        setTimeout(() => { pauseSuppressRef.current = false }, 200)
      }, cfDuration * 1000)
    })
  }, [volume, flushTime])

  useEffect(() => {
    if (isCrossfadingRef.current) return

    if (justCrossfadedRef.current) {
      justCrossfadedRef.current = false
      const activeSide = usePlayerStore.getState().activeAudioElement
      const inactiveGain = activeSide === 'primary' ? cfGainNodeRef.current : gainNodeRef.current
      if (inactiveGain && audioCtxRef.current) {
        inactiveGain.gain.setValueAtTime(0, audioCtxRef.current.currentTime)
      }
      return
    }

    if (!audioRef.current || !currentTrack) return

    if (cfAudioRef.current) { 
      try { 
        if (cfGainNodeRef.current) cfGainNodeRef.current.gain.value = 0
        cfAudioRef.current.pause(); 
        cfAudioRef.current.src = '' 
      } catch {} 
    }
    
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(volume, audioCtxRef.current.currentTime)
    }
    
    const currentActive = usePlayerStore.getState().activeAudioElement
    if (currentActive !== 'primary') {
      setActiveAudioElement('primary')
    }

    initAudioCtx()

    const src = api.isElectron 
      ? `file://${currentTrack.file_path.replace(/\\/g, '/').split('/').map(s => encodeURIComponent(s)).join('/').replace(/%3A/g, ':')}`
      : api.streamURL(currentTrack);
    audioRef.current.src = src
    if (isPlaying) audioRef.current.play().catch(() => {})
    if (api.isElectron) api.discordSetActivity(currentTrack, true).catch(() => {})
  }, [currentTrack?.id])

  useEffect(() => {
    if (isCrossfadingRef.current) return
    if (!audioRef.current || !cfAudioRef.current) return
    
    const activeSide = usePlayerStore.getState().activeAudioElement
    const activeEl = activeSide === 'primary' ? audioRef.current : cfAudioRef.current
    
    if (isPlaying) { 
      activeEl.play().catch(() => {})
      if (activeSide === 'primary' && !playTimerRef.current) startTimer()
    }
    else { 
      activeEl.pause(); 
      stopTimer() 
    }
    if (api.isElectron && currentTrack) api.discordSetActivity(currentTrack, isPlaying).catch(() => {})
  }, [isPlaying])

  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      try {
        gainNodeRef.current.gain.setValueAtTime(volume, audioCtxRef.current.currentTime)
      } catch {}
    }
  }, [volume])

  const handleTimeUpdate = useCallback((e) => {
    if (!isEventFromActive(e)) return;

    const cur = e.target.currentTime
    const dur = e.target.duration
    
    setProgress(cur)
    setDuration(dur)
    
    if (!dur || isNaN(dur) || isCrossfadingRef.current) return

    const state = usePlayerStore.getState()
    const cf = state.crossfadeSeconds || 0
    const remaining = dur - cur

    if (cf > 0.5 && remaining <= cf && remaining > 0.3) {
      const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex } = state
      let nextTrack = null
      
      if (shuffle && shuffleQueue.length > 0 && shuffleIndex + 1 < shuffleQueue.length) {
        nextTrack = shuffleQueue[shuffleIndex + 1]
      } else if (!shuffle && queueIndex + 1 < queue.length) {
        nextTrack = queue[queueIndex + 1]
      }
      
      if (nextTrack) triggerCrossfade(nextTrack)
    }

    const { queue, queueIndex, _fetchingRelated } = state
    if (queue.length - queueIndex - 1 < 3 && currentTrackRef.current && !_fetchingRelated) {
      usePlayerStore.getState().setFetchingRelated(true)
      api.getRelated(currentTrackRef.current.id, userRef.current?.id).then(related => {
        if (Array.isArray(related) && related.length) usePlayerStore.getState().appendRelated(related)
        usePlayerStore.getState().setFetchingRelated(false)
      })
    }
  }, [triggerCrossfade, isEventFromActive])

  const handlePrimaryDurationChange = useCallback((e) => {
    if (isEventFromActive(e)) setDuration(e.target.duration)
  }, [isEventFromActive])

  const handleCfDurationChange = useCallback((e) => {
    if (isEventFromActive(e)) setDuration(e.target.duration)
  }, [isEventFromActive])

  const handlePrimaryEnded = useCallback((e) => {
    if (!isEventFromActive(e) || isCrossfadingRef.current) return
    
    stopTimer()
    flushTime(currentTrackRef.current?.id)
    
    if (repeat === 'one') { 
      audioRef.current.currentTime = 0; 
      audioRef.current.play().catch(() => {}) 
    }
    else autoNext()
  }, [isEventFromActive, repeat])

  const handleCfEnded = useCallback((e) => {
    if (!isEventFromActive(e) || isCrossfadingRef.current) return
    
    stopTimer()
    flushTime(currentTrackRef.current?.id)
    
    if (repeat === 'one') { 
      cfAudioRef.current.currentTime = 0; 
      cfAudioRef.current.play().catch(() => {}) 
    }
    else autoNext()
  }, [isEventFromActive, repeat])

  const handleStartDownload = async () => {
    setUpdateState(prev => ({ ...prev, status: 'downloading' }));

    try {
      const result = await api.updaterDownload();
      if (result?.error) {
        setUpdateState(prev => ({ ...prev, status: 'error', error: result.error }));
      }
    } catch (err) {
      setUpdateState(prev => ({ ...prev, status: 'error', error: err.message }));
    }
  };

  const MarkdownLite = ({ text }) => {
    const lines = text.split('\n');

    const renderInline = (str) => {
      const parts = str.split(/(\*\*.*?\*\*)/g);
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-bold text-white/90">{part.slice(2, -2)}</strong>;
        }
        return part;
      });
    };

    return (
      <div className="space-y-2">
        {lines.map((line, i) => {
          const trimmedLine = line.trim();

          if (line.startsWith('### ')) {
            return <h3 key={i} className="text-sm font-bold text-white mt-4">{renderInline(line.replace('### ', ''))}</h3>;
          }
          if (line.startsWith('## ')) {
            return <h2 key={i} className="text-base font-bold text-white mt-4 border-b border-white/10 pb-1">{renderInline(line.replace('## ', ''))}</h2>;
          }

          if (line.startsWith('> ')) {
            return (
              <blockquote key={i} className="border-l-2 border-accent/50 pl-3 py-1 my-2 bg-white/5 italic text-xs text-muted/90 rounded-r-sm">
                {renderInline(line.replace('> ', ''))}
              </blockquote>
            );
          }

          if (line.startsWith('- ') || line.startsWith('* ')) {
            return (
              <div key={i} className="flex gap-2 text-xs text-muted ml-2">
                <span className="text-accent">•</span>
                <span>{renderInline(line.replace(/^[-*]\s+/, ''))}</span>
              </div>
            );
          }

          if (!trimmedLine) return <div key={i} className="h-1" />;
          
          return (
            <p key={i} className="text-xs text-muted leading-relaxed">
              {renderInline(line)}
            </p>
          );
        })}
      </div>
    );
  };

  const scrollbarStyles = `
    .update-scrollbar::-webkit-scrollbar {
      width: 6px;
    }
    .update-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .update-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
    }
    .update-scrollbar::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  `;

  const renderUpdateToast = () => {
    if (updateState.status === 'idle') return null;

    const isReady = updateState.status === 'ready';
    const isDownloading = updateState.status === 'downloading';

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
        <style>{scrollbarStyles}</style>
        <div className="bg-elevated/90 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)] w-full max-w-xl overflow-hidden ring-1 ring-white/5">
          
          <div className="p-8 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-5">
              <div className={`p-4 rounded-2xl ${isReady ? 'bg-green-500/20 text-green-400' : 'bg-accent/20 text-accent'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <h4 className="text-xl font-black text-white tracking-tight">
                  {isReady ? 'Update Ready' : isDownloading ? 'Downloading...' : 'Update Available'}
                </h4>
                <p className="text-xs text-accent uppercase tracking-[0.2em] font-bold mt-1 opacity-80">
                  Lokal v{updateState.info?.version || '1.3.0'}
                </p>
              </div>
            </div>
            
            <button 
              onClick={handleDismissUpdate}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-muted hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          <div className="p-8 space-y-6">
            <div className="max-h-[350px] overflow-y-auto pr-4 update-scrollbar">
              {loadingChangelog ? (
                <div className="space-y-4">
                  <div className="h-4 w-full bg-white/5 animate-pulse rounded-lg" />
                  <div className="h-4 w-5/6 bg-white/5 animate-pulse rounded-lg" />
                  <div className="h-4 w-4/6 bg-white/5 animate-pulse rounded-lg" />
                </div>
              ) : (
                <MarkdownLite text={changelog} />
              )}
            </div>

            {isDownloading && (
              <div className="space-y-3 pt-4 border-t border-white/5">
                <div className="flex justify-between text-xs font-bold uppercase tracking-wider">
                  <span className="text-muted">Downloading Package</span>
                  <span className="text-accent">{Math.round(updateState.progress)}%</span>
                </div>
                <div className="h-2.5 bg-white/5 rounded-full overflow-hidden p-[2px]">
                  <div 
                    className="h-full bg-accent rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(var(--accent-rgb),0.6)]"
                    style={{ width: `${updateState.progress}%` }}
                  />
                </div>
              </div>
            )}
            
            <div className="flex gap-3 pt-2">
              {!isDownloading && !isReady && (
                <button
                  onClick={handleStartDownload}
                  className="flex-1 py-4 bg-accent text-white text-sm font-bold rounded-2xl hover:brightness-110 active:scale-[0.98] transition-all"
                >
                  Download Update
                </button>
              )}
              
              {isReady && (
                <button
                  onClick={handleInstallUpdate}
                  className="flex-1 py-4 bg-white text-black text-sm font-black rounded-2xl hover:bg-gray-100 active:scale-[0.98] transition-all uppercase tracking-widest"
                >
                  Restart & Install
                </button>
              )}

              {!isReady && (
                <button
                  onClick={handleDismissUpdate}
                  className="px-6 py-4 bg-white/5 text-white text-sm font-bold rounded-2xl hover:bg-white/10 transition-all"
                >
                  Later
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Router>
      <div className="flex flex-col h-screen bg-base overflow-hidden" onClick={initAudioCtx}>
        {api.isElectron && <TitleBar />}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-base">
            <AnimatedRoutes />
          </main>
          <RightSidebar />
          <QueuePanel />
        </div>
        <PlayerBar />
        {showMiniPlayer && <MiniPlayer />}
        <FullscreenPlayer />
        <LyricsFullscreen />
        <AuthModal />
        <ProfileModal />
        <StatsModal />
        <AddToPlaylistModal />
        
        {!onboardingLoading && showOnboarding && (
          <Onboarding isOpen={showOnboarding} onComplete={completeOnboarding} />
        )}
        
        {renderUpdateToast()}

        <audio
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handlePrimaryDurationChange}
          onEnded={handlePrimaryEnded}
          onPlay={(e) => { if (!isEventFromActive(e)) return; setIsPlaying(true); startTimer() }}
          onPause={(e) => { if (pauseSuppressRef.current) return; if (!isEventFromActive(e)) return; setIsPlaying(false); stopTimer() }}
        />
        <audio 
          ref={cfAudioRef}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleCfDurationChange}
          onEnded={handleCfEnded}
          onPlay={(e) => { if (!isEventFromActive(e)) return; setIsPlaying(true); startTimer() }}
          onPause={(e) => { if (pauseSuppressRef.current) return; if (!isEventFromActive(e)) return; setIsPlaying(false); stopTimer() }}
        />
      </div>
    </Router>
  )
}
