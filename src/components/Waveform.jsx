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
          ctx.fillStyle = 'rgba(255,255,255,0.18)'
          ctx.fillRect(x, y, barWidth, barHeight)
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
          ctx.fillStyle = `rgba(255,255,255,${0.18})`
          ctx.fillRect(x, y, barWidth, barHeight)
        }
        animationRef.current = requestAnimationFrame(draw)
        return
      }

      analyser.getByteFrequencyData(dataArray)
      ctx.clearRect(0, 0, cssW, cssH)

      const gradient = ctx.createLinearGradient(0, 0, cssW, 0)
      gradient.addColorStop(0, 'rgba(255,255,255,0.35)')
      gradient.addColorStop(1, 'rgba(255,255,255,0.95)')

      const barWidth = Math.max(1, cssW / barCount - 2)
      const step = Math.max(1, Math.floor(dataArray.length / barCount))

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0
        const target = Math.max(2, (value / 255) * cssH * 0.9)
        const smoothFactor = 0.18 
        smoothedRef.current[i] += (target - smoothedRef.current[i]) * smoothFactor
        const barHeight = smoothedRef.current[i]

        const x = i * (barWidth + 2)
        const y = (cssH - barHeight) / 2

        const alpha = 0.25 + (value / 255) * 0.75 
        ctx.globalAlpha = alpha
        ctx.fillStyle = gradient
        ctx.fillRect(x, y, barWidth, barHeight)
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