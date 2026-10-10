import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Clapperboard, Play, Shuffle, Search, Plus, Check, MoreHorizontal, Clock, ListEnd, ListPlus, Download, Trash2 } from 'lucide-react'
import { api } from '../api'
import { usePageReady } from '../pageCache'
import { usePlayerStore } from '../store/player'
import { useMusicVideoView } from '../musicVideo'
import { useDownloads } from '../store/downloads'
import { addToPlaylistMany, addToQueueMany, playNextMany } from '../trackActions'
import { isStreamed } from '../onlineTracks'
import SaveToLibraryButton from '../components/SaveToLibraryButton'
import ContextMenu, { useContextMenu } from '../components/ContextMenu'
import { showToast } from '../components/Toaster'

export default function Videos() {
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(null)
  const jobs = useDownloads(s => s.jobs)
  const menu = useContextMenu()
  usePageReady(loaded)
  const load = useCallback(() => {
    api.musicVideoList().then(rows => { setItems(Array.isArray(rows) ? rows : []); setError('') })
      .catch(e => setError(e.message)).finally(() => setLoaded(true))
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('lokal:refresh', load)
    window.addEventListener('lokal:music-video-found', load)
    return () => { window.removeEventListener('lokal:refresh', load); window.removeEventListener('lokal:music-video-found', load) }
  }, [load])
  const completedVideos = jobs.filter(j => j.kind === 'music-video' && j.status === 'done').length
  useEffect(() => { load() }, [completedVideos, load])
  const visible = useMemo(() => items.filter(item => {
    if (filter === 'saved' && !item.saved) return false
    if (filter === 'downloaded' && !item.downloaded) return false
    return `${item.track.title} ${item.track.artist}`.toLowerCase().includes(query.trim().toLowerCase())
  }), [items, filter, query])

  const play = (item, shuffled = false) => {
    if (!item) return
    const state = usePlayerStore.getState()
    // Opening the current video's card must not restart the song.
    if (state.currentTrack?.id !== item.track.id) {
      const rows = shuffled ? visible.slice().sort(() => Math.random() - 0.5) : visible
      const tracks = rows.map(row => row.track)
      state.playQueue(tracks, Math.max(0, tracks.findIndex(t => t.id === item.track.id)), { type: 'videos', name: 'Videos' })
    } else if (!state.isPlaying) state.togglePlay()
    useMusicVideoView.getState().show()
  }
  const save = async item => {
    if (saving) return
    setSaving(item.track.id)
    try {
      const result = await api.musicVideoSave(item.track.id, !item.saved)
      if (result?.error) throw new Error(result.error)
      setItems(rows => rows.map(row => row.track.id === item.track.id ? { ...row, saved: result.saved } : row))
      if (result.saved && !item.downloaded) {
        const downloaded = await api.musicVideoDownload(item.track.id)
        if (downloaded?.error) showToast(downloaded.error)
        useDownloads.getState().load()
      }
    } catch (e) { showToast(e.message) } finally { setSaving(null) }
  }
  const openMenu = (event, item) => menu.open(event, [
    { label: 'Play video', icon: Play, onSelect: () => play(item) },
    { label: item.saved ? 'Remove video from library' : 'Save video to library', icon: item.saved ? Trash2 : Plus, onSelect: () => save(item) },
    { label: 'Download', icon: Download, onSelect: async () => {
      const result = await api.musicVideoDownload(item.track.id).catch(e => ({ error: e.message }))
      if (result?.error) showToast(result.error)
      useDownloads.getState().load()
    } },
    ...(item.downloaded ? [{ label: 'Delete download', icon: Trash2, onSelect: async () => {
      const result = await api.musicVideoDeleteDownload(item.track.id).catch(e => ({ error: e.message }))
      if (result?.error) showToast(result.error)
      else { load(); useDownloads.getState().load() }
    } }] : []),
    { separator: true },
    { label: 'Play next', icon: Clock, onSelect: () => playNextMany([item.track]) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueueMany([item.track]) },
    { label: 'Add to playlist…', icon: ListPlus, onSelect: () => addToPlaylistMany([item.track]) },
  ])

  return <div className="p-6 space-y-6 max-w-7xl mx-auto pb-10">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-[0.2em] text-muted mb-2">Your music, in motion</p><h1 className="text-3xl font-display text-white">Videos</h1><p className="text-sm text-muted mt-2">{items.length} music videos · Save your favorites and play them from your Videos folder.</p></div>
      <div className="flex gap-2">
        <button disabled={!visible.length} onClick={() => play(visible[0])} className="inline-flex items-center gap-2 rounded-full px-4 py-2 bg-accent text-base disabled:opacity-40"><Play size={15} fill="currentColor" />Play</button>
        <button disabled={!visible.length} onClick={() => play(visible[Math.floor(Math.random() * visible.length)], true)} className="inline-flex items-center gap-2 rounded-full px-4 py-2 border border-border text-text disabled:opacity-40"><Shuffle size={15} />Shuffle</button>
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Video collection" className="flex gap-1 p-1 rounded-lg bg-elevated border border-border">
        {[['all', 'All Videos'], ['saved', 'Saved'], ['downloaded', 'Downloaded']].map(([id, label]) => <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id} className={`px-3 py-1.5 rounded-md text-xs ${filter === id ? 'bg-accent text-base' : 'text-muted hover:text-text'}`}>{label}</button>)}
      </div>
      <label className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2"><Search size={14} className="text-muted" /><input aria-label="Search videos" placeholder="Search videos" value={query} onChange={e => setQuery(e.target.value)} className="bg-transparent outline-none text-sm text-text w-44" /></label>
    </div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 @2xl:grid-cols-4 gap-x-5 gap-y-7">
      {visible.map(item => <article key={item.track.id} className="group min-w-0" onContextMenu={e => openMenu(e, item)}>
        <button onClick={() => play(item)} aria-label={`Play video: ${item.track.title}`} className="relative block w-full aspect-video overflow-hidden rounded-xl bg-card border border-border shadow-lg">
          <img src={item.video.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"><span className="rounded-full p-3 bg-white/90 text-black"><Play size={22} fill="currentColor" /></span></span>
          {item.downloaded && <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[10px] uppercase tracking-wider text-white">Downloaded</span>}
        </button>
        <div className="flex gap-2 items-center mt-3">
          <div className="min-w-0 flex-1"><button onClick={() => play(item)} className="block truncate w-full text-left text-sm font-medium text-white hover:text-accent">{item.track.title}</button><p className="truncate text-xs text-muted mt-0.5">{item.track.artist}</p></div>
          {isStreamed(item.track) && <SaveToLibraryButton track={item.track} className="p-1.5" />}
          <button disabled={saving === item.track.id} onClick={() => save(item)} title={item.saved ? 'Remove video from library' : 'Save video to library'} aria-label={item.saved ? 'Remove video from library' : 'Save video to library'} className={`p-1.5 rounded-full hover:bg-elevated disabled:opacity-50 ${item.saved ? 'text-accent' : 'text-muted'}`}>{item.saved ? <Check size={17} /> : <Plus size={17} />}</button>
          <button onClick={e => openMenu(e, item)} title="Video actions" aria-label={`Actions for ${item.track.title}`} className="p-1.5 rounded-full text-muted hover:text-text hover:bg-elevated"><MoreHorizontal size={17} /></button>
        </div>
      </article>)}
    </div>
    {loaded && !visible.length && <div className="text-center py-16 text-muted"><Clapperboard size={40} className="mx-auto mb-4 opacity-40" /><p>{items.length ? 'No videos match this view.' : 'Your discovered music videos will appear here.'}</p><p className="text-xs mt-2">Play songs to discover videos, or use Settings → Library → Index Music Videos.</p></div>}
    <ContextMenu menu={menu} />
  </div>
}
