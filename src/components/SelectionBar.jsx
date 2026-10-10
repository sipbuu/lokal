// The bar shown while items are selected: how many, what can be done with
// them, and a way out. It floats over the bottom of the page (above the
// player bar) instead of being inserted above the list, so nothing moves
// when it comes and goes; it glides in and out.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'

const GAP = 16

// While a bar is up the page gets room at its bottom, so the last rows can
// still scroll out from under it (room below the content moves nothing).
let raised = 0
function useRoomBelow(open) {
  useEffect(() => {
    const main = open && document.querySelector('main')
    if (!main) return undefined
    raised += 1
    main.style.paddingBottom = '88px'
    return () => {
      raised -= 1
      if (!raised) main.style.paddingBottom = ''
    }
  }, [open])
}

/** Where the page content is on screen (the bar is centred over it). */
function usePageBox(open) {
  const [box, setBox] = useState(null)
  useLayoutEffect(() => {
    if (!open) return undefined
    const main = document.querySelector('main')
    const measure = () => {
      const rect = main?.getBoundingClientRect()
      setBox(rect ? { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.bottom } : null)
    }
    measure()
    const observer = main && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observer?.observe(main)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [open])
  return box
}

/**
 * @param open     whether anything is selected
 * @param label    "3 selected"
 * @param actions  [{ label, icon, onClick, danger, hidden }]
 */
export default function SelectionBar({ open = true, label, actions = [], onClear }) {
  const reduceMotion = useReducedMotion()
  const box = usePageBox(open)
  useRoomBelow(open)
  // While it glides out, it keeps showing what it last showed (not "0 selected").
  const shown = useRef({ label, actions })
  if (open) shown.current = { label, actions }
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  const rise = reduceMotion ? 0 : 18
  return createPortal(
    <AnimatePresence>
      {open && box && (
        <div className="pointer-events-none fixed z-[60] flex justify-center px-4"
          style={{ left: box.left, width: box.width, bottom: box.bottom + GAP }}>
          <motion.div
            role="toolbar"
            aria-label={shown.current.label}
            onClick={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: rise, scale: reduceMotion ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: rise * 0.6, scale: reduceMotion ? 1 : 0.98, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, mass: 0.8 }}
            className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-elevated/95 px-4 py-2.5 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl"
          >
            <span className="text-sm font-medium tabular-nums text-accent">{shown.current.label}</span>
            <span className="hidden text-[11px] text-muted xl:inline">Ctrl+click to add · Shift+click for a range · right-click for more</span>
            <div className="ml-auto flex flex-wrap items-center gap-2 pl-2">
              {shown.current.actions.filter(action => !action.hidden).map(({ label: text, icon: Icon, onClick, danger, disabled }) => (
                <button key={text} onClick={onClick} disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors disabled:opacity-40 disabled:cursor-default ${danger ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25' : 'border border-border bg-card text-white/80 hover:border-accent/40 hover:text-white'}`}>
                  {Icon && <Icon size={12} />} {text}
                </button>
              ))}
              <button onClick={onClear} title="Clear selection (Esc)" aria-label="Clear selection" className="p-1.5 text-muted transition-colors hover:text-white">
                <X size={14} />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
