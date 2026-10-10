import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useSelection } from '../selection'
import SelectionBar from '../components/SelectionBar'
import { startVideoPreview } from '../videoPreview'
import { deleteVideoDownloads, downloadVideos, updateVideoLibrary } from '../videoActions'

function VideoCard({ item, selected, onSelect, onMenu, onSave, saving, preview }) {
  const [hover, setHover] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const ref = React.useRef(null)
  React.useEffect(() => { setFailed(false) }, [preview])
  React.useEffect(() => {
    const changing = event => { if (event.detail?.trackId === item.track.id || event.detail?.videoId === item.video.videoId) setHover(false) }
    window.addEventListener('lokal:music-video-changing', changing)
    return () => window.removeEventListener('lokal:music-video-changing', changing)
  }, [item.track.id, item.video.videoId])
  React.useEffect(() => {
    const element = ref.current
    if (!element || !hover || !preview) return undefined
    let cleanup = () => {}
    const start = () => { cleanup(); cleanup = startVideoPreview(element) }
    element.addEventListener('loadedmetadata', start, { once: true })
    if (element.readyState >= 1) start()
    return () => { element.removeEventListener('loadedmetadata', start); cleanup(); element.pause(); element.removeAttribute('src'); element.load() }
  }, [hover, preview, failed])
  return <article className={`group min-w-0 ${selected ? 'rounded-xl ring-2 ring-accent/70' : ''}`} onContextMenu={onMenu}>
    <button onClick={onSelect} aria-pressed={selected} aria-label={`Play video: ${item.track.title}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="relative block w-full aspect-video overflow-hidden rounded-xl bg-card border border-border shadow-lg">
      <img src={item.video.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
      {preview && hover && !failed && <video ref={ref} src={preview} muted playsInline preload="metadata" onError={() => setFailed(true)} className="absolute inset-0 w-full h-full object-cover" />}
      <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"><span className="rounded-full p-3 bg-white/90 text-black"><Play size={22} fill="currentColor" /></span></span>
      {item.downloaded && <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-[10px] uppercase tracking-wider text-white">Downloaded</span>}
    </button>
    <div className="flex gap-2 items-center mt-3">
      <div className="min-w-0 flex-1"><button onClick={onSelect} className="block truncate w-full text-left text-sm font-medium text-white hover:text-accent">{item.track.title}</button><p className="truncate text-xs text-muted mt-0.5">{item.track.artist}</p></div>
      {isStreamed(item.track) && <SaveToLibraryButton track={item.track} className="p-1.5" />}
      <button disabled={saving} onClick={onSave} title={item.saved ? 'Remove video from library' : 'Save video to library'} aria-label={item.saved ? 'Remove video from library' : 'Save video to library'} className={`p-1.5 rounded-full hover:bg-elevated disabled:opacity-50 ${item.saved ? 'text-accent' : 'text-muted'}`}>{item.saved ? <Check size={17} /> : <Plus size={17} />}</button>
      <button onClick={onMenu} title="Video actions" aria-label={`Actions for ${item.track.title}`} className="p-1.5 rounded-full text-muted hover:text-text hover:bg-elevated"><MoreHorizontal size={17} /></button>
    </div>
  </article>
}

export default function Videos() {
  const [items, setItems] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [saving, setSaving] = useState(null)
  const busy = useRef(false)
  const loadRevision = useRef(0)
  const jobs = useDownloads(s => s.jobs)
  const menu = useContextMenu()
  usePageReady(loaded)
  const load = useCallback(() => {
    const revision = ++loadRevision.current
    api.musicVideoList().then(rows => {
      if (revision !== loadRevision.current) return
      if (!Array.isArray(rows)) throw new Error(rows?.error || 'Could not load music videos.')
      setItems(rows); setError('')
    }).catch(e => { if (revision === loadRevision.current) setError(e.message) }).finally(() => { if (revision === loadRevision.current) setLoaded(true) })
  }, [])
  useEffect(() => {
    load()
    window.addEventListener('lokal:refresh', load)
    window.addEventListener('lokal:music-video-found', load)
    return () => { loadRevision.current++; window.removeEventListener('lokal:refresh', load); window.removeEventListener('lokal:music-video-found', load) }
  }, [load])
  const completedVideos = jobs.filter(j => j.kind === 'music-video' && j.status === 'done').length
  useEffect(() => { load() }, [completedVideos, load])
  const visible = useMemo(() => items.filter(item => {
    if (filter === 'saved' && !item.saved) return false
    if (filter === 'downloaded' && !item.downloaded) return false
    return `${item.track.title} ${item.track.artist}`.toLowerCase().includes(query.trim().toLowerCase())
  }), [items, filter, query])
  const keys = useMemo(() => visible.map(item => item.track.id), [visible])
  const selection = useSelection(keys)
  const selectedItems = visible.filter(row => selection.has(row.track.id))

  const play = (item, shuffled = false, pool = visible) => {
    if (!item) return
    const state = usePlayerStore.getState()
    // Opening the current video's card must not restart the song.
    if (state.currentTrack?.id !== item.track.id) {
      const rows = shuffled ? pool.slice().sort(() => Math.random() - 0.5) : pool
      const tracks = rows.map(row => row.track)
      state.playQueue(tracks, Math.max(0, tracks.findIndex(t => t.id === item.track.id)), { type: 'videos', name: 'Videos' })
    } else if (!state.isPlaying) state.togglePlay()
    useMusicVideoView.getState().show()
  }
  const runAction = async (rows, action) => {
    if (busy.current || !rows.length) return
    busy.current = true
    setSaving(rows.length === 1 ? rows[0].track.id : 'bulk')
    try {
      const result = await action(rows)
      if (result.errors.length) showToast(`${result.errors.length} video action${result.errors.length === 1 ? '' : 's'} failed. ${result.errors[0]}`)
      useDownloads.getState().load()
      load()
    } catch (e) { showToast(e.message) } finally { busy.current = false; setSaving(null) }
  }
  const saveMany = (rows, saved) => runAction(rows, list => updateVideoLibrary(list, saved, api, (id, value) => setItems(current => current.map(row => row.track.id === id ? { ...row, saved: value } : row))))
  const downloadMany = rows => runAction(rows, list => downloadVideos(list, api))
  const deleteMany = rows => {
    const downloaded = rows.filter(row => row.downloaded)
    if (busy.current || !downloaded.length) return
    const name = downloaded.length === 1 ? `the downloaded video for "${downloaded[0].track.title}"` : `${downloaded.length} downloaded videos`
    if (!window.confirm(`Delete ${name} from disk? This deletes the video files permanently. Your songs, audio files and saved video entries will be kept.`)) return
    return runAction(downloaded, list => deleteVideoDownloads(list, api))
  }
  const save = item => saveMany([item], !item.saved)
  const openMenu = (event, item) => {
    event.preventDefault()
    const keys = selection.contextSelect(item.track.id)
    const chosen = visible.filter(row => keys.includes(String(row.track.id)))
    const tracks = chosen.map(row => row.track)
    menu.open(event, [
    { label: chosen.length > 1 ? 'Play selected videos' : 'Play video', icon: Play, onSelect: () => play(chosen[0] || item, false, chosen) },
    chosen.some(row => !row.saved) && { label: chosen.length > 1 ? 'Save selected videos to library' : 'Save video to library', icon: Plus, disabled: !!saving, onSelect: () => saveMany(chosen.filter(row => !row.saved), true) },
    chosen.some(row => row.saved) && { label: chosen.length > 1 ? 'Remove selected videos from library' : 'Remove video from library', icon: Trash2, disabled: !!saving, onSelect: () => saveMany(chosen.filter(row => row.saved), false) },
    { label: 'Download', icon: Download, disabled: !!saving, onSelect: () => downloadMany(chosen) },
    chosen.some(row => row.downloaded) && { label: 'Delete downloads', icon: Trash2, disabled: !!saving, onSelect: () => deleteMany(chosen) },
    { separator: true },
    { label: 'Play next', icon: Clock, onSelect: () => playNextMany(tracks) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueueMany(tracks) },
    { label: 'Add to playlist…', icon: ListPlus, onSelect: () => addToPlaylistMany(tracks) },
    ])
  }

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
      {visible.map(item => <VideoCard key={item.track.id} item={item} selected={selection.has(item.track.id)} onSelect={event => selection.click(item.track.id, event) || play(item)} onSave={() => save(item)} saving={!!saving} onMenu={event => openMenu(event, item)} preview={item.downloaded && item.video.file ? api.fileURL(item.video.file) : null} />)}
    </div>
    {loaded && !visible.length && <div className="text-center py-16 text-muted"><Clapperboard size={40} className="mx-auto mb-4 opacity-40" /><p>{items.length ? 'No videos match this view.' : 'Your discovered music videos will appear here.'}</p><p className="text-xs mt-2">Play songs to discover videos, or download one from its actions.</p></div>}
    <SelectionBar open={selection.count > 0} label={`${selection.count} selected`} onClear={selection.clear} actions={[
      { label: 'Play videos', icon: Play, onClick: () => play(selectedItems[0], false, selectedItems) },
      { label: 'Play next', icon: Clock, onClick: () => playNextMany(selectedItems.map(row => row.track)) },
      { label: 'Add to queue', icon: ListEnd, onClick: () => addToQueueMany(selectedItems.map(row => row.track)) },
      { label: 'Add to playlist', icon: ListPlus, onClick: () => addToPlaylistMany(selectedItems.map(row => row.track)) },
      { label: 'Save videos', icon: Plus, disabled: !!saving || selectedItems.every(row => row.saved), onClick: () => saveMany(selectedItems.filter(row => !row.saved), true) },
      { label: 'Remove videos', icon: Trash2, disabled: !!saving || selectedItems.every(row => !row.saved), onClick: () => saveMany(selectedItems.filter(row => row.saved), false) },
      { label: 'Download videos', icon: Download, disabled: !!saving, onClick: () => downloadMany(selectedItems) },
      { label: 'Delete downloads', icon: Trash2, disabled: !!saving || selectedItems.every(row => !row.downloaded), onClick: () => deleteMany(selectedItems) },
    ]} />
    <ContextMenu menu={menu} />
  </div>
}
