import React, { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { discoveryArtistKey, loadDiscoveryArtists, setDiscoveryArtistHidden, useDiscoveryArtists } from '../discoveryArtists'
import { showToast } from './Toaster'

export default function DiscoveryArtistButton({ name, className }) {
  const hidden = useDiscoveryArtists(s => s.hidden.has(discoveryArtistKey(name)))
  const [busy, setBusy] = useState(false)
  useEffect(() => { loadDiscoveryArtists().catch(() => {}) }, [])
  const toggle = async () => {
    if (busy) return
    setBusy(true)
    try { await setDiscoveryArtistHidden(name, !hidden); showToast(hidden ? 'Artist restored to discovery' : 'Artist hidden from discovery') }
    catch (error) { showToast(error.message) }
    finally { setBusy(false) }
  }
  return <button disabled={busy || !name} onClick={toggle} className={className} aria-pressed={hidden} title={hidden ? 'Show this artist on Home' : 'Hide this artist from Home'}>{hidden ? <Eye size={12} /> : <EyeOff size={12} />}{hidden ? 'Show in discovery' : 'Hide from discovery'}</button>
}
