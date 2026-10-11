// "Get it in lossless" for a library track: where to buy it in FLAC (exact
// store pages from MusicBrainz when known, plus store searches), a Soulseek
// search whose pick replaces the file in place, and, for a lossless file,
// the spectrum check that tells a real one from a converted MP3, and a search
// of your addon sources for a higher-quality copy that replaces the file.
// Opened from anywhere with openLossless(track) (src/quality.js).

import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, Search, Activity, ShoppingBag, Gift, Loader2, BookOpen, Blocks, Download, Check } from 'lucide-react'
import Modal from './Modal'
import { api } from '../api'
import { TIERS, tierOf, isSuspect, formatLabel, verdictText, storeSearches } from '../quality'
import { downloadGhostResult, differentDuration } from '../ghostDownloads'
import AddonSetupNotice from './AddonSetupNotice'

const LOSSLESS_HINT = /lossless|flac|hi-?res|24[ -]?bit|alac|wav|cd quality|16[ -]?bit/i
// A result an addon labels lossy is no upgrade, however well it matches.
const LOSSY_HINT = /\b(mp3|aac|ogg|opus|vorbis|m4a|\d{2,3}\s?k(?:bps)?|low|normal|high quality)\b/i
const fmtTime = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`
const plainText = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Closest to the song first: same title and artist, near its length, marked lossless. */
export function rankReplacements(track, items) {
  const title = plainText(track.title), artist = plainText(String(track.artist || '').split(/\s*,\s*/)[0])
  const score = item => (plainText(item.title) === title ? 4 : plainText(item.title).includes(title) ? 2 : 0)
    + (plainText(item.artist).includes(artist) ? 3 : 0)
    + (!differentDuration(track, item) ? 2 : 0)
    + (LOSSLESS_HINT.test(String(item.quality || '')) ? 1 : 0)
  const lossy = item => { const quality = String(item.quality || ''); return !!quality && LOSSY_HINT.test(quality) && !LOSSLESS_HINT.test(quality) }
  return items.filter(item => !item.preview && !lossy(item) && score(item) >= 5).sort((a, b) => score(b) - score(a))
}

function LinkRow({ link }) {
  const Icon = link.kind === 'free' ? Gift : link.kind === 'search' ? Search : link.kind === 'info' ? BookOpen : ShoppingBag
  return (
    <button
      onClick={() => api.openExternal(link.url)}
      className="w-full flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-card"
    >
      <Icon size={14} className={link.kind === 'search' || link.kind === 'info' ? 'text-muted' : 'text-accent'} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white truncate">
          {link.kind === 'search' || link.kind === 'info' ? `Search ${link.store}` : link.store}
          {link.release ? <span className="text-muted"> · {link.release}</span> : null}
        </span>
        <span className="block text-[11px] text-muted truncate">{link.format}</span>
      </span>
      <ExternalLink size={12} className="text-muted flex-shrink-0" />
    </button>
  )
}

export default function LosslessModal() {
  const nav = useNavigate()
  const [track, setTrack] = useState(null)
  const [links, setLinks] = useState(null) // null: loading
  const [check, setCheck] = useState(null) // { loading } | result | { error }

  useEffect(() => {
    const open = (e) => { if (e.detail?.id) setTrack(e.detail) }
    window.addEventListener('lokal:lossless', open)
    return () => window.removeEventListener('lokal:lossless', open)
  }, [])

  useEffect(() => {
    if (!track?.id) return undefined
    let alive = true
    setLinks(null)
    setCheck(null)
    Promise.resolve(api.qualityBuyLinks(track.id))
      .then(r => { if (alive) setLinks(r?.error ? { error: r.error, exact: [], searches: [] } : r) })
      .catch(e => { if (alive) setLinks({ error: e.message, exact: [], searches: [] }) })
    return () => { alive = false }
  }, [track?.id])

  // Addon sources only (no YouTube / SoundCloud): their best matches.
  const [online, setOnline] = useState(null) // null: loading; [{ source, items, error }]
  const [setup, setSetup] = useState([])
  const [replacing, setReplacing] = useState('')
  const [replaced, setReplaced] = useState('')
  useEffect(() => {
    if (!track?.id) return undefined
    let alive = true
    setOnline(null); setSetup([]); setReplaced(''); setReplacing('')
    ;(async () => {
      const providers = await Promise.resolve(api.onlineProviders?.()).catch(() => null)
      const addons = (Array.isArray(providers) ? providers : []).filter(p => p.addon)
      if (alive) setSetup(addons.filter(p => p.needsSetup))
      const usable = addons.filter(p => !p.needsSetup)
      const query = [String(track.artist || '').split(/\s*,\s*/)[0], track.title].filter(Boolean).join(' ')
      const groups = await Promise.all(usable.map(async source => {
        try {
          const response = await api.onlineSearch(query, source.id)
          if (response?.error) throw new Error(response.error)
          const rows = Array.isArray(response) ? response : response?.results || []
          return { source, items: rankReplacements(track, rows.map(item => ({ ...item, provider: item.provider || source.id }))).slice(0, 3) }
        } catch (error) { return { source, items: [], error: error.message } }
      }))
      if (alive) setOnline(groups)
    })()
    return () => { alive = false }
  }, [track?.id])

  const replaceWith = async (item, source) => {
    const key = `${item.provider}:${item.id}`
    setReplacing(key)
    const result = await downloadGhostResult({ ...track, missing: true }, item, {
      confirmDuration: (song, found) => window.confirm(`"${found.title}" on ${source.label} is ${fmtTime(found.duration)} long; yours is ${fmtTime(song.duration)}. Replace it anyway?`),
    }).catch(error => ({ error: error.message }))
    setReplacing('')
    if (result?.cancelled) return
    if (result?.error) { setOnline(groups => groups.map(group => group.source.id === source.id ? { ...group, error: result.error } : group)); return }
    setReplaced(key)
  }

  const close = () => setTrack(null)
  if (!track) return <Modal open={false} onClose={close} />

  const shown = check && !check.loading && !check.error ? { ...track, spectral_verdict: check.verdict, spectral_cutoff: check.cutoff } : track
  const tier = isSuspect(shown) ? 'suspect' : tierOf(shown)
  const info = TIERS[tier]
  const lossless = Number(track.lossless) === 1
  const verdict = verdictText(shown)

  const findOnSoulseek = () => {
    const query = [String(track.artist || '').split(/\s*,\s*/)[0], track.title].filter(Boolean).join(' ').replace(/\s*\((?:feat|ft)\.?[^)]*\)/i, '')
    nav('/search', { state: { soulseek: { query, losslessOnly: true, upgradeTrackId: track.id, title: track.title, artist: track.artist, current: formatLabel(track) || null } } })
    close()
  }

  const runCheck = async () => {
    setCheck({ loading: true })
    const result = await Promise.resolve(api.qualityCheckOne(track.id)).catch(e => ({ error: e.message }))
    setCheck(result || { error: 'No answer' })
    if (result && !result.error) window.dispatchEvent(new Event('lokal:quality-changed'))
  }

  return (
    <Modal open={!!track} onClose={close} title="Get it in lossless" width="max-w-lg">
      <div className="space-y-5 overflow-y-auto px-5 pb-5 pt-4 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white truncate">{track.title}</p>
            <p className="text-xs text-muted truncate">{track.artist}{track.album ? ` · ${track.album}` : ''}</p>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${info.className}`}>{info.label}</span>
            {formatLabel(track) && <span className="text-[11px] text-muted">{formatLabel(track)}</span>}
          </div>
        </div>

        {lossless && (
          <div className="rounded-xl border border-border bg-card/40 px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <Activity size={13} className="text-muted flex-shrink-0" />
              <p className="min-w-0 flex-1 text-muted">{check?.error ? check.error : verdict || 'A FLAC made from an MP3 keeps the MP3\'s high-frequency cut-off. Check the spectrum to find out.'}</p>
              <button onClick={runCheck} disabled={check?.loading}
                className="flex-shrink-0 rounded-lg border border-border px-2.5 py-1 text-[11px] text-muted hover:text-white disabled:opacity-50">
                {check?.loading ? <Loader2 size={12} className="animate-spin" /> : verdict ? 'Check again' : 'Check'}
              </button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-display uppercase tracking-widest text-muted">Buy in lossless</p>
          {links?.exact?.map(link => <LinkRow key={link.url} link={link} />)}
          {storeSearches(track).map(link => <LinkRow key={link.url} link={link} />)}
          {!links && <p className="flex items-center gap-2 text-[11px] text-muted"><Loader2 size={11} className="animate-spin" /> Looking for the exact release on MusicBrainz (a few seconds)…</p>}
          {links && !links.exact?.length && (
            <p className="text-[11px] text-muted">
              {links.identified ? 'MusicBrainz knows this recording but lists no lossless store for it.' : "MusicBrainz doesn't list a store for this song."}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-display uppercase tracking-widest text-muted">From your addon sources</p>
          {setup.map(source => <AddonSetupNotice key={source.id} source={source} />)}
          {online === null && <p className="flex items-center gap-2 text-[11px] text-muted"><Loader2 size={11} className="animate-spin" /> Searching your addon sources…</p>}
          {online?.length === 0 && !setup.length && <p className="text-[11px] text-muted">No addon sources installed. Add one in Settings → Addons to download a lossless copy from it.</p>}
          {online?.map(({ source, items, error }) => (
            <div key={source.id} className="space-y-1.5">
              {items.map(item => {
                const key = `${item.provider}:${item.id}`
                return (
                  <div key={key} className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2">
                    {source.icon ? <img src={source.icon} alt="" className="h-4 w-4 flex-shrink-0 rounded-sm object-cover" referrerPolicy="no-referrer" /> : <Blocks size={14} className="flex-shrink-0 text-accent" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{item.title}<span className="text-muted"> · {item.artist}</span></span>
                      <span className="block truncate text-[11px] text-muted">{[source.label, item.album, item.quality, item.duration ? fmtTime(item.duration) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    {replaced === key
                      ? <span className="inline-flex flex-shrink-0 items-center gap-1 text-[11px] text-accent"><Check size={12} />Downloading</span>
                      : <button onClick={() => replaceWith(item, source)} disabled={!!replacing || !!replaced} title="Download this copy; it replaces your file, keeping its playlists, likes and plays"
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] text-text hover:border-accent/40 disabled:opacity-40">
                          {replacing === key ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}Replace
                        </button>}
                  </div>
                )
              })}
              {!items.length && <p className="text-[11px] text-muted">{source.label}: {error || 'no close match.'}</p>}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-display uppercase tracking-widest text-muted">Soulseek</p>
          <button onClick={findOnSoulseek}
            className="w-full flex items-center gap-3 rounded-xl border border-border bg-card/60 px-3 py-2 text-left transition-colors hover:border-accent/40 hover:bg-card">
            <Search size={14} className="text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-white">Find a lossless file on Soulseek…</span>
              <span className="block text-[11px] text-muted">The file you pick replaces this one, keeping its playlists, likes and plays.</span>
            </span>
          </button>
        </div>
      </div>
    </Modal>
  )
}
