const bcrypt = require('bcryptjs')
const { getDB, getStorageDir } = require('./db')
const path = require('path')
const fs = require('fs-extra')

function registerUserHandlers(ipcMain) {
  ipcMain.handle('user:register', async (_, { username, displayName, password }) => {
    const db = getDB()
    if (!username?.trim() || !password) return { error: 'Username and password required' }
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase())
    if (exists) return { error: 'Username already taken' }
    const id = 'u-' + Date.now()
    const hash = bcrypt.hashSync(password, 10)
    db.prepare('INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)')
      .run(id, username.toLowerCase(), displayName?.trim() || username, hash)
    return { user: { id, username: username.toLowerCase(), display_name: displayName || username, avatar_path: null, bio: null } }
  })

  ipcMain.handle('user:login', async (_, { username, password }) => {
    const db = getDB()
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username?.toLowerCase())
    if (!user) return { error: 'User not found' }
    const valid = bcrypt.compareSync(password, user.password_hash)
    if (!valid) return { error: 'Incorrect password' }
    const { password_hash, ...safe } = user
    return { user: safe }
  })

  ipcMain.handle('user:updateProfile', async (_, payload = {}) => {
    const db = getDB()
    const userId = payload.userId
    const displayName = payload.displayName ?? payload.display_name
    const bio = payload.bio
    const avatarData = payload.avatarData ?? payload.avatar
    let avatarPath = null
    if (avatarData) {
      const buf = Buffer.from(avatarData.split(',')[1], 'base64')
      avatarPath = path.join(getStorageDir(), 'avatars', `${userId}.jpg`)
      fs.ensureDirSync(path.dirname(avatarPath))
      await fs.writeFile(avatarPath, buf)
    }
    const updates = []
    const params = []
    if (Object.prototype.hasOwnProperty.call(payload, 'displayName') || Object.prototype.hasOwnProperty.call(payload, 'display_name')) {
      updates.push('display_name = ?')
      params.push(displayName)
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'bio')) {
      updates.push('bio = ?')
      params.push(bio)
    }
    if (avatarPath) { updates.push('avatar_path = ?'); params.push(avatarPath) }
    if (updates.length) {
      params.push(userId)
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)
    }
    const updated = db.prepare('SELECT id, username, display_name, avatar_path, bio, created_at FROM users WHERE id = ?').get(userId)
    return { user: updated ? { ...updated, avatar_updated_at: avatarPath ? Date.now() : undefined } : updated }
  })

  ipcMain.handle('user:getUserSettings', (_, userId) => {
    const rows = getDB().prepare('SELECT key, value FROM user_settings WHERE user_id = ?').all(userId)
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  })

  ipcMain.handle('user:saveUserSettings', (_, userId, settings) => {
    const stmt = getDB().prepare('INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)')
    for (const [k, v] of Object.entries(settings)) stmt.run(userId, k, String(v))
  })
}

module.exports = { registerUserHandlers }
