export async function updateVideoLibrary(items, saved, client, onSaved = () => {}) {
  let succeeded = 0
  const errors = []
  for (const item of items) {
    try {
      const result = await client.musicVideoSave(item.track.id, saved)
      if (!result || result.error) throw new Error(result?.error || 'Could not update video library.')
      onSaved(item.track.id, result.saved ?? saved)
      succeeded++
      if (saved && !item.downloaded) {
        const downloaded = await client.musicVideoDownload(item.track.id)
        if (!downloaded || downloaded.error) errors.push(downloaded?.error || 'Could not download video.')
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
      const result = await client.musicVideoDownload(item.track.id)
      if (!result || result.error) throw new Error(result?.error || 'Could not download video.')
      succeeded++
    } catch (error) { errors.push(error.message) }
  }
  return { succeeded, errors }
}

export async function deleteVideoDownloads(items, client) {
  let succeeded = 0
  const errors = []
  for (const item of items) {
    if (!item.downloaded) continue
    try {
      const result = await client.musicVideoDeleteDownload(item.track.id, item.video?.videoId)
      if (!result?.success || result.error) throw new Error(result?.error || 'Could not delete video download.')
      succeeded++
    } catch (error) { errors.push(error.message) }
  }
  return { succeeded, errors }
}
