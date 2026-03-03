import React, { useEffect, useRef } from 'react'

export default function Waveform({ isPlaying, className = '' }) {
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const dataArrayRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const width = canvas.width
    const height = canvas.height

    const analyser = window.__lokalAnalyser
    if (!analyser) {
      const drawStatic = () => {
        ctx.clearRect(0, 0, width, height)
        const barCount = 32
        const barWidth = width / barCount - 2
        for (let i = 0; i < barCount; i++) {
          const barHeight = 3 + Math.random() * 4
          const x = i * (barWidth + 2)
          const y = (height - barHeight) / 2
          ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
          ctx.fillRect(x, y, barWidth, barHeight)
        }
      }
      drawStatic()
      return
    }

    if (!dataArrayRef.current) {
      const bufferLength = analyser.frequencyBinCount
      dataArrayRef.current = new Uint8Array(bufferLength)
    }

    const dataArray = dataArrayRef.current

    const draw = () => {
      if (!isPlaying) {
        // Draw static low bars when paused
        ctx.clearRect(0, 0, width, height)
        const barCount = 32
        const barWidth = width / barCount - 2
        for (let i = 0; i < barCount; i++) {
          const barHeight = 2 + Math.random() * 2
          const x = i * (barWidth + 2)
          const y = (height - barHeight) / 2
          ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'
          ctx.fillRect(x, y, barWidth, barHeight)
        }
        animationRef.current = requestAnimationFrame(draw)
        return
      }

      analyser.getByteFrequencyData(dataArray)
      
      ctx.clearRect(0, 0, width, height)
      
      const barCount = 32
      const barWidth = width / barCount - 2
      const step = Math.floor(dataArray.length / barCount)
      
      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step]
        const barHeight = Math.max(2, (value / 255) * height * 0.9)
        const x = i * (barWidth + 2)
        const y = (height - barHeight) / 2
        
        // Gradient from accent to white based on height
        const alpha = 0.3 + (value / 255) * 0.7
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
        ctx.fillRect(x, y, barWidth, barHeight)
      }
      
      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isPlaying])

  return (
    <canvas 
      ref={canvasRef} 
      width={120} 
      height={24} 
      className={className}
      style={{ display: 'block' }}
    />
  )
}
