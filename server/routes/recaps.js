const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const { buildRecap } = require('../../electron/ipc/recaps')

router.get('/:userId', (req, res) => {
  try {
    res.json(buildRecap(getDB(), req.params.userId || 'guest', req.query || {}))
  } catch (e) {
    res.json({ error: e.message })
  }
})

router.get('/:userId/preferences', (req, res) => {
  const row = getDB().prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'listening_preferences'").get(req.params.userId || 'guest')
  try {
    res.json(row?.value ? JSON.parse(row.value) : null)
  } catch {
    res.json(null)
  }
})

module.exports = router
