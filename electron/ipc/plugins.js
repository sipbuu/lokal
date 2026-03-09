const path = require('path')
const fs = require('fs-extra')
const vm = require('vm')
const { getDB, getStorageDir } = require('./db')

const SETTINGS_DISABLED_KEY = 'plugins_disabled'
const SETTINGS_PLUGIN_DATA_PREFIX = 'plugin_data:'
const DEFAULT_HOOK_TIMEOUT_MS = 3000

let initialized = false
let pluginsDir = null
const runtimePlugins = new Map()

function normalizeId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
}

function safeParseJSON(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function getDisabledSet() {
  try {
    const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_DISABLED_KEY)
    const list = Array.isArray(safeParseJSON(row?.value, [])) ? safeParseJSON(row?.value, []) : []
    return new Set(list.map(normalizeId).filter(Boolean))
  } catch {
    return new Set()
  }
}

function setDisabledSet(disabledSet) {
  const value = JSON.stringify([...disabledSet])
  getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SETTINGS_DISABLED_KEY, value)
}

function getPluginData(pluginId) {
  const key = SETTINGS_PLUGIN_DATA_PREFIX + pluginId
  const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return safeParseJSON(row?.value, {})
}

function setPluginData(pluginId, value) {
  const key = SETTINGS_PLUGIN_DATA_PREFIX + pluginId
  getDB().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value || {}))
}

function getPluginsDir() {
  if (pluginsDir) return pluginsDir
  pluginsDir = path.join(getStorageDir(), 'plugins')
  fs.ensureDirSync(pluginsDir)
  return pluginsDir
}

function getPluginManifestFile(pluginFolder) {
  return path.join(pluginFolder, 'plugin.json')
}

function readManifest(pluginFolder) {
  const manifestPath = getPluginManifestFile(pluginFolder)
  const raw = fs.readFileSync(manifestPath, 'utf8')
  const manifest = safeParseJSON(raw, null)
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Invalid plugin.json')
  }
  const id = normalizeId(manifest.id || path.basename(pluginFolder))
  if (!id) throw new Error('Plugin id is required')
  const entry = typeof manifest.entry === 'string' && manifest.entry.trim() ? manifest.entry.trim() : 'index.js'
  const hooks = Array.isArray(manifest.hooks) ? manifest.hooks.map(String) : []
  return {
    id,
    name: String(manifest.name || id),
    version: String(manifest.version || '0.0.0'),
    description: String(manifest.description || ''),
    entry,
    hooks,
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions.map(String) : [],
    raw: manifest,
    manifestPath,
  }
}

function createPluginSDK(pluginId) {
  return Object.freeze({
    storage: {
      get: () => getPluginData(pluginId),
      set: (value) => setPluginData(pluginId, value),
    },
    tracks: {
      query: ({ artist, limit = 50 } = {}) => {
        const lim = Math.max(1, Math.min(500, parseInt(limit, 10) || 50))
        if (artist) {
          return getDB().prepare('SELECT * FROM tracks WHERE artist = ? ORDER BY added_at DESC LIMIT ?').all(String(artist), lim)
        }
        return getDB().prepare('SELECT * FROM tracks ORDER BY added_at DESC LIMIT ?').all(lim)
      },
    },
    settings: {
      get: (key) => {
        const row = getDB().prepare('SELECT value FROM settings WHERE key = ?').get(String(key || ''))
        return row?.value
      },
    },
    log: (...args) => console.log(`[plugin:${pluginId}]`, ...args),
  })
}

function loadPluginRuntime(pluginFolder) {
  const manifest = readManifest(pluginFolder)
  const entryPath = path.resolve(pluginFolder, manifest.entry)
  if (!entryPath.startsWith(path.resolve(pluginFolder))) {
    throw new Error('Entry must be inside plugin folder')
  }
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Entry not found: ${manifest.entry}`)
  }
  const code = fs.readFileSync(entryPath, 'utf8')
  const sandbox = {
    module: { exports: {} },
    exports: {},
    console: Object.freeze({
      log: (...args) => console.log(`[plugin:${manifest.id}]`, ...args),
      warn: (...args) => console.warn(`[plugin:${manifest.id}]`, ...args),
      error: (...args) => console.error(`[plugin:${manifest.id}]`, ...args),
    }),
    setTimeout,
    clearTimeout,
  }
  vm.createContext(sandbox)
  const script = new vm.Script(code, { filename: entryPath })
  script.runInContext(sandbox, { timeout: DEFAULT_HOOK_TIMEOUT_MS })
  const exported = sandbox.module.exports && Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox.exports
  if (!exported || typeof exported !== 'object') {
    throw new Error('Plugin must export an object')
  }
  const sdk = createPluginSDK(manifest.id)
  return {
    id: manifest.id,
    manifest,
    instance: exported,
    sdk,
    pluginFolder,
    entryPath,
    error: null,
  }
}

async function callWithTimeout(fn, payload, sdk) {
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('Hook timeout')), DEFAULT_HOOK_TIMEOUT_MS))
  return Promise.race([Promise.resolve(fn(payload, sdk)), timer])
}

function getPluginList() {
  const disabled = getDisabledSet()
  const list = []
  for (const plugin of runtimePlugins.values()) {
    list.push({
      id: plugin.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      hooks: plugin.manifest.hooks,
      permissions: plugin.manifest.permissions,
      enabled: !disabled.has(plugin.id),
      loadError: plugin.error || null,
    })
  }
  return list.sort((a, b) => a.id.localeCompare(b.id))
}

function loadAllPlugins() {
  runtimePlugins.clear()
  const base = getPluginsDir()
  const entries = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())
  for (const entry of entries) {
    const folder = path.join(base, entry.name)
    try {
      const runtime = loadPluginRuntime(folder)
      runtimePlugins.set(runtime.id, runtime)
    } catch (e) {
      const fallbackId = normalizeId(entry.name) || entry.name
      runtimePlugins.set(fallbackId, {
        id: fallbackId,
        manifest: {
          id: fallbackId,
          name: fallbackId,
          version: '0.0.0',
          description: '',
          hooks: [],
          permissions: [],
        },
        instance: {},
        sdk: createPluginSDK(fallbackId),
        pluginFolder: folder,
        entryPath: null,
        error: e.message,
      })
    }
  }
}

async function emitPluginHook(hookName, payload) {
  const disabled = getDisabledSet()
  const results = []
  for (const plugin of runtimePlugins.values()) {
    if (disabled.has(plugin.id)) continue
    if (plugin.error) continue
    const fn = plugin.instance?.[hookName]
    if (typeof fn !== 'function') continue
    try {
      const value = await callWithTimeout(fn, payload, plugin.sdk)
      results.push({ pluginId: plugin.id, ok: true, value })
    } catch (e) {
      results.push({ pluginId: plugin.id, ok: false, error: e.message })
    }
  }
  return results
}

function resolveInstallTarget(manifestId, sourceFolderPath) {
  const sourceName = path.basename(path.resolve(sourceFolderPath))
  const folderName = normalizeId(manifestId || sourceName) || normalizeId(sourceName) || 'plugin'
  return path.join(getPluginsDir(), folderName)
}

function installPluginFromFolder(sourceFolderPath) {
  const source = path.resolve(String(sourceFolderPath || ''))
  if (!source || !fs.existsSync(source)) {
    return { error: 'Source folder not found' }
  }
  const stat = fs.statSync(source)
  if (!stat.isDirectory()) {
    return { error: 'Source path must be a directory' }
  }
  const manifest = readManifest(source)
  const dest = resolveInstallTarget(manifest.id, source)
  fs.removeSync(dest)
  fs.copySync(source, dest)
  loadAllPlugins()
  return { ok: true, id: manifest.id, path: dest }
}

function removePlugin(pluginId) {
  const id = normalizeId(pluginId)
  if (!id) return { error: 'Plugin id required' }
  const plugin = runtimePlugins.get(id)
  if (!plugin) return { error: 'Plugin not found' }
  fs.removeSync(plugin.pluginFolder)
  runtimePlugins.delete(id)
  const disabled = getDisabledSet()
  if (disabled.has(id)) {
    disabled.delete(id)
    setDisabledSet(disabled)
  }
  return { ok: true }
}

function setPluginEnabled(pluginId, enabled) {
  const id = normalizeId(pluginId)
  if (!id) return { error: 'Plugin id required' }
  if (!runtimePlugins.has(id)) return { error: 'Plugin not found' }
  const disabled = getDisabledSet()
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  setDisabledSet(disabled)
  return { ok: true, enabled: Boolean(enabled) }
}

function reloadPlugins() {
  loadAllPlugins()
  return { ok: true, plugins: getPluginList() }
}

function initPlugins() {
  if (initialized) return
  getPluginsDir()
  loadAllPlugins()
  initialized = true
}

function registerPluginHandlers(ipcMain) {
  ipcMain.handle('plugins:list', () => getPluginList())
  ipcMain.handle('plugins:reload', () => reloadPlugins())
  ipcMain.handle('plugins:enable', (_, pluginId) => setPluginEnabled(pluginId, true))
  ipcMain.handle('plugins:disable', (_, pluginId) => setPluginEnabled(pluginId, false))
  ipcMain.handle('plugins:installFromFolder', (_, sourceFolderPath) => installPluginFromFolder(sourceFolderPath))
  ipcMain.handle('plugins:remove', (_, pluginId) => removePlugin(pluginId))
}

module.exports = {
  initPlugins,
  emitPluginHook,
  registerPluginHandlers,
  getPluginList,
  reloadPlugins,
  installPluginFromFolder,
  removePlugin,
  setPluginEnabled,
}
