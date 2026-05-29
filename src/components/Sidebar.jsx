import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Search, Library, Download, Plus, Music, Heart, Settings, LogIn, LogOut, BarChart2, Disc3, User } from 'lucide-react'
import { useAppStore, usePlayerStore } from '../store/player'
import { api } from '../api'
import PlaylistCover from './PlaylistCover'

const NAV = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Search, label: 'Search', path: '/search' },
  { icon: Library, label: 'Library', path: '/library' },
  { icon: Download, label: 'Download', path: '/downloader' },
  { icon: BarChart2, label: 'Recap', path: '/recap' },
  { icon: Settings, label: 'Settings', path: '/settings' },
]

function periodEnd(period) {
  if (period.scope === 'year') return new Date(period.year + 1, 0, 1)
  if (period.scope === 'quarter') return new Date(period.year, period.quarter * 3, 1)
  return new Date()
}

function getCompletedRecapPeriods() {
  const now = new Date()
  const year = now.getFullYear()
  const periods = []
  for (let y = year; y >= year - 3; y -= 1) {
    const yearly = { id: `year-${y}`, scope: 'year', year: y }
    if (periodEnd(yearly) <= now) periods.push({ ...yearly, completedAt: periodEnd(yearly).getTime() })
  }
  for (let y = year; y >= year - 2; y -= 1) {
    for (let q = 4; q >= 1; q -= 1) {
      const quarterly = { id: `q${q}-${y}`, scope: 'quarter', year: y, quarter: q }
      if (periodEnd(quarterly) <= now) periods.push({ ...quarterly, completedAt: periodEnd(quarterly).getTime() })
    }
  }
  return periods.sort((left, right) => right.completedAt - left.completedAt)
}

export default function Sidebar() {
  const nav = useNavigate()
  const loc = useLocation()
  const [playlists, setPlaylists] = useState([])
  const [showNewPlaylist, setShowNewPlaylist] = useState(false)
  const [newPlName, setNewPlName] = useState('')
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [showRecapBadge, setShowRecapBadge] = useState(false)
  
  const { user, openAuth, logout, openStats } = useAppStore()

  const { currentTrack } = usePlayerStore()
  const navItems = user
    ? [{ icon: User, label: 'Profile', path: '/profile' }, ...NAV]
    : NAV

  const loadPlaylists = () => {
    api.getPlaylists(user?.id).then(p => setPlaylists(Array.isArray(p) ? p : []))
  }

  useEffect(() => { loadPlaylists() }, [user?.id])

  useEffect(() => {
    const handler = () => loadPlaylists();
    const createdHandler = (e) => {
      loadPlaylists();
      const pl = e?.detail?.playlistId;
      if (pl) nav(`/playlist/${pl}`);
    };

    window.addEventListener('lokal:playlist-created', createdHandler);
    window.addEventListener('lokal:playlists-changed', handler);
    window.addEventListener('lokal:playlist-deleted', handler);
    window.addEventListener('lokal:playlist-updated', handler);
    window.addEventListener('lokal:refresh', handler);

    return () => {
      window.removeEventListener('lokal:playlist-created', createdHandler);
      window.removeEventListener('lokal:playlists-changed', handler);
      window.removeEventListener('lokal:playlist-deleted', handler);
      window.removeEventListener('lokal:playlist-updated', handler);
      window.removeEventListener('lokal:refresh', handler);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!confirmSignOut) return
    const timer = setTimeout(() => setConfirmSignOut(false), 2500)
    return () => clearTimeout(timer)
  }, [confirmSignOut])

  useEffect(() => {
    setConfirmSignOut(false)
  }, [user?.id])

  useEffect(() => {
    let alive = true
    const syncRecapBadge = async () => {
      let latest = ''
      for (const period of getCompletedRecapPeriods()) {
        try {
          const recap = await api.getListeningRecap(user?.id || 'guest', period)
          if (recap?.totalPlays > 0) {
            latest = period.id
            localStorage.setItem('lokal-recap-latest-completed', latest)
            break
          }
        } catch {}
      }
      if (!alive) return
      const viewed = localStorage.getItem('lokal-recap-last-viewed') || ''
      setShowRecapBadge(Boolean(latest && latest !== viewed))
    }
    syncRecapBadge()
    window.addEventListener('storage', syncRecapBadge)
    window.addEventListener('lokal:recap-viewed', syncRecapBadge)
    window.addEventListener('lokal:recap-periods-changed', syncRecapBadge)
    return () => {
      window.removeEventListener('storage', syncRecapBadge)
      window.removeEventListener('lokal:recap-viewed', syncRecapBadge)
      window.removeEventListener('lokal:recap-periods-changed', syncRecapBadge)
      alive = false
    }
  }, [user?.id])

  const createPlaylist = async () => {
    if (!newPlName.trim()) return

    const pl = await api.createPlaylist(newPlName.trim(), user?.id)

    if (pl?.id) {
      window.dispatchEvent(
        new CustomEvent('lokal:playlists-changed', {
          detail: { playlistId: pl.id, action: 'created' }
        })
      )

      nav(`/playlist/${pl.id}`)
    }

    setNewPlName('')
    setShowNewPlaylist(false)
  }

  const handleSignOut = () => {
    if (!confirmSignOut) {
      setConfirmSignOut(true)
      return
    }
    setConfirmSignOut(false)
    logout()
  }

  return (
    <aside className="w-56 border-r border-border flex flex-col h-full flex-shrink-0 overflow-hidden" style={{ backgroundColor: 'rgba(var(--surface-rgb), 0.85)', backdropFilter: 'blur(12px)' }}>
      <div className="px-5 py-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex-shrink-0 overflow-hidden flex items-center justify-center"
            style={{
              background: 'var(--logo-wrap-bg, transparent)',
              boxShadow: 'var(--logo-wrap-shadow, none)',
              border: 'var(--logo-wrap-border, 1px solid transparent)',
              position: 'relative',
            }}
          >
            <img
              src="lokal-icon.png"
              alt="Lokal"
              className="w-7 h-7 rounded-lg flex-shrink-0"
              style={{
                filter: 'var(--logo-image-filter, none)',
                opacity: 'var(--logo-image-opacity, 1)',
              }}
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-lg"
              style={{
                opacity: 'var(--logo-mask-opacity, 0)',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-dim) 100%)',
                mixBlendMode: 'screen',
                WebkitMaskImage: "url('lokal-icon.png')",
                WebkitMaskSize: 'cover',
                WebkitMaskPosition: 'center',
                WebkitMaskRepeat: 'no-repeat',
                maskImage: "url('lokal-icon.png')",
                maskSize: 'cover',
                maskPosition: 'center',
                maskRepeat: 'no-repeat',
              }}
            />
          </div>
          <span className="font-display text-sm uppercase tracking-widest text-white">Lokal</span>
        </div>
      </div>

      <div className="px-3 mb-2 flex-shrink-0">
        {user ? (
          <div className="space-y-2 rounded-lg px-2 py-2">
            <div className="flex items-center gap-2">
              <button onClick={() => nav('/profile')} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                <img 
                  src={api.getAvatarSrc(user)} 
                  alt="Profile" 
                  className="w-7 h-7 rounded-full flex-shrink-0 object-cover" 
                />
                <p className="text-xs text-white truncate flex-1">{user.display_name || user.username}</p>
              </button>
              
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => nav('/profile')} title="Profile" className="text-muted hover:text-white transition-colors"><User size={13} /></button>
                <button onClick={openStats} title="Stats" className="text-muted hover:text-white transition-colors"><BarChart2 size={13} /></button>
                <button
                  onClick={handleSignOut}
                  title={confirmSignOut ? 'Confirm sign out' : 'Sign out'}
                  className={`transition-colors ${confirmSignOut ? 'text-red-400' : 'text-muted hover:text-red-400'}`}
                >
                  <LogOut size={13} />
                </button>
              </div>
            </div>

            {confirmSignOut && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2">
                <p className="text-[10px] font-display uppercase tracking-widest text-red-300">Are you sure?</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleSignOut}
                    className="flex-1 rounded-lg bg-red-500/20 px-2 py-1.5 text-[11px] font-medium text-red-200 hover:bg-red-500/30 transition-colors"
                  >
                    Sign Out
                  </button>
                  <button
                    onClick={() => setConfirmSignOut(false)}
                    className="flex-1 rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] text-muted hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => openAuth('login')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted hover:text-white hover:bg-elevated transition-all">
            <LogIn size={14} /> Sign In / Register
          </button>
        )}
      </div>

      <nav className="px-3 space-y-0.5 flex-shrink-0">
        {navItems.map(({ icon: Icon, label, path }) => (
          <button 
            key={path} 
            data-tour={path === '/search' ? 'search' : path === '/library' ? 'library' : path === '/downloader' ? 'downloader' : path === '/settings' ? 'settings' : null}
            onClick={() => nav(path)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${loc.pathname === path ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}>
            <Icon size={15} />
            <span className="flex-1 text-left">{label}</span>
            {path === '/recap' && showRecapBadge && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-base">!</span>
            )}
          </button>
        ))}
        
        <button 
          data-tour="albums"
          onClick={() => nav('/albums')}
          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${loc.pathname === '/albums' ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}>
          <Disc3 size={15} /> Albums
        </button>
      </nav>

      <div className="mx-4 my-2 border-t border-border flex-shrink-0" />

      <div className="flex-1 overflow-y-auto px-3 min-h-0">
        <div className="flex items-center justify-between py-2 px-1">
          <p className="text-xs font-display text-muted uppercase tracking-widest">Playlists</p>
          <button onClick={() => setShowNewPlaylist(v => !v)} title="New playlist"
            className="text-muted hover:text-white transition-colors p-0.5 rounded">
            <Plus size={14} />
          </button>
        </div>

        {showNewPlaylist && (
          <div className="mb-2 flex gap-1.5">
            <input autoFocus value={newPlName} onChange={e => setNewPlName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') createPlaylist(); if (e.key === 'Escape') setShowNewPlaylist(false) }}
              placeholder="Playlist name…"
              className="flex-1 bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-accent/50 placeholder:text-muted/60" />
            <button onClick={createPlaylist}
              className="px-2 py-1 bg-accent text-base rounded-lg text-xs font-medium">Add</button>
          </div>
        )}

        <button onClick={() => nav('/playlist/liked')}
          className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs transition-all group ${loc.pathname === '/playlist/liked' ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}>
          <div className="w-7 h-7 rounded bg-accent/20 flex items-center justify-center flex-shrink-0">
            <Heart size={12} className="text-accent" fill="currentColor" />
          </div>
          <span className="truncate font-medium">Liked Songs</span>
        </button>

        {playlists.map(pl => (
          <div key={pl.id} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={async (e) => {
              e.preventDefault()
              try {
                const data = JSON.parse(e.dataTransfer.getData('application/json') || '{}')
                if (data.type === 'tracks' && data.tracks) {
                  for (const track of data.tracks) {
                    await api.addToPlaylist(pl.id, track.id)
                  }
                  loadPlaylists()
                }
              } catch (err) { console.error('Drop error:', err) }
            }}>
            <button onClick={() => nav(`/playlist/${pl.id}`)}
              className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs transition-all group ${loc.pathname === `/playlist/${pl.id}` ? 'bg-accent/10 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}>
              <PlaylistCover playlistId={pl.id} coverPath={pl.cover_path} size={28} className="flex-shrink-0 rounded" />
              <span className="truncate">{pl.name}</span>
            </button>
          </div>
        ))}
      </div>

      {currentTrack && (
        <div className="p-3 flex-shrink-0 border-t border-border">
          <p className="text-xs text-white truncate font-medium">{currentTrack.title}</p>
          <p className="text-xs text-muted truncate">{currentTrack.artist}</p>
        </div>
      )}

    </aside>
  )
}
