// Syncing a playlist linked to one on Spotify / Tidal / Apple Music / Qobuz:
// the backend adds the songs added there since the last sync (the library's
// copy, or a ghost song), then the ghosts are downloaded from the playback
// sources like any imported playlist's. Removals are never synced.

import { api } from './api'
import { downloadGhostSongs, ghostDownloadMessage } from './ghostDownloads'
import { plural } from './plural'

export async function syncPlaylist(playlistId, { userId, client = api, download = downloadGhostSongs, onProgress } = {}) {
  const result = await client.playlistSync(playlistId, userId).catch(error => ({ error: error.message }))
  if (result?.error) return { error: result.error }
  const added = Number(result?.added) || 0
  if (typeof window !== 'undefined' && added) window.dispatchEvent(new Event('lokal:refresh'))
  if (!added) return { ...result, message: `Up to date with ${result.title || 'the linked playlist'}: no new songs.` }
  const ghosts = Array.isArray(result.ghosts) ? result.ghosts : []
  const downloads = ghosts.length ? await download(ghosts, { client, onProgress }) : null
  const parts = [`Added ${plural(added, 'new song')}`]
  if (result.matched) parts.push(`${result.matched} from your library`)
  if (downloads) parts.push(ghostDownloadMessage(downloads))
  return { ...result, downloads, message: parts.join('; ') }
}

/** Settings → "Sync linked playlists at launch": every linked playlist, one at a time. */
export async function syncLinkedPlaylists({ userId, client = api } = {}) {
  const ids = await client.playlistSyncLinked().catch(() => [])
  const results = []
  for (const id of Array.isArray(ids) ? ids : []) results.push({ id, ...(await syncPlaylist(id, { userId, client })) })
  return results
}
