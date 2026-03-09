const router = require('express').Router()
const { getDB } = require('../../electron/ipc/db')
const https = require('https')
const crypto = require('crypto')

function get(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'LokalMusic/2.0' } }, (res) => {
      let data = ''
      res.on('data', d => { data += d })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
    }).on('error', () => resolve(null))
  })
}

function parseLRC(lrc) {
  if (!lrc) return []
  const lines = []
  for (const raw of lrc.split('\n')) {
    const match = raw.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
    if (match) lines.push({ time: parseInt(match[1]) * 60 + parseFloat(match[2]), text: match[3].trim() })
  }
  return lines.sort((a, b) => a.time - b.time)
}

function normalizeLang(lang) {
  const l = String(lang || '').trim().toLowerCase()
  if (!l) return 'unknown'
  if (l.startsWith('en')) return 'en'
  if (l.startsWith('zh')) return 'zh'
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('ko')) return 'ko'
  if (l === 'und' || l === 'auto') return 'unknown'
  return l
}

function lineToText(line) {
  if (!line) return ''
  if (typeof line.text === 'string' && line.text.trim()) return line.text.trim()
  if (Array.isArray(line.words) && line.words.length) {
    return line.words.map((w, i) => {
      const word = String(w?.word || '')
      if (i === 0) return word
      const prev = String(line.words[i - 1]?.word || '')
      return prev.endsWith('-') ? word : ` ${word}`
    }).join('').trim()
  }
  return ''
}

function buildSourceHash(lines) {
  const payload = JSON.stringify((Array.isArray(lines) ? lines : []).map(lineToText))
  return crypto.createHash('sha1').update(payload).digest('hex')
}

async function detectLanguageViaGoogle(text) {
  if (!text) return 'unknown'
  const r = await get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`)
  if (!Array.isArray(r)) return 'unknown'
  if (typeof r[2] === 'string') return normalizeLang(r[2])
  if (Array.isArray(r[8]) && Array.isArray(r[8][0]) && typeof r[8][0][0] === 'string') {
    return normalizeLang(r[8][0][0])
  }
  return 'unknown'
}

function heuristicLanguage(lines) {
  const sample = (Array.isArray(lines) ? lines : [])
    .slice(0, 24)
    .map(lineToText)
    .join(' ')
    .trim()
  if (!sample) return { lang: 'unknown', confidence: 0 }
  const hasHangul = /[\uac00-\ud7af]/.test(sample)
  const hasHiraganaKatakana = /[\u3040-\u30ff]/.test(sample)
  const hasHan = /[\u3400-\u9fff\uf900-\ufaff]/.test(sample)
  if (hasHangul) return { lang: 'ko', confidence: 0.96 }
  if (hasHiraganaKatakana) return { lang: 'ja', confidence: 0.96 }
  if (hasHan) return { lang: 'zh', confidence: 0.9 }
  return { lang: 'unknown', confidence: 0.2 }
}

async function translateTextViaGoogle(text, targetLang) {
  if (!text) return { text: '', lang: 'unknown' }
  const r = await get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`)
  if (!Array.isArray(r) || !Array.isArray(r[0])) return { text, lang: 'unknown' }
  const translated = r[0].map(chunk => Array.isArray(chunk) ? (chunk[0] || '') : '').join('').trim()
  const lang = normalizeLang(r[2])
  return { text: translated || text, lang }
}


try {
  const db = getDB()
  db.exec("ALTER TABLE lyrics_cache ADD COLUMN fetched_at INTEGER DEFAULT 0")
} catch (e) {
  
}

try {
  const db = getDB()
  db.exec(`
    CREATE TABLE IF NOT EXISTS lyrics_translations (
      track_id TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      detected_lang TEXT,
      content TEXT,
      provider TEXT,
      fetched_at INTEGER DEFAULT 0,
      PRIMARY KEY (track_id, target_lang, source_hash)
    )
  `)
} catch (e) {
  
}

router.get('/:trackId', async (req, res) => {
  const db = getDB()
  const { trackId } = req.params
  const { title, artist, album, duration } = req.query

  const cached = db.prepare('SELECT * FROM lyrics_cache WHERE track_id = ?').get(trackId)
  if (cached) {
    try { return res.json({ type: cached.lyrics_type, lines: JSON.parse(cached.content), source: cached.source }) } catch {}
  }

  if (!title || !artist) return res.json(null)

  const keepCommaSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('keep_comma_artists')
  let keepCommaArtists = []
  try {
    const val = keepCommaSetting?.value || ""
    keepCommaArtists = val.startsWith('[') ? JSON.parse(val) : val.split('\n').map(s => s.trim())
  } catch (e) {
    keepCommaArtists = []
  }

  const isProtected = keepCommaArtists.some(a => a.toLowerCase() === artist.toLowerCase())
  
  const searchArtist = isProtected 
    ? artist 
    : artist.split(/,| feat\.?| & | ft\.?|;/i)[0].trim()


  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map(r => [r.key, r.value]))
  const source = settings.lyrics_source || 'lrclib'

  let result = null

  async function tryLRCLIB() {
    const q = new URLSearchParams({ track_name: title, artist_name: searchArtist })
    if (album) q.set('album_name', album)
    if (duration) q.set('duration', Math.round(duration))
    const r = await get(`https://lrclib.net/api/get?${q}`)
    if (!r) return null
    if (r.syncedLyrics) return { type: 'synced', lines: parseLRC(r.syncedLyrics), source: 'lrclib' }
    if (r.plainLyrics) return { type: 'unsynced', lines: r.plainLyrics.split('\n').filter(l => l.trim()).map(t => ({ time: null, text: t })), source: 'lrclib' }
    return null
  }

  async function tryOVH() {
    const r = await get(`https://api.lyrics.ovh/v1/${encodeURIComponent(searchArtist)}/${encodeURIComponent(title)}`)
    if (!r?.lyrics) return null
    return { type: 'unsynced', lines: r.lyrics.split('\n').filter(l => l.trim()).map(t => ({ time: null, text: t })), source: 'lyrics.ovh' }
  }

  if (source === 'lrclib' || source === 'both') result = await tryLRCLIB()
  if (!result && (source === 'lyricsovh' || source === 'both')) result = await tryOVH()
  if (!result && source === 'lrclib') result = await tryOVH()
  if (!result && source === 'lyricsovh') result = await tryLRCLIB()

  if (result) {
    db.prepare('INSERT OR REPLACE INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at) VALUES (?, ?, ?, ?, ?)').run(trackId, result.type, JSON.stringify(result.lines), result.source, Date.now())
  }
  
  res.json(result)
})

router.delete('/:trackId', (req, res) => {
  const db = getDB()
  db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(req.params.trackId)
  db.prepare('DELETE FROM lyrics_translations WHERE track_id = ?').run(req.params.trackId)
  res.json({ ok: true })
})

router.post('/clear-all', (req, res) => {
  const db = getDB()
  db.prepare('DELETE FROM lyrics_cache').run()
  db.prepare('DELETE FROM lyrics_translations').run()
  res.json({ ok: true })
})

router.post('/:trackId/detect-language', async (req, res) => {
  const trackId = req.params.trackId || 'unknown-track'
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
  if (!lines.length) return res.json({ lang: 'unknown', confidence: 0, source: 'empty' })
  const heuristic = heuristicLanguage(lines)
  const sourceHash = buildSourceHash(lines)
  const cached = getDB().prepare('SELECT detected_lang FROM lyrics_translations WHERE track_id = ? AND target_lang = ? AND source_hash = ?').get(trackId, 'en', sourceHash)
  if (cached?.detected_lang) {
    const lang = normalizeLang(cached.detected_lang)
    if (heuristic.lang !== 'unknown' && heuristic.lang !== lang) {
      return res.json({ lang: heuristic.lang, confidence: heuristic.confidence, source: 'heuristic-override' })
    }
    return res.json({ lang, confidence: 1, source: 'cache' })
  }
  const sample = lines.slice(0, 18).map(lineToText).filter(Boolean).join('\n').slice(0, 1800)
  if (heuristic.lang !== 'unknown') return res.json({ lang: heuristic.lang, confidence: heuristic.confidence, source: 'heuristic' })
  const lang = await detectLanguageViaGoogle(sample)
  res.json({ lang: normalizeLang(lang), confidence: lang === 'unknown' ? 0.2 : 0.86, source: lang === 'unknown' ? 'fallback' : 'remote' })
})

router.post('/:trackId/translate', async (req, res) => {
  const trackId = req.params.trackId || 'unknown-track'
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : []
  const targetLang = normalizeLang(req.body?.targetLang || 'en')
  if (!lines.length) return res.json({ lines: [], detectedLang: 'unknown', targetLang, translated: false, source: 'empty' })
  const db = getDB()
  const sourceHash = buildSourceHash(lines)
  const cached = db.prepare('SELECT * FROM lyrics_translations WHERE track_id = ? AND target_lang = ? AND source_hash = ?').get(trackId, targetLang, sourceHash)
  if (cached?.content) {
    try {
      return res.json({ lines: JSON.parse(cached.content), detectedLang: normalizeLang(cached.detected_lang), targetLang, translated: true, source: 'cache' })
    } catch {}
  }
  const sample = lines.slice(0, 18).map(lineToText).filter(Boolean).join('\n').slice(0, 1800)
  let detectedLang = await detectLanguageViaGoogle(sample)
  const heuristic = heuristicLanguage(lines)
  if (!detectedLang || detectedLang === 'unknown') detectedLang = heuristic.lang
  if (heuristic.lang !== 'unknown' && normalizeLang(detectedLang) !== heuristic.lang) detectedLang = heuristic.lang
  if (detectedLang === targetLang) return res.json({ lines, detectedLang, targetLang, translated: false, source: 'same-language' })
  const translatedLines = []
  for (const line of lines) {
    const raw = lineToText(line)
    if (!raw) {
      translatedLines.push({ ...line, text: '' })
      continue
    }
    const translated = await translateTextViaGoogle(raw, targetLang)
    if (translated.lang && translated.lang !== 'unknown') detectedLang = translated.lang
    translatedLines.push({ ...line, text: translated.text || raw })
  }
  db.prepare('INSERT OR REPLACE INTO lyrics_translations (track_id, target_lang, source_hash, detected_lang, content, provider, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(trackId, targetLang, sourceHash, normalizeLang(detectedLang), JSON.stringify(translatedLines), 'google-gtx', Date.now())
  res.json({ lines: translatedLines, detectedLang: normalizeLang(detectedLang), targetLang, translated: true, source: 'remote' })
})

module.exports = router
