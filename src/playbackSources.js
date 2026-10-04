export const DEFAULT_PLAYBACK_SOURCES = [{ id: 'yt', label: 'YouTube Music' }, { id: 'sc', label: 'SoundCloud' }]

export function orderedPlaybackSources(saved, available = DEFAULT_PLAYBACK_SOURCES) {
  let order = saved
  if (typeof saved === 'string') { try { order = JSON.parse(saved) } catch { order = [] } }
  const providers = new Map(available.map(provider => [provider.id, provider]))
  return [...new Set([...(Array.isArray(order) ? order : []), ...available.map(provider => provider.id)])]
    .filter(id => providers.has(id)).map(id => providers.get(id))
}
