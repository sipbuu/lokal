import React, { useState, useEffect } from 'react'
import { Camera, Save, BarChart2 } from 'lucide-react'
import Modal from './Modal'
import { useAppStore } from '../store/player'
import { api } from '../api'

export default function ProfileModal() {
  const { showProfileModal, closeProfile, openStats, user, setUser } = useAppStore()
  const [form, setForm] = useState({ display_name: '', bio: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (user) setForm({ display_name: user.display_name || user.username || '', bio: user.bio || '' })
  }, [user])

  const avatarSrc = user?.avatar_path
    ? (api.isElectron ? `file://${user.avatar_path}` : api.avatarURL(user?.id))
    : null

  const uploadAvatar = async () => {
    if (!api.isElectron) return
    const fp = await api.openFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    const img = new Image(); img.src = `file://${fp}`
    img.onload = async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 300
      const ctx = c.getContext('2d')
      const min = Math.min(img.width, img.height)
      ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, 300, 300)
      const data = c.toDataURL('image/jpeg', 0.85)
      const updated = await api.updateProfile({ userId: user.id, avatar: data })
      if (updated?.id) { setUser(updated); localStorage.setItem('lokal-user', JSON.stringify(updated)) }
    }
  }

  const saveProfile = async () => {
    setSaving(true)
    const updated = await api.updateProfile({ userId: user.id, ...form })
    if (updated?.id) { setUser(updated); localStorage.setItem('lokal-user', JSON.stringify(updated)) }
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  if (!user) return null

  return (
    <Modal open={showProfileModal} onClose={closeProfile} title="Profile" width="max-w-sm">
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3">
          <div className="relative group">
            <div className="w-20 h-20 rounded-full bg-accent/20 border-2 border-accent/40 overflow-hidden flex items-center justify-center">
              {avatarSrc
                ? <img src={avatarSrc} className="w-full h-full object-cover" />
                : <span className="text-accent text-2xl font-display font-bold">{(user.display_name || user.username)?.[0]?.toUpperCase()}</span>
              }
            </div>
            {api.isElectron && (
              <button onClick={uploadAvatar}
                className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Camera size={18} className="text-white" />
              </button>
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-white">{user.display_name || user.username}</p>
            <p className="text-xs text-muted">@{user.username}</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Display Name</label>
            <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1.5">Bio</label>
            <textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} rows={2}
              className="w-full bg-card border border-border rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-accent/60 resize-none transition-colors" />
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={() => { closeProfile(); openStats() }}
            className="flex items-center gap-1.5 px-4 py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white transition-colors">
            <BarChart2 size={13} /> Stats
          </button>
          <button onClick={saveProfile} disabled={saving}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:bg-accent/80 disabled:opacity-50 transition-colors">
            <Save size={13} /> {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
