import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Play, Music, Settings, Camera } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import TrackList from '../components/TrackList'
import ArtistManageModal from '../components/ArtistManageModal'
import { api } from '../api'

export default function Artist() {
  const { id } = useParams()
  const [artist, setArtist] = useState(null)
  const [allArtists, setAllArtists] = useState([])
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  const [showManage, setShowManage] = useState(false)
  const { playQueue } = usePlayerStore()

  const load = () => {
    api.getArtist(id).then(setArtist)
    api.getArtists().then(setAllArtists)
  }

  useEffect(() => { load() }, [id])

  const pickArtistImage = async () => {
    if (!artist) return
    if (api.isElectron) {
      const fp = await api.openFile()
      if (!fp) return
      const img = new Image()
      img.src = `file://${fp}`
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        api.artistSetImage(artist.id, c.toDataURL('image/jpeg', 0.85)).then(() => load())
      }
    }
  }

  if (!artist) return <div className="p-6 text-muted text-sm">Loading…</div>

  const imgSrc = artist.image_path ? (api.isElectron ? `file://${artist.image_path}` : null) : null
  const artSrc = (t) => t.artwork_path ? (api.isElectron ? `file://${t.artwork_path}` : api.artworkURL(t.id)) : null

  return (
    <div className="pb-8">
      <div className="relative h-56 overflow-hidden">
        {imgSrc ? <img src={imgSrc} className="w-full h-full object-cover opacity-40" /> : <div className="w-full h-full bg-gradient-to-b from-accent/8 to-transparent" />}
        <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20" />
        <div className="absolute bottom-5 left-8 flex items-end gap-5">
          <button onClick={pickArtistImage} className="relative group flex-shrink-0">
            <div className="w-24 h-24 rounded-full border-2 border-border overflow-hidden bg-elevated flex items-center justify-center">
              {imgSrc ? <img src={imgSrc} className="w-full h-full object-cover" /> : <Music size={36} className="text-muted" />}
            </div>
            {api.isElectron && <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Camera size={18} className="text-white" /></div>}
          </button>
          <div>
            <p className="text-xs font-display text-muted uppercase tracking-widest mb-1">Artist</p>
            <h1 className="text-3xl font-display text-white">{artist.name}</h1>
            <p className="text-xs text-muted mt-1">{artist.tracks?.length || 0} tracks</p>
          </div>
        </div>
        <button onClick={() => setShowManage(true)} className="absolute top-4 right-6 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs text-white/60 hover:text-white hover:border-white/20 transition-all backdrop-blur-sm">
          <Settings size={12} /> Manage
        </button>
      </div>

      <div className="px-8 py-5 space-y-7">
        <div className="flex items-center gap-3">
          <button onClick={() => playQueue(artist.tracks, 0)} className="flex items-center gap-2 px-5 py-2 bg-accent text-base rounded-full font-medium text-sm hover:bg-accent-dim transition-colors">
            <Play size={14} fill="currentColor" className="translate-x-px" /> Play All
          </button>
        </div>

        {artist.bio && (
          <div>
            <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-2">About</h2>
            <p className="text-sm text-muted leading-relaxed max-w-2xl">{artist.bio}</p>
          </div>
        )}

        {artist.topTracks?.length > 0 && (
          <section>
            <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Popular</h2>
            <TrackList tracks={artist.topTracks} showAlbum={false} />
          </section>
        )}

        {artist.albums?.length > 0 && (
          <section>
            <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Albums</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {artist.albums.map(album => {
                const firstTrack = artist.tracks?.find(t => t.album === album.title)
                const cover = firstTrack ? artSrc(firstTrack) : null
                return (
                  <motion.button key={album.title} onClick={() => setSelectedAlbum(selectedAlbum === album.title ? null : album.title)} whileHover={{ scale: 1.02 }}
                    className={`flex flex-col gap-2 p-3 rounded-xl border transition-all text-left ${selectedAlbum === album.title ? 'bg-accent/10 border-accent/40' : 'bg-elevated border-border hover:border-accent/30'}`}>
                    <div className="w-full aspect-square rounded-lg bg-card overflow-hidden flex items-center justify-center text-subtle">
                      {cover ? <img src={cover} className="w-full h-full object-cover" /> : <Music size={28} />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white truncate">{album.title}</p>
                      <p className="text-xs text-muted">{album.year} · {album.track_count} tracks</p>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </section>
        )}

        {selectedAlbum && <AlbumTracks album={selectedAlbum} />}
      </div>

      <ArtistManageModal
        artist={artist}
        allArtists={allArtists}
        open={showManage}
        onClose={() => setShowManage(false)}
        onChanged={load}
      />
    </div>
  )
}

function AlbumTracks({ album }) {
  const [tracks, setTracks] = useState([])
  const { playQueue } = usePlayerStore()
  useEffect(() => { api.getAlbumTracks(album).then(t => setTracks(t || [])) }, [album])
  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{album}</h3>
        <button onClick={() => playQueue(tracks, 0)} className="text-xs text-accent hover:text-accent-dim">Play Album</button>
      </div>
      <TrackList tracks={tracks} showAlbum={false} />
    </motion.div>
  )
}
