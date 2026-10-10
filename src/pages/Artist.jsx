import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Check, Play, Music, Settings, Camera, Share2, Radio, Globe } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import ArtistManageModal from '../components/ArtistManageModal'
import { api } from '../api'
import { makeAlbumContext, makeArtistContext } from '../playbackContext'
import { plural } from '../plural'
import { openShareCard, artistArtSource, coversOf } from '../shareCard'
import SelectionBar from '../components/SelectionBar'
import { useSelection } from '../selection'
import { releaseKey, useReleaseActions } from '../releaseActions'
import { openRadio } from '../radioActions'
import ImageZoom from '../components/ImageZoom'
import OnlineArtist, { OnlineArtistSections, OwnershipBadge, useOnlineArtist } from '../components/OnlineArtist'
import RefreshButton from '../components/RefreshButton'
import { isConnected, releaseTitleKey, setConnected } from '../onlineBrowse'
import ReleaseTypeFilter from '../components/ReleaseTypeFilter'
import { groupReleases, releaseTypeCounts, useReleaseTypes } from '../releaseTypes'
import DiscoveryArtistButton from '../components/DiscoveryArtistButton'

export default function Artist() {
  const { id } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const [artist, setArtist] = useState(null)
  const [allArtists, setAllArtists] = useState([])
  const [selectedAlbum, setSelectedAlbum] = useState(null)
  // A highlighted track that has no album AND isn't in "Popular" -- e.g. a
  // loose single -- has no Releases card to open and no Popular row to
  // scroll to, so there's nothing for the effect below to select. Without
  // this, that track silently fails to highlight with no visible fallback.
  const [standaloneTrack, setStandaloneTrack] = useState(null)
  const [showManage, setShowManage] = useState(false)
  // Not in the library, or only as streamed songs (a streamed song's artist
  // shortcut): their page online instead.
  const [online, setOnline] = useState(false)
  // The artist's picture, big (click it).
  const [zoom, setZoom] = useState(false)
  const onlineRef = useRef(false)
  onlineRef.current = online
  // Their name as the link gave it ("Earth, Wind & Fire"; the id is a slug).
  const onlineNames = useRef({})
  if (location.state?.name) onlineNames.current[id] = { name: location.state.name, anchor: location.state.anchor || null }
  const playQueue = usePlayerStore(s => s.playQueue)
  const artistContext = makeArtistContext(id, artist?.name)
  // Set by the "playing from ..." shortcut so we can scroll to the playing track.
  const [highlightTrackId, setHighlightTrackId] = useState(null)
  // A per-request identity, distinct from the track ID itself, so a second
  // shortcut to the *same* already-playing track still re-triggers the
  // scroll/flash in TrackList instead of being silently deduped against
  // the first request for that ID.
  const highlightSeqRef = useRef(0)
  const [highlightRequestKey, setHighlightRequestKey] = useState(null)

  useEffect(() => {
    const incoming = location.state?.highlightTrackId
    if (!incoming) return
    highlightSeqRef.current += 1
    setHighlightTrackId(incoming)
    setHighlightRequestKey(`${incoming}:${highlightSeqRef.current}`)
    // Clear it so a later refresh or back-navigation doesn't re-trigger the scroll.
    nav(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, nav])

  // A highlighted track that isn't in "Popular" only lives inside a
  // Releases card, which stays collapsed until clicked -- so AlbumTracks
  // never mounts and the track can't be scrolled to or flashed. Once the
  // artist has loaded, open whichever release actually contains it.
  useEffect(() => {
    if (!artist || !highlightTrackId) return
    const inTopTracks = artist.topTracks?.some((item) => String(item.id) === String(highlightTrackId))
    if (inTopTracks) {
      // The Popular row owns this highlight -- drop any Track section left
      // over from an earlier albumless-track request.
      setStandaloneTrack(null)
      return
    }
    const track = artist.tracks?.find((item) => String(item.id) === String(highlightTrackId))
    if (!track?.album) {
      // No Releases card owns this track either, so render it in its own
      // ad-hoc section instead of leaving the highlight request with
      // nowhere to land.
      setStandaloneTrack(track || null)
      return
    }
    setStandaloneTrack(null)
    // Carry the track's own album_artist along (falling back to its artist,
    // same as the backend's own COALESCE), not this page's display artist --
    // see the AlbumTracks fix below for why that distinction matters.
    setSelectedAlbum({ title: track.album, album_artist: track.album_artist || track.artist })
    // highlightRequestKey (not just highlightTrackId) is in the deps: if the
    // user collapsed this release card after the first "playing from ..."
    // request and then re-triggers the shortcut for the SAME track, the
    // track id alone wouldn't change, and this effect wouldn't re-run to
    // reopen the card -- highlightRequestKey changes on every request, even
    // repeats, so it does.
  }, [artist, highlightTrackId, highlightRequestKey])

  const load = () => {
    setOnline(false)
    Promise.all([api.getArtist(id), api.getSettings()]).then(([data, appSettings]) => {
      if (!data?.id || !data.tracks?.length) { setArtist(null); setOnline(true); return }
      setArtist(data)
      if (appSettings?.auto_fetch_artist_metadata !== '1') return
      api.artistRefreshMetadata(data.id).then((refreshed) => {
        if (!refreshed || refreshed.error) return
        setArtist((current) => {
          if (!current || current.id !== data.id) return current
          const nextBio = refreshed.bio || ''
          const currBio = current.bio || ''
          const nextImage = refreshed.image_path || ''
          const currImage = current.image_path || ''
          if (nextBio === currBio && nextImage === currImage) return current
          return { ...current, ...refreshed }
        })
      }).catch(() => {})
    }).catch(() => { setArtist(null); setOnline(true) })
    api.getArtists().then(setAllArtists)
  }

  useEffect(() => { load() }, [id])

  useEffect(() => {
    // An online artist page stays online while it's open (a download of one
    // of their songs marks it "In library" there instead, see OnlineArtist);
    // it's their library page from the next visit.
    const handleRefresh = () => {
      if (onlineRef.current) return
      load()
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [id])

  const pickArtistImage = async () => {
    if (!artist) return
    if (api.isElectron) {
      const fp = await api.openFile()
      if (!fp) return
      const img = new Image()
      img.src = `file://${fp}`
      img.onload = () => {
        const c = document.createElement('canvas')
        c.width = img.width
        c.height = img.height
        c.getContext('2d').drawImage(img, 0, 0)
        api.artistSetImage(artist.id, c.toDataURL('image/jpeg', 0.85)).then(() => load())
      }
    }
  }

  // Releases: Ctrl/Cmd+click (or Shift+click) selects, a right click or the
  // bar plays, queues, adds to a playlist or deletes them. Their artist is
  // this page's when a release doesn't name one (so its songs are found by
  // title and artist, not title alone).
  const releaseList = useMemo(() => (artist?.albums || []).map(album => ({ ...album, album_artist: album.album_artist || artist?.name })), [artist])
  const releaseKeys = useMemo(() => releaseList.map(releaseKey), [releaseList])
  const releases = useReleaseActions({ goToArtist: false, onDeleted: () => releaseSelection.clear() })
  const releasesFor = (keys) => releaseList.filter(album => keys.includes(releaseKey(album)))
  const releaseSelection = useSelection(releaseKeys, { onDelete: (keys) => releases.askDelete(releasesFor(keys)) })

  // "More online": their songs and albums online next to the library's, the
  // library's marked (remembered per artist).
  const [connected, setConnectedState] = useState(() => isConnected(`artist:${id}`))
  useEffect(() => { setConnectedState(isConnected(`artist:${id}`)) }, [id])
  const toggleConnected = () => setConnectedState(on => { setConnected(`artist:${id}`, !on); return !on })
  const onlineHints = useMemo(() => [...(artist?.albums || []).map(album => album.title), ...(artist?.tracks || []).map(track => track.title)].filter(Boolean), [artist])
  const onlineData = useOnlineArtist(artist?.name || '', connected && !!artist?.id, { hints: onlineHints })

  // Releases in sections (Albums, EPs, Singles...), the types shown chosen per
  // artist; "More releases online" follows the same choice.
  const [shownTypes, toggleType] = useReleaseTypes(artist?.name || id)
  const releaseGroups = useMemo(() => groupReleases(releaseList, shownTypes), [releaseList, shownTypes])
  // Song counts of the releases online (when the source gives them), to mark
  // the library's partial ones.
  const onlineTotals = useMemo(() => new Map(connected ? onlineData.albums.items.filter(album => album.track_count).map(album => [releaseTitleKey(album.title), Number(album.track_count)]) : []), [connected, onlineData.albums.items])
  const releaseTypes = useMemo(() => {
    const owned = new Set(releaseList.map(album => releaseTitleKey(album.title)))
    const online = connected ? onlineData.albums.items.filter(album => !owned.has(releaseTitleKey(album.title))) : []
    return releaseTypeCounts([...releaseList, ...online])
  }, [releaseList, connected, onlineData.albums.items])

  if (online) return <OnlineArtist key={id} id={id} name={onlineNames.current[id]?.name} anchor={onlineNames.current[id]?.anchor} />
  if (!artist) return <div className="p-6 text-muted text-sm">Loading...</div>

  // Web mode previously hardcoded this to null, so the artist detail page
  // never showed an image outside Electron even when one existed — see
  // getArtistImage in Artists.jsx for the same pattern already used there.
  const imgSrc = artist.image_path
    ? (api.isElectron ? `file://${artist.image_path}` : `/api/artist-image/${encodeURIComponent(artist.id)}`)
    : null
  const artSrc = (track) => track.artwork_path ? (api.isElectron ? `file://${track.artwork_path}` : api.artworkURL(track.id)) : null
  // The share card: the artist's photo (else a cover), their songs and your
  // plays of them, counted as recaps count them (30 seconds or more, streamed
  // songs too); the library's play counts if that can't be read.
  const shareArtist = async () => {
    const tracks = artist.tracks || []
    const albums = new Set(tracks.map(track => track.album).filter(Boolean))
    const listened = await Promise.resolve(api.getArtistPlays?.(useAppStore.getState().user?.id || 'guest', artist.id)).catch(() => null)
    const counted = listened && !listened.error && Number.isFinite(listened.plays)
    const plays = counted ? listened.plays : tracks.reduce((sum, track) => sum + (Number(track.play_count) || 0), 0)
    const top = counted && listened.topTracks?.length ? listened.topTracks : artist.topTracks?.length ? artist.topTracks : tracks
    const photo = artistArtSource(artist)
    openShareCard({
      kind: 'Artist',
      title: artist.name,
      round: !!photo,
      art: photo ? [photo] : coversOf(tracks, 1),
      stats: [['Songs', tracks.length.toLocaleString()], ['Albums', albums.size.toLocaleString()], ['Plays', plays.toLocaleString()]],
      list: { title: 'Top songs', items: top.slice(0, 5).map(track => [track.title, track.album && track.album !== track.title ? track.album : null]) },
    })
  }

  const releaseLabel = (type) => {
    if (type === 'single') return 'Single'
    if (type === 'ep') return 'EP'
    return 'Album'
  }

  return (
    <div className="pb-8">
      <div className="relative h-56 overflow-hidden">
        <button
          onClick={() => nav(-1)}
          className="absolute left-6 top-4 z-10 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur-sm transition-colors hover:text-white @md:left-8 @md:top-5"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        {imgSrc ? <img src={imgSrc} className="h-full w-full object-cover opacity-40" /> : <div className="h-full w-full bg-gradient-to-b from-accent/8 to-transparent" />}
        <div className="absolute inset-0 bg-gradient-to-t from-base via-base/20" />
        <div className="absolute bottom-5 left-8 flex items-end gap-5">
          {/* Click: the picture, big (no picture: choose one). The camera
              in the corner changes it. */}
          <div className="relative group flex-shrink-0">
            <button onClick={imgSrc ? () => setZoom(true) : pickArtistImage} title={imgSrc ? 'View the picture' : api.isElectron ? 'Choose a picture' : undefined} className={`flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated ${imgSrc ? 'cursor-zoom-in' : ''}`}>
              {imgSrc ? <img src={imgSrc} alt={artist.name} className="h-full w-full object-cover" /> : <Music size={36} className="text-muted" />}
            </button>
            {api.isElectron && imgSrc && (
              <button onClick={pickArtistImage} title="Change the picture" aria-label="Change the picture" className="absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-elevated text-muted opacity-0 shadow-lg transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100">
                <Camera size={14} />
              </button>
            )}
            <ImageZoom src={imgSrc} alt={artist.name} open={zoom} onClose={() => setZoom(false)} />
          </div>
          <div>
            <p className="mb-1 text-xs font-display uppercase tracking-widest text-muted">Artist</p>
            <h1 className="text-3xl font-display text-white">{artist.name}</h1>
            <p className="mt-1 text-xs text-muted">{plural(artist.tracks?.length, 'track')}</p>
          </div>
        </div>
        <button onClick={() => setShowManage(true)} className="absolute top-4 right-6 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white/60 transition-all backdrop-blur-sm hover:border-white/20 hover:text-white">
          <Settings size={12} /> Manage
        </button>
        <DiscoveryArtistButton name={artist.name} className="absolute top-14 right-6 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 text-xs text-white/60 transition-all hover:border-white/20 hover:text-white" />
      </div>

      <div className="space-y-7 px-8 py-5">
        <div className="flex items-center gap-3">
          <button onClick={() => playQueue(artist.tracks, 0, artistContext)} className="flex items-center gap-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-base transition-colors hover:bg-accent-dim">
            <Play size={14} fill="currentColor" className="translate-x-px" /> Play All
          </button>
          <button onClick={() => openRadio(nav, { artist: artist.name, type: 'artist' }, useAppStore.getState().user?.id)} className="flex items-center gap-2 rounded-full border border-border bg-elevated px-4 py-2 text-sm text-white/80 transition-colors hover:border-accent/30 hover:text-white">
            <Radio size={14} /> Radio
          </button>
          <button onClick={shareArtist} title="Share as a picture"
            className="flex items-center gap-2 rounded-full border border-border bg-elevated px-4 py-2 text-sm text-white/80 transition-colors hover:border-accent/30 hover:text-white">
            <Share2 size={14} /> Share
          </button>
          <button onClick={toggleConnected} aria-pressed={connected} title={connected ? 'Hide their music online' : 'Show their other songs and albums online'}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${connected ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border bg-elevated text-white/80 hover:border-accent/30 hover:text-white'}`}>
            <Globe size={14} /> {connected ? 'Online: on' : 'More online'}
          </button>
          {connected && <RefreshButton onClick={onlineData.refresh} loading={onlineData.loading} loadedAt={onlineData.loadedAt} className="bg-elevated" />}
        </div>

        {artist.bio && (
          <div>
            <h2 className="mb-2 text-xs font-display uppercase tracking-widest text-muted">About</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">{artist.bio}</p>
          </div>
        )}

        {artist.topTracks?.length > 0 && (
          <section>
            <h2 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Popular</h2>
            <TrackList tracks={artist.topTracks} context={artistContext} highlightTrackId={highlightTrackId} highlightRequestKey={highlightRequestKey} />
          </section>
        )}

        {standaloneTrack && (
          <section>
            <h2 className="mb-3 text-xs font-display uppercase tracking-widest text-muted">Track</h2>
            <TrackList tracks={[standaloneTrack]} context={artistContext} highlightTrackId={highlightTrackId} highlightRequestKey={highlightRequestKey} />
          </section>
        )}

        {artist.albums?.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-xs font-display uppercase tracking-widest text-muted">Releases</h2>
              <ReleaseTypeFilter types={releaseTypes} shown={shownTypes} onToggle={toggleType} />
            </div>
            <SelectionBar
              open={releaseSelection.count > 0}
              label={`${releaseSelection.count} ${releaseSelection.count === 1 ? 'release' : 'releases'} selected`}
              onClear={releaseSelection.clear}
              actions={releases.barActions(releasesFor([...releaseSelection.selected]))}
            />
            {releaseGroups.length === 0 && <p className="text-sm text-muted">No releases of the types chosen.</p>}
            <div className="space-y-6">
              {releaseGroups.map(group => (
                <div key={group.type}>
                  {(releaseGroups.length > 1 || group.type !== 'album') && <h3 className="mb-2 text-[11px] font-display uppercase tracking-[0.28em] text-white/50">{group.label} <span className="text-muted">· {group.items.length}</span></h3>}
                  <div className="grid grid-cols-2 gap-4 @md:grid-cols-3 @lg:grid-cols-4">
                    {group.items.map((album) => {
                const firstTrack = artist.tracks?.find((track) => track.album === album.title)
                const cover = firstTrack ? artSrc(firstTrack) : null
                const selected = releaseSelection.has(releaseKey(album))
                return (
                  <motion.button
                    key={album.title}
                    onClick={(event) => {
                      if (!releaseSelection.click(releaseKey(album), event)) nav('/albums', { state: { album, from: location.pathname } })
                    }}
                    onContextMenu={(event) => releases.openMenu(event, releasesFor(releaseSelection.contextSelect(releaseKey(album))))}
                    aria-selected={selected}
                    whileHover={{ scale: 1.02 }}
                    className={`relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border p-3 text-left transition-all ${selected ? 'border-accent ring-2 ring-accent/60 bg-accent/10' : selectedAlbum?.title === album.title ? 'border-accent/40 bg-accent/10' : 'border-border bg-elevated hover:border-accent/30'}`}
                  >
                    <div className="relative flex w-full aspect-square items-center justify-center overflow-hidden rounded-lg bg-card text-subtle">
                      {cover ? <img src={cover} className="h-full w-full object-cover" /> : <Music size={28} />}
                      {selected && (
                        <span className="pointer-events-none absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-base shadow-lg">
                          <Check size={14} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 overflow-hidden">
                      <p className="block truncate text-sm font-medium text-white">{album.title}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-display uppercase tracking-[0.18em] text-white/70">
                          {releaseLabel(album.release_type)}
                        </span>
                        <span className="block truncate">{album.year ? `${album.year} • ` : ''}{plural(album.track_count, 'track')}</span>
                        {/* Part of a release ("1/9"), when the release online has more songs. */}
                        {(() => { const total = onlineTotals.get(releaseTitleKey(album.title)); return total > album.track_count ? <OwnershipBadge ownership={{ owned: album.track_count, total, full: false }} /> : null })()}
                      </div>
                    </div>
                  </motion.button>
                )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {selectedAlbum && <AlbumTracks album={selectedAlbum} artistName={artist?.name} highlightTrackId={highlightTrackId} highlightRequestKey={highlightRequestKey} />}

        {connected && <OnlineArtistSections data={onlineData} path={`/artist/${id}`} libraryTracks={artist.tracks || []} libraryAlbums={artist.albums || []} shownTypes={shownTypes} />}
      </div>
      {releases.elements}

      <ArtistManageModal
        artist={artist}
        allArtists={allArtists}
        open={showManage}
        onClose={() => setShowManage(false)}
        onChanged={load}
      />
    </div>
  )
}

function AlbumTracks({ album, artistName = null, highlightTrackId = null, highlightRequestKey = null }) {
  const [tracks, setTracks] = useState([])
  const playQueue = usePlayerStore(s => s.playQueue)
  // album now carries its own album_artist (see the two setSelectedAlbum
  // call sites above) -- this page's display artist name isn't necessarily
  // the album's actual album_artist (e.g. a "Various Artists" compilation,
  // or a feature/guest album), and using it here made getAlbumTracks below
  // match tracks by the wrong artist whenever the two differ, sometimes
  // turning up an empty tracklist.
  const albumContext = makeAlbumContext(album)

  useEffect(() => {
    api.getAlbumTracks(album).then((result) => setTracks(result || []))
  }, [album])

  useEffect(() => {
    const handleRefresh = () => {
      api.getAlbumTracks(album).then((result) => setTracks(result || []))
    }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [album])

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-white">{album.title}</h3>
        <button onClick={() => playQueue(tracks, 0, albumContext)} className="text-xs text-accent hover:text-accent-dim">Play Album</button>
      </div>
      <TrackList tracks={tracks} context={albumContext} highlightTrackId={highlightTrackId} highlightRequestKey={highlightRequestKey} />
    </motion.div>
  )
}
