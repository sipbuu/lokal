// Playlist page: link the playlist to one on Spotify, Tidal, Apple Music or
// Qobuz, then "Sync" adds what was added there since (src/playlistSync.js).

import React, { useEffect, useState } from 'react'
import { Link2, Loader2, RefreshCw, Unlink } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'
import { syncPlaylist } from '../playlistSync'
import { showLoadingToast } from './Toaster'

function ago(time) {
  if (!time) return 'never synced'
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'synced just now'
  if (minutes < 60) return `synced ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `synced ${hours} h ago` : `synced ${new Date(time).toLocaleDateString()}`
}

export default function PlaylistSyncButton({ playlistId, userId, className = '' }) {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = () => Promise.resolve(api.playlistSyncStatus(playlistId)).then(setStatus).catch(() => setStatus(null))
  useEffect(() => { setStatus(null); refresh() }, [playlistId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!api.isElectron || !status || status.unsupported) return null

  const sync = async () => {
    setBusy(true); setError('')
    const toast = showLoadingToast(`Syncing with ${status.platformLabel}…`)
    let message = ''
    try {
      const result = await syncPlaylist(playlistId, { userId, onProgress: text => toast.update(text) })
      message = result.error || result.message
      if (result.error) setError(result.error)
    } catch (e) {
      message = e?.message || 'Sync failed'
      setError(message)
    } finally {
      toast.close(message)
      setBusy(false)
      refresh()
    }
  }
  const link = async () => {
    setBusy(true); setError('')
    const result = await api.playlistSyncLink(playlistId, url.trim()).catch(e => ({ error: e.message }))
    setBusy(false)
    if (result?.error) { setError(result.error); return }
    setStatus(result); setOpen(false); setUrl('')
    sync()
  }
  const unlink = async () => {
    await api.playlistSyncUnlink(playlistId).catch(() => {})
    setOpen(false); refresh()
  }

  const pill = 'flex items-center gap-2 px-5 py-2.5 bg-elevated border border-border text-white/80 rounded-full font-medium text-sm hover:text-white hover:border-accent/30 transition-colors disabled:opacity-40'
  return <>
    {status.linked
      ? <button onClick={sync} disabled={busy} title={`${status.platformLabel}${status.title ? ` · ${status.title}` : ''} · ${ago(status.syncedAt)}. Adds songs added there since the last sync; nothing is removed.`} className={`${pill} ${className}`}>
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />Sync<span className="text-xs font-normal text-muted">{status.platformLabel} · {ago(status.syncedAt).replace('synced ', '')}</span>
        </button>
      : <button onClick={() => setOpen(true)} title="Link to a playlist on Spotify, Tidal, Apple Music or Qobuz" className={`${pill} ${className}`}><Link2 size={15} />Link playlist</button>}
    {status.linked && <button onClick={() => setOpen(true)} title="Linked playlist settings" aria-label="Linked playlist settings" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-elevated text-muted hover:text-white"><Link2 size={15} /></button>}
    <Modal open={open} onClose={() => setOpen(false)} title={status.linked ? 'Linked playlist' : 'Link a streaming playlist'}>
      <div className="space-y-4 px-5 pb-5 pt-4 sm:px-6">
        {status.linked ? <>
          <p className="text-sm text-text">{status.title || status.platformLabel}</p>
          <p className="break-all text-xs text-muted">{status.url}</p>
          <p className="text-xs leading-relaxed text-muted">Sync adds the songs added to it since the last sync and downloads them from your sources. Songs removed there stay here. {ago(status.syncedAt)}.</p>
          {status.error && <p className="text-xs text-red">{status.error}</p>}
          <button onClick={unlink} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted hover:text-red"><Unlink size={13} />Unlink</button>
        </> : <>
          <p className="text-xs leading-relaxed text-muted">Paste the link of a playlist on Spotify, Tidal, Apple Music or Qobuz (yours or anyone’s). Each sync adds the songs added there since the last one, then downloads them through your sources. Removals are never synced. It needs the matching SpotiFLAC addon (Spotify Web, Tidal, Apple Music or Qobuz) from Settings → Addons.</p>
          <input autoFocus value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && url.trim() && link()} placeholder="https://open.spotify.com/playlist/…" spellCheck={false}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-text outline-none focus:border-accent/50" />
          {error && <p className="text-xs text-red">{error}</p>}
          <button onClick={link} disabled={busy || !url.trim()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[rgb(var(--bg-rgb))] disabled:opacity-40">{busy && <Loader2 size={12} className="animate-spin" />}Link and sync</button>
        </>}
      </div>
    </Modal>
  </>
}
