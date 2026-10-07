// Settings → Addons & Plugins → Qobuz: the app ID and secret, signing in with
// a Qobuz account, the streaming quality, and a connection test. Qobuz then
// shows as a source next to YouTube Music and SoundCloud in search.
// The secret and the login token stay in the backend: this page only learns
// whether they're set. The account password is sent once to sign in and never kept.

import React, { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '../../api'

// format_id the API uses -> what the user picks (5, MP3, isn't offered: it's the fallback floor).
const QUALITIES = [
  [6, 'CD quality (FLAC 16-bit / 44.1 kHz)'],
  [7, 'Hi-Res (FLAC 24-bit / up to 96 kHz)'],
  [27, 'Hi-Res Max (FLAC 24-bit / up to 192 kHz)'],
]

const inputClass = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-text outline-none focus:border-accent/50 placeholder:text-muted'
const buttonClass = 'flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[rgb(var(--bg-rgb))] transition-colors hover:bg-accent/80 disabled:opacity-40'
const sourcesChanged = () => window.dispatchEvent(new Event('lokal:addons-changed'))

export default function QobuzSettings() {
  const [status, setStatus] = useState(null) // { enabled, appId, hasSecret, signedIn, userName, quality }
  const [appId, setAppId] = useState('')
  const [secret, setSecret] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(null) // 'save' | 'signIn' | 'test'
  const [message, setMessage] = useState(null) // { error?, text }

  const apply = (result) => {
    if (result?.error) { setMessage({ error: true, text: result.error }); return false }
    setStatus(result)
    return true
  }

  useEffect(() => {
    Promise.resolve(api.qobuzStatus()).then(s => { if (s && !s.error) { setStatus(s); setAppId(s.appId || '') } }).catch(() => {})
  }, [])

  /** Run one call: busy state, errors shown, the page told when the source list may have changed. */
  const run = async (name, work, onDone) => {
    setBusy(name)
    setMessage(null)
    try {
      const result = await work()
      if (result?.error) setMessage({ error: true, text: result.error })
      else onDone?.(result)
    } catch (e) { setMessage({ error: true, text: e.message }) }
    setBusy(null)
  }

  const save = (extra = {}) => run('save', () => api.qobuzSave({ appId: appId.trim(), appSecret: secret.trim(), ...extra }), (result) => {
    apply(result)
    setSecret('')
    setMessage({ text: 'Saved.' })
    sourcesChanged()
  })

  const setEnabled = (enabled) => run('save', () => api.qobuzSave({ enabled }), (result) => { apply(result); sourcesChanged() })
  const setQuality = (quality) => run('save', () => api.qobuzSave({ quality: Number(quality) }), apply)

  const signIn = () => run('signIn', async () => {
    // The app ID is needed to sign in: save what's typed first.
    const saved = await api.qobuzSave({ appId: appId.trim(), appSecret: secret.trim() })
    if (saved?.error) return saved
    return api.qobuzSignIn(email.trim(), password)
  }, (result) => {
    apply(result)
    setSecret(''); setPassword('')
    setMessage({ text: `Signed in as ${result.userName || 'your account'}.` })
  })

  const signOut = () => run('signIn', () => api.qobuzSignOut(), (result) => { apply(result); setMessage({ text: 'Signed out.' }) })

  const test = () => run('test', async () => {
    // Test what's typed, not only what was saved before.
    if (appId.trim() !== status?.appId || secret.trim()) {
      const saved = await api.qobuzSave({ appId: appId.trim(), appSecret: secret.trim() })
      if (saved?.error) return saved
      apply(saved); setSecret('')
    }
    return api.qobuzTest()
  }, (result) => setMessage({ text: result?.message || 'Connected.' }))

  if (!status) return null
  const on = status.enabled

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-muted">
        Stream from Qobuz in lossless and hi-res FLAC, with your own Qobuz account. Songs can be played, added to playlists and saved to your library. A subscription is needed: without one, Qobuz only plays 30-second samples.
      </p>
      <div className="flex items-start gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/10 p-3">
        <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-yellow-300" />
        <p className="text-[11px] leading-relaxed text-text/80">
          Lokal isn't affiliated with Qobuz and doesn't provide an app ID or secret: use ones you're entitled to use, and follow Qobuz's terms. Your password is only sent to Qobuz to sign in, and isn't stored.
        </p>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-text">Qobuz source</p>
          <p className="text-[11px] leading-relaxed text-muted">Shows Qobuz as a source in search.</p>
        </div>
        <button role="switch" aria-checked={on} onClick={() => setEnabled(!on)} disabled={busy === 'save'}
          className={`flex-shrink-0 rounded-lg border px-3 py-1 text-[11px] font-display uppercase tracking-wider transition-colors ${on ? 'border-accent/50 bg-accent/20 text-accent' : 'border-border text-muted hover:text-text'}`}>
          {on ? 'On' : 'Off'}
        </button>
      </div>

      <div className="space-y-1">
        <label htmlFor="qobuz-app-id" className="text-xs font-medium text-text">App ID</label>
        <input id="qobuz-app-id" value={appId} onChange={e => setAppId(e.target.value)} spellCheck={false} autoComplete="off" className={inputClass} />
      </div>
      <div className="space-y-1">
        <label htmlFor="qobuz-app-secret" className="text-xs font-medium text-text">App secret</label>
        <input id="qobuz-app-secret" type="password" value={secret} onChange={e => setSecret(e.target.value)} spellCheck={false} autoComplete="off"
          placeholder={status.hasSecret ? 'Saved. Type to replace it.' : ''} className={inputClass} />
        <p className="text-[11px] leading-relaxed text-muted">Needed to ask Qobuz for the audio link of a song.</p>
      </div>
      <button onClick={() => save()} disabled={!!busy || !appId.trim()} className={buttonClass}>
        {busy === 'save' && <Loader2 size={12} className="animate-spin" />} Save
      </button>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-xs font-medium text-text">Account</p>
        {status.signedIn ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Signed in{status.userName ? ` as ${status.userName}` : ''}.</p>
            <button onClick={signOut} disabled={!!busy} className="rounded-lg border border-border px-3 py-1 text-[11px] text-muted hover:text-text disabled:opacity-40">Sign out</button>
          </div>
        ) : (
          <div className="space-y-2">
            <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="username" spellCheck={false} className={inputClass} />
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && email && password && signIn()}
              placeholder="Password" autoComplete="current-password" className={inputClass} />
            <button onClick={signIn} disabled={!!busy || !appId.trim() || !email.trim() || !password} className={buttonClass}>
              {busy === 'signIn' && <Loader2 size={12} className="animate-spin" />} Sign in
            </button>
          </div>
        )}
      </div>

      <div className="space-y-1 border-t border-border pt-4">
        <label htmlFor="qobuz-quality" className="text-xs font-medium text-text">Streaming quality</label>
        <select id="qobuz-quality" value={String(status.quality)} onChange={e => setQuality(e.target.value)}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-text outline-none focus:border-accent/50">
          {QUALITIES.map(([value, label]) => <option key={value} value={String(value)}>{label}</option>)}
        </select>
        <p className="text-[11px] leading-relaxed text-muted">If a song isn't available in this quality, the next one down is used.</p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={test} disabled={!!busy || !appId.trim()} className={buttonClass}>
          {busy === 'test' && <Loader2 size={12} className="animate-spin" />} Test connection
        </button>
        {message && <p className={`text-xs ${message.error ? 'text-red' : 'text-accent'}`}>{message.text}</p>}
      </div>
    </div>
  )
}
