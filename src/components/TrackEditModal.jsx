import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Camera, Save, RefreshCw, Check, AlertCircle } from 'lucide-react'
import { api } from '../api'
import Modal from './Modal'

export default function TrackEditModal({ track, open, onClose, onSave }) {
  const [formData, setFormData] = useState({
    title: '',
    artist: '',
    album: '',
    album_artist: '',
    track_num: '',
    year: '',
    genre: ''
  })
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(null)
  const [artworkPreview, setArtworkPreview] = useState(null)

  useEffect(() => {
    if (track) {
      setFormData({
        title: track.title || '',
        artist: track.artist || '',
        album: track.album || '',
        album_artist: track.album_artist || '',
        track_num: track.track_num || '',
        year: track.year || '',
        genre: track.genre || ''
      })
      
      if (track.artwork_path) {
        setArtworkPreview(api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id))
      } else {
        setArtworkPreview(null)
      }
      setStatus(null)
    }
  }, [track])

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSelectArtwork = async () => {
    if (!api.isElectron) return
    
    const fp = await api.openFile([{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    
    const dataUrl = await api.readFileAsDataURL(fp)
    setArtworkPreview(dataUrl)
    
    setSaving(true)
    try {
      await api.trackSetArtwork(track.id, dataUrl)
      setStatus({ type: 'success', message: 'Artwork updated!' })
      setTimeout(() => setStatus(null), 2000)
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    }
    setSaving(false)
  }

  const handleSave = async () => {
    if (!track) return
    
    setSaving(true)
    setStatus(null)
    
    try {
      const updateData = {}
      if (formData.title && formData.title !== track.title) updateData.title = formData.title
      if (formData.artist && formData.artist !== track.artist) updateData.artist = formData.artist
      if (formData.album !== track.album) updateData.album = formData.album || null
      if (formData.album_artist !== track.album_artist) updateData.album_artist = formData.album_artist || null
      if (formData.track_num !== track.track_num) updateData.track_num = formData.track_num ? parseInt(formData.track_num) : null
      if (formData.year !== track.year) updateData.year = formData.year ? parseInt(formData.year) : null
      if (formData.genre !== track.genre) updateData.genre = formData.genre || null
      
      if (Object.keys(updateData).length > 0) {
        const result = await api.updateTrack(track.id, updateData)
        if (result?.error) {
          setStatus({ type: 'error', message: result.error })
        } else {
          setStatus({ type: 'success', message: 'Track updated!' })
          if (onSave) onSave({ ...track, ...updateData })
          setTimeout(() => {
            onClose()
          }, 1000)
        }
      } else {
        setStatus({ type: 'success', message: 'No changes to save' })
        setTimeout(() => setStatus(null), 2000)
      }
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    }
    
    setSaving(false)
  }

  const fetchFromiTunes = async () => {
    if (!track) return
    
    setSaving(true)
    setStatus({ type: 'loading', message: 'Searching iTunes for artwork...' })
    
    try {
      const result = await api.fetchExternalArtwork(track.id, track.title, track.artist)
      
      if (result?.success && result.artworkPath) {
        setArtworkPreview(api.isElectron ? `file://${result.artworkPath}` : api.artworkURL(track.id))
        setStatus({ type: 'success', message: 'Artwork found and updated!' })
        if (onSave) onSave({ ...track, artwork_path: result.artworkPath })
      } else {
        setStatus({ type: 'error', message: result?.error || 'No artwork found on iTunes' })
      }
    } catch (e) {
      setStatus({ type: 'error', message: e.message })
    }
    
    setSaving(false)
    setTimeout(() => setStatus(null), 3000)
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Track" width="max-w-lg">
      <div className="space-y-4">
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <div className="w-32 h-32 rounded-lg overflow-hidden bg-card border border-border relative group">
              {artworkPreview ? (
                <img src={artworkPreview} alt="Artwork" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted">
                  <Camera size={32} />
                </div>
              )}
              <button 
                onClick={handleSelectArtwork}
                disabled={saving}
                className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Camera size={24} className="text-white" />
              </button>
            </div>
          </div>
          
          <div className="flex-1 space-y-3">
            <div>
              <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Title</label>
              <input 
                value={formData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                placeholder="Track title"
              />
            </div>
            
            <div>
              <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Artist</label>
              <input 
                value={formData.artist}
                onChange={(e) => handleChange('artist', e.target.value)}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
                placeholder="Artist name"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Album</label>
          <input 
            value={formData.album}
            onChange={(e) => handleChange('album', e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
            placeholder="Album name"
          />
        </div>

        <div>
          <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Album Artist</label>
          <input 
            value={formData.album_artist}
            onChange={(e) => handleChange('album_artist', e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
            placeholder="Album artist (if different)"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Track #</label>
            <input 
              type="number"
              min="1"
              value={formData.track_num}
              onChange={(e) => handleChange('track_num', e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              placeholder="1"
            />
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Year</label>
            <input 
              type="number"
              min="1900"
              max="2100"
              value={formData.year}
              onChange={(e) => handleChange('year', e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              placeholder="2024"
            />
          </div>
          <div>
            <label className="text-xs font-display text-muted uppercase tracking-widest block mb-1">Genre</label>
            <input 
              value={formData.genre}
              onChange={(e) => handleChange('genre', e.target.value)}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
              placeholder="Rock"
            />
          </div>
        </div>

        <AnimatePresence>
          {status && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`p-3 rounded-lg flex items-center gap-2 ${
                status.type === 'success' ? 'bg-accent/20 text-accent' :
                status.type === 'error' ? 'bg-red-500/20 text-red-400' :
                'bg-card text-muted'
              }`}
            >
              {status.type === 'success' && <Check size={16} />}
              {status.type === 'error' && <AlertCircle size={16} />}
              {status.type === 'loading' && <RefreshCw size={16} className="animate-spin" />}
              <span className="text-sm">{status.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex gap-2 pt-2">
          <button 
            onClick={onClose}
            className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-2.5 bg-accent text-base rounded-xl text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {saving ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            Save Changes
          </button>
        </div>
      </div>
    </Modal>
  )
}

