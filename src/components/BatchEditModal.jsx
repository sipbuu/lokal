import React, { useEffect, useMemo, useState } from 'react'
import { Camera, RefreshCw, Save } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'

const FIELD_LABELS = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  album_artist: 'Album Artist',
  year: 'Year',
  genre: 'Genre',
  artwork: 'Artwork',
}

const DEFAULT_MODES = {
  title: 'ignore',
  artist: 'ignore',
  album: 'ignore',
  album_artist: 'ignore',
  year: 'ignore',
  genre: 'ignore',
  artwork: 'ignore',
}

function createDefaultValues() {
  return {
    title: '',
    artist: '',
    album: '',
    album_artist: '',
    year: '',
    genre: '',
    artwork: '',
  }
}

export default function BatchEditModal({ tracks = [], open, onClose, onSave }) {
  const [modes, setModes] = useState(DEFAULT_MODES)
  const [values, setValues] = useState(createDefaultValues())
  const [artworkPreview, setArtworkPreview] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setModes(DEFAULT_MODES)
    setValues(createDefaultValues())
    setArtworkPreview(null)
    setSaving(false)
  }, [open])

  const summary = useMemo(() => {
    const uniqueArtists = new Set(tracks.map(track => track.artist).filter(Boolean)).size
    const uniqueAlbums = new Set(tracks.map(track => track.album).filter(Boolean)).size
    return { count: tracks.length, uniqueArtists, uniqueAlbums }
  }, [tracks])

  const previewRows = useMemo(() => {
    const rows = []
    for (const track of tracks.slice(0, 12)) {
      const changes = []
      for (const field of ['title', 'artist', 'album', 'album_artist', 'year', 'genre']) {
        const mode = modes[field]
        if (mode === 'ignore') continue
        if (mode === 'clear') {
          if (track[field] !== null && track[field] !== '') changes.push(`${FIELD_LABELS[field]} -> empty`)
          continue
        }
        if (mode === 'fillMissing') {
          if (track[field] === null || track[field] === undefined || String(track[field]) === '') {
            changes.push(`${FIELD_LABELS[field]} -> ${values[field]}`)
          }
          continue
        }
        if (mode === 'replace' && String(track[field] ?? '') !== String(values[field] ?? '')) {
          changes.push(`${FIELD_LABELS[field]} -> ${values[field]}`)
        }
      }
      if (modes.artwork === 'replace' && values.artwork) changes.push('Artwork -> new image')
      if (modes.artwork === 'clear' && track.artwork_path) changes.push('Artwork -> empty')
      if (changes.length) rows.push({ id: track.id, title: track.title, artist: track.artist, changes })
    }
    return rows
  }, [tracks, modes, values])

  const canSave = useMemo(() => {
    return Object.entries(modes).some(([field, mode]) => {
      if (mode === 'ignore') return false
      if (mode === 'clear') return true
      if (field === 'artwork') return Boolean(values.artwork)
      return String(values[field] ?? '').trim() !== ''
    })
  }, [modes, values])

  const setMode = (field, mode) => {
    setModes(prev => ({ ...prev, [field]: mode }))
  }

  const setValue = (field, value) => {
    setValues(prev => ({ ...prev, [field]: value }))
    setModes(prev => prev[field] === 'ignore' ? { ...prev, [field]: 'replace' } : prev)
  }

  const handleArtworkPick = async () => {
    if (!api.isElectron) return
    const fp = await api.openFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    const dataUrl = await api.readFileAsDataURL(fp)
    if (!dataUrl) return
    setArtworkPreview(dataUrl)
    setValue('artwork', dataUrl)
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    const operations = {
      title: { mode: modes.title, value: values.title || null },
      artist: { mode: modes.artist, value: values.artist || null },
      album: { mode: modes.album, value: values.album || null },
      album_artist: { mode: modes.album_artist, value: values.album_artist || null },
      year: { mode: modes.year, value: values.year ? parseInt(values.year, 10) : null },
      genre: { mode: modes.genre, value: values.genre || null },
      artwork: { mode: modes.artwork, value: values.artwork || null },
    }
    const result = await api.batchUpdateTracks(tracks.map(track => track.id), operations)
    setSaving(false)
    if (result?.error) {
      alert(result.error)
      return
    }
    onSave?.(Array.isArray(result?.tracks) ? result.tracks : [])
    onClose?.()
  }

  return (
    <Modal open={open} onClose={onClose} title="Batch Edit Tracks" width="max-w-4xl">
      <div className="space-y-5">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>{summary.count} selected</span>
          <span>{summary.uniqueArtists} artists</span>
          <span>{summary.uniqueAlbums} albums</span>
        </div>

        <div className="grid grid-cols-[7rem_8rem_1fr] gap-3 items-center">
          <span className="text-xs font-display text-muted uppercase tracking-widest">Field</span>
          <span className="text-xs font-display text-muted uppercase tracking-widest">Mode</span>
          <span className="text-xs font-display text-muted uppercase tracking-widest">Value</span>

          {['title', 'artist', 'album', 'album_artist', 'year', 'genre'].map(field => (
            <React.Fragment key={field}>
              <label className="text-sm text-white">{FIELD_LABELS[field]}</label>
              <select
                value={modes[field]}
                onChange={(e) => setMode(field, e.target.value)}
                className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              >
                <option value="ignore">Ignore</option>
                <option value="replace">Replace all</option>
                <option value="fillMissing">Fill missing</option>
                <option value="clear">Clear</option>
              </select>
              <input
                value={values[field]}
                onChange={(e) => setValue(field, e.target.value)}
                disabled={modes[field] === 'clear'}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50 disabled:opacity-40"
              />
            </React.Fragment>
          ))}

          <label className="text-sm text-white">Artwork</label>
          <select
            value={modes.artwork}
            onChange={(e) => setMode('artwork', e.target.value)}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
          >
            <option value="ignore">Ignore</option>
            <option value="replace">Replace all</option>
            <option value="clear">Clear</option>
          </select>
          <div className="flex items-center gap-3">
            <button
              onClick={handleArtworkPick}
              disabled={!api.isElectron || modes.artwork === 'clear'}
              className="px-3 py-2 bg-card border border-border rounded-lg text-sm text-muted hover:text-white transition-colors disabled:opacity-40 flex items-center gap-2"
            >
              <Camera size={14} /> {artworkPreview ? 'Change Image' : 'Choose Image'}
            </button>
            {artworkPreview && <img src={artworkPreview} alt="" className="w-10 h-10 rounded-lg object-cover border border-border" />}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-display text-muted uppercase tracking-widest">Preview</p>
          <div className="max-h-64 overflow-y-auto rounded-xl border border-border bg-card/40 p-3 space-y-2">
            {previewRows.length === 0 && (
              <p className="text-sm text-muted">No pending changes yet.</p>
            )}
            {previewRows.map(row => (
              <div key={row.id} className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-sm text-white truncate">{row.title}</p>
                <p className="text-xs text-muted truncate">{row.artist}</p>
                <p className="text-xs text-muted mt-1">{row.changes.join(' | ')}</p>
              </div>
            ))}
            {tracks.length > 12 && previewRows.length > 0 && (
              <p className="text-xs text-muted">Previewing first 12 matching rows.</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            Apply Changes
          </button>
        </div>
      </div>
    </Modal>
  )
}
