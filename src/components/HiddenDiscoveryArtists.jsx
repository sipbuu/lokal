import React from 'react'
import { discoveryArtistKey, useDiscoveryArtists } from '../discoveryArtists'
import DiscoveryArtistButton from './DiscoveryArtistButton'

export default function HiddenDiscoveryArtists({ artists = [] }) {
  const hidden = useDiscoveryArtists(s => s.hidden)
  if (!hidden.size) return null
  const names = new Map(artists.map(artist => [discoveryArtistKey(artist.name), artist.name]))
  return <details className="rounded-xl border border-border bg-elevated p-4">
    <summary className="cursor-pointer text-sm text-muted hover:text-white">Hidden artists ({hidden.size})</summary>
    <div className="mt-3 space-y-2">{[...hidden].sort().map(key => <div key={key} className="flex items-center justify-between gap-3">
      <span className="truncate text-sm text-white">{names.get(key) || key}</span>
      <DiscoveryArtistButton name={names.get(key) || key} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-50" />
    </div>)}</div>
  </details>
}
