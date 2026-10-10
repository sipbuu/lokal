import { create } from 'zustand'
import { api } from './api'

export const discoveryArtistKey = name => String(name || '').normalize('NFKC').trim().toLowerCase()
export function parseHiddenArtists(value) {
  try {
    const names = JSON.parse(value || '[]')
    return new Set(Array.isArray(names) ? names.map(discoveryArtistKey).filter(Boolean) : [])
  } catch { return new Set() }
}

export const useDiscoveryArtists = create(() => ({ hidden: new Set(), loaded: false }))
let pending = null
let writes = Promise.resolve()

export function loadDiscoveryArtists() {
  if (!pending) pending = api.getSettings().then(settings => {
    if (settings?.error) throw new Error(settings.error)
    useDiscoveryArtists.setState({ hidden: parseHiddenArtists(settings.discovery_hidden_artists), loaded: true })
  }).finally(() => { pending = null })
  return pending
}

export function setDiscoveryArtistHidden(name, hidden) {
  const key = discoveryArtistKey(name)
  if (!key) return Promise.resolve()
  const write = writes.catch(() => {}).then(async () => {
    await loadDiscoveryArtists()
    const names = new Set(useDiscoveryArtists.getState().hidden)
    if (hidden) names.add(key)
    else names.delete(key)
    const result = await api.saveSettings({ discovery_hidden_artists: JSON.stringify([...names]) })
    if (result?.error) throw new Error(result.error)
    useDiscoveryArtists.setState({ hidden: names })
  })
  writes = write
  return write
}
