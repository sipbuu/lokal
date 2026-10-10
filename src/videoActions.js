export async function updateVideoLibrary(items, saved, client, onSaved = () => {}) {
  let succeeded = 0
  const errors = []
  for (const item of items) {
    try {
      const result = await client.musicVideoSave(item.track.id, saved)
      if (!result || result.error) throw new Error(result?.error || 'Could not update video library.')
      onSaved(item.track.id, result.saved ?? saved)
      succeeded++
      if (saved && !item.cached) {
        const cached = await client.musicVideoCache(item.track.id)
        if (cached?.error) errors.push(cached.error)
      }
    } catch (error) { errors.push(error.message) }
  }
  return { succeeded, errors }
}

export async function downloadVideos(items, client) {
  let succeeded = 0
  const errors = []
  for (const item of items) {
    try {
      const result = await client.musicVideoCache(item.track.id)
      if (!result || result.error) throw new Error(result?.error || 'Could not download video.')
      succeeded++
    } catch (error) { errors.push(error.message) }
  }
  return { succeeded, errors }
}
