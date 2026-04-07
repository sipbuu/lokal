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
    Promise.all([api.getArtist(id), api.getSettings()]).then(([data, appSettings]) => {
      setArtist(data)
      if (!data?.id) return
      if (appSettings?.auto_fetch_artist_metadata !== '1') return
      api.artistRefreshMetadata(data.id).then((refreshed) => {
        if (!refreshed || refreshed.error) return
        setArtist((current) => {
          if (!current || current.id !== data.id) return current
          const nextBio = refreshed.bio || ''
          const currBio = current.bio || ''
          const nextImage = refreshed.image_path || ''
          const currImage = current.image_path || ''
          if (nextBio === currBio && nextImage === currImage) return current
          return { ...current, ...refreshed }
        })
      }).catch(() => {})
    }).catch(() => {})
    api.getArtists().then(setAllArtists)
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    const handleRefresh = () => {
      load()
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [id])

  const pickArtistImage = async () => {
    if (!artist) return
    if (api.isElectron) {
      const fp = await api.openFile()
      if (!fp) return
      const img = new Image()
      img.src = `file://${fp}`
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        api.artistSetImage(artist.id, c.toDataURL('image/jpeg', 0.85)).then(() => load())
      }
    }
  }

  if (!artist) return <div className="p-6 text-muted text-sm">Loading...</div>

  const imgSrc = artist.image_path ? (api.isElectron ? `file://${artist.image_path}` : null) : null
  const artSrc = (track) => track.artwork_path ? (api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)) : null
  const releaseLabel = (type) => {
    if (type === 'single') return 'Single'
    if (type === 'ep') return 'EP'
    return 'Album'
  }

  return (
    <div className="pb-8">
      <div className="relative h-56 overflow-hidden">
        {imgSrc ? <img src={imgSrc} className="h-full w-full object-cover opacity-40" /> : <div className="h-full w-full bg-gradient-to-b from-accent/8 to-transparent" />}
        <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20" />
        <div className="absolute bottom-5 left-8 flex items-end gap-5">
          <button onClick={pickArtistImage} className="relative group flex-shrink-0">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated">
              {imgSrc ? <img src={imgSrc} className="h-full w-full object-cover" /> : <Music size={36} className="text-muted" />}
            </div>
            {api.isElectron && <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"><Camera size={18} className="text-white" /></div>}
          </button>
          <div>
            <p className="mb-1 text-xs font-display uppercase tracking-widest text-muted">Artist</p>
            <h1 className="text-3xl font-display text-white">{artist.name}</h1>
            <p className="mt-1 text-xs text-muted">{artist.tracks?.length || 0} tracks</p>
          </div>
        </div>
        <button onClick={() => setShowManage(true)} className="absolute top-4 right-6 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white/60 transition-all backdrop-blur-sm hover:border-white/20 hover:text-white">
          <Settings size={12} /> Manage
        </button>
      </div>

      <div className="space-y-7 px-8 py-5">
        <div className="flex items-center gap-3">
          <button onClick={() => playQueue(artist.tracks, 0)} className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-base transition-colors hover:bg-accent-dim">
            <Play size={14} fill="currentColor" className="translate-x-px" /> Play All
          </button>
        </div>

        {artist.bio && (
          <div>
            <h2 className="mb-2 text-xs font-display uppercase tracking-widest text-muted">About</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">{artist.bio}</p>
          </div>
        )}

        {artist.topTracks?.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Popular</h2>
            <TrackList tracks={artist.topTracks} showAlbum={false} />
          </section>
        )}

        {artist.albums?.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Releases</h2>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {artist.albums.map((album) => {
                const firstTrack = artist.tracks?.find((track) => track.album === album.title)
                const cover = firstTrack ? artSrc(firstTrack) : null
                return (
                  <motion.button
                    key={album.title}
                    onClick={() => setSelectedAlbum(selectedAlbum === album.title ? null : album.title)}
                    whileHover={{ scale: 1.02 }}
                    className={`flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border p-3 text-left transition-all ${selectedAlbum === album.title ? 'border-accent/40 bg-accent/10' : 'border-border bg-elevated hover:border-accent/30'}`}
                  >
                    <div className="flex w-full aspect-square items-center justify-center overflow-hidden rounded-lg bg-card text-subtle">
                      {cover ? <img src={cover} className="h-full w-full object-cover" /> : <Music size={28} />}
                    </div>
                    <div className="min-w-0 overflow-hidden">
                      <p className="block truncate text-sm font-medium text-white">{album.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-display uppercase tracking-[0.18em] text-white/70">
                          {releaseLabel(album.release_type)}
                        </span>
                        <span className="block truncate">{album.year ? `${album.year} • ` : ''}{album.track_count} tracks</span>
                      </div>
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

  useEffect(() => {
    api.getAlbumTracks(album).then((result) => setTracks(result || []))
  }, [album])

  useEffect(() => {
    const handleRefresh = () => {
      api.getAlbumTracks(album).then((result) => setTracks(result || []))
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [album])

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
