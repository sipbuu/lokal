import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BarChart3, CalendarRange, ChevronLeft, ChevronRight, Clock3, Disc3, ListMusic, Play, Plus, RefreshCw, Sparkles, X } from 'lucide-react'
import { api } from '../api'
import { useAppStore, usePlayerStore } from '../store/player'
import TrackList from '../components/TrackList'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const GENRE_COMMENTS = {
  'slowcore': "staring at the ceiling again, i see.",
  'lo-fi': "staying productive, or just daydreaming?",
  'techno': "we get it, you're at a warehouse rave in your head.",
  'shoegaze': "can you even hear the lyrics through all that fuzz?",
  'metal': "your neighbors probably hate you. keep it up.",
  'pop': "no thoughts, just vibes and hooks.",
  'ambient': "is this music or just background noise for your naps?",
  'default': "this was your top sound."
}

function fmtMinutes(minutes) {
  if (!minutes) return '0 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins ? `${hours}h ${mins}m` : `${hours}h`
}

function fmtDate(seconds) {
  if (!seconds) return ''
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtHour(hour) {
  if (hour === null || hour === undefined || Number.isNaN(Number(hour))) return 'No peak yet'
  const suffix = Number(hour) >= 12 ? 'PM' : 'AM'
  const normalized = Number(hour) % 12 || 12
  return `${normalized}:00 ${suffix}`
}

function hourComment(hour) {
  const n = Number(hour)
  if (!Number.isFinite(n)) return "the data kept its secrets."
  if (n >= 5 && n < 8) return "early bird? or just haven't gone to bed yet?"
  if (n >= 12 && n < 14) return "the midday slump needed a soundtrack."
  if (n >= 18 && n < 21) return "the main character energy is peaking."
  if (n >= 23 || n < 4) return "ooh... late night listener are you?"
  return "this was your peak vibe hour."
}

function sessionComment(session) {
  const label = String(session?.label || '').toLowerCase()
  if (label.includes('late night')) return "you're a certified night owl."
  if (label.includes('morning')) return "suspiciously productive behavior."
  if (label.includes('afternoon')) return "the slump hit you hard, didn't it?"
  if (label.includes('evening')) return "the library opened up when the sun went down."
  return "this session had a very specific shape."
}

function trackArt(track) {
  if (!track?.artwork_path) return ''
  return api.isElectron ? api.fileURL(track.artwork_path) : api.artworkURL(track.id)
}

function isFallbackGenre(genre) {
  return String(genre || '').trim().toLowerCase() === 'music'
}

function filteredGenres(genres = []) {
  return genres.filter(genre => !isFallbackGenre(genre.genre))
}

function genreComment(genre) {
  const key = String(genre || '').trim().toLowerCase()
  return GENRE_COMMENTS[key] || GENRE_COMMENTS['default']
}

function periodEnd(period) {
  if (period.scope === 'year') return new Date(period.year + 1, 0, 1)
  if (period.scope === 'quarter') return new Date(period.year, period.quarter * 3, 1)
  return new Date()
}

function periodMonths(period) {
  if (period.scope === 'year') return { start: 0, end: 11 }
  const start = (period.quarter - 1) * 3
  return { start, end: start + 2 }
}

function periodTitle(period) {
  if (!period) return 'Recap'
  const { start, end } = periodMonths(period)
  return `${MONTHS[start]}-${MONTHS[end]} ${period.year} Recap`
}

function periodLabel(period) {
  if (!period) return ''
  const { start, end } = periodMonths(period)
  return `${SHORT_MONTHS[start]}-${SHORT_MONTHS[end]} ${period.year}`
}

function buildPeriods() {
  const now = new Date()
  const year = now.getFullYear()
  const periods = []
  for (let y = year; y >= year - 3; y -= 1) {
    const yearly = { id: `year-${y}`, scope: 'year', year: y }
    if (periodEnd(yearly) <= now) periods.push({ ...yearly, label: periodLabel(yearly), title: periodTitle(yearly), completedAt: periodEnd(yearly).getTime() })
  }
  for (let y = year; y >= year - 2; y -= 1) {
    for (let q = 4; q >= 1; q -= 1) {
      const quarterly = { id: `q${q}-${y}`, scope: 'quarter', year: y, quarter: q }
      if (periodEnd(quarterly) <= now) periods.push({ ...quarterly, label: periodLabel(quarterly), title: periodTitle(quarterly), completedAt: periodEnd(quarterly).getTime() })
    }
  }
  return periods.sort((left, right) => right.completedAt - left.completedAt)
}

function getLatestCompletedPeriodId(periods) {
  return periods[0]?.id || ''
}

function daysText(minutes) {
  const days = (Number(minutes || 0) / 1440)
  if (days < 1) return "less than a day, but still very real"
  return `${days.toFixed(days >= 10 ? 0 : 1)} days of straight music`
}

function albumArt(album, tracks = []) {
  const match = tracks.find(track => track.album === album?.album && track.artwork_path)
  return trackArt(match)
}

function artistAlbumName(artist, albums = [], tracks = []) {
  const direct = tracks.find(track => track.artist === artist?.artist && track.album)
  if (direct?.album) return direct.album
  return albums[0]?.album || 'one song'
}

function Metric({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl border border-border bg-elevated/80 p-4">
      <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted">
        <Icon size={12} />
        {label}
      </div>
      <div className="mt-3 text-2xl font-display text-white">{value}</div>
    </div>
  )
}

function SessionCard({ session, index, onPlay }) {
  const genres = filteredGenres(session.topGenres || []).slice(0, 3)
  const topArtist = session.topArtists?.[0]
  const previewTracks = (session.tracks || []).slice(0, 4)
  const duration = fmtMinutes(session.durationMinutes || 0)

  return (
    <motion.button
      key={session.id || index}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={onPlay}
      className="group overflow-hidden rounded-xl border border-border bg-elevated text-left transition-colors hover:border-accent/35"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-display text-white">{session.label}</p>
              <p className="mt-1 text-xs text-muted">{fmtDate(session.start)}</p>
            </div>
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-accent transition-colors group-hover:bg-accent group-hover:text-base">
              <Play size={14} fill="currentColor" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">Time</div>
              <div className="mt-1 truncate text-sm text-white">{duration}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">Tracks</div>
              <div className="mt-1 text-sm text-white">{session.trackCount || 0}</div>
            </div>
            <div className="rounded-lg border border-border/70 bg-card px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-muted">Skips</div>
              <div className="mt-1 text-sm text-white">{session.skippedCount || 0}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {topArtist?.artist && (
              <span className="max-w-full truncate rounded-full border border-accent/25 bg-accent/10 px-2.5 py-1 text-[10px] text-accent">
                {topArtist.artist}
              </span>
            )}
            {genres.map(genre => (
              <span key={genre.genre} className="max-w-full truncate rounded-full border border-border bg-card px-2.5 py-1 text-[10px] text-muted">{genre.genre}</span>
            ))}
          </div>
        </div>

        <div className="grid w-full grid-cols-4 gap-2 sm:w-32 sm:grid-cols-2">
          {previewTracks.map((track, trackIndex) => {
            const art = trackArt(track)
            return (
              <div key={track.id || trackIndex} className="aspect-square overflow-hidden rounded-lg bg-card">
                {art ? <img src={art} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted/50"><Disc3 size={16} /></div>}
              </div>
            )
          })}
          {!previewTracks.length && (
            <div className="col-span-4 flex aspect-[4/1] items-center justify-center rounded-lg bg-card text-xs text-muted sm:col-span-2 sm:aspect-square">No tracks</div>
          )}
        </div>
      </div>
    </motion.button>
  )
}

function AlbumStack({ albums, tracks }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {albums.slice(0, 5).map((album, index) => {
        const art = albumArt(album, tracks)
        return (
          <motion.div
            key={`${album.album}-${index}`}
            initial={{ opacity: 0, y: 18, rotate: index % 2 ? 2 : -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: index * 0.08 }}
            className="overflow-hidden rounded-xl border border-white/10 bg-black/20"
          >
            <div className="aspect-square bg-card">
              {art ? <img src={art} className="h-full w-full object-cover aspect-square" /> : <div className="flex h-full w-full items-center justify-center text-white/30"><Disc3 size={index === 0 ? 32 : 24} /></div>}
            </div>
            <div className="p-3">
              <p className="truncate text-xs text-white lowercase">{album.album}</p>
              <p className="text-[10px] text-white/50 lowercase">{album.plays} plays</p>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}

function StoryTrackStrip({ track, label }) {
  const art = trackArt(track)
  return (
    <motion.div
      key={track?.id || label}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.55 }}
      className="mt-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-black/35 p-3 shadow-2xl"
    >
      <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-card">
        {art ? <img src={art} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-white/30"><Disc3 size={20} /></div>}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-white lowercase">{track?.title || label || 'no track'}</p>
        <p className="truncate text-[10px] text-white/55 lowercase">{track?.artist || 'no artist'}</p>
      </div>
    </motion.div>
  )
}

function StoryArtwork({ track, label }) {
  const art = trackArt(track)
  return (
    <motion.div
      key={track?.id || label}
      initial={{ opacity: 0, scale: 0.92, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="absolute bottom-10 right-6 w-40 overflow-hidden rounded-2xl border border-white/10 bg-black/35 shadow-2xl md:w-48 rotate-3"
    >
      <div className="aspect-square bg-card">
        {art ? <img src={art} className="h-full w-full object-cover aspect-square" /> : <div className="flex h-full w-full items-center justify-center text-white/30"><Disc3 size={30} /></div>}
      </div>
      <div className="p-4">
        <p className="truncate text-xs text-white lowercase">{track?.title || label || 'no track'}</p>
        <p className="truncate text-[10px] text-white/55 lowercase">{track?.artist || 'no artist'}</p>
      </div>
    </motion.div>
  )
}

function RecapStory({ open, onClose, recap, period, playQueue, onSavePlaylist, playlistStatus }) {
  const [index, setIndex] = useState(0)
  const topGenres = filteredGenres(recap?.topGenres || [])
  const topGenre = topGenres[0]
  const topArtist = recap?.topArtists?.[0]
  const topAlbums = recap?.topAlbums || []
  const topAlbum = topAlbums[0]
  const biggestSession = recap?.biggestSession || recap?.sessions?.[0]
  const topTracks = recap?.topTracks || []
  const replayQueue = recap?.replayQueue || topTracks
  const artistAlbum = artistAlbumName(topArtist, topAlbums, topTracks)
  const backgroundTrack = topTracks[index % Math.max(topTracks.length, 1)] || topTracks[0]
  const backgroundArt = trackArt(backgroundTrack)
  const sessionArtist = biggestSession?.topArtists?.[0]?.artist || 'your queue'
  const slides = [
    {
      key: 'overview',
      eyebrow: (period?.label || 'recap').toLowerCase(),
      title: `${fmtMinutes(recap?.totalMinutes || 0)} // ${recap?.uniqueTracks || 0} tracks // ${recap?.uniqueArtists || 0} artists`,
      body: `(thats about ${daysText(recap?.totalMinutes || 0)}... you okay?)`,
      track: topTracks[0],
      variant: 'overview',
    },
    {
      key: 'hour',
      eyebrow: 'the chronology',
      title: `favorite hour: ${fmtHour(recap?.peakHour?.hour)}`,
      body: hourComment(recap?.peakHour?.hour),
      track: topTracks[1] || topTracks[0],
      variant: 'hour',
    },
    {
      key: 'session',
      eyebrow: 'the vibe check',
      title: biggestSession ? `deep session: ${biggestSession.label.toLowerCase()}` : 'your biggest session had a shape.',
      body: biggestSession ? `${biggestSession.trackCount} tracks over ${fmtMinutes(biggestSession.durationMinutes)}, mostly by ${sessionArtist}. ${sessionComment(biggestSession)}` : 'no named sessions yet.',
      track: biggestSession?.tracks?.[0] || topTracks[0],
      actionTracks: biggestSession?.tracks,
      variant: 'session',
    },
    {
      key: 'genre',
      eyebrow: 'genre check',
      title: topGenre ? `out of all possible genres, ${topGenre.genre.toLowerCase()} was your favorite.` : 'your genres refused to pick one winner.',
      body: topGenre ? genreComment(topGenre.genre) : 'the fallback genre stayed out of the story.',
      track: topTracks[2] || topTracks[0],
      variant: 'genre',
    },
    {
      key: 'artist',
      eyebrow: 'top artist',
      title: topArtist ? `your favorite artist was ${topArtist.artist.toLowerCase()}.` : 'no artist took the crown yet.',
      body: topArtist ? `${topArtist.plays} plays in total... they were your strongest, and ${artistAlbum.toLowerCase()} was the one that kept dragging you back in.` : 'listen a little more and this will get personal.',
      track: topTracks.find(track => track.artist === topArtist?.artist) || topTracks[0],
      variant: 'artist',
    },
    {
      key: 'albums',
      eyebrow: 'top albums',
      title: topAlbum ? `${topAlbum.album.toLowerCase()} was your soundtrack.` : 'no album had enough gravity yet.',
      body: topAlbums[1] ? 'these almost took the crown:' : 'this era leaned more track-by-track.',
      track: topTracks.find(track => track.album === topAlbum?.album) || topTracks[0],
      variant: 'albums',
    },
    {
      key: 'end',
      eyebrow: 'the replay',
      title: "now, let's replay this era of your music.",
      body: 'save this to your library to replay your top 50.',
      track: topTracks[0],
      actionTracks: replayQueue,
      variant: 'end',
    },
  ]
  const slide = slides[index] || slides[0]

  useEffect(() => {
    if (!open) return
    setIndex(0)
  }, [open, recap?.scope, recap?.year, recap?.quarter])

  useEffect(() => {
    if (!open || !slide?.track?.id) return
    playQueue([slide.track], 0)
  }, [open, index])

  useEffect(() => {
    if (!open) return
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') setIndex(value => Math.min(value + 1, slides.length - 1))
      if (event.key === 'ArrowLeft') setIndex(value => Math.max(value - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, slides.length])

  const next = () => setIndex(value => Math.min(value + 1, slides.length - 1))
  const prev = () => setIndex(value => Math.max(value - 1, 0))

  const handleSurfaceClick = (e) => {
    const interactive = e.target.closest('button, [data-interactive="true"]')
    if (interactive) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX - rect.left < rect.width * 0.3) prev()
    else next()
  }

  return (
    <AnimatePresence>
      {open && recap && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[90] overflow-hidden bg-black p-4">
          <div 
            className="pointer-events-none absolute inset-0 z-50 opacity-[0.04]" 
            style={{ 
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` 
            }} 
          />
          {backgroundArt && (
            <>
              <motion.div
                key={`${backgroundTrack?.id}-wash`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.4 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-cover bg-center blur-[80px] scale-110"
                style={{ backgroundImage: `url("${backgroundArt}")` }}
              />
              <motion.div 
                animate={{ scale: [1, 1.1, 1], rotate: [0, 1, 0] }}
                transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 bg-cover bg-center opacity-20 blur-[40px]"
                style={{ backgroundImage: `url("${backgroundArt}")` }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(0,0,0,0.88),rgba(0,0,0,0.42)_52%,rgba(0,0,0,0.86))]" />
            </>
          )}
          <div className="relative mx-auto flex h-full max-w-lg flex-col">
            <div className="mb-4 flex gap-2">
              {slides.map((item, slideIndex) => (
                <div key={item.key} className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
                  <motion.div className="h-full rounded-full bg-white" animate={{ width: slideIndex <= index ? '100%' : '0%' }} transition={{ duration: 0.2 }} />
                </div>
              ))}
            </div>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[10px] font-display uppercase tracking-[0.24em] text-white/40">lokal recap</div>
              <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div 
              onClick={handleSurfaceClick}
              className="relative flex-1 overflow-hidden rounded-[32px] border border-white/10 bg-black/25 p-8 shadow-2xl backdrop-blur-xl"
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={slide.key}
                  initial={{ opacity: 0, x: 38 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -26 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className={`relative z-10 h-full flex flex-col ${slide.variant === 'albums' ? 'justify-start overflow-y-auto pr-1 pb-4' : 'justify-center pb-20'} ${slide.variant === 'genre' ? 'gap-6 pb-0' : ''}`}
                >
                  <div className="mb-4 inline-flex w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-display uppercase tracking-widest text-accent/80">{slide.eyebrow}</div>
                  <motion.h2 
                    initial={{ y: 20, opacity: 0 }} 
                    animate={{ y: 0, opacity: 1 }} 
                    transition={{ delay: 0.1, duration: 0.6 }} 
                    className="max-w-xs text-3xl font-display leading-tight text-white lowercase md:text-4xl"
                  >
                    {slide.title}
                  </motion.h2>
                  <motion.p 
                    initial={{ y: 14, opacity: 0 }} 
                    animate={{ y: 0, opacity: 1 }} 
                    transition={{ delay: 0.2 }} 
                    className="mt-4 max-w-xs text-sm leading-relaxed text-white/50 lowercase italic"
                  >
                    {slide.body}
                  </motion.p>

                  {slide.variant === 'genre' && topGenres.length > 1 && (
                    <div className="mt-8 grid gap-2">
                      {topGenres.slice(1, 5).map((genre, runnerIndex) => (
                        <motion.div
                          key={genre.genre}
                          initial={{ x: 26, opacity: 0 }}
                          animate={{ x: 0, opacity: 1 }}
                          transition={{ delay: 0.4 + runnerIndex * 0.1 }}
                          className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3"
                        >
                          <span className="text-xs text-white/70 lowercase">#{runnerIndex + 2} {genre.genre}</span>
                          <span className="text-[10px] text-white/30">{genre.plays} plays</span>
                        </motion.div>
                      ))}
                    </div>
                  )}

                  {slide.variant === 'genre' && <StoryTrackStrip track={slide.track} label={slide.eyebrow} />}

                  {slide.variant === 'albums' && <div className="mt-7"><AlbumStack albums={topAlbums} tracks={topTracks} /></div>}

                  {slide.variant === 'end' && (
                    <div className="mt-8 flex flex-col gap-2">
                      <button data-interactive="true" onClick={() => replayQueue.length && playQueue(replayQueue, 0)} className="flex items-center justify-center gap-2 rounded-2xl bg-accent px-5 py-4 text-sm font-semibold text-base">
                        <Play size={15} fill="currentColor" />
                        play top 50
                      </button>
                      <button data-interactive="true" onClick={onSavePlaylist} className="flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 text-sm text-white hover:bg-white/[0.1]">
                        <Plus size={15} />
                        add to my library
                      </button>
                      {playlistStatus && <span className="self-center text-xs text-accent">{playlistStatus}</span>}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
              {slide.variant !== 'albums' && slide.variant !== 'end' && slide.variant !== 'genre' && <StoryArtwork track={slide.track} label={slide.eyebrow} />}
            </div>
            <div className="mt-6 flex items-center justify-between text-[10px] uppercase tracking-widest text-white/30">
              <button onClick={prev} className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 hover:text-white">
                <ChevronLeft size={14} />
              </button>
              <span>{index + 1} / {slides.length}</span>
              <button onClick={next} className="flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 hover:text-white">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function Recap() {
  const allPeriods = useMemo(buildPeriods, [])
  const [periods, setPeriods] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [recapsById, setRecapsById] = useState({})
  const [recap, setRecap] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checkingPeriods, setCheckingPeriods] = useState(true)
  const [status, setStatus] = useState('')
  const [storyOpen, setStoryOpen] = useState(false)
  const { user } = useAppStore()
  const { playQueue } = usePlayerStore()

  const selectedPeriod = periods.find(period => period.id === selectedId) || periods[0]

  const loadPeriodList = async () => {
    setCheckingPeriods(true)
    setStatus('')
    const nextRecaps = {}
    const available = []
    for (const period of allPeriods) {
      if (period.year < 2026) continue

      try {
        const result = await api.getListeningRecap(user?.id || 'guest', period)
        if (!result?.error && result?.totalPlays > 0) {
          nextRecaps[period.id] = result
          available.push(period)
        }
      } catch {}
    }
    setRecapsById(nextRecaps)
    setPeriods(available)
    const latestId = getLatestCompletedPeriodId(available)
    setSelectedId(current => available.some(period => period.id === current) ? current : latestId)
    if (latestId) {
      localStorage.setItem('lokal-recap-latest-completed', latestId)
      window.dispatchEvent(new CustomEvent('lokal:recap-periods-changed', { detail: { latestId } }))
    }
    setCheckingPeriods(false)
  }

  const loadRecap = async () => {
    if (!selectedPeriod) return
    setLoading(true)
    setStatus('')
    try {
      const cached = recapsById[selectedPeriod.id]
      const result = cached || await api.getListeningRecap(user?.id || 'guest', selectedPeriod)
      if (result?.error) {
        setStatus(result.error)
        setRecap(null)
      } else {
        setRecap(result)
        setRecapsById(current => ({ ...current, [selectedPeriod.id]: result }))
      }
    } catch (e) {
      setStatus(e.message)
      setRecap(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPeriodList()
  }, [user?.id])

  useEffect(() => {
    loadRecap()
  }, [selectedId, user?.id])

  useEffect(() => {
    if (!selectedId) return
    localStorage.setItem('lokal-recap-last-viewed', selectedId)
    window.dispatchEvent(new CustomEvent('lokal:recap-viewed', { detail: { periodId: selectedId } }))
  }, [selectedId])

  const topTracks = recap?.topTracks || []
  const replayQueue = recap?.replayQueue || topTracks
  const heroTrack = topTracks[0]
  const heroArt = trackArt(heroTrack)
  const topGenres = filteredGenres(recap?.topGenres || [])
  const favoriteGenres = filteredGenres(recap?.preferences?.favoriteGenres || [])

  const savePlaylist = async () => {
    if (!replayQueue.length || !selectedPeriod) return
    setStatus('Creating playlist...')
    const name = `${selectedPeriod.title} Top ${Math.min(replayQueue.length, 50)}`
    const playlist = await api.createPlaylist(name, user?.id, `Generated from ${selectedPeriod.title}`)
    if (!playlist?.id) {
      setStatus('Could not create playlist')
      return
    }
    await api.addMultipleToPlaylist(playlist.id, replayQueue.slice(0, 50).map(track => track.id))
    window.dispatchEvent(new CustomEvent('lokal:playlists-changed', { detail: { playlistId: playlist.id, action: 'created' } }))
    setStatus(`Saved ${name}`)
  }

  return (
    <div className="p-6 pb-10 space-y-6 max-w-6xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-accent">
            <Sparkles size={13} />
            Listening Recaps
          </div>
          <h1 className="mt-2 text-3xl font-display text-white">Your listening eras</h1>
          <p className="mt-1 text-sm text-muted">Finished monthly-range snapshots built from your local listening sessions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={loadPeriodList} disabled={checkingPeriods || loading} className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm text-muted transition-colors hover:text-white disabled:opacity-50">
            <RefreshCw size={14} className={checkingPeriods || loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button onClick={() => replayQueue.length && playQueue(replayQueue, 0)} disabled={!replayQueue.length} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-base transition-colors hover:bg-accent/85 disabled:opacity-50">
            <Play size={14} fill="currentColor" />
            Replay Era
          </button>
          <button onClick={savePlaylist} disabled={!replayQueue.length} className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/15 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50">
            <Plus size={14} />
            Add To Playlists
          </button>
          <button onClick={() => setStoryOpen(true)} disabled={!recap || recap.totalPlays === 0} className="flex items-center gap-2 rounded-xl border border-border bg-elevated px-4 py-2 text-sm text-white transition-colors hover:border-accent/40 disabled:opacity-50">
            <Sparkles size={14} />
            Show Story
          </button>
        </div>
      </div>

      {checkingPeriods ? (
        <div className="rounded-xl border border-border bg-elevated p-6 text-sm text-muted">Looking for finished recaps with listening data...</div>
      ) : periods.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {periods.map(period => (
            <button key={period.id} onClick={() => setSelectedId(period.id)} className={`flex-shrink-0 rounded-full border px-4 py-2 text-xs font-display uppercase tracking-wider transition-colors ${selectedId === period.id ? 'border-accent bg-accent text-base' : 'border-border bg-elevated text-muted hover:text-white'}`}>
              {period.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-elevated p-6 text-sm text-muted">No finished recap periods with listening data yet.</div>
      )}

      {status && <div className="rounded-xl border border-border bg-elevated px-4 py-3 text-sm text-muted">{status}</div>}

      {loading ? (
        <div className="rounded-xl border border-border bg-elevated p-10 text-center text-sm text-muted">Building recap...</div>
      ) : !recap || recap.totalPlays === 0 ? (
        <div className="rounded-xl border border-border bg-elevated p-10 text-center">
          <Disc3 size={36} className="mx-auto text-muted/40" />
          <p className="mt-3 text-sm text-white">No finished recap selected yet.</p>
          <p className="mt-1 text-xs text-muted">Once a completed period has enough listening data, it will show up here.</p>
        </div>
      ) : (
        <>
          <section className="relative overflow-hidden rounded-xl border border-border bg-elevated">
            {heroArt && <div className="absolute inset-0 bg-cover bg-center opacity-20 blur-xl scale-110" style={{ backgroundImage: `url("${heroArt}")` }} />}
            <div className="relative grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-display uppercase tracking-widest text-muted">
                  <CalendarRange size={12} />
                  {fmtDate(recap.from)} - {fmtDate(recap.to)}
                </div>
                <h2 className="mt-3 text-4xl font-display text-white">{selectedPeriod?.title}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
                  You played {recap.totalPlays} tracks for {fmtMinutes(recap.totalMinutes)}, with {recap.sessions?.length || 0} sessions strong enough to name.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric label="Minutes" value={fmtMinutes(recap.totalMinutes)} icon={Clock3} />
                  <Metric label="Tracks" value={recap.uniqueTracks || 0} icon={ListMusic} />
                  <Metric label="Artists" value={recap.uniqueArtists || 0} icon={BarChart3} />
                  <Metric label="Peak Hour" value={fmtHour(recap.peakHour?.hour)} icon={Clock3} />
                </div>
              </div>
              <div className="rounded-xl border border-border bg-black/20 p-4">
                <div className="aspect-square overflow-hidden rounded-lg bg-card">
                  {heroArt ? <img src={heroArt} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-muted"><Disc3 size={32} /></div>}
                </div>
                <p className="mt-3 truncate text-sm font-medium text-white">{heroTrack?.title}</p>
                <p className="truncate text-xs text-muted">{heroTrack?.artist}</p>
              </div>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-display uppercase tracking-widest text-muted">Top Tracks</h2>
                <button onClick={() => playQueue(topTracks, 0)} className="text-xs font-display uppercase tracking-wider text-accent hover:text-accent/70">Play Top 50</button>
              </div>
              <TrackList tracks={topTracks.slice(0, 20)} showAlbum />
            </section>

            <aside className="space-y-4">
              <section className="rounded-xl border border-border bg-elevated p-4">
                <h2 className="text-xs font-display uppercase tracking-widest text-muted">Preference Profile</h2>
                <div className="mt-4 space-y-3">
                  {favoriteGenres.slice(0, 5).map((genre, index) => (
                    <div key={genre.genre || index} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2">
                      <span className="truncate text-sm text-white">{genre.genre}</span>
                      <span className="text-xs text-muted">{genre.plays}</span>
                    </div>
                  ))}
                  {!favoriteGenres.length && <p className="text-xs text-muted">No specific genre stood out yet.</p>}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-elevated p-4">
                <h2 className="text-xs font-display uppercase tracking-widest text-muted">Top Artists</h2>
                <div className="mt-4 space-y-3">
                  {(recap.topArtists || []).slice(0, 5).map((artist, index) => (
                    <div key={artist.artist || index} className="flex items-center justify-between gap-3 rounded-lg bg-card px-3 py-2">
                      <span className="truncate text-sm text-white">{artist.artist}</span>
                      <span className="text-xs text-muted">{artist.plays}</span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          {recap.sessions?.length > 0 && (
            <section className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xs font-display uppercase tracking-widest text-muted">Listening Sessions</h2>
                  <p className="mt-1 text-sm text-muted">Your strongest runs from this recap, grouped by listening shape.</p>
                </div>
                <span className="text-xs text-muted">{recap.sessions.length} named sessions</span>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {recap.sessions.slice(0, 8).map((session, index) => (
                  <SessionCard
                    key={session.id || index}
                    session={session}
                    index={index}
                    onPlay={() => session.tracks?.length && playQueue(session.tracks, 0)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <RecapStory open={storyOpen} onClose={() => setStoryOpen(false)} recap={recap ? { ...recap, topGenres } : recap} period={selectedPeriod} playQueue={playQueue} onSavePlaylist={savePlaylist} playlistStatus={status} />
    </div>
  )
}
