import { create } from 'zustand'

function loadQueue() {
  try {
    const data = localStorage.getItem('lokal-queue')
    if (!data) return null
    const parsed = JSON.parse(data)

    if (Array.isArray(parsed.queue)) {
      return {
        ...parsed,
        isPlaying: false,
        progress: 0,
        duration: 0,
        audioRef: null,
        cfAudioRef: null,
      }
    }
  } catch (e) {
    console.error('Failed to load queue from localStorage', e)
  }
  return null
}

function loadUser() {
  try { return JSON.parse(localStorage.getItem('lokal-user') || 'null') } catch { return null }
}


function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

const savedQueueState = loadQueue()

export const usePlayerStore = create((set, get) => ({
  queue: [], queueIndex: -1, currentTrack: null,
  isPlaying: false, progress: 0, duration: 0,
  volume: parseFloat(localStorage.getItem('lokal-volume') || '0.8'),
  shuffle: false, repeat: 'none',
  showLyrics: false, showLyricsFullscreen: false,
  showRightSidebar: false, showFullscreen: false, showQueue: false,
  audioRef: null, cfAudioRef: null, crossfadeSeconds: 0, _fetchingRelated: false,
  activeAudioElement: 'primary',

  originalQueue: [], 
  shuffleQueue: [], 
  shuffleIndex: -1, 
  playHistory: [], 
  futureHistory: [], 
  wasShuffled: false, 

  ...(savedQueueState || {}),

  setAudioRef: (ref) => set({ audioRef: ref }),
  setCfAudioRef: (ref) => set({ cfAudioRef: ref }),
  setActiveAudioElement: (el) => set({ activeAudioElement: el }),
  setFetchingRelated: (v) => set({ _fetchingRelated: v }),
  appendRelated: (tracks) => {
    const { queue } = get()
    const ids = new Set(queue.map(t => t.id))
    const fresh = tracks.filter(t => !ids.has(t.id))
    if (fresh.length) set({ queue: [...queue, ...fresh] })
  },

  initShuffleQueue: (tracks, currentIndex) => {
    const currentTrack = tracks[currentIndex]
    const otherTracks = tracks.filter((_, i) => i !== currentIndex)
    const shuffled = shuffleArray(otherTracks)
    const shuffleQueue = currentTrack ? [currentTrack, ...shuffled] : shuffled
    const shuffleIndex = 0
    
    set({ 
      shuffleQueue, 
      shuffleIndex, 
      originalQueue: tracks,
      wasShuffled: true,
      playHistory: currentTrack ? [currentTrack.id] : [],
      futureHistory: []
    })
  },

  disableShuffle: () => {
    const { originalQueue, currentTrack, playHistory } = get()
    if (!originalQueue.length || !currentTrack) {
      set({ shuffle: false, shuffleQueue: [], shuffleIndex: -1, wasShuffled: false })
      return
    }
    
    const newIndex = originalQueue.findIndex(t => t.id === currentTrack.id)
    set({ 
      shuffle: false, 
      queue: originalQueue,
      queueIndex: newIndex >= 0 ? newIndex : 0,
      shuffleQueue: [], 
      shuffleIndex: -1,
      wasShuffled: false 
    })
  },

  enableShuffle: () => {
    const { queue, currentTrack, queueIndex } = get()
    if (!queue.length) {
      set({ shuffle: true })
      return
    }
    
    const currentIndex = queueIndex >= 0 ? queueIndex : 0
    get().initShuffleQueue(queue, currentIndex)
    set({ shuffle: true })
  },

  toggleShuffle: () => {
    const { shuffle, enableShuffle, disableShuffle } = get()
    if (shuffle) {
      disableShuffle()
    } else {
      enableShuffle()
    }
  },

  playTrack: (track, queue = null) => {
    const q = queue || get().queue
    const idx = Math.max(q.findIndex(t => t.id === track.id), 0)
    
    if (get().shuffle) {
      get().initShuffleQueue(q, idx)
    }
    
    set({ 
      currentTrack: track, 
      queue: q, 
      queueIndex: idx, 
      isPlaying: true, 
      playHistory: [track.id],
      futureHistory: []
    })
  },

  playQueue: (tracks, startIndex = 0) => {
    if (!tracks?.length) return
    
    const startTrack = tracks[startIndex]
    
    if (get().shuffle) {
      get().initShuffleQueue(tracks, startIndex)
    }
    
    set({ 
      queue: tracks, 
      queueIndex: startIndex, 
      currentTrack: startTrack, 
      isPlaying: true,
      playHistory: startTrack ? [startTrack.id] : [],
      futureHistory: []
    })
  },

  togglePlay: () => {
    const { audioRef, cfAudioRef, activeAudioElement, isPlaying } = get()
    const activeRef = activeAudioElement === 'primary' ? audioRef : cfAudioRef
    if (!activeRef?.current) return
    isPlaying ? activeRef.current.pause() : activeRef.current.play()
    set({ isPlaying: !isPlaying })
  },

  next: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, repeat, futureHistory, playHistory } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      let nextIdx = shuffleIndex + 1
      
      if (nextIdx < shuffleQueue.length) {
        const nextTrack = shuffleQueue[nextIdx]
        const newHistory = [...playHistory, nextTrack.id]
        set({ 
          shuffleIndex: nextIdx,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: newHistory,
          futureHistory: []
        })
      } else if (repeat === 'all') {
        const otherTracks = shuffleQueue.filter((_, i) => i !== shuffleIndex)
        const reshuffled = shuffleArray(otherTracks)
        const current = shuffleQueue[shuffleIndex]
        const newShuffleQueue = [current, ...reshuffled]
        const nextTrack = newShuffleQueue[0]
        set({
          shuffleQueue: newShuffleQueue,
          shuffleIndex: 0,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: [nextTrack.id],
          futureHistory: []
        })
      }
      return
    }
    
    
    if (!queue.length) return
    let idx
    if (queueIndex < queue.length - 1) idx = queueIndex + 1
    else if (repeat === 'all') idx = 0
    else return
    
    const nextTrack = queue[idx]
    const newHistory = [...playHistory, nextTrack.id]
    set({ 
      queueIndex: idx, 
      currentTrack: nextTrack, 
      isPlaying: true,
      playHistory: newHistory,
      futureHistory: []
    })
  },

  autoNext: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, repeat, playHistory } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      let nextIdx = shuffleIndex + 1
      
      if (nextIdx < shuffleQueue.length) {
        const nextTrack = shuffleQueue[nextIdx]
        const newHistory = [...playHistory, nextTrack.id]
        set({ 
          shuffleIndex: nextIdx,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: newHistory,
          futureHistory: []
        })
      } else if (repeat === 'all') {
        const current = shuffleQueue[shuffleIndex]
        const otherTracks = shuffleQueue.filter((_, i) => i !== shuffleIndex)
        const reshuffled = shuffleArray(otherTracks)
        const newShuffleQueue = [current, ...reshuffled]
        const nextTrack = newShuffleQueue[0]
        set({
          shuffleQueue: newShuffleQueue,
          shuffleIndex: 0,
          currentTrack: nextTrack,
          queueIndex: queue.findIndex(t => t.id === nextTrack.id),
          isPlaying: true,
          playHistory: [nextTrack.id],
          futureHistory: []
        })
      }
      return
    }
    
    if (!queue.length) return
    let idx
    if (queueIndex < queue.length - 1) idx = queueIndex + 1
    else if (repeat === 'all') idx = 0
    else return
    
    const nextTrack = queue[idx]
    const newHistory = [...playHistory, nextTrack.id]
    set({ 
      queueIndex: idx, 
      currentTrack: nextTrack, 
      isPlaying: true,
      playHistory: newHistory,
      futureHistory: []
    })
  },

  prev: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, progress, audioRef, playHistory, futureHistory } = get()
    
    if (progress > 3 && audioRef?.current) {
      audioRef.current.currentTime = 0
      return
    }
    
    if (playHistory.length > 1) {
      const newHistory = [...playHistory]
      newHistory.pop() 
      const prevTrackId = newHistory[newHistory.length - 1]
      
      let prevTrack = null
      let prevIndex = -1
      
      if (shuffle && shuffleQueue.length > 0) {
        prevTrack = shuffleQueue.find(t => t.id === prevTrackId)
        prevIndex = shuffleQueue.findIndex(t => t.id === prevTrackId)
      }
      
      if (!prevTrack) {
        prevTrack = queue.find(t => t.id === prevTrackId)
        prevIndex = queue.findIndex(t => t.id === prevTrackId)
      }
      
      if (prevTrack) {
        const currentId = shuffle && shuffleQueue[shuffleIndex]?.id 
          ? shuffleQueue[shuffleIndex].id 
          : queue[queueIndex]?.id
        
        const newFuture = [...futureHistory, currentId].slice(-20) 
        
        if (shuffle) {
          set({ 
            shuffleIndex: prevIndex,
            currentTrack: prevTrack,
            queueIndex: queue.findIndex(t => t.id === prevTrack.id),
            isPlaying: true,
            playHistory: newHistory,
            futureHistory: newFuture
          })
        } else {
          set({ 
            queueIndex: prevIndex, 
            currentTrack: prevTrack, 
            isPlaying: true,
            playHistory: newHistory,
            futureHistory: newFuture
          })
        }
        return
      }
    }
    if (queueIndex > 0) {
      const prevTrack = queue[queueIndex - 1]
      const newHistory = [...playHistory, prevTrack.id]
      set({ queueIndex: queueIndex - 1, currentTrack: prevTrack, isPlaying: true, playHistory: newHistory })
    }
  },

  skipAhead: () => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, playHistory, futureHistory, repeat } = get()
    
    const playedIds = new Set([...playHistory, ...futureHistory])
    
    let candidates = []
    
    if (shuffle && shuffleQueue.length > 0) {
      candidates = shuffleQueue.filter((t, i) => i !== shuffleIndex && !playedIds.has(t.id))
      
      if (candidates.length === 0 && repeat === 'all') {
        const current = shuffleQueue[shuffleIndex]
        const remaining = shuffleQueue.filter((t, i) => i !== shuffleIndex)
        const reshuffled = shuffleArray(remaining)
        candidates = reshuffled
      }
    } else {
      candidates = queue.filter((t, i) => i !== queueIndex && !playedIds.has(t.id))
      
      if (candidates.length === 0 && repeat === 'all') {
        candidates = queue.filter((t, i) => i !== queueIndex)
      }
    }
    
    if (candidates.length === 0) return
    
    const randomTrack = candidates[Math.floor(Math.random() * candidates.length)]
    
    const currentId = shuffle && shuffleQueue[shuffleIndex]?.id 
      ? shuffleQueue[shuffleIndex].id 
      : queue[queueIndex]?.id
    
    const newFuture = [...futureHistory, currentId].slice(-20)
    const newHistory = [...playHistory, randomTrack.id]
    
    if (shuffle) {
      const newShuffleIndex = shuffleQueue.findIndex(t => t.id === randomTrack.id)
      set({
        shuffleIndex: newShuffleIndex >= 0 ? newShuffleIndex : shuffleIndex,
        currentTrack: randomTrack,
        queueIndex: queue.findIndex(t => t.id === randomTrack.id),
        isPlaying: true,
        playHistory: newHistory,
        futureHistory: newFuture
      })
    } else {
      const newQueueIndex = queue.findIndex(t => t.id === randomTrack.id)
      set({
        queueIndex: newQueueIndex >= 0 ? newQueueIndex : queueIndex,
        currentTrack: randomTrack,
        isPlaying: true,
        playHistory: newHistory,
        futureHistory: newFuture
      })
    }
  },

  playNext: (track) => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      const newShuffleQueue = [...shuffleQueue]
      newShuffleQueue.splice(shuffleIndex + 1, 0, track)
      set({ shuffleQueue: newShuffleQueue })
    } else {
      const newQueue = [...queue]
      newQueue.splice(queueIndex + 1, 0, track)
      set({ queue: newQueue })
    }
  },

  addToQueue: (track) => {
    const { shuffle, shuffleQueue, queue } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      set({ shuffleQueue: [...shuffleQueue, track] })
    } else {
      set({ queue: [...queue, track] })
    }
  },

  reorderQueue: (fromIndex, toIndex) => {
    const { shuffle, queue, queueIndex } = get()
    if (shuffle) return
    
    const newQueue = [...queue]
    const [removed] = newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, removed)
    
    let newCurrentIndex = queueIndex
    if (fromIndex === queueIndex) {
      newCurrentIndex = toIndex
    } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
      newCurrentIndex--
    } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
      newCurrentIndex++
    }
    
    set({ queue: newQueue, queueIndex: newCurrentIndex })
  },

  removeFromQueue: (trackId) => {
    const { shuffle, shuffleQueue, shuffleIndex, queue, queueIndex, currentTrack } = get()
    
    if (shuffle && shuffleQueue.length > 0) {
      const idx = shuffleQueue.findIndex(t => t.id === trackId)
      if (idx === shuffleIndex) return 
      const newShuffleQueue = shuffleQueue.filter(t => t.id !== trackId)
      const newShuffleIndex = idx < shuffleIndex ? shuffleIndex - 1 : shuffleIndex
      set({ shuffleQueue: newShuffleQueue, shuffleIndex: newShuffleIndex })
    } else {
      const idx = queue.findIndex(t => t.id === trackId)
      if (idx === queueIndex) return 
      const newQueue = queue.filter(t => t.id !== trackId)
      const newQueueIndex = idx < queueIndex ? queueIndex - 1 : queueIndex
      set({ queue: newQueue, queueIndex: newQueueIndex })
    }
  },

  setProgress: (v) => set({ progress: v }),
  setDuration: (v) => set({ duration: v }),
  setVolume: (v) => { localStorage.setItem('lokal-volume', String(v)); set({ volume: v }) },
  toggleRepeat: () => set(s => ({ repeat: s.repeat === 'none' ? 'all' : s.repeat === 'all' ? 'one' : 'none' })),
  toggleLyrics: () => set(s => ({ showLyrics: !s.showLyrics })),
  toggleLyricsFullscreen: () => set(s => ({ showLyricsFullscreen: !s.showLyricsFullscreen })),
  toggleRightSidebar: () => set(s => ({ showRightSidebar: !s.showRightSidebar })),
  toggleFullscreen: () => set(s => ({ showFullscreen: !s.showFullscreen })),
  toggleQueue: () => set(s => ({ showQueue: !s.showQueue })),
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCrossfade: (v) => set({ crossfadeSeconds: v }),

  sleepTimerMinutes: 0,
  sleepTimerEndTime: null,
  sleepTimerInterval: null,
  setSleepTimer: (minutes) => {
    const { sleepTimerInterval } = get()
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval)
    }
    
    if (minutes <= 0) {
      set({ sleepTimerMinutes: 0, sleepTimerEndTime: null, sleepTimerInterval: null })
      return
    }
    
    const endTime = Date.now() + (minutes * 60 * 1000)
    const interval = setInterval(() => {
      const { sleepTimerEndTime, isPlaying } = get()
      if (!sleepTimerEndTime) return
      
      if (Date.now() >= sleepTimerEndTime) {
        const { audioRef, cfAudioRef, activeAudioElement } = get()
        const activeRef = activeAudioElement === 'primary' ? audioRef : cfAudioRef
        if (activeRef?.current) {
          activeRef.current.pause()
        }
        set({ isPlaying: false, sleepTimerMinutes: 0, sleepTimerEndTime: null, sleepTimerInterval: null })
        clearInterval(interval)
      }
    }, 1000)
    
    set({ sleepTimerMinutes: minutes, sleepTimerEndTime: endTime, sleepTimerInterval: interval })
  },
  cancelSleepTimer: () => {
    const { sleepTimerInterval } = get()
    if (sleepTimerInterval) {
      clearInterval(sleepTimerInterval)
    }
    set({ sleepTimerMinutes: 0, sleepTimerEndTime: null, sleepTimerInterval: null })
  },

  likedIds: new Set(),
  setLiked: (id, liked) => set(s => {
    const next = new Set(s.likedIds)
    liked ? next.add(id) : next.delete(id)
    return { likedIds: next }
  }),
  initLiked: (ids) => set({ likedIds: new Set(ids) }),
}))

export const useAppStore = create((set, get) => ({
  user: loadUser(),
  showAuthModal: false, authMode: 'login',
  showCreatePlaylistModal: false,
  showProfileModal: false,
  showStatsModal: false,
  showAlbumsModal: false,
  selectedAlbum: null,
  addToPlaylistTrack: null,
  addToPlaylistTrackIds: [],

  setUser: (user) => set({ user }),
  logout: () => { set({ user: null }); localStorage.removeItem('lokal-user') },
  openAuth: (mode = 'login') => set({ showAuthModal: true, authMode: mode }),
  closeAuth: () => set({ showAuthModal: false }),
  openCreatePlaylist: () => set({ showCreatePlaylistModal: true }),
  closeCreatePlaylist: () => set({ showCreatePlaylistModal: false }),
  openProfile: () => set({ showProfileModal: true }),
  closeProfile: () => set({ showProfileModal: false }),
  openStats: () => set({ showStatsModal: true }),
  closeStats: () => set({ showStatsModal: false }),
  openAlbums: (album = null) => set({ showAlbumsModal: true, selectedAlbum: album }),
  closeAlbums: () => set({ showAlbumsModal: false, selectedAlbum: null }),
  openAddToPlaylist: (track) => set({ addToPlaylistTrack: track, addToPlaylistTrackIds: [track.id] }),
  openAddMultipleToPlaylist: (trackIds) => set({ addToPlaylistTrack: null, addToPlaylistTrackIds: trackIds }),
  closeAddToPlaylist: () => set({ addToPlaylistTrack: null, addToPlaylistTrackIds: [] }),
}))

usePlayerStore.subscribe((state) => {
  const {
    queue, queueIndex, currentTrack, shuffle, repeat, shuffleQueue,
    shuffleIndex, playHistory, futureHistory, wasShuffled, originalQueue,
  } = state

  const dataToSave = {
    queue, queueIndex, currentTrack, shuffle, repeat, shuffleQueue,
    shuffleIndex, playHistory, futureHistory, wasShuffled, originalQueue,
  }

  try {
    localStorage.setItem('lokal-queue', JSON.stringify(dataToSave))
  } catch (e) {
    console.error('Failed to save queue to localStorage', e)
  }
})
