import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Music, RefreshCw, ScanLine, Play, Clock, Sparkles, Radio, History } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import { api } from '../api'

function ScanBanner({ onScan }) {
  const [folder, setFolder] = useState('')
  const [progress, setProgress] = useState(null)

  useEffect(() => {
    api.getSettings().then(s => { if (s?.music_folder) setFolder(s.music_folder) })
    const unsub = api.onScanProgress((_, data) => {
      setProgress(data)
      if (data.complete) { onScan?.(); setTimeout(() => setProgress(null), 3000) }
    })
    return () => { if (typeof unsub === 'function') unsub() }
  }, [])

  const scan = async () => {
    let f = folder
    if (api.isElectron) f = (await api.openFolder()) || folder
    if (!f) f = 'C:\\Users\\sipbuu\\Music'
    setFolder(f)
    api.scanFolder(f)
  }

  return (
    <div className="bg-elevated border border-border rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">Music Folder</p>
        <p className="text-xs text-muted mt-0.5 font-display truncate">{folder || 'Not set'}</p>
        {progress && !progress.complete && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-accent">Scanning… {progress.done}/{progress.total} · {progress.skipped || 0} skipped</p>
            <div className="h-0.5 bg-border rounded-full w-48 overflow-hidden">
              <motion.div className="h-full bg-accent rounded-full" animate={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
            </div>
          </div>
        )}
        {progress?.complete && <p className="text-xs text-accent mt-1">✓ {progress.done - (progress.skipped || 0)} tracks indexed</p>}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {folder && (
          <button onClick={() => api.scanFolder(folder).then(onScan)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border text-xs text-muted hover:text-white transition-colors">
            <RefreshCw size={12} /> Rescan
          </button>
        )}
        <button onClick={scan} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-base text-xs font-medium hover:bg-accent/80 transition-colors">
          <ScanLine size={12} /> {folder ? 'Change' : 'Select Folder'}
        </button>
      </div>
    </div>
  )
}

function MixCard({ mix, onClick }) {
  const artSrc = (t) => t.artwork_path
    ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id))
    : null

  const arts = [...new Set(mix.tracks.filter(t => t.artwork_path).map(t => t.artwork_path))].slice(0, 4)

  const getMixTypeLabel = (type) => {
    switch (type) {
      case 'daily': return 'Daily Mix'
      case 'recent': return 'New Arrivals'
      case 'top': return 'Most Played'
      case 'discovery': return 'Discovery'
      default: return type
    }
  }

  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="flex flex-col gap-3 p-3 bg-elevated border border-border rounded-xl hover:border-accent/30 transition-all text-left group"
    >
      <div className="w-full aspect-square rounded-lg overflow-hidden bg-card relative">
        {arts.length === 0 && <div className="w-full h-full flex items-center justify-center text-subtle"><Radio size={36} /></div>}
        {arts.length === 1 && <img src={artSrc({ artwork_path: arts[0] })} className="w-full h-full object-cover" />}
        {arts.length > 1 && (
          <div className="w-full h-full grid grid-cols-2">
            {arts.slice(0, 4).map((art, i) => (
              <img key={i} src={artSrc({ artwork_path: art })} className="w-full h-full object-cover" />
            ))}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-10 h-10 bg-accent rounded-full flex items-center justify-center shadow-xl">
            <Play size={16} fill="currentColor" className="text-base translate-x-0.5" />
          </div>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-white truncate">{mix.name}</p>
        <p className="text-xs text-muted">{mix.tracks.length} tracks · {getMixTypeLabel(mix.type)}</p>
      </div>
    </motion.button>
  )
}

export default function Home() {
  const [recentTracks, setRecentTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [history, setHistory] = useState([])
  const [mixes, setMixes] = useState([])
  const [tab, setTab] = useState('home')
  const nav = useNavigate()
  const { playQueue } = usePlayerStore()
  const { user } = useAppStore()

  const load = () => {
    const uid = user?.id
    api.getTracks({ sort: 'added_at DESC', limit: 10 }).then(t => setRecentTracks(Array.isArray(t) ? t : []))
    api.getArtists().then(a => setArtists((Array.isArray(a) ? a : []).slice(0, 12)))
    api.getSuggestions(uid).then(s => setSuggestions(Array.isArray(s) ? s : []))
    api.getHistory(uid, 30).then(h => setHistory(Array.isArray(h) ? h : []))
    api.getMixes(uid).then(m => setMixes(Array.isArray(m) ? m : []))
  }

  useEffect(() => { load() }, [user?.id])

  const artSrc = (a) => a.image_path ? (api.isElectron ? `file://${a.image_path}` : null) : null
  const trackArt = (t) => t.artwork_path ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id)) : null

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="p-6 space-y-7 max-w-5xl pb-10">
      <div>
        <h1 className="text-2xl font-display text-white">{greeting()}</h1>
        <p className="text-sm text-muted mt-1">Here's what's happening with your music</p>
      </div>

      <ScanBanner onScan={load} />

      <div className="flex gap-1 p-0.5 bg-elevated rounded-lg border border-border w-fit">
        {[['home', 'Home'], ['history', 'History']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-1.5 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'history' ? (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <History size={14} className="text-muted" />
            <h2 className="text-xs font-display text-muted uppercase tracking-widest">Listen History</h2>
          </div>
          {history.length > 0
            ? <TrackList tracks={history} showAlbum />
            : <p className="text-muted text-sm text-center py-12">No listen history yet.</p>
          }
        </section>
      ) : (
        <>
          {artists.length > 0 && (
            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-4">Artists</h2>
              <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
                {artists.map((a, i) => (
                  <motion.button key={a.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i * 0.04, 0.4) }} onClick={() => nav(`/artist/${a.id}`)} className="flex flex-col items-center gap-2 group">
                    <div className="w-full aspect-square rounded-full bg-elevated border border-border overflow-hidden flex items-center justify-center text-muted group-hover:border-accent/40 transition-colors">
                      {artSrc(a) ? <img src={artSrc(a)} className="w-full h-full object-cover" /> : <Music size={22} />}
                    </div>
                    <p className="text-xs text-center truncate w-full text-muted group-hover:text-white transition-colors">{a.name}</p>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {mixes.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Radio size={14} className="text-accent" />
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Your Mixes</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {mixes.slice(0, 6).map(mix => (
                  <MixCard key={mix.id} mix={mix} onClick={() => playQueue(mix.tracks, 0)} />
                ))}
              </div>
            </section>
          )}

          {suggestions.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={14} className="text-accent" />
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Suggested for You</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {suggestions.slice(0, 8).map((t, i) => (
                  <motion.button
                    key={t.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onDoubleClick={() => playQueue(suggestions, i)}
                    className="flex items-center gap-3 p-3 bg-elevated rounded-xl border border-border hover:border-accent/30 transition-all group text-left"
                  >
                    <div className="w-10 h-10 rounded-lg bg-card overflow-hidden flex-shrink-0 flex items-center justify-center text-subtle">
                      {trackArt(t) ? <img src={trackArt(t)} className="w-full h-full object-cover" /> : <Music size={16} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{t.title}</p>
                      <p className="text-xs text-muted truncate">{t.artist}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {recentTracks.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-display text-muted uppercase tracking-widest">Recently Added</h2>
                <button onClick={() => playQueue(recentTracks, 0)} className="text-xs text-accent hover:text-accent/70 font-display uppercase tracking-wider transition-colors">
                  Play All
                </button>
              </div>
              <TrackList tracks={recentTracks} />
            </section>
          )}

          {!recentTracks.length && !artists.length && (
            <div className="text-center py-24 text-muted">
              <Music size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-medium">No tracks yet</p>
              <p className="text-sm mt-1 opacity-60">Scan your music folder above.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
