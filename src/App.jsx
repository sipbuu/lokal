import React, { useEffect, useRef, useCallback, useState } from 'react'
import { MemoryRouter as Router, Routes, Route } from 'react-router-dom'
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
import Home from './pages/Home'
import Library from './pages/Library'
import Search from './pages/Search'
import Artist from './pages/Artist'
import Playlist from './pages/Playlist'
import Downloader from './pages/Downloader'
import Settings from './pages/Settings'
import { usePlayerStore, useAppStore } from './store/player'
import { api } from './api'

export default function App() {
  const audioRef = useRef(null)
  const cfAudioRef = useRef(null)
  const gainNodeRef = useRef(null)
  const cfGainNodeRef = useRef(null)
  const audioCtxRef = useRef(null)
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
  } = usePlayerStore()
  const { user } = useAppStore()

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
            progress: data.percent || 0,
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
        f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.4; f.gain.value = 0
        return f
      })

      const cfNodes = bands.map((freq, i) => {
        const f = ctx.createBiquadFilter()
        f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.4
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

      if (isIOS) {
        primarySource.connect(ctx.destination)
        cfSource.connect(ctx.destination)
      } else {
        let prev = primarySource
        for (const n of nodes) { prev.connect(n); prev = n }
        prev.connect(primaryGain)
        primaryGain.connect(ctx.destination)

        let cfPrev = cfSource
        for (const n of cfNodes) { cfPrev.connect(n); cfPrev = n }
        cfPrev.connect(cfGain)
        cfGain.connect(ctx.destination)
      }

      try {
        JSON.parse(localStorage.getItem('lokal-eq') || '[]').forEach((v, i) => {
          if (nodes[i]) nodes[i].gain.value = v
          if (cfNodes[i]) cfNodes[i].gain.value = v
        })
      } catch {}

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
      fadeInEl.play().catch(() => {})

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
        
        setActiveAudioElement(isPrimaryActive ? 'cf' : 'primary')

        justCrossfadedRef.current = true
        isCrossfadingRef.current = false

        pauseSuppressRef.current = true
        try { fadeOutEl.pause() } catch {}
        try { fadeOutEl.src = '' } catch {}
        try { fadeOutEl.currentTime = 0 } catch {}
        setTimeout(() => { pauseSuppressRef.current = false }, 200)

        activeElementRef.current = isPrimaryActive ? 'cf' : 'primary'

        const state = usePlayerStore.getState()
        const nextIdx = state.shuffle ? state.shuffleIndex + 1 : state.queueIndex + 1
        usePlayerStore.setState({
          currentTrack: nextTrack,
          queueIndex: !state.shuffle ? nextIdx : state.queueIndex,
          shuffleIndex: state.shuffle ? nextIdx : state.shuffleIndex,
        })

        if (api.isElectron) api.discordSetActivity(nextTrack, true).catch(() => {})
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
  ? `file://${currentTrack.file_path
      .replace(/\\/g, '/')       
      .split('/')                
      .map(segment => encodeURIComponent(segment)) 
      .join('/')                 
      .replace(/%3A/g, ':')      
    }` 
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

  const renderUpdateToast = () => {
    if (updateState.status === 'idle') return null;

    const isReady = updateState.status === 'ready';
    const isDownloading = updateState.status === 'downloading';
    const isAvailable = updateState.status === 'available';

    return (
      <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] w-full max-w-[440px] px-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
        <div className="bg-elevated/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden ring-1 ring-black/5">
          
          {/* Top Status Bar */}
          <div className="p-4 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${isReady ? 'bg-green-500/20 text-green-400' : 'bg-accent/20 text-accent'}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <h4 className="text-sm font-bold text-white leading-none">
                  {isReady ? 'Ready to Install' : `Version ${updateState.info?.version || ''}`}
                </h4>
                <p className="text-[11px] text-muted mt-1 uppercase tracking-wider font-semibold">
                  {isDownloading ? 'Downloading Update...' : isReady ? 'Restart required' : 'New Update Available'}
                </p>
              </div>
            </div>
            
            <button 
              onClick={handleDismissUpdate}
              className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-muted hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>

          {/* Content Area */}
          <div className="p-4 space-y-4">
            {isDownloading ? (
              <div className="py-2">
                <div className="flex justify-between text-xs mb-2">
                  <span className="text-muted">Progress</span>
                  <span className="text-accent font-mono">{Math.round(updateState.progress)}%</span>
                </div>
                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-accent transition-all duration-300 ease-out shadow-[0_0_10px_rgba(var(--accent-rgb),0.5)]"
                    style={{ width: `${updateState.progress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                  {loadingChangelog ? (
                    <div className="space-y-2 py-2">
                      <div className="h-3 w-3/4 bg-white/5 animate-pulse rounded" />
                      <div className="h-3 w-1/2 bg-white/5 animate-pulse rounded" />
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground leading-relaxed">
                      <pre className="whitespace-pre-wrap font-sans text-[13px] text-white/70">
                        {changelog}
                      </pre>
                    </div>
                  )}
                </div>
                
                <div className="pt-2 flex gap-2">
                  <button
                    onClick={handleInstallUpdate}
                    disabled={!isReady}
                    className="flex-1 py-2.5 bg-white text-black text-sm font-bold rounded-xl hover:bg-gray-200 transition-all disabled:opacity-20 disabled:grayscale"
                  >
                    {isReady ? 'Restart & Update' : 'Waiting for download...'}
                  </button>
                  {isAvailable && !isDownloading && !isReady && (
                    <p className="text-[10px] text-center text-muted italic w-full">Update will download automatically</p>
                  )}
                </div>
              </div>
            )}
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
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/library" element={<Library />} />
              <Route path="/search" element={<Search />} />
              <Route path="/artist/:id" element={<Artist />} />
              <Route path="/playlist/:id" element={<Playlist />} />
              <Route path="/downloader" element={<Downloader />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
          <RightSidebar />
          <QueuePanel />
        </div>
        <PlayerBar />
        <FullscreenPlayer />
        <LyricsFullscreen />
        <AuthModal />
        <ProfileModal />
        <StatsModal />
        <AddToPlaylistModal />
        
        {renderUpdateToast()}

        <audio
          ref={audioRef}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handlePrimaryDurationChange}
          onEnded={handlePrimaryEnded}
          onPlay={() => { setIsPlaying(true); if (usePlayerStore.getState().activeAudioElement === 'primary') startTimer() }}
          onPause={() => { if (pauseSuppressRef.current) return; if (usePlayerStore.getState().activeAudioElement === 'primary') { setIsPlaying(false); stopTimer() } }}
        />
        <audio 
          ref={cfAudioRef}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleCfDurationChange}
          onEnded={handleCfEnded}
          onPlay={() => { setIsPlaying(true); if (usePlayerStore.getState().activeAudioElement === 'cf') startTimer() }}
          onPause={() => { if (pauseSuppressRef.current) return; if (usePlayerStore.getState().activeAudioElement === 'cf') { setIsPlaying(false); stopTimer() } }}
        />
      </div>
    </Router>
  )
}
