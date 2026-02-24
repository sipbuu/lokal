import React, { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Home, Search, Library, Download, Plus, Music, Heart, Settings, LogIn, LogOut, BarChart2, Disc3, Radio, User } from 'lucide-react'
import { useAppStore, usePlayerStore } from '../store/player'
import { api } from '../api'
import PlaylistCover from './PlaylistCover'
import AlbumsModal from './AlbumsModal'

const NAV = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Search, label: 'Search', path: '/search' },
  { icon: Library, label: 'Library', path: '/library' },
  { icon: Download, label: 'Download', path: '/downloader' },
  { icon: Settings, label: 'Settings', path: '/settings' },
]

export default function Sidebar() {
  const nav = useNavigate()
  const loc = useLocation()
  const [playlists, setPlaylists] = useState([])
  const [showNewPlaylist, setShowNewPlaylist] = useState(false)
  const [newPlName, setNewPlName] = useState('')
  
  const { user, openAuth, logout, openProfile, openStats, openAlbums } = useAppStore()

  const avatarSrc = user?.avatar_path
    ? (api.isElectron ? `file://${user.avatar_path}` : api.avatarURL(user?.id))
    : null
    
  const { currentTrack } = usePlayerStore()

  const loadPlaylists = () => {
    api.getPlaylists(user?.id).then(p => setPlaylists(Array.isArray(p) ? p : []))
  }

  useEffect(() => { loadPlaylists() }, [user?.id])

  useEffect(() => {
    const handler = () => loadPlaylists()
    window.addEventListener('lokal:playlist-created', handler)
    return () => window.removeEventListener('lokal:playlist-created', handler)
  }, [user?.id])

  const createPlaylist = async () => {
    if (!newPlName.trim()) return
    const pl = await api.createPlaylist(newPlName.trim(), user?.id)
    if (pl?.id) {
      setPlaylists(prev => [...prev, pl])
      nav(`/playlist/${pl.id}`)
    }
    setNewPlName(''); setShowNewPlaylist(false)
  }

  return (
    <aside className="w-56 bg-surface border-r border-border flex flex-col h-full flex-shrink-0 overflow-hidden">
      <div className="px-5 py-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <img src="lokal-icon.png" alt="Lokal" className="w-7 h-7 rounded-lg flex-shrink-0" />
          <span className="font-display text-sm uppercase tracking-widest text-white">Lokal</span>
        </div>
      </div>

      <div className="px-3 mb-2 flex-shrink-0">
        {user ? (
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg">
            <img 
              src={api.getAvatarSrc(user)} 
              alt="Profile" 
              className="w-7 h-7 rounded-full flex-shrink-0 object-cover" 
            />
            
            <p className="text-xs text-white truncate flex-1">{user.display_name || user.username}</p>
            
            <div className="flex gap-1 flex-shrink-0">
              <button onClick={openProfile} title="Profile" className="text-muted hover:text-white transition-colors"><User size={13} /></button>
              <button onClick={openStats} title="Stats" className="text-muted hover:text-white transition-colors"><BarChart2 size={13} /></button>
              <button onClick={logout} title="Sign out" className="text-muted hover:text-red-400 transition-colors"><LogOut size={13} /></button>
            </div>
          </div>
        ) : (
          <button onClick={() => openAuth('login')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted hover:text-white hover:bg-elevated transition-all">
            <LogIn size={14} /> Sign In / Register
          </button>
        )}
      </div>

      <nav className="px-3 space-y-0.5 flex-shrink-0">
        {NAV.map(({ icon: Icon, label, path }) => (
          <button key={path} onClick={() => nav(path)}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${loc.pathname === path ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
        
        <button onClick={openAlbums}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted hover:text-white hover:bg-elevated transition-all">
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
              <PlaylistCover playlistId={pl.id} size={28} className="flex-shrink-0 rounded" />
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

      <AlbumsModal />
    </aside>
  )
}