import React from 'react'
import { Bird, Globe, Puzzle, Youtube } from 'lucide-react'
import { downloadSourceLabel, streamRef } from '../onlineTracks'

// Quiet marks by default; online search opts into coloured provider branding.
export default function SourceIcon({ source, size = 14, className = '', colored = false }) {
  const props = { width: size, height: size, className: `shrink-0 ${className}`, 'aria-hidden': true }
  if (source === 'sc' && !colored) return (
    <svg {...props} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12v4m3-6v8m3-9v9m3-12v12h7a4 4 0 1 0-.5-8A6 6 0 0 0 11 6Z" />
    </svg>
  )
  if (colored && source === 'yt') return <svg {...props} viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="5" fill="#ff0000" /><path d="m10 8 6 4-6 4Z" fill="white" /></svg>
  if (colored && source === 'sc') return <svg {...props} viewBox="0 0 24 24" fill="#ff5500"><path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z" /></svg>
  if (colored && source === 'spotify') return <svg {...props} viewBox="0 0 24 24" fill="#1ed760"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" /></svg>
  if (colored && (source === 'soulseek' || source === 'slsk')) return <span aria-hidden="true" className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}><Bird size={size} className="text-blue-400" /><img src="https://www.slsknet.org/news/sites/default/files/slsk_bird.jpg" alt="" className="absolute inset-0 h-full w-full rounded-sm object-cover" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }} /></span>
  const Icon = source === 'yt' ? Youtube
    : source === 'soulseek' || source === 'slsk' ? Bird
      : source?.startsWith('a-') ? Puzzle : Globe
  return <Icon {...props} />
}

export function TrackSourceIcon({ track, addonNames, className = '' }) {
  const stream = streamRef(track)
  const source = stream?.provider || track.download_source
  const label = downloadSourceLabel(source, addonNames)
  const local = !source && !String(track.file_path || '').startsWith('ghost://')
  if (local) return null
  const description = label ? `${stream ? 'Streamed' : 'Downloaded'} from ${label}${stream ? ' · not in your library yet' : ''}` : 'Source unknown'
  return (
    <span role="img" aria-label={description} title={description} className={`inline-flex shrink-0 items-center justify-center text-muted ${className}`}>
      <SourceIcon source={source} />
    </span>
  )
}
