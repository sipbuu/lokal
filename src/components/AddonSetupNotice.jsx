// "Finish setting up" for SpotiFLAC sources that can't stream or download
// yet (an unverified session, a login not done): people often install one
// and don't notice it still needs this step.

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { api } from '../api'

/** Settings → Addons, opened at this addon. */
export function openAddonSetup(navigate, key) {
  navigate('/settings', { state: { category: 'addons', addon: key } })
}

export default function AddonSetupNotice({ source, className = '' }) {
  const navigate = useNavigate()
  const [message, setMessage] = useState('')
  if (!source?.needsSetup) return null
  const key = String(source.id || '').replace(/^a-/, '')
  // Signed-session sources verify straight from here: the window opens, and
  // the source list refreshes when it closes (lokal:addons-changed).
  const verify = async () => {
    setMessage('')
    const result = await api.addonsPackages({ action: 'package.verify', key }).catch(error => ({ error: error.message }))
    if (result?.error) setMessage(result.error)
    else if (result?.opened) setMessage('Complete the verification in the window that opened.')
    else window.dispatchEvent(new Event('lokal:addons-changed'))
  }
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-xs text-text/85 ${className}`}>
      <ShieldAlert size={14} className="flex-shrink-0 text-yellow-300" />
      <span className="min-w-0 flex-1">{message || `${source.label} isn't set up yet: verify access to stream and download from it.`}</span>
      {api.isElectron && <button type="button" onClick={verify} className="rounded-lg bg-yellow-500/20 px-2.5 py-1 text-[11px] font-medium text-yellow-200 hover:bg-yellow-500/30">Verify now</button>}
      <button type="button" onClick={() => openAddonSetup(navigate, key)} className="text-[11px] text-yellow-200/90 underline-offset-2 hover:underline">Addon settings</button>
    </div>
  )
}
