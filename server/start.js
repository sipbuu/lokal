/**
 * Web server starter for Lokal Music.
 * 
 * Electron compiles better-sqlite3 for its own bundled Node version 
 * (ABI differs from system Node). 
 * This script detects that and rebuilds for plain Node before starting the server.
 * 
 * Usage:  node server/start.js
 */

const { execSync, spawnSync } = require('child_process')
const path = require('path')


let needsRebuild = false
try {
  require('better-sqlite3')
} catch (e) {
  if (e.code === 'ERR_DLOPEN_FAILED' || e.message?.includes('NODE_MODULE_VERSION')) {
    needsRebuild = true
  } else {
    throw e 
  }
}

if (needsRebuild) {
  console.log('⚙ better-sqlite3 needs rebuilding for plain Node (Electron ABI mismatch)...')
  const root = path.join(__dirname, '..')
  const result = spawnSync('npm', ['rebuild', 'better-sqlite3', '--update-binary'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  if (result.status !== 0) {
    console.error('❌ Rebuild failed. Try running manually: npm rebuild better-sqlite3')
    console.error('   Or install electron-rebuild: npx electron-rebuild')
    process.exit(1)
  }
  console.log('✅ Rebuilt successfully. Starting server...\n')
}


require('./index.js')
