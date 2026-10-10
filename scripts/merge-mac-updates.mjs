import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function mergeMacUpdates(artifacts, destination) {
  const groups = new Map()
  for (const directory of fs.readdirSync(artifacts)) {
    const folder = path.join(artifacts, directory)
    if (!fs.statSync(folder).isDirectory()) continue
    for (const file of fs.readdirSync(folder).filter(name => name.endsWith('-mac.yml'))) {
      if (!groups.has(file)) groups.set(file, [])
      groups.get(file).push(fs.readFileSync(path.join(folder, file), 'utf8'))
    }
  }
  for (const [filename, documents] of groups) {
    const versions = documents.map(text => text.match(/^version:\s*(.+)$/m)?.[1])
    if (!versions[0] || versions.some(version => version !== versions[0])) throw new Error(`Incompatible versions in ${filename}`)
    const pattern = /^files:\r?\n(?:(?:[ \t]|- ).*(?:\r?\n|$))+/m
    const blocks = documents.map(text => text.match(pattern)?.[0])
    if (blocks.some(block => !block)) throw new Error(`Missing update file entries in ${filename}`)
    const combined = `files:\n${blocks.map(block => block.replace(/^files:\r?\n/, '').trimEnd()).join('\n')}\n`
    fs.writeFileSync(path.join(destination, filename), documents[0].replace(pattern, combined))
    console.log(`Merged ${documents.length} architecture manifest(s) into ${filename}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  mergeMacUpdates(path.resolve(process.argv[2] || 'artifacts'), path.resolve(process.argv[3] || 'release_all'))
}
