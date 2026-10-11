// Home → Releases: the newest releases by the artists in your library, newest
// first, as a list of albums with their details. Checked when you refresh
// (every artist's catalogue); the last check is kept for the next visit.

import React from 'react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { CalendarDays, Disc3, Loader2, MoreHorizontal, Play, RefreshCw, X } from 'lucide-react'
import DiscoveryImage from './DiscoveryImage'
import { checkReleases, loadArtistReleases, savedReleases } from '../newReleases'
import { api } from '../api'
import { plural } from '../plural'
import { discoveryArtistKey, useDiscoveryArtists } from '../discoveryArtists'

const TYPE_LABEL = { album: 'Album', single: 'Single', ep: 'EP' }

function ago(time) {
  if (!time) return ''
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(time).toLocaleDateString()
}

function dateLabel(release) {
  const date = String(release.release_date || release.releaseDate || '')
  // A plain date ("2026-09-30") is that calendar day everywhere: read as UTC
  // and shown in UTC, it can't slip to the day before west of Greenwich.
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (date.length > 4 && Number.isFinite(Date.parse(date))) return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  return String(release.year || date.slice(0, 4) || '')
}

function ReleaseRow({ release, index, onPlay, onOpen, onMenu, onArtist }) {
  const type = TYPE_LABEL[release.release_type] || 'Release'
  return (
    <div role="listitem" onContextMenu={event => onMenu?.(event, release)}
      className="group grid grid-cols-[2rem_4.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-elevated">
      <span className="text-right text-xs tabular-nums text-muted">{index + 1}</span>
      <button type="button" onClick={() => onOpen(release)} aria-label={`Open ${release.title}`} className="relative h-[4.5rem] w-[4.5rem] overflow-hidden rounded-lg bg-card shadow-md">
        <DiscoveryImage item={release} type="album" src={release.artwork_url} className="h-full w-full object-cover" fallback={<div className="flex h-full items-center justify-center text-muted"><Disc3 size={24} /></div>} />
      </button>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => onOpen(release)} className="truncate text-left text-sm font-semibold text-white hover:underline">{release.title}</button>
          {release.isNew && <span className="flex-shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">New</span>}
        </div>
        <button type="button" onClick={() => onArtist(release)} className="block max-w-full truncate text-left text-xs text-white/75 hover:text-white hover:underline">{release.artist}</button>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          <span className="rounded border border-border px-1.5 py-px text-[10px] uppercase tracking-wider">{type}</span>
          <CalendarDays size={11} />{dateLabel(release)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => onPlay(release)} title={`Play ${release.title}`} aria-label={`Play ${release.title}`} className="flex h-9 w-9 items-center justify-center text-white/80 transition hover:scale-110 hover:text-accent"><Play size={20} fill="currentColor" strokeWidth={0} /></button>
        <button type="button" onClick={event => onMenu?.(event, release)} title="More" aria-label={`More for ${release.title}`} className="rounded-full p-2 text-muted opacity-0 transition-opacity hover:text-white group-hover:opacity-100 focus:opacity-100"><MoreHorizontal size={16} /></button>
      </div>
    </div>
  )
}

// The check lives outside the page: leaving Home (or the tab) doesn't stop
// it or lose what it found, and coming back shows its progress.
export const useReleaseCheck = create((set, get) => ({
  saved: savedReleases(),
  checking: null, // { done, total }
  run: 0,
  start: async artists => {
    if (get().checking) return
    const id = get().run + 1
    const isCurrent = () => get().run === id
    set({ run: id, checking: { done: 0, total: artists.length } })
    try {
      const result = await checkReleases(artists, name => loadArtistReleases(name, api), {
        isCurrent,
        onProgress: ({ done, total, items }) => { if (isCurrent()) set(state => ({ checking: { done, total }, saved: { ...state.saved, items } })) },
      })
      if (isCurrent()) set({ saved: result })
    } finally { if (isCurrent()) set({ checking: null }) }
  },
  stop: () => set(state => ({ run: state.run + 1, checking: null, saved: savedReleases() })),
}))

export default function ReleasesPanel({ artists, onPlay, onOpen, onMenu, onArtist }) {
  const { saved, checking, start, stop } = useReleaseCheck(useShallow(state => ({ saved: state.saved, checking: state.checking, start: state.start, stop: state.stop })))
  const refresh = () => start(artists)

  // Hiding an artist from Discovery takes their releases out at once,
  // without a new check.
  const hidden = useDiscoveryArtists(state => state.hidden)
  const items = (saved?.items || []).filter(release => !hidden.has(discoveryArtistKey(release.seedArtist || release.artist)) && !hidden.has(discoveryArtistKey(release.artist)))
  const newCount = items.filter(release => release.isNew).length
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-display uppercase tracking-[0.25em] text-accent">Releases</p>
          <h2 className="mt-1 text-xl font-medium text-white">New from your artists</h2>
          <p className="mt-1 text-xs text-muted">
            {checking ? `Checking ${checking.done}/${checking.total} artists…`
              : saved?.checkedAt ? `The latest ${plural(items.length, 'release')} by ${plural(saved.artists || artists.length, 'library artist')}, newest first · checked ${ago(saved.checkedAt)}${newCount ? ` · ${newCount} new` : ''}${saved.failures ? ` · ${plural(saved.failures, 'artist')} couldn't be checked` : ''}`
              : `The latest ${100} releases by the artists in your library, newest first.`}
          </p>
        </div>
        {checking
          ? <button type="button" onClick={stop} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-text hover:border-accent/40"><Loader2 size={13} className="animate-spin text-accent" />Stop<X size={12} className="text-muted" /></button>
          : <button type="button" onClick={refresh} disabled={!artists.length} className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-medium text-[rgb(var(--bg-rgb))] disabled:opacity-40"><RefreshCw size={13} />{saved?.checkedAt ? 'Refresh' : 'Check for releases'}</button>}
      </div>
      {checking && <div className="h-1 overflow-hidden rounded-full bg-elevated"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${checking.total ? (checking.done / checking.total) * 100 : 0}%` }} /></div>}
      {items.length ? (
        <div role="list" aria-label="New releases" className="space-y-0.5">
          {items.map((release, index) => <ReleaseRow key={`${release.artist}\u0000${release.title}`} release={release} index={index} onPlay={onPlay} onOpen={onOpen} onMenu={onMenu} onArtist={onArtist} />)}
        </div>
      ) : !checking && (
        <div className="rounded-xl border border-border bg-elevated px-4 py-12 text-center">
          <CalendarDays size={30} className="mx-auto mb-3 text-muted/60" />
          <p className="text-sm text-text">{artists.length ? (saved?.checkedAt ? 'No dated releases were found.' : 'See what your artists released lately.') : 'Add music to your library to follow its artists’ releases.'}</p>
          {artists.length > 0 && <p className="mt-1 text-xs text-muted">Refresh checks each artist’s catalogue on YouTube Music.</p>}
        </div>
      )}
    </section>
  )
}
