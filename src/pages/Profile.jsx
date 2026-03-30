import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { Camera, BarChart2, LogIn, LogOut, UserRound, Heart, Clock3, Music4, TrendingUp, Disc3, Image as ImageIcon, Pencil } from 'lucide-react'
import { useAppStore } from '../store/player'
import { api } from '../api'
import PlaylistCover from '../components/PlaylistCover'

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="bg-elevated border border-border rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-display text-white">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  )
}

function bannerKey(userId) {
  return `lokal-profile-banner:${userId}`
}

function normalizeBio(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export default function Profile() {
  const nav = useNavigate()
  const avatarInputRef = useRef(null)
  const bannerInputRef = useRef(null)
  const bioInputRef = useRef(null)
  const { user, openAuth, openStats, openProfile, logout } = useAppStore()
  const [bannerData, setBannerData] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [topArtistProfile, setTopArtistProfile] = useState(null)
  const [playlists, setPlaylists] = useState([])
  const [editingBio, setEditingBio] = useState(false)
  const [bioDraft, setBioDraft] = useState('')
  const [savingBio, setSavingBio] = useState(false)

  useEffect(() => {
    if (!user?.id) {
      setStats(null)
      return
    }
    setStatsLoading(true)
    api.getUserStats(user.id).then((result) => {
      setStats(result || null)
      setStatsLoading(false)
    }).catch(() => {
      setStats(null)
      setStatsLoading(false)
    })
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) {
      setBannerData('')
      return
    }
    try {
      setBannerData(localStorage.getItem(bannerKey(user.id)) || '')
    } catch {
      setBannerData('')
    }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) {
      setPlaylists([])
      return
    }
    api.getPlaylists(user.id).then((result) => {
      setPlaylists(Array.isArray(result) ? result.slice(0, 6) : [])
    }).catch(() => setPlaylists([]))
  }, [user?.id])

  useEffect(() => {
    const topArtistName = String(stats?.topArtists?.[0]?.artist || '').trim()
    if (!topArtistName) {
      setTopArtistProfile(null)
      return
    }

    let cancelled = false
    api.getArtistsPage({ search: topArtistName, limit: 10, offset: 0 }).then((result) => {
      if (cancelled) return
      const artists = Array.isArray(result) ? result : result?.items
      const match = Array.isArray(artists)
        ? artists.find((artist) => String(artist?.name || '').trim().toLowerCase() === topArtistName.toLowerCase())
          || artists.find((artist) => String(artist?.name || '').trim().toLowerCase().includes(topArtistName.toLowerCase()))
        : null
      setTopArtistProfile(match || null)
    }).catch(() => {
      if (!cancelled) setTopArtistProfile(null)
    })

    return () => {
      cancelled = true
    }
  }, [stats?.topArtists])

  useEffect(() => {
    setBioDraft(user?.bio || '')
  }, [user?.bio])

  useEffect(() => {
    if (editingBio) bioInputRef.current?.focus()
  }, [editingBio])

  if (!user) {
    return (
      <div className="pb-8">
        <div className="relative h-56 overflow-hidden">
          <div className="w-full h-full bg-gradient-to-b from-accent/10 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20" />
          <div className="absolute bottom-5 left-8 flex items-end gap-5">
            <div className="w-24 h-24 rounded-full border-2 border-border overflow-hidden bg-elevated flex items-center justify-center">
              <UserRound size={34} className="text-muted" />
            </div>
            <div>
              <p className="text-xs font-display text-muted uppercase tracking-widest mb-1">Profile</p>
              <h1 className="text-3xl font-display text-white">Local profile</h1>
              <p className="text-xs text-muted mt-1">Lives on this app only and is not tied to any online service</p>
            </div>
          </div>
        </div>

        <div className="px-8 py-5 space-y-7 max-w-4xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => openAuth('login')}
              className="flex items-center gap-2 px-5 py-2 bg-accent text-base rounded-full font-medium text-sm hover:bg-accent-dim transition-colors"
            >
              <LogIn size={14} />
              Sign In / Register
            </button>
          </div>

          <section>
            <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-2">About</h2>
            <p className="text-sm text-muted leading-relaxed max-w-2xl">
              This is your personal Lokal identity for this device. Nothing here becomes a public profile and nothing is backed by a remote account.
            </p>
          </section>
        </div>
      </div>
    )
  }

  const avatarSrc = api.getAvatarSrc(user)
  const bannerSrc = bannerData || avatarSrc || ''
  const hours = stats ? Math.round((stats.totalMinutes || 0) / 60) : 0
  const topArtist = stats?.topArtists?.[0]?.artist || 'No listening data yet'
  const topArtistImageSrc = topArtistProfile?.id && topArtistProfile?.image_path
    ? (api.isElectron ? `file://${topArtistProfile.image_path}` : `/api/artist-image/${encodeURIComponent(topArtistProfile.id)}`)
    : null
  const topTrackData = stats?.topTracks?.[0] || null
  const topTrack = topTrackData ? `${topTrackData.title} · ${topTrackData.artist}` : 'No top track yet'
  const topTrackArt = topTrackData?.artwork_path
    ? (api.isElectron ? `file://${topTrackData.artwork_path}` : api.artworkURL(topTrackData.id))
    : null
  const topArtistSupport = stats?.topArtists?.[0]?.plays ? `${stats.topArtists[0].plays} plays` : 'From your local listening history'
  const topTrackSupport = topTrackData?.plays ? `${topTrackData.plays} plays` : 'Calculated from your local play activity'

  const saveBanner = (dataUrl) => {
    if (!user?.id) return
    try {
      localStorage.setItem(bannerKey(user.id), dataUrl)
      setBannerData(dataUrl)
    } catch {}
  }

  const handleBannerFile = async (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || '')
      if (!src) return
      const image = new Image()
      image.onload = () => {
        setUploadingBanner(true)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const targetWidth = 1600
        const targetHeight = 480
        const targetRatio = targetWidth / targetHeight
        const sourceRatio = image.width / image.height
        let sx = 0
        let sy = 0
        let sw = image.width
        let sh = image.height

        if (sourceRatio > targetRatio) {
          sw = image.height * targetRatio
          sx = (image.width - sw) / 2
        } else {
          sh = image.width / targetRatio
          sy = (image.height - sh) / 2
        }

        canvas.width = targetWidth
        canvas.height = targetHeight
        ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
        saveBanner(canvas.toDataURL('image/jpeg', 0.84))
        setUploadingBanner(false)
      }
      image.onerror = () => setUploadingBanner(false)
      image.src = src
    }
    reader.readAsDataURL(file)
  }

  const handleAvatarFile = async (file) => {
    if (!file || !user?.id) return
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || '')
      if (!src) return
      const image = new Image()
      image.onload = async () => {
        setUploadingAvatar(true)
        const size = Math.min(image.width, image.height)
        const offsetX = Math.max(0, (image.width - size) / 2)
        const offsetY = Math.max(0, (image.height - size) / 2)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        canvas.width = 320
        canvas.height = 320
        ctx.drawImage(image, offsetX, offsetY, size, size, 0, 0, 320, 320)
        const updated = await api.updateProfile({ userId: user.id, avatarData: canvas.toDataURL('image/jpeg', 0.88) })
        if (updated?.id) {
          const merged = { ...user, ...updated, avatar_updated_at: Date.now() }
          useAppStore.getState().setUser(merged)
          localStorage.setItem('lokal-user', JSON.stringify(merged))
        }
        setUploadingAvatar(false)
      }
      image.onerror = () => setUploadingAvatar(false)
      image.src = src
    }
    reader.readAsDataURL(file)
  }

  const saveBio = async () => {
    if (!user?.id) return
    setSavingBio(true)
    const updated = await api.updateProfile({ userId: user.id, bio: normalizeBio(bioDraft) })
    if (updated?.id) {
      const merged = { ...user, ...updated }
      useAppStore.getState().setUser(merged)
      localStorage.setItem('lokal-user', JSON.stringify(merged))
    }
    setSavingBio(false)
    setEditingBio(false)
  }

  return (
    <div className="pb-8">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          await handleAvatarFile(file)
        }}
        className="hidden"
      />
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          await handleBannerFile(file)
        }}
        className="hidden"
      />

      <div className="relative h-56 overflow-hidden group">
        {bannerSrc ? (
          <img src={bannerSrc} alt="Banner" className="w-full h-full object-cover opacity-40" />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-accent/8 to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20" />
        <button
          onClick={() => bannerInputRef.current?.click()}
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-black/20"
          aria-label="Upload banner"
        >
          <span className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-black/55 border border-white/10 text-xs text-white/80 backdrop-blur-sm">
            <ImageIcon size={12} /> {uploadingBanner ? 'Uploading banner...' : 'Upload banner'}
          </span>
        </button>
        <div className="absolute bottom-5 left-8 flex items-end gap-5">
          <button onClick={() => avatarInputRef.current?.click()} className="relative flex-shrink-0 group/avatar">
            <div className="w-24 h-24 rounded-full border-2 border-border overflow-hidden bg-elevated flex items-center justify-center">
              {user.avatar_path ? (
                <img src={avatarSrc} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="text-3xl font-display text-accent">{(user.display_name || user.username)?.[0]?.toUpperCase()}</span>
              )}
            </div>
            <div className="absolute inset-0 rounded-full bg-black/55 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/50 text-[11px] text-white/85">
                <Camera size={11} /> {uploadingAvatar ? 'Uploading...' : 'Upload'}
              </span>
            </div>
          </button>
          <div>
            <p className="text-xs font-display text-muted uppercase tracking-widest mb-1">Profile</p>
            <h1 className="text-3xl font-display text-white">{user.display_name || user.username}</h1>
            <p className="text-xs text-muted mt-1">@{user.username} · local only</p>
          </div>
        </div>
        <div className="absolute top-4 right-6 flex items-center gap-2">
          <button
            onClick={openProfile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs text-white/60 hover:text-white hover:border-white/20 transition-all backdrop-blur-sm"
          >
            <Pencil size={12} /> Edit Profile
          </button>
          <button
            onClick={openStats}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs text-white/60 hover:text-white hover:border-white/20 transition-all backdrop-blur-sm"
          >
            <BarChart2 size={12} /> Stats
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/50 border border-white/10 text-xs text-white/60 hover:text-red-300 hover:border-white/20 transition-all backdrop-blur-sm"
          >
            <LogOut size={12} /> Sign Out
          </button>
        </div>
      </div>

      <div className="px-8 py-5 space-y-7">
        <section>
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="text-xs font-display text-muted uppercase tracking-widest">About</h2>
            <button
              onClick={() => {
                setBioDraft(user.bio || '')
                setEditingBio(true)
              }}
              className="text-muted hover:text-white transition-colors"
            >
              <Pencil size={14} />
            </button>
          </div>
          {editingBio ? (
            <div className="max-w-2xl space-y-3">
              <textarea
                ref={bioInputRef}
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value.replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n'))}
                rows={4}
                className="w-full bg-card border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-muted/60 outline-none focus:border-accent/60 resize-none transition-colors"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={saveBio}
                  disabled={savingBio}
                  className="px-4 py-2 bg-accent text-base rounded-full text-sm font-medium hover:bg-accent-dim disabled:opacity-50 transition-colors"
                >
                  {savingBio ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditingBio(false)
                    setBioDraft(user.bio || '')
                  }}
                  className="px-4 py-2 bg-elevated border border-border text-white/80 rounded-full text-sm font-medium hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted leading-relaxed max-w-2xl whitespace-pre-line">
              {normalizeBio(user.bio) || 'No bio set yet.'}
            </p>
          )}
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,0.48fr)_minmax(0,0.52fr)] gap-6 items-start max-w-6xl">
          <div className="space-y-6">
            <section className="bg-elevated border border-border rounded-2xl p-5">
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-4">Snapshot</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <StatTile icon={Music4} label="Total Plays" value={statsLoading ? '...' : (stats?.totalPlays || 0).toLocaleString()} />
                <StatTile icon={Clock3} label="Hours Listened" value={statsLoading ? '...' : `${hours}h`} />
                <StatTile icon={Heart} label="Liked Tracks" value={statsLoading ? '...' : String(stats?.likedCount || 0)} />
                <StatTile icon={TrendingUp} label="This Week" value={statsLoading ? '...' : String(stats?.weeklyPlays || 0)} />
              </div>
            </section>

            <section>
              <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Highlights</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-elevated border border-border rounded-xl p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-card border border-border flex items-center justify-center overflow-hidden flex-shrink-0">
                      {topArtistImageSrc ? (
                        <img src={topArtistImageSrc} alt={topArtist} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl font-display text-accent">{topArtist?.[0]?.toUpperCase() || 'A'}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-white">Top Artist</p>
                      <p className="text-xs text-muted">{topArtistSupport}</p>
                    </div>
                  </div>
                  <p className="text-sm text-white mt-4 truncate">{topArtist}</p>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.06 }}
                  className="bg-elevated border border-border rounded-xl p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-card border border-border overflow-hidden flex items-center justify-center flex-shrink-0">
                      {topTrackArt ? (
                        <img src={topTrackArt} alt="Top track" className="w-full h-full object-cover" />
                      ) : (
                        <Music4 size={20} className="text-accent" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-white">Top Track</p>
                      <p className="text-xs text-muted">{topTrackSupport}</p>
                    </div>
                  </div>
                  <p className="text-sm text-white mt-4 truncate">{topTrackData?.title || 'No top track yet'}</p>
                  <p className="text-xs text-muted truncate mt-1">{topTrackData?.artist || ''}</p>
                </motion.div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            {!!playlists.length && (
              <section>
                <h2 className="text-xs font-display text-muted uppercase tracking-widest mb-3">Playlists</h2>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                  {playlists.map((playlist) => (
                    <motion.button
                      key={playlist.id}
                      onClick={() => nav(`/playlist/${playlist.id}`)}
                      whileHover={{ scale: 1.02 }}
                      className="rounded-xl border bg-elevated border-border hover:border-accent/30 transition-all text-left overflow-hidden"
                    >
                      <div className="p-3">
                        <PlaylistCover playlistId={playlist.id} size={128} className="rounded-lg w-32 h-32 mx-auto" />
                      </div>
                      <div className="px-3 pb-3">
                        <p className="text-sm font-medium text-white truncate">{playlist.name}</p>
                        <p className="text-xs text-muted truncate mt-1">{playlist.description || 'Local playlist'}</p>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
