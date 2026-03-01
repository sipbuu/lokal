import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronRight, Music, Maximize2, Mic2, Disc3 } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import LyricsPanel from './LyricsPanel'
import { api } from '../api'

function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-xs font-display text-muted uppercase tracking-wider w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-white/70 leading-relaxed break-all">{value}</span>
    </div>
  )
}

export default function RightSidebar() {
  const { showRightSidebar, toggleRightSidebar, currentTrack, isPlaying, progress, toggleFullscreen, toggleLyricsFullscreen } = usePlayerStore()
  const [tab, setTab] = useState('info')
  const wordSync = localStorage.getItem('word-sync') === '1'

  const artSrc = currentTrack?.artwork_path
    ? (api.isElectron ? `file://${currentTrack.artwork_path}` : api.artworkURL(currentTrack.id))
    : null

  return (
    <AnimatePresence>
      {showRightSidebar && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 300, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="bg-surface border-l border-border overflow-hidden flex-shrink-0 flex flex-col"
          style={{ minWidth: 300 }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0 border-b border-border">
            <div className="flex gap-0.5 p-0.5 bg-card rounded-lg border border-border/50">
              {[['info', 'Details'], ['lyrics', 'Lyrics']].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)} className={`px-3 py-1 text-xs font-display uppercase tracking-wider rounded transition-colors ${tab === id ? 'bg-accent text-base' : 'text-muted hover:text-white'}`}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={toggleRightSidebar} className="text-muted hover:text-white transition-colors ml-2">
              <ChevronRight size={16} />
            </button>
          </div>

          {tab === 'info' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-card border border-border/50">
                <AnimatePresence mode="wait">
                  {artSrc ? (
                    <motion.img key={currentTrack?.id} src={artSrc} initial={{ opacity: 0, scale: 1.04 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-subtle"><Music size={52} /></div>
                  )}
                </AnimatePresence>
              </div>

              <AnimatePresence mode="wait">
                <motion.div key={currentTrack?.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                  <p className="font-display text-white text-sm leading-tight">{currentTrack?.title || 'Nothing playing'}</p>
                  <p className="text-xs text-muted mt-0.5">{currentTrack?.artist}</p>
                </motion.div>
              </AnimatePresence>

              {currentTrack && (
                <div className="flex gap-2">
                  <button onClick={toggleFullscreen} className="flex-1 py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                    <Disc3 size={11} /> Full Screen
                  </button>
                  <button onClick={toggleLyricsFullscreen} className="flex-1 py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                    <Mic2 size={11} /> Lyrics
                  </button>
                </div>
              )}

              {currentTrack && (
                <div className="bg-card rounded-xl border border-border px-4 py-1">
                  <InfoRow label="Artist" value={currentTrack.artist} />
                  <InfoRow label="Album" value={currentTrack.album} />
                  {currentTrack.album_artist && currentTrack.album_artist !== currentTrack.artist && <InfoRow label="Alb. Artist" value={currentTrack.album_artist} />}
                  <InfoRow label="Year" value={currentTrack.year} />
                  <InfoRow label="Genre" value={currentTrack.genre} />
                  <InfoRow label="Track #" value={currentTrack.track_num ? `${currentTrack.track_num}` : null} />
                  <InfoRow label="Bitrate" value={currentTrack.bitrate ? `${currentTrack.bitrate} kbps` : null} />
                  <InfoRow label="Plays" value={currentTrack.play_count > 0 ? `${currentTrack.play_count}` : null} />
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden min-h-0">
                {currentTrack ? (
                  <LyricsPanel track={currentTrack} progress={progress} darkMode wordSync={wordSync} fullscreen={false} textScale={1.4} />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted text-xs">No track playing</div>
                )}
              </div>
              <div className="p-3 border-t border-border flex-shrink-0">
                <button onClick={toggleLyricsFullscreen} className="w-full py-2 bg-card border border-border rounded-xl text-xs text-muted hover:text-white hover:border-accent/30 transition-all font-display uppercase tracking-wider flex items-center justify-center gap-1.5">
                  <Maximize2 size={11} /> Expand Lyrics
                </button>
              </div>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
