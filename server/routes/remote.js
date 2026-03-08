const express = require('express')
const os = require('os')
const { getRemoteState, sendRemoteCommand } = require('../../electron/ipc/remote')

const router = express.Router()

function authorized(req) {
  const token = process.env.REMOTE_TOKEN
  if (!token) return true
  const provided = req.headers['x-remote-token'] || req.query.token || req.body?.token
  return provided === token
}

function getLanUrls(req) {
  const port = process.env.PORT || 3421
  const nets = os.networkInterfaces()
  const urls = []
  for (const entries of Object.values(nets)) {
    for (const info of entries || []) {
      if (!info || info.internal || info.family !== 'IPv4') continue
      urls.push(`http://${info.address}:${port}/remote`)
    }
  }
  const deduped = [...new Set(urls)]
  const host = req.headers.host
  if (host) deduped.unshift(`http://${host}/remote`)
  return [...new Set(deduped)]
}

router.get('/state', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  return res.json(getRemoteState())
})

router.post('/command', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  const action = req.body?.action
  const value = req.body?.value
  if (!action) return res.status(400).json({ error: 'Missing action' })
  const result = await sendRemoteCommand({ action, value, ts: Date.now() })
  if (result?.error) return res.status(503).json(result)
  return res.json(result || { ok: true })
})

router.get('/connection', (req, res) => {
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' })
  const urls = getLanUrls(req)
  const primary = urls[0] || null
  const qrUrl = primary ? `https://quickchart.io/qr?text=${encodeURIComponent(primary)}&size=256` : null
  return res.json({
    sameWifiRequired: true,
    primary,
    urls,
    qrUrl,
  })
})

module.exports = router
