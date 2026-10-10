function trackFileFilter(includeGhosts) {
  return includeGhosts === true || includeGhosts === 'true' || includeGhosts === '1' ? null : "file_path NOT LIKE 'ghost://%'"
}

function missingTrackFile(track, exists) {
  return !!track.file_path && !track.file_path.startsWith('ghost://') && !exists(track.file_path)
}

module.exports = { trackFileFilter, missingTrackFile }
