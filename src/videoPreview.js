export function previewWindow(duration) {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 65
  const start = Math.min(60, Math.max(0, end - 5))
  return { start, end: Math.min(end, start + 5) }
}

export function startVideoPreview(element) {
  if (!element) return () => {}
  const { start, end } = previewWindow(element.duration)
  element.muted = true
  element.volume = 0
  element.currentTime = start
  element.play().catch(() => {})
  const stop = () => element.pause()
  const bound = () => { if (element.currentTime >= end) stop() }
  const timer = setTimeout(stop, 5000)
  element.addEventListener('timeupdate', bound)
  return () => { clearTimeout(timer); element.removeEventListener('timeupdate', bound); stop() }
}
