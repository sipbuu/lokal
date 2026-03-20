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

function normalizeSource(source) {
  return source === 'wikipedia' || source === 'musicbrainz' ? source : 'either'
}

function isUsefulArtistDescription(description) {
  if (!description) return false
  return /(musician|singer|rapper|band|artist|composer|producer|dj|duo|group|songwriter)/i.test(description)
}

function getWikipediaTitleFromUrl(url) {
  if (!url) return null
  const match = String(url).match(/https?:\/\/[a-z]+\.wikipedia\.org\/wiki\/(.+)$/i)
  if (!match?.[1]) return null
  return decodeURIComponent(match[1]).replace(/_/g, ' ')
}

function buildMusicBrainzBio(artist) {
  if (!artist) return null
  const parts = []
  if (artist.type) parts.push(artist.type)
  if (artist.disambiguation) parts.push(artist.disambiguation)
  const place = artist.area?.name || artist['begin-area']?.name || ''
  if (place) parts.push(place)
  const tags = Array.isArray(artist.tags) ? artist.tags.slice(0, 3).map(tag => tag?.name).filter(Boolean) : []
  if (tags.length) parts.push(tags.join(', '))
  const bio = parts.join(' • ').trim()
  return bio || null
}

async function searchMusicBrainzArtists(query) {
  const normalized = String(query || '').trim()
  if (!normalized) return []
  const data = await getJson(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${normalized}"`)}&fmt=json&limit=8`)
  return Array.isArray(data?.artists) ? data.artists : []
}

async function getMusicBrainzArtistMetadataById(id) {
  if (!id) return null
  try {
    const data = await getJson(`https://musicbrainz.org/ws/2/artist/${encodeURIComponent(id)}?fmt=json&inc=url-rels+tags`)
    const relations = Array.isArray(data?.relations) ? data.relations : []
    const wikipediaRelation = relations.find((relation) => relation?.type === 'wikipedia' || /wikipedia\.org\/wiki\//i.test(relation?.url?.resource || ''))
    const wikipediaTitle = getWikipediaTitleFromUrl(wikipediaRelation?.url?.resource)
    const summary = wikipediaTitle ? await getWikipediaSummary(wikipediaTitle) : null
    const bio = typeof summary?.extract === 'string' && summary.extract.trim() ? summary.extract.trim() : buildMusicBrainzBio(data)
    const imageUrl = summary?.originalimage?.source || summary?.thumbnail?.source || null
    return {
      id: data.id,
      title: data.name,
      bio,
      imageUrl,
      snippet: data.disambiguation || buildMusicBrainzBio(data) || '',
      source: 'musicbrainz',
    }
  } catch {
    return null
  }
}

async function fetchMusicBrainzArtistMetadata(name) {
  const artists = await searchMusicBrainzArtists(name)
  for (const artist of artists) {
    const metadata = await getMusicBrainzArtistMetadataById(artist.id)
    if (metadata?.title) return metadata
  }
  return null
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

async function fetchWikipediaArtistMetadata(name) {
  const title = await searchWikipediaTitle(name)
  if (!title) return null
  const metadata = await getArtistMetadataByTitle(title)
  return metadata ? { ...metadata, source: 'wikipedia' } : null
}

async function fetchArtistMetadata(name, options = {}) {
  const source = normalizeSource(options.source)
  if (source === 'wikipedia') return fetchWikipediaArtistMetadata(name)
  if (source === 'musicbrainz') return fetchMusicBrainzArtistMetadata(name)

  const wikipedia = await fetchWikipediaArtistMetadata(name)
  if (wikipedia?.bio || wikipedia?.imageUrl) return wikipedia

  const musicbrainz = await fetchMusicBrainzArtistMetadata(name)
  if (musicbrainz?.bio || musicbrainz?.imageUrl) return musicbrainz

  return wikipedia || musicbrainz || null
}

async function getArtistMetadataByTitle(title) {
  const summary = await getWikipediaSummary(title)
  if (!summary) return null
  const bio = typeof summary.extract === 'string' && summary.extract.trim() ? summary.extract.trim() : null
  const imageUrl = summary.originalimage?.source || summary.thumbnail?.source || null
  return { title, bio, imageUrl }
}

async function searchWikipediaMetadataCandidates(query) {
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
        source: 'wikipedia',
      })
      if (candidates.length >= 5) break
    }
    return candidates.sort((a, b) => b.score - a.score)
  } catch {
    return []
  }
}

async function searchMusicBrainzMetadataCandidates(query) {
  const artists = await searchMusicBrainzArtists(query)
  const candidates = []
  for (const artist of artists) {
    const metadata = await getMusicBrainzArtistMetadataById(artist.id)
    if (!metadata) continue
    candidates.push({
      title: metadata.title,
      bio: metadata.bio,
      imageUrl: metadata.imageUrl,
      snippet: metadata.snippet || '',
      score: artist.score || 0,
      source: 'musicbrainz',
    })
    if (candidates.length >= 5) break
  }
  return candidates
}

async function searchArtistMetadataCandidates(query, options = {}) {
  const source = normalizeSource(options.source)
  if (source === 'wikipedia') return searchWikipediaMetadataCandidates(query)
  if (source === 'musicbrainz') return searchMusicBrainzMetadataCandidates(query)
  const [wikipedia, musicbrainz] = await Promise.all([
    searchWikipediaMetadataCandidates(query),
    searchMusicBrainzMetadataCandidates(query),
  ])
  const seen = new Set()
  return [...wikipedia, ...musicbrainz].filter((candidate) => {
    const key = `${candidate.source}:${String(candidate.title || '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
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

async function cacheArtistMetadata(db, artist, options = {}) {
  if (!artist?.id || !artist?.name) return null
  const { fetchImages } = getArtistFetchSettings(db)
  if (!shouldFetchArtistMetadata(artist, fetchImages)) return artist

  const fetched = await fetchArtistMetadata(artist.name, options)
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
          bio_source = CASE WHEN COALESCE(NULLIF(bio, ''), '') = '' AND ? IS NOT NULL THEN ? ELSE bio_source END,
          bio_fetched_at = ?
      WHERE id = ? AND COALESCE(bio_source, '') != 'manual'
    `).run(fetched.bio, fetched.bio, fetched.source || 'wikipedia', now, artist.id)
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
          image_source = CASE WHEN image_path IS NULL AND ? IS NOT NULL THEN ? ELSE image_source END,
          image_fetched_at = ?
      WHERE id = ? AND COALESCE(image_source, '') != 'manual'
    `).run(imagePath, imagePath, fetched.source || 'wikipedia', now, artist.id)
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
