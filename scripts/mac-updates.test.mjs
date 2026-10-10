import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { mergeMacUpdates } from './merge-mac-updates.mjs'

const yaml = createRequire(import.meta.url)('js-yaml')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-mac-updates-'))
  const artifacts = path.join(root, 'artifacts')
  const destination = path.join(root, 'release_all')
  fs.mkdirSync(artifacts); fs.mkdirSync(destination)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const add = (arch, version = '6.1.1') => {
    const dir = path.join(artifacts, arch)
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'latest-mac.yml'), yaml.dump({ version, files: [{ url: `Lokal-${version}-${arch}.zip`, sha512: arch, size: 123 }], path: `Lokal-${version}-${arch}.zip`, sha512: arch, releaseDate: '2026-10-09' }))
  }
  return { artifacts, destination, add }
}

test('release aggregation retains updater downloads for both Mac architectures', t => {
  const { artifacts, destination, add } = fixture(t)
  add('x64'); add('arm64')
  mergeMacUpdates(artifacts, destination)
  const result = yaml.load(fs.readFileSync(path.join(destination, 'latest-mac.yml'), 'utf8'))
  assert.equal(result.version, '6.1.1')
  assert.deepEqual(result.files.map(file => file.url).sort(), ['Lokal-6.1.1-arm64.zip', 'Lokal-6.1.1-x64.zip'])
  assert.equal(result.releaseDate, '2026-10-09')
})

test('release aggregation refuses architecture manifests from different versions', t => {
  const { artifacts, destination, add } = fixture(t)
  add('x64'); add('arm64', '6.1.2')
  assert.throws(() => mergeMacUpdates(artifacts, destination), /Incompatible versions/)
  assert.equal(fs.existsSync(path.join(destination, 'latest-mac.yml')), false)
})
