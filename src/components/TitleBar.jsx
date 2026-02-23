import React from 'react'
import { Minus, Square, X } from 'lucide-react'

export default function TitleBar() {
  return (
    <div className="titlebar h-10 bg-surface flex items-center justify-between px-4 border-b border-border flex-shrink-0">
      <span className="font-display text-xs text-muted tracking-widest uppercase">Lokal Music</span>

      <div className="flex gap-1 -webkit-app-region-no-drag">
        <button
          onClick={() => window.electron?.minimize()}
          className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-white hover:bg-elevated transition-colors"
        >
          <Minus size={12} />
        </button>
        <button
          onClick={() => window.electron?.maximize()}
          className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-white hover:bg-elevated transition-colors"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => window.electron?.close()}
          className="w-7 h-7 rounded flex items-center justify-center text-muted hover:text-white hover:bg-red-500/30 hover:text-red-400 transition-colors"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
