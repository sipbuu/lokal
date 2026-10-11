// Authentication pages get an isolated Chromium session and no application
// preload or Node access. Callback ownership stays in the trusted host.
const { validateURL, domainAllowed } = require('./network')
const windows = new Map()

async function openAuthWindow(packages, key) {
  const runtime = await packages.runtime(key)
  const pending = runtime.host.session?.pending || runtime.host.auth.pending
  if (!pending?.url) throw new Error('There is no pending addon login or verification')
  const permissions = runtime.host.network.permissions
  validateURL(pending.url, permissions)
  const { BrowserWindow, session } = require('electron')
  windows.get(key)?.close()
  const partition = session.fromPartition(`lokal-addon-${key}`)
  const window = new BrowserWindow({ width: 720, height: 800, title: 'Lokal — Addon access', autoHideMenuBar: true, webPreferences: { session: partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } })
  windows.set(key, window)
  let completing = false
  const inspect = async (event, raw) => {
    let url
    try { url = new URL(raw) } catch { event.preventDefault(); return }
    const expected = runtime.host.session?.config.callbackUrl || runtime.host.auth.pending?.callback
    const callback = expected ? new URL(expected) : null
    if (callback && url.protocol === callback.protocol && url.host === callback.host && url.pathname === callback.pathname) {
      event.preventDefault()
      if (completing) return
      completing = true
      try {
        const cookies = await partition.cookies.get({})
        for (const cookie of cookies) {
          const host = cookie.domain.replace(/^\./, '')
          if (!domainAllowed(host, permissions.network)) continue
          const attributes = `${cookie.name}=${cookie.value}; Domain=${cookie.domain}; Path=${cookie.path || '/'}${cookie.secure ? '; Secure' : ''}${cookie.httpOnly ? '; HttpOnly' : ''}`
          try { runtime.host.network.cookies.setCookieSync(attributes, `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`) } catch {}
        }
        runtime.host.network.persist?.()
        await packages.authCallback(key, raw)
        if (!window.isDestroyed()) window.close()
      } catch (error) {
        completing = false
        if (!window.isDestroyed()) window.setTitle(`Lokal — ${error.message}`)
      }
      return
    }
    try { validateURL(raw, permissions) } catch { event.preventDefault() }
  }
  window.webContents.on('will-navigate', inspect)
  window.webContents.on('will-redirect', inspect)
  window.webContents.setWindowOpenHandler(({ url }) => {
    try { validateURL(url, permissions); window.loadURL(url).catch(() => {}) } catch {}
    return { action: 'deny' }
  })
  partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  const timer = setTimeout(() => { if (!window.isDestroyed()) window.close() }, 180000)
  // However the window closes (verified, the person closed it, timed out),
  // access is checked again and the Addons page is told.
  window.on('closed', () => {
    clearTimeout(timer)
    if (windows.get(key) === window) windows.delete(key)
    packages.authStatus(key).then(status => announce(key, status), error => announce(key, { authenticated: false, error: error.message }))
  })
  await window.loadURL(pending.url)
  return { success: true, message: 'Complete verification in the addon window.' }
}
function announce(key, status) {
  const { BrowserWindow } = require('electron')
  const auth = new Set(windows.values())
  for (const window of BrowserWindow.getAllWindows()) if (!auth.has(window) && !window.isDestroyed()) window.webContents.send('addons:auth-changed', { key, ...status })
}
function closeAuthWindow(key) { windows.get(key)?.close() }
/** Forget what the addon's login pages stored (Disconnect). */
async function clearAuthSession(key) {
  windows.get(key)?.close()
  try { await require('electron').session.fromPartition(`lokal-addon-${key}`).clearStorageData() } catch {}
}
module.exports = { openAuthWindow, closeAuthWindow, clearAuthSession }
