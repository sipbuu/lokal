import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CalendarRange, Clock3, Disc3, Music4, Play, Plus, Sparkles, Users, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import { useAppStore, usePlayerStore } from '../store/player'

function fmtMinutes(minutes) {
  if (!minutes) return '0 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

function fmtHour(hour) {
  if (hour === null || hour === undefined || Number.isNaN(Number(hour))) return 'No peak yet'
  const suffix = Number(hour) >= 12 ? 'PM' : 'AM'
  const normalized = Number(hour) % 12 || 12
  return `${normalized}:00 ${suffix}`
}

function trackArt(track) {
  if (!track?.artwork_path) return ''
  return api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)
}

export default function RecapStories({ open, onClose }) {
  const { user } = useAppStore()
  const { playTrack, playQueue } = usePlayerStore()
  const [recap, setRecap] = useState(null)
  const [loading, setLoading] = useState(false)
  const [recapSource, setRecapSource] = useState('user')
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0)
  const [playlistStatus, setPlaylistStatus] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setActiveIndex(0)
    setSelectedTrackIndex(0)
    setPlaylistStatus('')
    const loadRecap = async () => {
      try {
        const primary = await api.getUserRecap(user?.id)
        if (primary?.topTracks?.length || primary?.totalPlays || !user?.id) {
          setRecap(primary || null)
          setRecapSource(user?.id ? 'user' : 'guest')
          setLoading(false)
          return
        }

        const guestFallback = await api.getUserRecap('guest')
        setRecap(guestFallback || null)
        setRecapSource('guest')
      } catch {
        setRecap(null)
        setRecapSource(user?.id ? 'user' : 'guest')
      } finally {
        setLoading(false)
      }
    }

    loadRecap().catch(() => {
      setRecap(null)
      setRecapSource(user?.id ? 'user' : 'guest')
      setLoading(false)
    })
  }, [open, user?.id])

  const slides = useMemo(() => {
    const topTrack = recap?.topTracks?.[0] || null
    const secondTrack = recap?.topTracks?.[1] || topTrack
    const thirdTrack = recap?.topTracks?.[2] || secondTrack || topTrack
    const topArtist = recap?.topArtists?.[0] || null
    const topGenre = recap?.topGenres?.[0] || null
    return [
      {
        key: 'hero',
        track: topTrack,
      },
      {
        key: 'pulse',
        track: secondTrack,
      },
      {
        key: 'artist',
        track: thirdTrack,
        topArtist,
        topGenre,
      },
      {
        key: 'top-five',
        track: topTrack,
      },
      {
        key: 'top-fifty',
        track: recap?.topTracks?.[selectedTrackIndex] || topTrack,
      },
    ]
  }, [recap, selectedTrackIndex])

  useEffect(() => {
    if (!open) return
    const current = slides[activeIndex]
    if (!current?.track?.id) return
    playTrack(current.track, recap?.topTracks || [current.track])
  }, [open, activeIndex, slides, recap?.topTracks, playTrack])

  useEffect(() => {
    if (!open) return
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowRight') setActiveIndex((index) => Math.min(index + 1, slides.length - 1))
      if (event.key === 'ArrowLeft') setActiveIndex((index) => Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, slides.length])

  const saveTopTracks = async () => {
    if (!recap?.topTracks?.length) return
    const playlist = await api.createPlaylist('Dev Recap Top 50', user?.id)
    if (!playlist?.id) {
      setPlaylistStatus('Could not create playlist')
      return
    }
    await api.addMultipleToPlaylist(playlist.id, recap.topTracks.map(track => track.id))
    setPlaylistStatus('Saved Dev Recap Top 50')
    window.dispatchEvent(new CustomEvent('lokal:playlists-changed'))
  }

  const background = trackArt(slides[activeIndex]?.track)
  const topTracks = recap?.topTracks || []
  const topFive = topTracks.slice(0, 5)
  const heroStrip = topTracks.slice(0, 6)
  const nextSlide = () => setActiveIndex((index) => Math.min(index + 1, slides.length - 1))
  const prevSlide = () => setActiveIndex((index) => Math.max(index - 1, 0))
  const handleStorySurfaceClick = (event) => {
    const interactive = event.target instanceof Element
      ? event.target.closest('button, a, input, textarea, select, [data-recap-interactive="true"]')
      : null
    if (interactive) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const isLeftSide = event.clientX - bounds.left < bounds.width / 2
    if (isLeftSide) prevSlide()
    else nextSlide()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] overflow-hidden bg-black"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_32%),linear-gradient(180deg,rgba(0,0,0,0.24),rgba(0,0,0,0.7))]" />
          {background && (
            <div
              className="absolute inset-0 bg-cover bg-center opacity-40 blur-2xl scale-110"
              style={{ backgroundImage: `url("${background}")` }}
            />
          )}

          <div className="relative flex h-full flex-col px-5 pb-6 pt-4 sm:px-8">
            <div className="mb-4 flex items-center gap-2">
              {slides.map((slide, index) => (
                <div key={slide.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/12">
                  <motion.div
                    className="h-full rounded-full bg-white"
                    animate={{
                      width: index <= activeIndex ? '100%' : '0%'
                    }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                  />
                </div>
              ))}
            </div>

            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-white/55">Dev Story Recap</div>
                <div className="mt-1 text-sm text-white/75">
                  {recapSource === 'guest' ? 'Guest history fallback active.' : 'Prototype preview.'}
                </div>
              </div>
              <button
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 transition-colors hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            <div
              className="relative flex-1 overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(165deg,rgba(20,20,28,0.95),rgba(10,10,14,0.88))] p-6 sm:p-8"
              onClick={handleStorySurfaceClick}
            >
              <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,214,102,0.16),transparent_28%,transparent_72%,rgba(86,198,255,0.18))]" />

              <AnimatePresence mode="wait">
                <motion.div
                  key={slides[activeIndex]?.key}
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.22 }}
                  className="relative z-10 h-full"
                >
                  {loading && (
                    <div className="flex h-full items-center justify-center text-sm text-white/60">
                      Building your dev recap...
                    </div>
                  )}

                  {!loading && !recap && (
                    <div className="flex h-full items-center justify-center text-sm text-white/60">
                      No listening data yet.
                    </div>
                  )}

                  {!loading && recap && activeIndex === 0 && (
                    <div className="flex h-full flex-col justify-between">
                      <div>
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                          <CalendarRange size={12} />
                          All-Time Dev Snapshot
                        </div>
                        <h1 className="mt-4 max-w-3xl text-4xl font-display leading-none text-white sm:text-6xl">
                          {user?.display_name || user?.username || 'You'} in motion.
                        </h1>
                        <p className="mt-4 max-w-2xl text-sm leading-7 text-white/68">
                          Example
                        </p>
                        <div className="mt-6 flex gap-3 overflow-hidden">
                          {heroStrip.map((track, index) => (
                            <button
                              key={track.id}
                              onClick={() => playTrack(track, topTracks)}
                              data-recap-interactive="true"
                              className="group relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-3xl border border-white/10 bg-white/5"
                            >
                              {trackArt(track) ? (
                                <img src={trackArt(track)} alt={track.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-white/25">
                                  <Disc3 size={22} />
                                </div>
                              )}
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-6 text-left">
                                <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">#{index + 1}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Minutes</div>
                          <div className="mt-2 text-3xl font-display text-white">{recap.totalMinutes || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Artists</div>
                          <div className="mt-2 text-3xl font-display text-white">{recap.uniqueArtists || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Albums</div>
                          <div className="mt-2 text-3xl font-display text-white">{recap.uniqueAlbums || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Tracks</div>
                          <div className="mt-2 text-3xl font-display text-white">{recap.uniqueTracks || 0}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!loading && recap && activeIndex === 1 && (
                    <div className="grid h-full gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                      <div className="flex flex-col justify-between">
                        <div>
                          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                            <Clock3 size={12} />
                            Listening Pulse
                          </div>
                          <h2 className="mt-4 text-3xl font-display text-white sm:text-5xl">
                            Your library lives most at {fmtHour(recap.peakHour?.hour)}.
                          </h2>
                          <p className="mt-4 max-w-xl text-sm leading-7 text-white/68">
                            Example
                          </p>
                          <div className="mt-6 overflow-hidden rounded-[30px] border border-white/10 bg-black/20">
                            {trackArt(slides[1]?.track) ? (
                              <img src={trackArt(slides[1]?.track)} alt={slides[1]?.track?.title} className="h-56 w-full object-cover" />
                            ) : (
                              <div className="flex h-56 w-full items-center justify-center text-white/20">
                                <Music4 size={28} />
                              </div>
                            )}
                            <div className="flex items-center justify-between px-5 py-4">
                              <div>
                                <div className="text-sm text-white">{slides[1]?.track?.title || 'No track'}</div>
                                <div className="text-xs text-white/50">{slides[1]?.track?.artist || 'No artist'}</div>
                              </div>
                              <button
                                onClick={() => slides[1]?.track && playTrack(slides[1].track, topTracks)}
                                data-recap-interactive="true"
                                className="rounded-full border border-white/10 bg-white/5 p-2 text-white/80 transition-colors hover:text-white"
                              >
                                <Play size={14} fill="currentColor" />
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Total Plays</div>
                            <div className="mt-2 text-2xl font-display text-white">{recap.totalPlays || 0}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Liked Tracks</div>
                            <div className="mt-2 text-2xl font-display text-white">{recap.likedCount || 0}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Listen Time</div>
                            <div className="mt-2 text-2xl font-display text-white">{fmtMinutes(recap.totalMinutes || 0)}</div>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Top Genres</div>
                        <div className="mt-4 grid gap-3">
                          {(recap.topGenres || []).slice(0, 5).map((genre, index) => (
                            <div key={genre.genre || index} className="rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm text-white">{genre.genre || 'Unknown genre'}</div>
                                <div className="text-xs text-white/50">{genre.plays} plays</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {!loading && recap && activeIndex === 2 && (
                    <div className="grid h-full gap-6 lg:grid-cols-[1fr_1fr]">
                      <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                          <Users size={12} />
                          Artist Spotlight
                        </div>
                        <h2 className="mt-5 text-4xl font-display text-white">{slides[2]?.topArtist?.artist || 'No top artist yet'}</h2>
                        <div className="mt-3 text-sm text-white/60">{slides[2]?.topArtist?.plays || 0} plays</div>
                        <p className="mt-6 max-w-lg text-sm leading-7 text-white/68">
                          Example
                        </p>
                        <div className="mt-6 grid grid-cols-3 gap-3">
                          {topTracks.filter(track => track.artist === slides[2]?.topArtist?.artist).slice(0, 3).map((track) => (
                            <button
                              key={track.id}
                              onClick={() => playTrack(track, topTracks)}
                              data-recap-interactive="true"
                              className="overflow-hidden rounded-2xl border border-white/10 bg-black/20"
                            >
                              {trackArt(track) ? (
                                <img src={trackArt(track)} alt={track.title} className="h-28 w-full object-cover" />
                              ) : (
                                <div className="flex h-28 w-full items-center justify-center text-white/20">
                                  <Disc3 size={18} />
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-4">
                        {(recap.topArtists || []).slice(0, 5).map((artist, index) => (
                          <div key={artist.artist || index} className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-white/35">#{index + 1}</div>
                                <div className="mt-1 text-lg text-white">{artist.artist}</div>
                              </div>
                              <div className="text-sm text-white/55">{artist.plays} plays</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!loading && recap && activeIndex === 3 && (
                    <div className="flex h-full flex-col">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                          <Music4 size={12} />
                          Top Five Tracks
                        </div>
                        <p className="mt-4 max-w-xl text-sm leading-7 text-white/68">
                          Example
                        </p>
                      <div className="mt-5 grid flex-1 gap-4 lg:grid-cols-5">
                        {topFive.map((track, index) => (
                          <button
                            key={track.id}
                            onClick={() => playTrack(track, topTracks)}
                            className="group flex flex-col overflow-hidden rounded-[28px] border border-white/10 bg-black/20 text-left"
                          >
                            <div className="aspect-square bg-black/30">
                              {trackArt(track) ? (
                                <img src={trackArt(track)} alt={track.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-white/30">
                                  <Disc3 size={28} />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 p-4">
                              <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">#{index + 1}</div>
                              <div className="mt-2 line-clamp-2 text-sm text-white">{track.title}</div>
                              <div className="mt-1 line-clamp-1 text-xs text-white/55">{track.artist}</div>
                              <div className="mt-4 text-xs text-accent">{track.plays} plays</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {!loading && recap && activeIndex === 4 && (
                    <div className="grid h-full gap-6 lg:grid-cols-[0.92fr_1.08fr]">
                      <div className="flex flex-col rounded-[30px] border border-white/10 bg-black/20 p-5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-white/55">
                          <Sparkles size={12} />
                          Top 50
                        </div>
                        <h2 className="mt-4 text-3xl font-display text-white">Save your Top 50.</h2>
                        <p className="mt-3 text-sm leading-7 text-white/68">
                          Example
                        </p>
                        <div className="mt-6 overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.04]">
                          <div className="aspect-[4/3] bg-black/30">
                            {trackArt(topTracks[selectedTrackIndex]) ? (
                              <img src={trackArt(topTracks[selectedTrackIndex])} alt={topTracks[selectedTrackIndex]?.title} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-white/30">
                                <Disc3 size={32} />
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-white/35">
                              #{selectedTrackIndex + 1}
                            </div>
                            <div className="mt-2 text-xl font-display text-white">
                              {topTracks[selectedTrackIndex]?.title || 'No track yet'}
                            </div>
                            <div className="mt-1 text-sm text-white/58">
                              {topTracks[selectedTrackIndex]?.artist || 'No artist yet'}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 grid gap-2">
                          <button
                            onClick={() => playQueue(topTracks, selectedTrackIndex)}
                            data-recap-interactive="true"
                            className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-base transition-colors hover:bg-accent/85"
                          >
                            <Play size={14} />
                            Play Top 50
                          </button>
                          <button
                            onClick={saveTopTracks}
                            data-recap-interactive="true"
                            className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/78 transition-colors hover:text-white"
                          >
                            <Plus size={14} />
                            Add Top 50 To Library
                          </button>
                          {playlistStatus ? <div className="text-xs text-accent">{playlistStatus}</div> : null}
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-[30px] border border-white/10 bg-black/20">
                        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                          <div className="text-sm font-display uppercase tracking-[0.18em] text-white">Ranked List</div>
                          <div className="text-xs text-white/45">Click a song to make it the active story soundtrack</div>
                        </div>
                        <div className="max-h-[68vh] overflow-y-auto px-2 py-2">
                          {topTracks.map((track, index) => (
                            <button
                              key={track.id}
                              onClick={() => {
                                setSelectedTrackIndex(index)
                                playTrack(track, topTracks)
                              }}
                              data-recap-interactive="true"
                              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${selectedTrackIndex === index ? 'bg-accent/12' : 'hover:bg-white/[0.04]'}`}
                            >
                              <div className="w-8 text-center text-xs font-display text-white/45">{index + 1}</div>
                              <div className="h-12 w-12 overflow-hidden rounded-xl bg-black/20">
                                {trackArt(track) ? (
                                  <img src={trackArt(track)} alt={track.title} className="h-full w-full object-cover" />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-white/20">
                                    <Disc3 size={16} />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm text-white">{track.title}</div>
                                <div className="truncate text-xs text-white/50">{track.artist}</div>
                              </div>
                              <div className="text-xs text-white/40">{track.plays}x</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-white/45" data-recap-interactive="true">
              <div>Tap right to advance. Tap left to go back.</div>
              <div className="flex items-center gap-3">
                <button onClick={prevSlide} data-recap-interactive="true" className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-white/72 transition-colors hover:text-white">
                  <ChevronLeft size={14} />
                  Prev
                </button>
                <button onClick={nextSlide} data-recap-interactive="true" className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-white/72 transition-colors hover:text-white">
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <button className="absolute inset-y-20 left-0 z-0 w-1/3" onClick={prevSlide} aria-label="Previous story" />
            <button className="absolute inset-y-20 right-0 z-0 w-1/3" onClick={nextSlide} aria-label="Next story" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
