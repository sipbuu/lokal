import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReleases, latestReleases, savedReleases } from '../src/newReleases.js'

const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) } }

test('latest releases: newest first, no year cut-off, nothing from the future, at most the limit', () => {
  const now = new Date('2026-10-11T00:00:00Z')
  const items = latestReleases([
    { title: 'Old', artist: 'A', year: 2009 },
    { title: 'Future', artist: 'A', year: 2027 },
    { title: 'Soon', artist: 'B', release_date: '2026-12-01' },
    { title: 'Recent', artist: 'B', release_date: '2026-09-30' },
    { title: 'Second', artist: 'C', year: 2026, rank: 1 },
    { title: 'First', artist: 'C', year: 2026, rank: 0 },
    { title: 'first', artist: 'c', year: 2026, rank: 5 },
  ], { now, limit: 4 })
  assert.deepEqual(items.map(item => item.title), ['Recent', 'First', 'Second', 'Old'])
})

test('a check covers every artist, saves the result and marks what is new since the last check', async () => {
  const storage = memory()
  const catalogue = { One: [{ title: 'Alpha', year: 2025 }], Two: [{ title: 'Beta', year: 2024 }] }
  const artists = Object.keys(catalogue).map(name => ({ name }))
  const first = await checkReleases(artists, async name => catalogue[name], { storage, now: new Date('2026-01-01') })
  assert.equal(first.artists, 2)
  assert.deepEqual(first.items.map(item => [item.title, item.isNew]), [['Alpha', false], ['Beta', false]])
  catalogue.Two.unshift({ title: 'Gamma', year: 2026 })
  const second = await checkReleases(artists, async name => catalogue[name], { storage, now: new Date('2026-06-01') })
  assert.deepEqual(second.items.map(item => [item.title, item.isNew]), [['Gamma', true], ['Alpha', false], ['Beta', false]])
  assert.equal(savedReleases(storage).items.length, 3)
})

test('an empty saved check still counts, and failed artists keep their releases from the last check', async () => {
  const storage = memory()
  const artists = [{ name: 'One' }, { name: 'Two' }]
  const empty = await checkReleases(artists, async () => [], { storage, now: new Date('2026-01-01') })
  assert.equal(empty.items.length, 0)
  const found = await checkReleases(artists, async name => name === 'One' ? [{ title: 'Alpha', year: 2026 }] : [{ title: 'Beta', year: 2025 }], { storage, now: new Date('2026-02-01') })
  assert.deepEqual(found.items.map(item => [item.title, item.isNew]), [['Alpha', true], ['Beta', true]])
  const partial = await checkReleases(artists, async name => { if (name === 'Two') throw new Error('Offline'); return [{ title: 'Alpha', year: 2026 }] }, { storage, now: new Date('2026-03-01') })
  assert.deepEqual(partial.items.map(item => [item.title, item.isNew]), [['Alpha', false], ['Beta', false]])
  const offline = await checkReleases(artists, async () => { throw new Error('Offline') }, { storage, now: new Date('2026-04-01') })
  assert.equal(offline.failures, 2)
  assert.deepEqual(savedReleases(storage).items.map(item => item.title), ['Alpha', 'Beta'])
})
