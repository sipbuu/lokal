// The official music video of the playing song (found and checked by the main
// process: electron/online/musicVideo.js), and whether its player is open.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { api } from './api'
import { usePlayerStore } from './store/player'
import { useDownloads } from './store/downloads'

const lookups = new Map()
const RETRY_MISSING_MS = 10 * 60 * 1000

// How each track's lookup is going ({ stage: 'searching' | 'checking' |
// 'fallback' | 'done', index, total }), from the main process.
const useLookupProgress = create(() => ({}))
let progressBound = false
function bindProgress() {
  if (progressBound) return
  progressBound = true
  api.onMusicVideoProgress?.(p => {
    if (!p?.trackId) return
    useLookupProgress.setState(p.stage === 'done' ? state => { const next = { ...state }; delete next[p.trackId]; return next } : { [p.trackId]: p })
  })
}

/** The track's music video ({ src, segments, ... }) or null; asked once per track. */
export function loadMusicVideo(trackId) {
  if (!trackId) return Promise.resolve(null)
  if (!lookups.has(trackId)) {
    const job = api.musicVideo(trackId).catch(() => null)
    lookups.set(trackId, job)
    job.then(video => {
      if (!video) setTimeout(() => lookups.delete(trackId), RETRY_MISSING_MS)
      else window.dispatchEvent(new Event('lokal:music-video-found'))
    })
  }
  return lookups.get(trackId)
}

/** { video, loading, progress } for a track; optionally cache it for playback. */
export function useMusicVideo(track, enabled = true, prepare = false) {
  const id = enabled ? track?.id : null
  const [state, setState] = useState({ id: null, video: null, pending: false })
  const downloadId = state.id === id ? state.video?.downloadId : null
  const job = useDownloads(s => downloadId ? s.jobs.find(j => j.id === downloadId) : null)
  useEffect(() => {
    if (!id) return undefined
    bindProgress()
    let current = true
    setState({ id, video: null, pending: true })
    loadMusicVideo(id).then(async video => {
      if (!current) return
      if (!video || !prepare) { setState({ id, video, pending: false }); return }
      const cached = await api.musicVideoCache(id).catch(e => ({ error: e.message }))
      if (!current) return
      setState({ id, video: cached?.error ? { ...video, error: cached.error } : cached, pending: !!cached?.downloadId })
      if (cached?.downloadId) useDownloads.getState().load()
    })
    return () => { current = false }
  }, [id, prepare])

  useEffect(() => {
    if (!id || !prepare || !downloadId || !job || ['queued', 'downloading'].includes(job.status)) return undefined
    let current = true
    if (job.status !== 'done') {
      setState(s => ({ ...s, pending: false, video: { ...s.video, error: job.error || 'Music video download cancelled' } }))
      return undefined
    }
    // The job runs independently of this overlay. Re-check the file on completion
    // (and on reopening); don't keep a stale path after cache eviction.
    api.musicVideoCache(id).then(cached => {
      if (current) setState(s => ({ id, video: cached?.error ? { ...s.video, error: cached.error } : cached, pending: !!cached?.downloadId }))
    }).catch(e => {
      if (current) setState(s => ({ ...s, pending: false, video: { ...s.video, error: e.message } }))
    })
    return () => { current = false }
  }, [id, prepare, downloadId, job?.status])
  const progress = useLookupProgress(s => (id ? s[id] : null)) || null
  const mine = !!id && state.id === id
  const downloadProgress = job && ['queued', 'downloading'].includes(job.status)
    ? { stage: job.status === 'queued' ? 'queued' : 'downloading', percent: job.progress }
    : null
  return { video: mine ? state.video : null, loading: !!id && (!mine || state.pending), progress: downloadProgress || (mine && !state.pending ? null : progress) }
}

export const useMusicVideoView = create(set => ({
  open: false,
  mini: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggleMini: () => set(s => ({ mini: !s.mini })),
}))

/** Video time for a song time (seconds); null where the video doesn't have the song. */
export function videoTimeFor(segments, time) {
  const segment = (segments || []).find(s => time >= s.start && (s.end == null || time < s.end))
  return segment ? time + segment.offset : null
}

/** The song's playing position, straight from its audio element when there is one. */
export function songTime() {
  const { audioRef, cfAudioRef, activeAudioElement, progress } = usePlayerStore.getState()
  const audio = (activeAudioElement === 'primary' ? audioRef : cfAudioRef)?.current
  return audio && Number.isFinite(audio.currentTime) ? audio.currentTime : progress
}
