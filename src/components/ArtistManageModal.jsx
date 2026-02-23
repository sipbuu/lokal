import React, { useState, useRef } from 'react'
import { Camera, Merge, Trash2, Edit3, X } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'

export default function ArtistManageModal({ artist, allArtists = [], open, onClose, onChanged }) {
  const [tab, setTab] = useState('edit')
  const [name, setName] = useState(artist?.name || '')
  const [bio, setBio] = useState(artist?.bio || '')
  const [mergeTarget, setMergeTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef()

  if (!artist) return null

  const pickImage = async () => {
    if (api.isElectron) {
      const fp = await api.openFile()
      if (!fp) return
      const content = await api.readFile(fp)
      const img = new Image()
      img.src = `file://${fp}`
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width; c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        const data = c.toDataURL('image/jpeg', 0.85)
        api.artistSetImage(artist.id, data).then(() => onChanged?.())
      }
    } else {
      fileRef.current?.click()
    }
  }

  const onFileChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      await api.artistSetImage(artist.id, ev.target.result)
      onChanged?.()
    }
    reader.readAsDataURL(file)
  }

  const saveEdit = async () => {
    setSaving(true)
    if (name.trim() && name.trim() !== artist.name) await api.artistRename(artist.id, name.trim())
    await api.artistUpdateBio(artist.id, bio)
    setSaving(false)
    onChanged?.()
    onClose?.()
  }

  const doMerge = async () => {
    if (!mergeTarget || mergeTarget === artist.id) return
    setSaving(true)
    await api.artistMerge(artist.id, mergeTarget)
    setSaving(false)
    onChanged?.()
    onClose?.()
  }

  const doDelete = async () => {
    if (!confirm(`Delete artist "${artist.name}"? This does NOT delete tracks, just the artist entry.`)) return
    await api.artistDelete(artist.id)
    onChanged?.()
    onClose?.()
  }

  const artSrc = artist.image_path
    ? (api.isElectron ? `file://${artist.image_path}` : null)
    : null

  return (
    <Modal open={open} onClose={onClose} title={`Manage: ${artist.name}`} width="max-w-lg">
      {}
      <div className="flex gap-1 mb-5 p-0.5 bg-card rounded-lg border border-border">
        {[['edit', 'Edit'], ['merge', 'Merge'], ['danger', 'Danger Zone']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`flex-1 py-1.5 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? (id === 'danger' ? 'bg-red-500/20 text-red-400' : 'bg-accent text-base') : 'text-muted hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'edit' && (
        <div className="space-y-4">
          {}
          <div className="flex items-center gap-4">
            <button onClick={pickImage} className="relative group">
              <div className="w-16 h-16 rounded-full bg-elevated border border-border overflow-hidden flex items-center justify-center">
                {artSrc ? <img src={artSrc} className="w-full h-full object-cover" /> : <span className="text-muted text-2xl">{artist.name[0]}</span>}
              </div>
              <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={16} className="text-white" />
              </div>
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
            <p className="text-xs text-muted">Click to change artist image</p>
          </div>

          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Bio</label>
            <textarea value={bio} onChange={e => setBio(e.target.value)} rows={4} placeholder="Artist biography..." className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent-dim transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {tab === 'merge' && (
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">Merge <strong className="text-white">{artist.name}</strong> into another artist. All tracks will be reassigned. This cannot be undone.</p>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Merge into</label>
            <select value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors">
              <option value="">Select target artist…</option>
              {allArtists.filter(a => a.id !== artist.id).map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.track_count} tracks)</option>
              ))}
            </select>
          </div>
          <button onClick={doMerge} disabled={!mergeTarget || saving} className="w-full py-2.5 bg-orange-500/20 border border-orange-500/40 text-orange-300 rounded-xl text-sm font-medium hover:bg-orange-500/30 transition-colors disabled:opacity-40">
            <Merge size={14} className="inline mr-2" />Merge Artists
          </button>
        </div>
      )}

      {tab === 'danger' && (
        <div className="space-y-4">
          <p className="text-xs text-muted leading-relaxed">Delete the artist entry for <strong className="text-white">{artist.name}</strong>. Tracks will remain in your library but this artist profile will be removed.</p>
          <button onClick={doDelete} className="w-full py-2.5 bg-red-500/15 border border-red-500/30 text-red-400 rounded-xl text-sm font-medium hover:bg-red-500/25 transition-colors flex items-center justify-center gap-2">
            <Trash2 size={14} /> Delete Artist Profile
          </button>
        </div>
      )}
    </Modal>
  )
}
