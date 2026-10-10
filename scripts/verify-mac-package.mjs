import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const release = path.resolve(process.argv[2] || 'release')
const arch = process.argv[3] || process.arch
if (process.platform !== 'darwin') throw new Error('macOS package verification requires macOS')
const files = fs.readdirSync(release)
const zip = files.find(file => file.endsWith(`-${arch}.zip`))
const dmg = files.find(file => file.endsWith(`-${arch}.dmg`))
if (!zip || !dmg) throw new Error('macOS build must contain both a zip and a dmg')

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout
}

run('unzip', ['-t', path.join(release, zip)])
const listing = run('unzip', ['-l', path.join(release, zip)])
if (!listing.includes(`app.asar.unpacked/electron/native/audio-output.darwin-${arch}.node`)) throw new Error(`zip is missing unpacked audio-output.darwin-${arch}.node`)
run('hdiutil', ['verify', path.join(release, dmg)])
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-mac-integrity-'))
try {
  run('ditto', ['-x', '-k', path.join(release, zip), temp])
  const app = fs.readdirSync(temp).find(name => name.endsWith('.app'))
  if (!app) throw new Error('zip contains no app bundle')
  const appPath = path.join(temp, app)
  const executable = path.join(appPath, 'Contents/MacOS/Lokal')
  const resources = path.join(appPath, 'Contents/Resources')
  const native = path.join(resources, `app.asar.unpacked/electron/native/audio-output.darwin-${arch}.node`)
  const machoArch = arch === 'x64' ? 'x86_64' : arch
  run('lipo', [executable, '-verify_arch', machoArch])
  run('lipo', [native, '-verify_arch', machoArch])
  run('plutil', ['-lint', path.join(appPath, 'Contents/Info.plist')])
  const signature = spawnSync('codesign', ['-d', '--verbose=4', appPath], { encoding: 'utf8' })
  if (signature.status === 0) {
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    console.log(signature.stderr.includes('Authority=Developer ID Application') ? 'Developer ID signature verified; notarization was not assessed' : 'Ad-hoc signature integrity verified; this is not Developer ID signing or notarization')
  } else {
    if (process.env.REQUIRE_MAC_SIGNATURE === '1') throw new Error('A configured signing build produced an unsigned bundle')
    console.log('Unsigned bundle: package integrity verified; Gatekeeper approval requires Developer ID signing and notarization')
  }
  if (process.env.REQUIRE_MAC_SIGNATURE === '1' && !signature.stderr.includes('Authority=Developer ID Application')) throw new Error('A configured signing build must have a Developer ID Application signature')
  if (arch !== process.arch) throw new Error('Runtime smoke test requires a runner matching ' + arch)
  const smoke = spawnSync(executable, [path.resolve('scripts/mac-package-smoke.cjs'), resources, arch], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  if (smoke.status !== 0) throw new Error(`Packaged native runtime smoke failed: ${smoke.stderr || smoke.stdout}`)
  console.log(smoke.stdout.trim())
} finally {
  fs.rmSync(temp, { recursive: true, force: true })
}
console.log(`Verified ${zip}, ${dmg}, and audio-output.darwin-${arch}.node`)
