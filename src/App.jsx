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
  const audioRefs = useRef([null, null])
  const currentIndexRef = useRef(0)
  const gainNodeRefs = useRef([null, null])
  const masterGainRef = useRef(null)
  const audioCtxRef = useRef(null)
  const cfActiveRef = useRef(false)
  const playSecsRef = useRef(0)
  const playTimerRef = useRef(null)
  const userRef = useRef(null)
  const currentTrackRef = useRef(null)
  const prevTrackIdRef = useRef(null)
  const artworkCacheRef = useRef({})
  const eqNodesRef = useRef([])

  const [updateState, setUpdateState] = useState({
    status: 'idle',
    info: null,
    progress: 0,
    error: null,
  })

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

  const getActiveAudio = useCallback(() => {
    return audioRefs.current[currentIndexRef.current]?.current
  }, [])

  const {
    currentTrack, isPlaying, volume, repeat,
    autoNext, setProgress, setDuration, setIsPlaying,
    setAudioRef, initLiked, setCrossfade, crossfadeSeconds,
    shuffle, playNext, addToQueue, skipAhead,
  } = usePlayerStore()
  const { user } = useAppStore()

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
  }, [])

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
  }

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
    const activeAudio = getActiveAudio()
    if (activeAudio && typeof navigator.mediaSession.setPositionState === 'function') {
      try {
        navigator.mediaSession.setPositionState({
          duration: activeAudio.duration || 0,
          playbackRate: activeAudio.playbackRate || 1,
          position: activeAudio.currentTime || 0
        })
      } catch {}
    }
    navigator.mediaSession.setActionHandler('play', () => { getActiveAudio()?.play() })
    navigator.mediaSession.setActionHandler('pause', () => { getActiveAudio()?.pause() })
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      const activeAudio = getActiveAudio()
      if (activeAudio && typeof details.seekTime === 'number') activeAudio.currentTime = details.seekTime
    })
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      usePlayerStore.getState().prev()
    })
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      usePlayerStore.getState().next()
    })
  }, [currentTrack, isPlaying, getActiveAudio])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const activeAudio = getActiveAudio()
    if (!activeAudio) return
    const update = () => {
      if (typeof navigator.mediaSession.setPositionState === 'function') {
        try {
          navigator.mediaSession.setPositionState({
            duration: activeAudio.duration || 0,
            playbackRate: activeAudio.playbackRate || 1,
            position: activeAudio.currentTime || 0
          })
        } catch {}
      }
    }
    activeAudio.addEventListener('timeupdate', update)
    return () => activeAudio?.removeEventListener('timeupdate', update)
  }, [getActiveAudio])
  useEffect(() => { userRef.current = user }, [user])
  useEffect(() => { currentTrackRef.current = currentTrack }, [currentTrack])

  useEffect(() => {
    api.getLikedTracks(user?.id).then(t => initLiked((t || []).map(x => x.id)))
  }, [user?.id])

  useEffect(() => {
    const updateAudioRef = () => {
      const activeAudio = audioRefs.current[currentIndexRef.current]
      setAudioRef({ current: activeAudio })
    }
    updateAudioRef()
    api.getSettings().then(s => {
      if (s?.crossfade_seconds) setCrossfade(parseFloat(s.crossfade_seconds) || 0)
    })
  }, [setAudioRef])

  const initAudioCtx = useCallback(() => {
    if (audioCtxRef.current || !audioRefs.current[0] || !audioRefs.current[1]) return
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      audioCtxRef.current = ctx

      const bands = [60, 230, 910, 3600, 14000]
      const eqNodes = bands.map(freq => {
        const f = ctx.createBiquadFilter()
        f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.4; f.gain.value = 0
        return f
      })
      eqNodesRef.current = eqNodes

      const masterGain = ctx.createGain()
      masterGain.gain.value = volume
      masterGainRef.current = masterGain

      let prev = eqNodes[eqNodes.length - 1]
      prev.connect(masterGain)
      masterGain.connect(ctx.destination)

      for (let i = 0; i < 2; i++) {
        const source = ctx.createMediaElementSource(audioRefs.current[i])
        const gainNode = ctx.createGain()
        gainNode.gain.value = 1
        gainNodeRefs.current[i] = gainNode

        let node = source
        for (const eq of eqNodes) {
          node.connect(eq)
          node = eq
        }
        node.connect(gainNode)
        gainNode.connect(masterGain)
      }

      try { JSON.parse(localStorage.getItem('lokal-eq') || '[]').forEach((v, i) => eqNodes[i] && (eqNodes[i].gain.value = v)) } catch {}
      window.__lokaleq = { setGain: (i, v) => eqNodes[i] && (eqNodes[i].gain.value = v) }
    } catch {}
  }, [volume])

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

  const playTrackWithCrossfade = useCallback((nextTrack, isAutoAdvance = false) => {
    if (cfActiveRef.current) return
    if (!audioRefs.current[0] || !audioRefs.current[1] || !nextTrack) return
    
    const ctx = audioCtxRef.current
    if (!ctx) return

    cfActiveRef.current = true
    
    const currentIndex = currentIndexRef.current
    const nextIndex = 1 - currentIndex
    
    const currentAudio = audioRefs.current[currentIndex]
    const nextAudio = audioRefs.current[nextIndex]
    const currentGain = gainNodeRefs.current[currentIndex]
    const nextGain = gainNodeRefs.current[nextIndex]
    
    const encodedPath = nextTrack.file_path
      .replace(/\\/g, '/')
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/')
      .replace(/%3A/g, ':');

    const nextSrc = api.isElectron ? `file://${encodedPath}` : api.streamURL(nextTrack);
    
    nextAudio.src = nextSrc
    nextAudio.volume = 1
    
    const cfSeconds = usePlayerStore.getState().crossfadeSeconds || 3
    const now = ctx.currentTime
    
    nextGain.gain.setValueAtTime(0, now)
    nextGain.gain.linearRampToValueAtTime(1, now + cfSeconds)
    currentGain.gain.setValueAtTime(1, now)
    currentGain.gain.linearRampToValueAtTime(0, now + cfSeconds)
    
    nextAudio.play().then(() => {
      setTimeout(() => {
        currentAudio.pause()
        currentAudio.src = ''
        currentGain.gain.setValueAtTime(1, ctx.currentTime)
        
        currentIndexRef.current = nextIndex
        setAudioRef({ current: nextAudio })
        
        if (isAutoAdvance) {
          flushTime(currentTrackRef.current?.id)
          autoNext()
        }
        
        cfActiveRef.current = false
      }, cfSeconds * 1000)
    }).catch(() => {
      cfActiveRef.current = false
    })
  }, [autoNext, flushTime, setAudioRef])

  const triggerCrossfade = useCallback((nextTrack) => {
    if (cfActiveRef.current) return
    if (!nextTrack) return
    
    playTrackWithCrossfade(nextTrack, true)
  }, [playTrackWithCrossfade])

  useEffect(() => {
    const activeAudio = getActiveAudio()
    if (!activeAudio || !currentTrack) return
    if (cfActiveRef.current) return

    stopTimer(); flushTime(currentTrackRef.current?.id); playSecsRef.current = 0

    const src = api.isElectron 
  ? `file://${currentTrack.file_path
      .replace(/\\/g, '/')       
      .split('/')                
      .map(segment => encodeURIComponent(segment)) 
      .join('/')                 
      .replace(/%3A/g, ':')      
    }` 
  : api.streamURL(currentTrack);
    
    const currentIndex = currentIndexRef.current
    activeAudio.src = src
    
    if (gainNodeRefs.current[currentIndex]) {
      gainNodeRefs.current[currentIndex].gain.value = 1
    }
    
    if (isPlaying) activeAudio.play().catch(() => {})
    if (api.isElectron) api.discordSetActivity(currentTrack, true).catch(() => {})
  }, [currentTrack?.id, getActiveAudio, isPlaying, stopTimer, flushTime])

  useEffect(() => {
    const activeAudio = getActiveAudio()
    if (!activeAudio) return
    if (isPlaying) { activeAudio.play().catch(() => {}); startTimer() }
    else { activeAudio.pause(); stopTimer() }
    if (api.isElectron && currentTrack) api.discordSetActivity(currentTrack, isPlaying).catch(() => {})
  }, [isPlaying, getActiveAudio, currentTrack, startTimer, stopTimer])

  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = volume
    }
  }, [volume])


  const handleTimeUpdate = useCallback((e) => {
    const cur = e.target.currentTime
    const dur = e.target.duration
    setProgress(cur)
    if (!dur || isNaN(dur) || cfActiveRef.current) return

    const state = usePlayerStore.getState()
    const cf = state.crossfadeSeconds || 0
    const remaining = dur - cur

    if (cf > 0.5 && remaining <= cf && remaining > 0) {
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
  }, [triggerCrossfade])

  const renderUpdateToast = () => {
    if (updateState.status === 'idle') return null

    const isReady = updateState.status === 'ready'
    const isDownloading = updateState.status === 'downloading'
    const isAvailable = updateState.status === 'available'

    return (
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-elevated border border-accent/30 rounded-xl px-4 py-3 shadow-xl flex items-center gap-4 min-w-80">
        {isDownloading && (
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-white font-medium">
                Update v{updateState.info?.version || ''} downloading…
              </span>
              <span className="text-xs text-accent">{Math.round(updateState.progress)}%</span>
            </div>
            <div className="h-1 bg-card rounded-full overflow-hidden">
              <div 
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${updateState.progress}%` }}
              />
            </div>
          </div>
        )}
        
        {isAvailable && (
          <span className="text-sm text-white">
            Update v{updateState.info?.version || ''} available…
          </span>
        )}
        
        {isReady && (
          <>
            <span className="text-sm text-white flex-1">
              Update ready — restart to install
            </span>
            <button
              onClick={handleInstallUpdate}
              className="px-3 py-1.5 bg-accent text-white text-xs font-medium rounded-lg hover:bg-accent/80 transition-colors"
            >
              Restart Now
            </button>
          </>
        )}
        
        <button
          onClick={handleDismissUpdate}
          className="text-muted hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    )
  }

  const handleAudioEnded = useCallback(() => {
    stopTimer(); flushTime(currentTrackRef.current?.id)
    if (cfActiveRef.current) return
    const activeAudio = getActiveAudio()
    if (repeat === 'one') { activeAudio.currentTime = 0; activeAudio.play() }
    else autoNext()
  }, [stopTimer, flushTime, getActiveAudio, repeat, autoNext])

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
          ref={el => audioRefs.current[0] = el}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={e => setDuration(e.target.duration)}
          onEnded={handleAudioEnded}
          onPlay={() => { setIsPlaying(true); startTimer() }}
          onPause={() => { setIsPlaying(false); stopTimer() }}
        />
        <audio ref={el => audioRefs.current[1] = el} />
      </div>
    </Router>
  )
}
