import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Clock, Music, Heart, TrendingUp, BarChart2 } from 'lucide-react'
import Modal from './Modal'
import { useAppStore } from '../store/player'
import { api } from '../api'

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${accent || 'bg-accent/15'}`}>
        <Icon size={16} className="text-accent" />
      </div>
      <div>
        <p className="text-lg font-display text-white font-bold">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  )
}

export default function StatsModal() {
  const { showStatsModal, closeStats, user } = useAppStore()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!showStatsModal || !user?.id) return
    setLoading(true)
    api.getUserStats(user.id).then(s => { setStats(s); setLoading(false) })
  }, [showStatsModal, user?.id])

  const hours = stats ? Math.round(stats.totalMinutes / 60) : 0

  return (
    <Modal open={showStatsModal} onClose={closeStats} title="Listening Stats" width="max-w-xl">
      {loading && <p className="text-muted text-sm text-center py-6">Loading stats…</p>}
      {!loading && !stats && <p className="text-muted text-sm text-center py-6">No stats yet — start listening!</p>}
      {stats && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <StatCard icon={Music} label="Total Plays" value={stats.totalPlays.toLocaleString()} />
            <StatCard icon={Clock} label="Hours Listened" value={`${hours}h`} />
            <StatCard icon={Heart} label="Liked Tracks" value={stats.likedCount} />
            <StatCard icon={TrendingUp} label="This Week" value={stats.weeklyPlays} />
          </div>

          {stats.topArtists?.length > 0 && (
            <div>
              <h3 className="text-xs font-display text-muted uppercase tracking-widest mb-2">Top Artists</h3>
              <div className="space-y-1.5">
                {stats.topArtists.map((a, i) => (
                  <div key={a.artist} className="flex items-center gap-3">
                    <span className="text-xs text-muted w-4 font-display">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm text-white truncate">{a.artist}</span>
                        <span className="text-xs text-muted ml-2 flex-shrink-0">{a.plays} plays</span>
                      </div>
                      <div className="h-0.5 bg-border rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-accent rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${(a.plays / stats.topArtists[0].plays) * 100}%` }}
                          transition={{ delay: i * 0.06, duration: 0.5 }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.topTracks?.length > 0 && (
            <div>
              <h3 className="text-xs font-display text-muted uppercase tracking-widest mb-2">Top Tracks</h3>
              <div className="space-y-1">
                {stats.topTracks.map((t, i) => (
                  <div key={t.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-card transition-colors">
                    <span className="text-xs text-muted w-4 font-display">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{t.title}</p>
                      <p className="text-xs text-muted truncate">{t.artist}</p>
                    </div>
                    <span className="text-xs text-muted">{t.plays}×</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stats.topGenres?.length > 0 && (
            <div>
              <h3 className="text-xs font-display text-muted uppercase tracking-widest mb-2">Top Genres</h3>
              <div className="flex flex-wrap gap-2">
                {stats.topGenres.map((g, i) => (
                  <span key={g.genre} className="px-3 py-1 bg-accent/10 border border-accent/25 text-accent rounded-full text-xs font-display" style={{ opacity: 1 - i * 0.15 }}>
                    {g.genre} · {g.plays}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
