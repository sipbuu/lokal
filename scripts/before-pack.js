const path = require('path')
const { spawnSync } = require('child_process')
const { Arch } = require('builder-util')

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') throw new Error('macOS packages require a macOS build host')
  const root = context.packager.projectDir
  const arch = Arch[context.arch]
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/prepare-audio.js'), arch], { cwd: root, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('macOS native audio preparation failed for ' + arch)
}
