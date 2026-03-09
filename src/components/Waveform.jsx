import React, { useEffect, useRef } from 'react'

export default function Waveform({
  isPlaying,
  className = '',
  barCount = 32,
  defaultWidth = 120,
  defaultHeight = 24,
}) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const dataArrayRef = useRef(null)
  const smoothedRef = useRef(null)
  const resizeObserverRef = useRef(null)
  const phaseRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const parent = canvas.parentElement
      const cssW = (parent ? parent.clientWidth : defaultWidth) || defaultWidth
      const cssH = (parent ? parent.clientHeight : defaultHeight) || defaultHeight

      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.max(1, Math.floor(cssH * dpr))

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      resizeObserverRef.current = new ResizeObserver(resize)
      resizeObserverRef.current.observe(canvas.parentElement)
    } else {
      window.addEventListener('resize', resize)
    }
    resize()

    if (!smoothedRef.current || smoothedRef.current.length !== barCount) {
      smoothedRef.current = new Array(barCount).fill(2)
    }

    const analyser = window.__lokalAnalyser
    const drawCapsule = (x, y, w, h, r, fill) => {
      const radius = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.lineTo(x + w - radius, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
      ctx.lineTo(x + w, y + h - radius)
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
      ctx.lineTo(x + radius, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
      ctx.lineTo(x, y + radius)
      ctx.quadraticCurveTo(x, y, x + radius, y)
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }
    const ctxClear = () => {
      const cssW = parseFloat(canvas.style.width) || defaultWidth
      const cssH = parseFloat(canvas.style.height) || defaultHeight
      ctx.clearRect(0, 0, cssW, cssH)
    }

    if (!analyser) {
      const drawStatic = () => {
        ctxClear()
        const cssW = parseFloat(canvas.style.width) || defaultWidth
        const cssH = parseFloat(canvas.style.height) || defaultHeight
        const barWidth = Math.max(1, cssW / barCount - 2)
        for (let i = 0; i < barCount; i++) {
          const barHeight = 3 + Math.random() * 4
          const x = i * (barWidth + 2)
          const y = (cssH - barHeight) / 2
          drawCapsule(x, y, barWidth, barHeight, 2, 'rgba(255,255,255,0.18)')
        }
        animationRef.current = requestAnimationFrame(drawStatic)
      }
      drawStatic()
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        if (resizeObserverRef.current) resizeObserverRef.current.disconnect()
        else window.removeEventListener('resize', resize)
      }
    }

    if (!dataArrayRef.current) {
      const bufferLength = analyser.frequencyBinCount
      dataArrayRef.current = new Uint8Array(bufferLength)
    }
    const dataArray = dataArrayRef.current
    const getBarValue = (index) => {
      const nyquist = (analyser.context?.sampleRate || 44100) / 2
      const minFreq = 28
      const maxFreq = Math.min(18000, nyquist - 1)
      const startFreq = minFreq * Math.pow(maxFreq / minFreq, index / barCount)
      const endFreq = minFreq * Math.pow(maxFreq / minFreq, (index + 1) / barCount)
      const binHz = nyquist / dataArray.length
      const startBin = Math.max(0, Math.floor(startFreq / binHz))
      const endBin = Math.min(dataArray.length - 1, Math.max(startBin + 1, Math.ceil(endFreq / binHz)))
      let sum = 0
      let count = 0
      for (let b = startBin; b <= endBin; b++) {
        const v = dataArray[b] || 0
        sum += v * v
        count++
      }
      const rms = count ? Math.sqrt(sum / count) : 0
      const bassZone = index / Math.max(1, barCount - 1)
      const bassBoost = bassZone < 0.34 ? 1.5 - bassZone * 0.8 : 1
      const highLift = 1 + Math.pow(bassZone, 1.9) * 0.95
      const shaped = Math.min(255, rms * bassBoost * highLift)
      return shaped
    }

    const draw = () => {
      const cssW = parseFloat(canvas.style.width) || defaultWidth
      const cssH = parseFloat(canvas.style.height) || defaultHeight

      if (!isPlaying) {
        ctx.clearRect(0, 0, cssW, cssH)
        const barWidth = Math.max(1, cssW / barCount - 2)
        for (let i = 0; i < barCount; i++) {
          const noiseTarget = 2 + Math.random() * 2
          smoothedRef.current[i] += (noiseTarget - smoothedRef.current[i]) * 0.05
          const barHeight = Math.max(2, smoothedRef.current[i])
          const x = i * (barWidth + 2)
          const y = (cssH - barHeight) / 2
          drawCapsule(x, y, barWidth, barHeight, 2, 'rgba(255,255,255,0.18)')
        }
        animationRef.current = requestAnimationFrame(draw)
        return
      }

      analyser.getByteFrequencyData(dataArray)
      ctx.clearRect(0, 0, cssW, cssH)
      phaseRef.current += 0.08

      const gradient = ctx.createLinearGradient(0, 0, cssW, 0)
      gradient.addColorStop(0, 'rgba(255,255,255,0.3)')
      gradient.addColorStop(0.55, 'rgba(232,255,87,0.9)')
      gradient.addColorStop(1, 'rgba(255,255,255,0.95)')

      const barWidth = Math.max(1, cssW / barCount - 2)
      const center = (barCount - 1) / 2

      for (let i = 0; i < barCount; i++) {
        const value = getBarValue(i)
        const centerWeight = 1 - Math.min(1, Math.abs(i - center) / center)
        let target = Math.max(2, (value / 255) * cssH * (0.62 + centerWeight * 0.42))
        if (i > barCount * 0.74) {
          const shimmer = 1.3 + Math.sin(phaseRef.current + i * 0.55) * 1.15
          target = Math.max(target, shimmer + (value / 255) * 3.2)
        }
        const smoothFactor = i < barCount * 0.28 ? 0.24 : i > barCount * 0.74 ? 0.12 : 0.16
        smoothedRef.current[i] += (target - smoothedRef.current[i]) * smoothFactor
        const barHeight = smoothedRef.current[i]

        const x = i * (barWidth + 2)
        const y = (cssH - barHeight) / 2

        const alpha = 0.24 + (value / 255) * 0.72
        ctx.globalAlpha = alpha
        drawCapsule(x, y, barWidth, barHeight, barWidth / 2, gradient)
        ctx.globalAlpha = 1
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect()
      else window.removeEventListener('resize', resize)
    }
  }, [isPlaying, barCount, defaultWidth, defaultHeight])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block', width: `${defaultWidth}px`, height: `${defaultHeight}px` }}
    />
  )
}
