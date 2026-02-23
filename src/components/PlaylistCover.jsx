import React, { useEffect, useState } from 'react'
import { Music } from 'lucide-react'
import { api } from '../api'

export default function PlaylistCover({ playlistId, size = 48, className = '' }) {
  const [artworks, setArtworks] = useState([])

  useEffect(() => {
    if (!playlistId || playlistId === 'liked') return
    api.getPlaylistTracks(playlistId).then(tracks => {
      const arts = [...new Set(
        (tracks || [])
          .filter(t => t.artwork_path)
          .map(t => t.artwork_path)
      )].slice(0, 4)
      setArtworks(arts)
    })
  }, [playlistId])

  const getArtSrc = (p) => api.isElectron ? `file://${p}` : api.artworkURL(p.split('/').pop().replace('.jpg', ''))

  if (!artworks.length) {
    return (
      <div className={`rounded-lg bg-elevated flex items-center justify-center text-subtle overflow-hidden flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
        <Music size={size * 0.4} />
      </div>
    )
  }

  if (artworks.length === 1) {
    return (
      <div className={`rounded-lg overflow-hidden flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
        <img src={getArtSrc(artworks[0])} className="w-full h-full object-cover" />
      </div>
    )
  }

  const grid = artworks.slice(0, 4)
  const half = Math.floor(size / 2)

  return (
    <div className={`rounded-lg overflow-hidden grid grid-cols-2 flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
      {grid.map((art, i) => (
        <img key={i} src={getArtSrc(art)} style={{ width: half, height: half }} className="object-cover" />
      ))}
      {grid.length === 3 && <div className="bg-elevated" style={{ width: half, height: half }} />}
    </div>
  )
}
