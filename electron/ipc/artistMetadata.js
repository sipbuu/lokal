const path = require('path')
const fs = require('fs-extra')
const http = require('http')
const https = require('https')
const { getStorageDir } = require('./db')

const ARTIST_METADATA_TTL_MS = 1000 * 60 * 60 * 24 * 7
const USER_AGENT = 'Lokal/1.9.0 (https://github.com/sipbuu/lokal)'

function getJson(url, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
  }).then(async (res) => {
    clearTimeout(timer)
    if (!res.ok) throw new Error(`Request failed: ${res.status}`)
    return res.json()
  }).catch((error) => {
    clearTimeout(timer)
    throw error
  })
}

function shouldFetchField(value, source, fetchedAt) {
  if (source === 'manual') return false
  if (value && String(value).trim()) return false
  const lastFetched = Number(fetchedAt) || 0
  if (!lastFetched) return true
  return Date.now() - lastFetched >= ARTIST_METADATA_TTL_MS
}

function shouldFetchArtistMetadata(artist, fetchImages) {
  return shouldFetchField(artist.bio, artist.bio_source, artist.bio_fetched_at)
    || (fetchImages && shouldFetchField(artist.image_path, artist.image_source, artist.image_fetched_at))
}

function getArtistFetchSettings(db) {
  try {
    const fetchArtwork = db.prepare("SELECT value FROM settings WHERE key = 'fetch_online_artwork'").get()?.value
    return { fetchImages: fetchArtwork !== '0' }
  } catch {
    return { fetchImages: true }
  }
}

function buildArtistQueries(name) {
  const normalized = String(name || '').trim()
  if (!normalized) return []
  return [
    `"${normalized}" musician`,
    `"${normalized}" band`,
    `"${normalized}" artist`,
    normalized,
  ]
}

function isUsefulArtistDescription(description) {
  if (!description) return false
  return /(musician|singer|rapper|band|artist|composer|producer|dj|duo|group|songwriter)/i.test(description)
}

async function searchWikipediaTitle(name) {
  const queries = buildArtistQueries(name)
  for (const query of queries) {
    try {
      const data = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`)
      const results = Array.isArray(data?.query?.search) ? data.query.search : []
      const preferred = results.find((entry) => isUsefulArtistDescription(entry?.snippet))
      const first = preferred || results[0]
      if (first?.title) return first.title
    } catch {}
  }
  return null
}

async function getWikipediaSummary(title) {
  if (!title) return null
  try {
    return await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
  } catch {
    return null
  }
}

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    const request = client.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        file.close()
        return downloadToFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        fs.unlink(dest).catch(() => {})
        return reject(new Error(`Image request failed: ${res.statusCode}`))
      }
      res.pipe(file)
      file.on('finish', () => {
        file.close()
        resolve(dest)
      })
    })
    request.on('error', (error) => {
      file.close()
      fs.unlink(dest).catch(() => {})
      reject(error)
    })
  })
}

async function fetchArtistMetadata(name) {
  const title = await searchWikipediaTitle(name)
  if (!title) return null
  return getArtistMetadataByTitle(title)
}

async function getArtistMetadataByTitle(title) {
  const summary = await getWikipediaSummary(title)
  if (!summary) return null
  const bio = typeof summary.extract === 'string' && summary.extract.trim() ? summary.extract.trim() : null
  const imageUrl = summary.originalimage?.source || summary.thumbnail?.source || null
  return { title, bio, imageUrl }
}

async function searchArtistMetadataCandidates(query) {
  const normalized = String(query || '').trim()
  if (!normalized) return []
  try {
    const data = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(normalized)}&srlimit=8&format=json&origin=*`)
    const results = Array.isArray(data?.query?.search) ? data.query.search : []
    const candidates = []
    for (const result of results) {
      if (!result?.title) continue
      const metadata = await getArtistMetadataByTitle(result.title)
      if (!metadata) continue
      candidates.push({
        title: metadata.title,
        bio: metadata.bio,
        imageUrl: metadata.imageUrl,
        snippet: result.snippet || '',
        score: isUsefulArtistDescription(result.snippet) ? 1 : 0,
      })
      if (candidates.length >= 5) break
    }
    return candidates.sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

async function applyArtistMetadataSelection(db, artistId, selection, options = {}) {
  const artist = db.prepare('SELECT * FROM artists WHERE id = ?').get(artistId)
  if (!artist) return null
  const mode = options.mode || 'both'
  const now = Date.now()
  let imagePath = artist.image_path || null

  if ((mode === 'both' || mode === 'image') && selection?.imageUrl) {
    const dest = path.join(getStorageDir(), 'artwork', `artist-${artist.id}.jpg`)
    imagePath = await downloadToFile(selection.imageUrl, dest)
  }

  if (mode === 'both' || mode === 'bio') {
    db.prepare(`
      UPDATE artists
      SET bio = ?, bio_source = ?, bio_fetched_at = ?
      WHERE id = ?
    `).run(selection?.bio || '', 'manual', now, artist.id)
  }

  if (mode === 'both' || mode === 'image') {
    db.prepare(`
      UPDATE artists
      SET image_path = ?, image_source = ?, image_fetched_at = ?
      WHERE id = ?
    `).run(imagePath || null, 'manual', now, artist.id)
  }

  return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id)
}

function clearArtistImageOverride(db, artistId) {
  db.prepare(`
    UPDATE artists
    SET image_path = NULL, image_source = ?, image_fetched_at = ?
    WHERE id = ?
  `).run('fallback', Date.now(), artistId)
  return db.prepare('SELECT * FROM artists WHERE id = ?').get(artistId) || null
}

async function cacheArtistMetadata(db, artist) {
  if (!artist?.id || !artist?.name) return null
  const { fetchImages } = getArtistFetchSettings(db)
  if (!shouldFetchArtistMetadata(artist, fetchImages)) return artist

  const fetched = await fetchArtistMetadata(artist.name)
  const now = Date.now()

  if (!fetched) {
    if (shouldFetchField(artist.bio, artist.bio_source, artist.bio_fetched_at)) {
      db.prepare(`UPDATE artists SET bio_fetched_at = ? WHERE id = ? AND COALESCE(bio_source, '') != 'manual'`).run(now, artist.id)
    }
    if (fetchImages && shouldFetchField(artist.image_path, artist.image_source, artist.image_fetched_at)) {
      db.prepare(`UPDATE artists SET image_fetched_at = ? WHERE id = ? AND COALESCE(image_source, '') != 'manual'`).run(now, artist.id)
    }
    return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id) || artist
  }

  if (shouldFetchField(artist.bio, artist.bio_source, artist.bio_fetched_at)) {
    db.prepare(`
      UPDATE artists
      SET bio = COALESCE(NULLIF(bio, ''), ?),
          bio_source = CASE WHEN COALESCE(NULLIF(bio, ''), '') = '' AND ? IS NOT NULL THEN 'wikipedia' ELSE bio_source END,
          bio_fetched_at = ?
      WHERE id = ? AND COALESCE(bio_source, '') != 'manual'
    `).run(fetched.bio, fetched.bio, now, artist.id)
  }

  if (fetchImages && shouldFetchField(artist.image_path, artist.image_source, artist.image_fetched_at)) {
    let imagePath = null
    if (fetched.imageUrl) {
      const dest = path.join(getStorageDir(), 'artwork', `artist-${artist.id}.jpg`)
      try {
        imagePath = await downloadToFile(fetched.imageUrl, dest)
      } catch {}
    }
    db.prepare(`
      UPDATE artists
      SET image_path = COALESCE(image_path, ?),
          image_source = CASE WHEN image_path IS NULL AND ? IS NOT NULL THEN 'wikipedia' ELSE image_source END,
          image_fetched_at = ?
      WHERE id = ? AND COALESCE(image_source, '') != 'manual'
    `).run(imagePath, imagePath, now, artist.id)
  }

  return db.prepare('SELECT * FROM artists WHERE id = ?').get(artist.id) || artist
}

module.exports = {
  applyArtistMetadataSelection,
  cacheArtistMetadata,
  clearArtistImageOverride,
  getArtistFetchSettings,
  searchArtistMetadataCandidates,
}
