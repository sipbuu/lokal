// The official music video of the playing song (found and checked by the main
// process: electron/online/musicVideo.js), and whether its player is open.
import { useEffect, useRef, useState } from 'react'
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
    useLookupProgress.setState(p.stage === 'done' && !p.message ? state => { const next = { ...state }; delete next[p.trackId]; return next } : { [p.trackId]: p })
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

export function useMusicVideo(track, enabled = true, prepare = false) {
  const id = enabled ? track?.id : null
  const [state, setState] = useState({ id: null, video: null, pending: false })
  const [revision, setRevision] = useState(0)
  const request = useRef(0)
  const downloadId = state.id === id ? state.video?.downloadId : null
  const job = useDownloads(s => downloadId ? s.jobs.find(j => j.id === downloadId) : null)
  useEffect(() => {
    if (!id) return undefined
    const changing = event => {
      if (event.detail?.trackId !== id && (!event.detail?.videoId || event.detail.videoId !== state.video?.videoId)) return
      request.current++
      setState(current => ({ ...current, pending: false, video: current.video ? { ...current.video, file: null, src: null, downloadId: null, needsDownload: true } : null }))
    }
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('lokal:music-video-changing', changing)
    window.addEventListener('lokal:refresh', refresh)
    return () => { window.removeEventListener('lokal:music-video-changing', changing); window.removeEventListener('lokal:refresh', refresh) }
  }, [id, state.video?.videoId])
  useEffect(() => {
    if (!id) return undefined
    bindProgress()
    let current = true
    const token = ++request.current
    setState({ id, video: null, pending: true })
    loadMusicVideo(id).then(async video => {
      if (!current || token !== request.current) return
      if (!video || !prepare) { setState({ id, video, pending: false }); return }
      const prepared = await api.musicVideoPrepare(id).catch(e => ({ error: e.message }))
      if (!current || token !== request.current) return
      setState({ id, video: prepared?.error ? { ...video, error: prepared.error } : prepared, pending: !!prepared?.downloadId })
      if (prepared?.downloadId) useDownloads.getState().load()
    })
    return () => { current = false }
  }, [id, prepare, revision])

  useEffect(() => {
    if (!id || !prepare || !downloadId || !job || ['queued', 'downloading'].includes(job.status)) return undefined
    let current = true
    const token = request.current
    if (job.status !== 'done') {
      setState(s => ({ ...s, pending: false, video: { ...s.video, downloadId: null, needsDownload: true, error: job.error || 'Music video download cancelled' } }))
      return undefined
    }
    api.musicVideoPrepare(id).then(prepared => {
      if (current && token === request.current) setState(s => ({ id, video: prepared?.error ? { ...s.video, error: prepared.error } : prepared, pending: !!prepared?.downloadId }))
    }).catch(e => {
      if (current && token === request.current) setState(s => ({ ...s, pending: false, video: { ...s.video, error: e.message } }))
    })
    return () => { current = false }
  }, [id, prepare, downloadId, job?.status])
  const progress = useLookupProgress(s => (id ? s[id] : null)) || null
  const mine = !!id && state.id === id
  const downloadProgress = job && ['queued', 'downloading'].includes(job.status)
    ? { stage: job.status === 'queued' ? 'queued' : 'downloading', percent: job.progress }
    : null
  const download = async () => {
    if (!id || state.pending) return
    const token = ++request.current
    setState(current => ({ ...current, pending: true }))
    const result = await api.musicVideoDownload(id).catch(error => ({ error: error.message }))
    if (token !== request.current) return
    setState(current => ({ id, video: result?.error ? { ...current.video, error: result.error } : result, pending: !!result?.downloadId }))
    if (result?.downloadId) useDownloads.getState().load()
  }
  return { video: mine ? state.video : null, loading: !!id && (!mine || state.pending), progress: downloadProgress || (progress?.message ? progress : mine && !state.pending ? null : progress), download }
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
