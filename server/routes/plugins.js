const router = require('express').Router()
const {
  getPluginList,
  reloadPlugins,
  installPluginFromFolder,
  removePlugin,
  setPluginEnabled,
} = require('../../electron/ipc/plugins')

router.get('/', (req, res) => {
  res.json(getPluginList())
})

router.post('/reload', (req, res) => {
  res.json(reloadPlugins())
})

router.post('/install-folder', (req, res) => {
  const { sourceFolderPath } = req.body || {}
  const result = installPluginFromFolder(sourceFolderPath)
  if (result?.error) return res.status(400).json(result)
  res.json(result)
})

router.post('/:id/enable', (req, res) => {
  const result = setPluginEnabled(req.params.id, true)
  if (result?.error) return res.status(404).json(result)
  res.json(result)
})

router.post('/:id/disable', (req, res) => {
  const result = setPluginEnabled(req.params.id, false)
  if (result?.error) return res.status(404).json(result)
  res.json(result)
})

router.delete('/:id', (req, res) => {
  const result = removePlugin(req.params.id)
  if (result?.error) return res.status(404).json(result)
  res.json(result)
})

module.exports = router
