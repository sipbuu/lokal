import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { CalendarDays, ChevronDown, ChevronUp, Clock, Disc3, History, ListEnd, ListPlus, Music, Play, Plus, Radio, RefreshCw, Sparkles, User } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import FadeImg from '../components/FadeImg'
import SectionSwap from '../components/SectionSwap'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { plural } from '../plural'
import ContextMenu, { useContextMenu } from '../components/ContextMenu'
import { showToast } from '../components/Toaster'
import { addToPlaylistMany, addToQueueMany, playNextMany, saveAsPlaylist } from '../trackActions'
import { artistPath } from '../releaseActions'
import ProviderConnections from '../components/ProviderConnections'
import { trackArtURL } from '../onlineTracks'
import { openRadio } from '../radioActions'
import { songKey, sourceName, playableRecommendation, resolveRecommendationTracks, buildRecommendationMix, loadRecommendationPage } from '../recommendations'

const today = () => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
const mixTitle = (mix) => (mix.type === 'artist' ? `${mix.name} Mix` : mix.name)

function secureImage(value) {
  const url = String(value || '').trim()
  if (!url || /2a96cbd8b46e442fc41c2b86b821562f/i.test(url)) return ''
  return url.replace(/^http:\/\//i, 'https://')
}

function relativeAge(timestamp) {
  const value = Number(timestamp) || 0
  if (!value) return 'Unknown time'
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - value)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`
  return `${Math.floor(seconds / 604800)} weeks ago`
}

function dateLabel(timestamp) {
  const value = Number(timestamp) || 0
  if (!value) return 'Unknown date'
  return new Date(value * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function MixCard({ mix, onClick, onSave, saving, onContextMenu }) {
  const arts = [...new Map(mix.tracks.map(track => [trackArtURL(track), track]).filter(([art]) => art)).values()].slice(0, 4)
  return (
    <motion.div whileHover={{ scale: 1.03 }} className="relative group" onContextMenu={onContextMenu}>
      <motion.button whileTap={{ scale: 0.98 }} onClick={onClick} className="w-full flex flex-col gap-3 p-3 bg-elevated border border-border rounded-xl hover:border-accent/30 transition-all text-left">
        <div className="w-full aspect-square rounded-lg overflow-hidden bg-card relative">
          {arts.length === 0 && <div className="w-full h-full flex items-center justify-center text-subtle"><Radio size={36} /></div>}
          {arts.length === 1 && <FadeImg src={trackArtURL(arts[0])} className="w-full h-full object-cover" />}
          {arts.length > 1 && <div className="w-full h-full grid grid-cols-2">{arts.map((track, index) => <FadeImg key={index} src={trackArtURL(track)} className="w-full h-full object-cover" />)}</div>}
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"><div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center shadow-xl"><Play size={16} fill="currentColor" className="text-base translate-x-0.5" /></div></div>
        </div>
        <div><p className="text-sm font-medium text-white truncate">{mix.name}</p><p className="text-xs text-muted">{plural(mix.tracks.length, 'track')} · {mixTitle(mix)}</p></div>
      </motion.button>
      <button onClick={onSave} disabled={saving} title="Save as playlist" aria-label={`Save ${mixTitle(mix)} as a playlist`} className={`absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white/85 backdrop-blur transition-all hover:bg-black/80 hover:text-accent focus:opacity-100 ${saving ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {saving ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" /> : <ListPlus size={15} />}
      </button>
    </motion.div>
  )
}

function SectionHeader({ icon: Icon, eyebrow, title, count, subtitle, onExpand, expanded, action }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-display uppercase tracking-[0.24em] text-muted">{eyebrow}</p>}
        <div className="flex items-center gap-2"><Icon size={15} className="text-accent" /><h2 className="text-xl font-medium text-white">{title}</h2>{count != null && <span className="text-sm text-muted">{count}</span>}</div>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {(onExpand || action) && <div className="flex shrink-0 items-center gap-3">{action}{onExpand && <button type="button" onClick={onExpand} className="inline-flex items-center gap-1 text-xs text-muted hover:text-white">{expanded ? 'Show less' : 'See all'}{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>}</div>}
    </div>
  )
}

function DiscoveryTrack({ track, onPlay, onRadio, onContextMenu }) {
  const artwork = trackArtURL(track) || secureImage(track?.artwork_url)
  return (
    <div onContextMenu={event => onContextMenu?.(event, track)} className="group flex min-w-0 items-center gap-1 rounded-xl p-2 transition-colors hover:bg-white/[0.06]">
      <button type="button" onClick={() => onPlay(track)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-card">{artwork ? <FadeImg src={artwork} className="h-full w-full object-cover" /> : <Music size={17} className="m-4 text-muted" />}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-white">{track.title}</p><p className="truncate text-xs text-muted">{track.artist}{track.scrobbleCount ? ` · ${track.scrobbleCount} this week` : ''}</p></div>
      </button>
      {onRadio && <button type="button" aria-label={`Start radio for ${track.title}`} onClick={() => onRadio(track)} className="rounded-full p-2 text-muted opacity-0 transition-opacity hover:text-accent group-hover:opacity-100" title="Start radio"><Radio size={14} /></button>}
    </div>
  )
}

function ArtistRecommendation({ artist, onClick, onContextMenu }) {
  const image = secureImage(artist?.image)
  return <button type="button" onClick={() => onClick(artist)} onContextMenu={event => onContextMenu?.(event, artist)} className="group min-w-0 text-center"><div className="mx-auto aspect-square w-full max-w-28 overflow-hidden rounded-full bg-card ring-1 ring-white/10 transition-transform group-hover:scale-105">{image ? <FadeImg src={image} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center bg-accent/20 text-2xl font-medium text-accent">{artist.name.charAt(0)}</div>}</div><p className="mt-2 truncate text-sm text-white">{artist.name}</p><p className="text-xs text-muted">Start artist radio</p></button>
}

function AlbumRecommendation({ album, onClick }) {
  const image = secureImage(album?.artwork_url)
  return <button type="button" onClick={() => onClick(album)} className="group min-w-0 text-left"><div className="relative aspect-square overflow-hidden rounded-xl bg-card">{image ? <FadeImg src={image} className="h-full w-full object-cover transition-transform group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-muted"><Disc3 size={30} /></div>}<span className="absolute bottom-2 right-2 rounded-full bg-black/65 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100"><Radio size={13} /></span></div><p className="mt-2 truncate text-sm font-medium text-white">{album.title}</p><p className="truncate text-xs text-muted">{album.artist}</p></button>
}

function ScrobbleHistory({ entries, onPlay, compact = false }) {
  const groups = []
  const byDate = new Map()
  for (const entry of Array.isArray(entries) ? entries : []) {
    const timestamp = Number(entry?.scrobbledAt || entry?.played_at) || 0
    const date = dateLabel(timestamp)
    if (!byDate.has(date)) { const group = { date, entries: [] }; byDate.set(date, group); groups.push(group) }
    byDate.get(date).entries.push(entry)
  }
  if (compact) {
    return <div className="grid grid-cols-2 gap-3 @md:grid-cols-3 @lg:grid-cols-6">{(entries || []).slice(0, 6).map((entry, index) => { const track = entry.track || entry; return <button key={`${songKey(track)}-${entry.scrobbledAt || entry.played_at || index}`} onClick={() => onPlay(entry)} className="min-w-0 text-left"><div className="aspect-square overflow-hidden rounded-xl bg-card">{trackArtURL(track) ? <FadeImg src={trackArtURL(track)} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><Music size={28} /></div>}</div><p className="mt-2 truncate text-sm font-medium text-white">{track.title}</p><p className="truncate text-xs text-muted">{track.artist}</p><p className="mt-1 text-[11px] text-muted/70">{relativeAge(entry.scrobbledAt || entry.played_at)}</p></button> })}</div>
  }
  return <div className="space-y-6">{groups.map(group => <section key={group.date}><div className="mb-2 flex items-center gap-2 text-xs font-display uppercase tracking-widest text-muted"><CalendarDays size={14} />{group.date}</div><div className="overflow-hidden rounded-xl border border-border bg-elevated"><div className="grid grid-cols-[minmax(0,1fr)_9rem_7rem] gap-3 border-b border-border px-4 py-2 text-[10px] font-display uppercase tracking-widest text-muted"><span>Track</span><span>Scrobbled</span><span>Age</span></div>{group.entries.map((entry, index) => { const track = entry.track || entry; return <button key={`${songKey(track)}-${entry.scrobbledAt || entry.played_at || index}`} onClick={() => onPlay(entry)} className="grid w-full grid-cols-[minmax(0,1fr)_9rem_7rem] items-center gap-3 border-b border-border/60 px-4 py-3 text-left last:border-0 hover:bg-card"><span className="min-w-0"><span className="block truncate text-sm text-white">{track.title}</span><span className="block truncate text-xs text-muted">{track.artist}</span></span><span className="text-xs text-muted">{new Date((Number(entry.scrobbledAt || entry.played_at) || 0) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className="text-xs text-muted">{relativeAge(entry.scrobbledAt || entry.played_at)}</span></button> })}</div></section>)}</div>
}

function RecommendationSections({ data, source: selectedSource, loading, error, onRefresh, onPlay, onTrackMenu, onRadio, onArtistRadio, onArtistMenu, onAlbumRadio, onSave, saving, onSeeHistory, onOpenSettings, showRefresh = false }) {
  const [expanded, setExpanded] = useState({ quick: false, albums: false, artists: false, fresh: false })
  const source = sourceName(selectedSource)
  const quick = Array.isArray(data?.quickPicks) ? data.quickPicks : []
  const history = Array.isArray(data?.history) ? data.history : []
  const albums = Array.isArray(data?.albums) ? data.albums : []
  const artists = Array.isArray(data?.artists) ? data.artists : []
  const fresh = Array.isArray(data?.freshFinds) ? data.freshFinds : []
  const toggle = key => setExpanded(current => ({ ...current, [key]: !current[key] }))
  return <div className="space-y-10">
    {showRefresh && <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Sparkles size={15} className="text-accent" /><h2 className="text-xs font-display uppercase tracking-widest text-muted">Discovery · {source}</h2></div><p className="mt-1 text-sm text-muted">Recommendations come directly from your selected provider.</p></div><button onClick={onRefresh} disabled={loading} className="inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/70 disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Refresh</button></div>}
    {error && <p role="status" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    {!data && (loading
      ? <p className="py-10 text-center text-sm text-muted">Building your {source} recommendations…</p>
      : <div className="rounded-xl border border-border bg-elevated p-4"><ProviderConnections compact onOpenSettings={onOpenSettings} /></div>)}
    {data && !quick.length && !history.length && !albums.length && !artists.length && !fresh.length && <p className="py-10 text-center text-sm text-muted">No {source} recommendations are available yet.</p>}
    {quick.length > 0 && <section><SectionHeader icon={Sparkles} eyebrow="Jump back in" title="Quick Picks" count={quick.length} subtitle={selectedSource === 'youtube' ? 'Picks from your YouTube Music account.' : 'Tracks you scrobbled most often over the past week.'} onExpand={() => toggle('quick')} expanded={expanded.quick} /><div className="grid gap-2 @md:grid-cols-2 @lg:grid-cols-3">{(expanded.quick ? quick : quick.slice(0, 6)).map(track => <DiscoveryTrack key={songKey(track)} track={track} onPlay={onPlay} onRadio={onRadio} onContextMenu={onTrackMenu} />)}</div></section>}
    {history.length > 0 && <section><SectionHeader icon={History} eyebrow="History" title="Continue Listening" count={history.length} onExpand={onSeeHistory} /><ScrobbleHistory entries={history} onPlay={onPlay} compact /></section>}
    {albums.length > 0 && <section><SectionHeader icon={Disc3} eyebrow="Rotation" title="Albums For You" count={albums.length} onExpand={() => toggle('albums')} expanded={expanded.albums} /><div className="grid grid-cols-2 gap-4 @md:grid-cols-3 @lg:grid-cols-6">{(expanded.albums ? albums : albums.slice(0, 6)).map(album => <AlbumRecommendation key={`${album.artist}-${album.title}`} album={album} onClick={onAlbumRadio} />)}</div></section>}
    {artists.length > 0 && <section><SectionHeader icon={User} eyebrow="For You" title="Artists For You" count={artists.length} onExpand={() => toggle('artists')} expanded={expanded.artists} /><div className="grid grid-cols-3 gap-4 @sm:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-8">{(expanded.artists ? artists : artists.slice(0, 8)).map(artist => <ArtistRecommendation key={artist.name} artist={artist} onClick={onArtistRadio} onContextMenu={onArtistMenu} />)}</div></section>}
    {fresh.length > 0 && <section><SectionHeader icon={Music} eyebrow="Fresh Finds" title="Fresh Finds" count={fresh.length} subtitle={`More music from ${source}.`} onExpand={() => toggle('fresh')} expanded={expanded.fresh} action={<button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/70 disabled:opacity-50"><ListPlus size={13} />{saving ? 'Saving…' : 'Save'}</button>} /><div className="rounded-xl border border-border bg-elevated p-3">{(expanded.fresh ? fresh : fresh.slice(0, 6)).map(track => <DiscoveryTrack key={songKey(track)} track={track} onPlay={onPlay} onRadio={onRadio} onContextMenu={onTrackMenu} />)}</div></section>}
  </div>
}

function MixPanel({ tracks, source, size, generating, error, saving, onSize, onGenerate, onPlay, onSave }) {
  return <div className="space-y-7">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="flex items-center gap-2 text-xs font-display uppercase tracking-widest text-muted"><Radio size={14} className="text-accent" />Mix</h2><p className="mt-1 text-sm text-muted">A fresh {sourceName(source)} mix from your account recommendations.</p></div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1 rounded-lg bg-card p-1">{[24, 32, 40].map(value => <button key={value} type="button" onClick={() => onSize(value)} disabled={generating} className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${size === value ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>{value}</button>)}</div>
        <button onClick={() => onGenerate(size)} disabled={generating} className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-base disabled:opacity-50"><RefreshCw size={14} className={generating ? 'animate-spin' : ''} />{generating ? 'Refreshing…' : 'Regenerate'}</button>
      </div>
    </div>
    {error && <p role="status" className="rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    {tracks.length > 0 ? <section className="rounded-xl border border-border bg-elevated p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-medium text-white">Your {tracks.length}-track mix</p><p className="mt-0.5 text-xs text-muted">Sampled from a fresh {sourceName(source)} recommendation pool.</p></div>
        <div className="flex gap-2">
          <button onClick={() => onPlay(tracks)} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs text-black"><Play size={13} fill="currentColor" />Play mix</button>
          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted hover:text-white disabled:opacity-50"><ListPlus size={13} />Save</button>
        </div>
      </div>
      <TrackList tracks={tracks} reduceMotion />
    </section> : <p className="rounded-xl border border-border bg-elevated px-4 py-10 text-center text-sm text-muted">Choose a size and regenerate to build a {sourceName(source)} mix.</p>}
  </div>
}

export default function Home() {
  const { user } = useAppStore()
  return <HomeContent key={user?.id || 'guest'} user={user} />
}

function HomeContent({ user }) {
  const uidKey = user?.id || 'guest'
  const [recentTracks, setRecentTracks] = useCachedState(`home:recent:${uidKey}`, [])
  const [suggestions, setSuggestions] = useCachedState(`home:suggestions:${uidKey}`, [])
  const [localHistory, setLocalHistory] = useCachedState(`home:history:${uidKey}`, [])
  const [mixes, setMixes] = useCachedState(`home:mixes:${uidKey}`, [])
  const [discovery, setDiscovery] = useState(null)
  const [mixLab, setMixLab] = useState({ size: 32, tracks: [] })
  const [loaded, setLoaded, wasCached] = useCachedState(`home:loaded:${uidKey}`, false)
  usePageReady(loaded || wasCached)
  const location = useLocation()
  const [tab, setTab] = useState(() => ['history', 'discovery', 'mixlab'].includes(location.state?.tab) ? location.state.tab : 'home')
  const { playQueue } = usePlayerStore()
  const navigate = useNavigate()
  const menu = useContextMenu()
  const [saving, setSaving] = useState(null)
  const [discoveryLoading, setDiscoveryLoading] = useState(false)
  const [discoveryError, setDiscoveryError] = useState('')
  const [mixGenerating, setMixGenerating] = useState(false)
  const [mixError, setMixError] = useState('')
  const [recommendationSource, setRecommendationSource] = useState('lastfm')
  const discoveryRequestRef = useRef(0)
  const discoveryPageRef = useRef(0)
  const mixPageRef = useRef(0)
  const discoveryRef = useRef(null)
  const mixRequestRef = useRef(0)
  const mixBusyRef = useRef(false)
  const playRequestRef = useRef(0)
  const accountRef = useRef('')
  const saveBusyRef = useRef(false)

  const saveList = async (key, name, items, description) => {
    if (saveBusyRef.current) return
    saveBusyRef.current = true
    setSaving(key)
    try {
      const tracks = typeof items === 'function' ? await items() : items
      if (!tracks.length) { showToast('No playable matches were found.'); return }
      const playlist = await saveAsPlaylist(name, tracks, { userId: user?.id, description })
      showToast(playlist ? `Saved "${name}" (${plural(new Set(tracks.map(t => t.id)).size, 'song')})` : 'Could not create playlist')
    } catch { showToast('Could not create playlist') }
    finally { saveBusyRef.current = false; setSaving(null) }
  }
  const saveMix = mix => saveList(`mix:${mix.id}`, `${mixTitle(mix)} - ${today()}`, mix.tracks, `Your ${mixTitle(mix)} from Home`)

  const playRecommendation = async (entry, context = 'recommendations') => {
    const request = ++playRequestRef.current
    const track = entry?.track || entry
    if (!track) return
    if (playableRecommendation(track)) {
      playQueue([track], 0, { type: context, id: track.id, name: context })
      return
    }
    const [resolved] = await resolveRecommendationTracks([track], api, { isCurrent: () => request === playRequestRef.current })
    if (request !== playRequestRef.current) return
    if (resolved?.id) playQueue([resolved], 0, { type: context, id: resolved.id, name: context })
    else showToast(`No matching playback source was found for ${track.title}.`)
  }

  const startRadio = async seed => {
    if (!seed) return
    await openRadio(navigate, seed, user?.id)
  }

  const load = () => {
    const uid = user?.id
    const soft = promise => Promise.resolve(promise).catch(() => null)
    Promise.all([
      soft(api.getTracks({ sort: 'added_at DESC', limit: 10 })),
      soft(api.getSuggestions(uid)),
      soft(api.getHistory(uid, 100)),
      soft(api.getMixes(uid)),
    ]).then(([tracks, suggested, history, userMixes]) => {
      const nonGhost = items => (Array.isArray(items) ? items.filter(item => !String(item?.file_path || '').startsWith('ghost://')) : [])
      if (Array.isArray(tracks)) setRecentTracks(nonGhost(tracks))
      if (Array.isArray(suggested)) setSuggestions(nonGhost(suggested))
      if (Array.isArray(history)) setLocalHistory(history.map(entry => ({ ...entry, scrobbledAt: entry.played_at })))
      if (Array.isArray(userMixes)) setMixes(userMixes.map(mix => ({ ...mix, tracks: nonGhost(mix.tracks) })).filter(mix => mix.tracks.length > 0))
      if ([tracks, suggested, history, userMixes].every(Array.isArray)) setLoaded(true)
    })
  }

  const loadDiscovery = async (force = false) => {
    const requestId = ++discoveryRequestRef.current
    setDiscoveryLoading(true)
    setDiscoveryError('')
    try {
      const settings = await api.getSettings()
      if (!settings || settings.error) throw new Error(settings?.error || 'Could not read recommendation settings.')
      if (requestId !== discoveryRequestRef.current) return null
      const source = settings?.recommendation_source === 'youtube' ? 'youtube' : 'lastfm'
      const account = `${source}:${source === 'lastfm' ? settings.lastfm_username || '' : settings.yt_cookie_header || ''}:${settings.lastfm_enabled}`
      if (accountRef.current !== account) {
        accountRef.current = account
        discoveryRef.current = null
        discoveryPageRef.current = 0
        mixPageRef.current = 0
        setDiscovery(null)
        ++mixRequestRef.current
        ++playRequestRef.current
        mixBusyRef.current = false
        setMixGenerating(false)
        setMixLab(prev => ({ size: prev.size, tracks: [] }))
        setMixError('')
      }
      setRecommendationSource(source)
      const previous = discoveryRef.current
      const page = force && previous ? ++discoveryPageRef.current : discoveryPageRef.current
      const providerData = await loadRecommendationPage(source, page, api)
      if (requestId !== discoveryRequestRef.current) return null
      if (!providerData || providerData.error) throw new Error(providerData?.error || 'Recommendation provider unavailable.')
      const section = key => Array.isArray(providerData[key]) ? providerData[key] : previous?.[key] || []
      const next = {
        ...providerData, source, updatedAt: Date.now(),
        quickPicks: section('quickPicks'), history: section('history'),
        albums: section('albums').slice(0, 30), artists: section('artists').slice(0, 30),
        freshFinds: section('freshFinds').slice(0, 30),
      }
      discoveryRef.current = next
      setDiscovery(next)
      if (providerData.warnings?.length) setDiscoveryError(`Some ${sourceName(source)} sections could not refresh. ${providerData.warnings[0]}`)
      return next
    } catch (error) {
      if (requestId === discoveryRequestRef.current) setDiscoveryError(error.message || 'Could not refresh recommendations.')
      return null
    } finally {
      if (requestId === discoveryRequestRef.current) setDiscoveryLoading(false)
    }
  }

  const generateMix = async requestedSize => {
    const target = Number(requestedSize || mixLab?.size) || 32
    if (mixBusyRef.current) return
    mixBusyRef.current = true
    const requestId = ++mixRequestRef.current
    setMixGenerating(true)
    setMixError('')
    try {
      const settings = await api.getSettings()
      if (requestId !== mixRequestRef.current) return
      if (!settings || settings.error) throw new Error(settings?.error || 'Could not read settings.')
      const source = settings.recommendation_source === 'youtube' ? 'youtube' : 'lastfm'
      const isCurrent = () => requestId === mixRequestRef.current
      const tracks = await buildRecommendationMix({
        size: target,
        previous: mixLab.source === source ? mixLab?.tracks || [] : [],
        loadPage: () => loadRecommendationPage(source, ++mixPageRef.current, api),
        resolve: tracks => resolveRecommendationTracks(tracks, api, { isCurrent }),
        isCurrent,
      })
      if (requestId !== mixRequestRef.current) return
      setMixLab({ size: target, tracks, source })
    } catch (error) {
      if (requestId === mixRequestRef.current) setMixError(error?.message || 'Could not build a new recommendation mix.')
    } finally {
      if (requestId === mixRequestRef.current) { mixBusyRef.current = false; setMixGenerating(false) }
    }
  }

  useEffect(() => { load() }, [user?.id])
  useEffect(() => { loadDiscovery(); return () => { discoveryRequestRef.current++; mixRequestRef.current++; playRequestRef.current++ } }, [user?.id])
  useEffect(() => {
    const refresh = () => { load(); loadDiscovery(true) }
    const settingsChanged = () => {
      mixRequestRef.current++
      playRequestRef.current++
      mixBusyRef.current = false
      setMixGenerating(false)
      loadDiscovery(true)
    }
    window.addEventListener('lokal:refresh', refresh)
    window.addEventListener('lokal:settings-saved', settingsChanged)
    return () => { window.removeEventListener('lokal:refresh', refresh); window.removeEventListener('lokal:settings-saved', settingsChanged) }
  }, [user?.id])

  const data = discovery
  const recommendationTracks = data?.freshFinds || []
  const historyEntries = recommendationSource === 'lastfm' ? data?.history || [] : localHistory
  const openMixMenu = (event, mix) => menu.open(event, [
    { label: 'Play', icon: Play, onSelect: () => playQueue(mix.tracks, 0) },
    { label: 'Play next', icon: Clock, onSelect: () => playNextMany(mix.tracks) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueueMany(mix.tracks) },
    { label: 'Add to playlist…', icon: Plus, onSelect: () => addToPlaylistMany(mix.tracks) },
    { separator: true },
    { label: 'Save as playlist', icon: ListPlus, onSelect: () => saveMix(mix), disabled: !!saving },
  ])
  const openArtistMenu = (event, artist) => menu.open(event, [
    { label: 'Start artist radio', icon: Radio, onSelect: () => startRadio({ artist: artist.name, type: 'artist' }) },
    { label: 'Go to artist', icon: User, onSelect: () => navigate(artistPath(artist.name)) },
  ])
  const withRecommendation = async (track, action) => {
    const account = accountRef.current
    const [resolved] = await resolveRecommendationTracks([track], api, { isCurrent: () => account === accountRef.current })
    if (account !== accountRef.current) return
    if (resolved) action([resolved])
    else showToast(`No matching playback source was found for ${track.title}.`)
  }
  const openTrackMenu = (event, track) => menu.open(event, [
    { label: 'Play', icon: Play, onSelect: () => playRecommendation(track) },
    { label: 'Play next', icon: Clock, onSelect: () => withRecommendation(track, playNextMany) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => withRecommendation(track, addToQueueMany) },
    { label: 'Add to playlist…', icon: Plus, onSelect: () => withRecommendation(track, addToPlaylistMany) },
    { label: 'Start radio', icon: Radio, onSelect: () => startRadio(track) },
  ])
  const saveRecommendations = () => {
    const account = accountRef.current
    return saveList('recommendations', `Fresh Finds - ${today()}`, () => resolveRecommendationTracks(recommendationTracks, api, { isCurrent: () => account === accountRef.current }), `Recommendations from ${sourceName(recommendationSource)}`)
  }
  const sectionProps = {
    data, source: recommendationSource, loading: discoveryLoading, error: discoveryError,
    onRefresh: () => loadDiscovery(true), onPlay: playRecommendation, onTrackMenu: openTrackMenu,
    onRadio: startRadio, onArtistMenu: openArtistMenu,
    onArtistRadio: artist => startRadio({ artist: artist.name, type: 'artist' }),
    onAlbumRadio: album => startRadio({ title: album.title, artist: album.artist, type: 'album' }),
    onSave: saveRecommendations, saving: !!saving, onSeeHistory: () => setTab('history'),
    onOpenSettings: () => navigate('/settings', { state: { category: 'integrations' } }),
  }
  const localHome = <>
    {mixes.length > 0 && <section><div className="flex items-center gap-2 mb-4"><Radio size={14} className="text-accent" /><h2 className="text-xs font-display text-muted uppercase tracking-widest">Your Mixes</h2></div><div className="grid grid-cols-2 @md:grid-cols-3 gap-3">{mixes.slice(0, 6).map(mix => <MixCard key={mix.id} mix={mix} onClick={() => playQueue(mix.tracks, 0)} onSave={() => saveMix(mix)} saving={saving === `mix:${mix.id}`} onContextMenu={event => openMixMenu(event, mix)} />)}</div></section>}
    {suggestions.length > 0 && <section><div className="flex items-center gap-2 mb-4"><Sparkles size={14} className="text-accent" /><h2 className="text-xs font-display text-muted uppercase tracking-widest">Suggested for You</h2><button onClick={() => saveList('suggestions', `Suggested for You - ${today()}`, suggestions, 'Suggested for you on Home')} disabled={!!saving} className="ml-auto inline-flex items-center gap-1 text-xs text-accent disabled:opacity-50"><ListPlus size={13} />Save as playlist</button></div><TrackList tracks={suggestions.slice(0, 8)} reduceMotion /></section>}
    {recentTracks.length > 0 && <section><div className="flex items-center justify-between mb-4"><h2 className="text-xs font-display text-muted uppercase tracking-widest">Recently Added</h2><button onClick={() => playQueue(recentTracks, 0)} className="text-xs text-accent hover:text-accent/70">Play All</button></div><TrackList tracks={recentTracks} reduceMotion /></section>}
    {loaded && !recentTracks.length && !suggestions.length && !mixes.length && <p className="py-10 text-center text-sm text-muted">No local tracks yet. Pick your music folder in Library.</p>}
  </>

  return <div className="p-6 space-y-7 w-full max-w-6xl mx-auto pb-10">
    <div><h1 className="text-2xl font-display text-white">{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}</h1><p className="text-sm text-muted mt-1">Recommendations and listening history from {recommendationSource === 'youtube' ? 'YouTube Music' : 'Last.fm'}</p></div>
    <div className="flex gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">{[['home', 'Home'], ['discovery', 'Discovery'], ['mixlab', 'Mix'], ['history', 'History']].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>{label}</button>)}</div>
    <SectionSwap id={tab} className="space-y-10">
      {tab === 'history' ? <section>
        <SectionHeader icon={History} eyebrow="History" title={recommendationSource === 'lastfm' ? 'Scrobbles' : 'Listening History'} count={historyEntries.length} subtitle={recommendationSource === 'lastfm' ? 'Your last 100 Last.fm scrobbles, grouped by date.' : 'Your last 100 local listening events, grouped by date.'} />
        {discoveryError && <p role="status" className="mb-4 text-sm text-red-200">{discoveryError}</p>}
        {historyEntries.length ? <ScrobbleHistory entries={historyEntries} onPlay={entry => playRecommendation(entry, 'history')} /> : <p className="py-10 text-center text-sm text-muted">{discoveryLoading ? 'Loading history…' : 'No listening history available.'}</p>}
      </section>
        : tab === 'mixlab' ? <MixPanel tracks={mixLab?.tracks || []} source={mixLab.source || recommendationSource} size={Number(mixLab?.size) || 32} error={mixError} generating={mixGenerating} saving={!!saving} onSize={size => setMixLab(prev => ({ ...prev, size }))} onGenerate={generateMix} onPlay={tracks => playQueue(tracks, 0, { type: 'mix', name: `${sourceName(mixLab.source || recommendationSource)} Mix` })} onSave={() => saveList('mixlab', `Mix - ${today()}`, mixLab?.tracks || [], `${sourceName(mixLab.source || recommendationSource)} recommendation Mix`)} />
        : tab === 'discovery' ? <RecommendationSections {...sectionProps} showRefresh />
        : <><RecommendationSections {...sectionProps} />{localHome}</>
      }
    </SectionSwap>
    <ContextMenu menu={menu} />
  </div>
}
