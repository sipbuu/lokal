let remoteState = {
  connected: false,
  isPlaying: false,
  progress: 0,
  duration: 0,
  volume: 0.8,
  currentTrack: null,
  updatedAt: 0,
}

let remoteCommandHandler = null

function setRemoteState(state) {
  if (!state || typeof state !== 'object') return
  remoteState = {
    ...remoteState,
    ...state,
    connected: true,
    updatedAt: Date.now(),
  }
}

function getRemoteState() {
  return remoteState
}

function setRemoteCommandHandler(handler) {
  remoteCommandHandler = handler
}

async function sendRemoteCommand(command) {
  if (typeof remoteCommandHandler !== 'function') {
    return { error: 'Remote command handler is not ready' }
  }
  try {
    return await remoteCommandHandler(command)
  } catch (e) {
    return { error: e.message || 'Remote command failed' }
  }
}

module.exports = {
  setRemoteState,
  getRemoteState,
  setRemoteCommandHandler,
  sendRemoteCommand,
}
