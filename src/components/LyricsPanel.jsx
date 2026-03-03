import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Mic2, Search } from 'lucide-react'
import { api } from '../api'

function WaveLoader() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-40">
      <div className="flex gap-1 items-end">
        {[0,1,2,3,4].map(i => (
          <motion.div key={i} className="w-0.5 bg-accent/50 rounded-full"
            animate={{ height: ['8px','20px','8px'] }}
            transition={{ duration: 0.8, repeat: Infinity, delay: i*0.12 }} />
        ))}
      </div>
      <p className="text-xs text-muted">Fetching lyrics…</p>
    </div>
  )
}

function WaveDots({ duration = 3 }) {
  const dotDuration = duration * 1000
  
  return (
    <span className="inline-flex items-center gap-0.5" style={{ height: '1em' }}>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1 h-1 rounded-full"
          style={{ backgroundColor: '#9ca3af' }}
          animate={{
            opacity: [0.3, 1, 0.3],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: dotDuration / 1000,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * (dotDuration / 3000),
          }}
        />
      ))}
    </span>
  )
}

const isLetter = ch => /[A-Za-z0-9]/.test(ch)
const charWeight = ch => isLetter(ch) ? 1.0 : 0.35

function buildCharTimeline(wordText, start, end) {
  const chars = Array.from(wordText)
  const n = chars.length
  if (n === 0) return []
  const wordDur = Math.max(0.05, end - start)
  const staggerWindow = wordDur * 0.65
  const charAnimDur = Math.min(0.18, wordDur * 0.45)
  return chars.map((ch, i) => {
    const staggerT = n > 1 ? i / (n - 1) : 0
    const chStart = start + staggerT * staggerWindow
    const chEnd = chStart + charAnimDur
    return { ch, start: chStart, end: chEnd }
  })
}

function RAFWordLine({ words, bgWords, liveProgressRef }) {
  const containerRef = useRef(null)
  const rafRef = useRef(null)
  const charDataRef = useRef([])
  const bgCharDataRef = useRef([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const spans = container.querySelectorAll('[data-char]')
    const bgSpans = container.querySelectorAll('[data-bgchar]')
    charDataRef.current = Array.from(spans).map(el => ({
      el,
      start: parseFloat(el.dataset.start),
      end: parseFloat(el.dataset.end),
    }))
    bgCharDataRef.current = Array.from(bgSpans).map(el => ({
      el,
      start: parseFloat(el.dataset.start),
      end: parseFloat(el.dataset.end),
    }))

    let prev = -1
    function tick() {
      rafRef.current = requestAnimationFrame(tick)
      const p = liveProgressRef.current
      if (Math.abs(p - prev) < 0.0005) return
      prev = p

      for (const { el, start, end } of charDataRef.current) {
        const raw = Math.max(0, Math.min(1, (p - start) / Math.max(0.01, end - start)))
        const t = raw < 1 ? 1 - Math.pow(1 - raw, 2.2) : 1
        const bounce = raw < 1 ? Math.sin(raw * Math.PI) * 1.5 : 0
        const y = (1 - t) * 7 - bounce
        const scale = 0.94 + 0.09 * t - (raw < 1 ? Math.sin(raw * Math.PI) * 0.02 : 0)
        el.style.transform = `translate3d(0,${y}px,0) scale(${scale})`
        el.style.opacity = String(Math.max(0.35, 0.35 + 0.65 * t))
        el.style.color = raw > 0.05 ? '#fff' : '#9ca3af'
      }
      for (const { el, start, end } of bgCharDataRef.current) {
        const raw = Math.max(0, Math.min(1, (p - start) / Math.max(0.01, end - start)))
        const t = raw < 1 ? 1 - Math.pow(1 - raw, 2.2) : 1
        const bounce = raw < 1 ? Math.sin(raw * Math.PI) * 1.0 : 0
        const y = (1 - t) * 5 - bounce
        el.style.transform = `translate3d(0,${y}px,0) scale(${0.95 + 0.05 * t})`
        el.style.opacity = String(Math.max(0.2, 0.2 + 0.8 * t))
        el.style.color = raw > 0.05 ? '#fff' : '#9ca3af'
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [words, bgWords, liveProgressRef])

  return (
    <span ref={containerRef} style={{ display: 'inline' }}>
      {(words || []).map((w, wi) => {
        const merged = wi > 0 && words[wi-1]?.word?.endsWith('-')
        return (
          <span key={wi} style={{ display: 'inline-block', whiteSpace: 'nowrap', marginRight: merged ? 0 : '0.35em' }}>
            {(w.chars || []).map((c, ci) => (
              <span key={ci}
                data-char="1"
                data-start={c.start}
                data-end={c.end}
                style={{ display: 'inline-block', whiteSpace: 'pre', willChange: 'transform,opacity', color: '#9ca3af', opacity: 0.4 }}>
                {c.ch}
              </span>
            ))}
          </span>
        )
      })}
      {bgWords?.length > 0 && (
        <div className="text-sm mt-1 italic">
          {bgWords.map((bw, bi) => (
            <span key={bi} style={{ display: 'inline-block', whiteSpace: 'nowrap', marginRight: bw.word.endsWith('-') ? 0 : '0.25em' }}>
              {(bw.chars || []).map((c, ci) => (
                <span key={ci}
                  data-bgchar="1"
                  data-start={c.start}
                  data-end={c.end}
                  style={{ display: 'inline-block', whiteSpace: 'pre', willChange: 'transform,opacity', color: '#9ca3af', opacity: 0.2 }}>
                  {c.ch}
                </span>
              ))}
            </span>
          ))}
        </div>
      )}
    </span>
  )
}

const Line = React.memo(function Line({
  line, isActive, isPast, fullscreen, darkMode, wordSync, lyricsType, liveProgressRef, onRef, distanceFromActive, textScale = 1,
}) {
  const useRAF = wordSync && lyricsType === 'synced' && isActive && line.words?.length > 0

  const blurAmount = Math.min(distanceFromActive * 1, 8)
  const isBlurred = blurAmount > 0.1

  const baseNormalSize = fullscreen ? 1.2 : 0.875
  const baseActiveSize = fullscreen ? 1.9 : 1.125
  const normalSize = baseNormalSize * textScale
  const activeSize = baseActiveSize * textScale

 const lineDuration = useMemo(() => {
    if (line.end && line.time) return Math.max(1, line.end - line.time)
    return 3 
  }, [line.end, line.time])

  return (
    <motion.div
      ref={onRef}
      animate={{
        opacity: isActive ? 1 : isPast ? 0.18 : 0.35,
        scale: isActive ? (fullscreen ? 1 : 1.01) : 1,
      }}
      transition={{ 
        duration: 0.5,
        ease: [0.16, 1, 0.3, 1] 
      }}
      className="text-center w-full max-w-2xl my-1.5 font-medium cursor-default select-none"
      style={{
        color: isActive ? (darkMode ? '#fff' : '#e8ff57') : '#666',
        fontWeight: isActive ? 700 : 500,
        textShadow: isActive ? (fullscreen ? '0 0 40px rgba(232,255,87,0.2)' : '0 0 20px rgba(232,255,87,0.15)') : 'none',
        filter: isBlurred ? `blur(${blurAmount}px)` : 'none',
        transform: `scale(${textScale})`,
        fontSize: isActive ? `${activeSize}rem` : `${normalSize}rem`,
        lineHeight: isActive ? '1.2' : '1.5',
        transition: 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), filter 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), color 0.4s ease, text-shadow 0.5s ease',
      }}
    >
      {useRAF
        ? <RAFWordLine words={line.words} bgWords={line.bgWords} liveProgressRef={liveProgressRef} />
        : (line.text || <WaveDots duration={lineDuration} />)
      }
    </motion.div>
  )
}, (prev, next) =>
  prev.isActive === next.isActive &&
  prev.isPast === next.isPast &&
  prev.fullscreen === next.fullscreen &&
  prev.darkMode === next.darkMode &&
  prev.wordSync === next.wordSync &&
  prev.lyricsType === next.lyricsType &&
  prev.distanceFromActive === next.distanceFromActive
)

export default function LyricsPanel({
  track, progress, darkMode = false, fullscreen = false, wordSync = false, onLyricsAvailable, onSearchRequest, textScale = 1, isAutoSynced = false,
}) {
  const [lines, setLines] = useState([])
  const [lyricsType, setLyricsType] = useState(null)
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const containerRef = useRef(null)
  const lineRefs = useRef([])

  const anchorRef = useRef({ audioTime: progress, wallTime: performance.now() })
  const liveProgressRef = useRef(progress)

  useEffect(() => {
    anchorRef.current = { audioTime: progress, wallTime: performance.now() }
  }, [progress])

  useEffect(() => {
    let raf
    function tick() {
      raf = requestAnimationFrame(tick)
      const { audioTime, wallTime } = anchorRef.current
      const elapsed = Math.min((performance.now() - wallTime) / 1000, 0.5)
      liveProgressRef.current = audioTime + elapsed
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    if (!track?.id) return
    setLoading(true); setLines([]); setActiveIdx(-1); setLyricsType(null); setSource(null)
    api.getLyrics(track.id, track.title, track.artist, track.album, track.duration).then(r => {
      if (r?.lines) { 
        setLines(r.lines); 
        setLyricsType(r.type); 
        setSource(r.source) 
      }
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [track?.id])

  useEffect(() => {
    if (!loading) {
      onLyricsAvailable?.(lines.length > 0);
    }
  }, [loading, lines.length, onLyricsAvailable])

  const processedLines = useMemo(() => {
    if (!lines.length) return []
    return lines.map((line, li, arr) => {
      const nextLine = arr[li + 1]
      const lineEnd = line.end ?? (nextLine ? nextLine.time : (line.time ?? 0) + 3.0)

      const words = line.words?.length
        ? line.words.map((w, wi) => {
            const nextW = line.words[wi + 1]
            const wStart = w.time ?? (line.time ?? 0) + wi * ((lineEnd - (line.time ?? 0)) / line.words.length)
            const wEnd = w.end ?? (nextW ? nextW.time : lineEnd)
            return { ...w, time: wStart, end: wEnd, chars: buildCharTimeline(w.word, wStart, Math.max(wEnd, wStart + 0.01)) }
          })
        : (line.text || '').split(' ').filter(Boolean).map((w, wi, arr) => {
            const lineDur = Math.max(0.01, lineEnd - (line.time ?? 0))
            const wStart = (line.time ?? 0) + wi * (lineDur / arr.length)
            const wEnd = (line.time ?? 0) + (wi + 1) * (lineDur / arr.length)
            return { word: w, time: wStart, end: wEnd, chars: buildCharTimeline(w, wStart, Math.max(wEnd, wStart + 0.01)) }
          })

      const bgWords = line.bgWords?.map((bw, bi) => {
        const nextBW = line.bgWords[bi + 1]
        const bwStart = bw.time ?? (line.time ?? 0) + bi * 0.5
        const bwEnd = bw.end ?? (nextBW ? nextBW.time : bwStart + 0.8)
        return { ...bw, time: bwStart, end: bwEnd, chars: buildCharTimeline(bw.word, bwStart, Math.max(bwEnd, bwStart + 0.01)) }
      })

      return { ...line, end: lineEnd, words, bgWords }
    })
  }, [lines])

  useEffect(() => {
    if (!processedLines.length) return
    if (lyricsType === 'synced') {
      let idx = 0
      for (let i = 0; i < processedLines.length; i++) {
        if ((processedLines[i].time ?? 0) <= progress) idx = i; else break
      }
      setActiveIdx(idx)
    } else if (isAutoSynced) {
      setActiveIdx(Math.min(Math.floor(progress / 4), processedLines.length - 1))
    }
  }, [progress, processedLines, lyricsType, isAutoSynced])

  useEffect(() => {
    const el = lineRefs.current[activeIdx]
    const container = containerRef.current
    if (!el || !container) return
    const target = Math.max(0, Math.min(
      el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2,
      container.scrollHeight - container.clientHeight
    ))
    let raf
    const start = performance.now()
    const from = container.scrollTop
    const ease = t => 1 - Math.pow(1 - t, 3)
    function step(now) {
      const t = Math.min(1, (now - start) / 420)
      container.scrollTop = from + (target - from) * ease(t)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [activeIdx])

  const hasSyncedLyrics = processedLines.some(l => l.time != null)
  const showUnsyncedMessage = !hasSyncedLyrics && processedLines.length > 0

  return (
    <div ref={containerRef}
      className="w-full h-full overflow-y-auto flex flex-col items-center py-8 px-6"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>

      {loading && <WaveLoader />}

      {!loading && !processedLines.length && (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 opacity-30 select-none">
          <Mic2 size={fullscreen ? 40 : 28} />
          {!isOnline ? (
            <p className={fullscreen ? 'text-sm' : 'text-xs'}>
              Hey. You're currently offline.. lyrics will pull once online.
            </p>
          ) : (
            <>
              <p className={fullscreen ? 'text-sm' : 'text-xs'}>No lyrics found</p>
              {onSearchRequest && (
                <button 
                  onClick={onSearchRequest}
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
                >
                  <Search size={12} />
                  Search manually
                </button>
              )}
            </>
          )}
        </div>
      )}

      {processedLines.length > 0 && (
        <>
          {showUnsyncedMessage && (
            <p className="text-[10px] text-white/25 italic mb-4 mt-2">
              these lyrics are unsynced! :3
            </p>
          )}
          <div style={{ height: fullscreen ? '30vh' : '40%', flexShrink: 0 }} />
        </>
      )}

      {processedLines.map((line, i) => (
        <Line
          key={i}
          line={line}
          isActive={i === activeIdx}
          isPast={i < activeIdx}
          fullscreen={fullscreen}
          darkMode={darkMode}
          wordSync={wordSync}
          lyricsType={lyricsType}
          liveProgressRef={liveProgressRef}
          onRef={el => lineRefs.current[i] = el}
          distanceFromActive={activeIdx >= 0 ? Math.abs(i - activeIdx) : 0}
          textScale={textScale}
        />
      ))}

      {processedLines.length > 0 && <div style={{ height: fullscreen ? '40vh' : '40%', flexShrink: 0 }} />}
      {source && processedLines.length > 0 && (
        <p className="text-xs opacity-20 mt-2 mb-8">via {source}</p>
      )}
    </div>
  )
}
