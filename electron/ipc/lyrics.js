const { getDB } = require('./db')
const https = require('https')

function httpGet(url) {
  return new Promise((res) => {
    https.get(url, { headers: { 'User-Agent': 'LokalMusic/4.0' } }, (r) => {
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => {
        try { res(JSON.parse(d)) } catch { res(d) }
      })
    }).on('error', () => res(null))
  })
}

function isLetter(ch) { return /[A-Za-z0-9]/.test(ch) }
function charWeight(ch) { return isLetter(ch) ? 1.0 : 0.35 }

function buildCharTimeline(wordText, start, end) {
  const chars = Array.from(wordText)
  const weights = chars.map(ch => charWeight(ch))
  const totalWeight = weights.reduce((a,b) => a + b, 0) || 1
  const dur = Math.max(0.01, (end - start))
  let acc = 0
  return chars.map((ch, i) => {
    const w = weights[i]
    const chStart = start + (acc / totalWeight) * dur
    acc += w
    const chEnd = start + (acc / totalWeight) * dur
    return { ch, start: chStart, end: chEnd }
  })
}

function parseLRC(lrc, totalDuration = 0) {
  if (!lrc) return []
  const base = lrc.split('\n').map(raw => {
    const m = raw.match(/\[(\d+):(\d+\.?\d*)\](.*)/)
    if (!m) return null
    return { time: parseInt(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() }
  }).filter(l => l && l.text !== undefined).sort((a, b) => a.time - b.time)

  const lines = base.map((line, i, arr) => {
    const nextLine = arr[i + 1]
    const lineEnd = line.end ?? (nextLine ? nextLine.time : (totalDuration > line.time ? totalDuration : (line.time + 3.0)))
    const lineDuration = Math.max(0.01, (lineEnd - line.time))
    const rawWords = line.text.split(' ').filter(Boolean)
    const words = rawWords.map((w, wi) => {
      const wStart = line.time + (wi * (lineDuration / rawWords.length))
      const wEnd = line.time + ((wi + 1) * (lineDuration / rawWords.length))
      const chars = buildCharTimeline(w, wStart, Math.max(wEnd, wStart + 0.01))
      return { word: w, time: wStart, end: wEnd, chars }
    })
    const displayText = words.map((w, i) => (i === 0 ? w.word : (words[i - 1].word.endsWith('-') ? w.word : ' ' + w.word))).join('')
    return { time: line.time, end: lineEnd, text: displayText.trim(), words }
  })

  return lines
}

function parseTime(t) {
  if (!t) return 0
  const p = t.split(':')
  if (p.length === 3) return parseInt(p[0]) * 3600 + parseInt(p[1]) * 60 + parseFloat(p[2])
  if (p.length === 2) return parseInt(p[0]) * 60 + parseFloat(p[1])
  return parseFloat(p[0])
}

function parseTTML(xml) {
  if (!xml) return []
  const lines = []
  const normalized = xml.replace(/\r/g, '').replace(/\n+/g, ' ')

  function extractBgSpans(str) {
    const results = []
    const openTagRegex = /<span\b[^>]*\b(?:ttm:role|role|xml:role)\s*=\s*(['"])\s*x-bg\s*\1[^>]*>/ig
    let m
    while ((m = openTagRegex.exec(str)) !== null) {
      const openIndex = m.index
      const openTag = m[0]
      let pos = openIndex + openTag.length
      let depth = 1
      const nextTagRegex = /<\/?span\b/ig
      nextTagRegex.lastIndex = pos
      let nm
      while ((nm = nextTagRegex.exec(str)) !== null) {
        const tagIndex = nm.index
        const snippetAfter = str.slice(tagIndex, tagIndex + 8).toLowerCase()
        if (snippetAfter.startsWith('</span')) {
          depth -= 1
          const closeGT = str.indexOf('>', tagIndex)
          if (depth === 0) {
            const fullEnd = closeGT !== -1 ? closeGT + 1 : tagIndex + 7
            const full = str.slice(openIndex, fullEnd)
            const firstGT = str.indexOf('>', openIndex)
            const inner = firstGT !== -1 ? str.slice(firstGT + 1, tagIndex) : str.slice(openIndex + openTag.length, tagIndex)
            results.push({ full, inner, openIndex, fullEnd })
            openTagRegex.lastIndex = fullEnd
            break
          } else {
            nextTagRegex.lastIndex = closeGT + 1
          }
        } else {
          depth += 1
          nextTagRegex.lastIndex = tagIndex + 6
        }
      }
      if (nm === null) break
    }
    return results
  }

  const pReg = /<p\b[^>]*\bbegin="([^"]+)"(?:\s+end="([^"]+)")?[^>]*>([\s\S]*?)<\/p>/ig

  for (const pm of normalized.matchAll(pReg)) {
    const lineStart = parseTime(pm[1])
    const lineEnd = pm[2] ? parseTime(pm[2]) : null
    let inner = (pm[3] || '').trim()

    const bgSpanMatches = extractBgSpans(inner)
    const bgWords = []
    let bgText = ''

    for (const bm of bgSpanMatches) {
      const bgInner = bm.inner
      const innerTimedReg = /<span\b[^>]*\bbegin="([^"]+)"(?:\s+end="([^"]+)")?[^>]*>([\s\S]*?)<\/span>/ig
      const innerTimed = [...bgInner.matchAll(innerTimedReg)]
      for (const itm of innerTimed) {
        const bwStart = parseTime(itm[1])
        const bwEnd = itm[2] ? parseTime(itm[2]) : null
        const raw = (itm[3] || '').replace(/<[^>]+>/g, '').trim()
        if (!raw) continue

        const pieces = raw.split(/\s+/).filter(Boolean)
        if (pieces.length === 1) {
          bgWords.push({ word: pieces[0], time: bwStart, end: bwEnd })
          bgText += (bgText ? ' ' : '') + pieces[0]
        } else {
          const dur = Math.max(0.001, (bwEnd ? bwEnd - bwStart : pieces.length * 0.3))
          pieces.forEach((p, pi) => {
            const s = bwStart + pi * (dur / pieces.length)
            const e = bwStart + (pi + 1) * (dur / pieces.length)
            bgWords.push({ word: p, time: s, end: e })
            bgText += (bgText ? ' ' : '') + p
          })
        }
      }
    }

    if (bgSpanMatches.length) {
      for (const bm of bgSpanMatches) {
        inner = inner.split(bm.full).join(' ')
      }
    }

    const words = []
    const wordReg = /<span\b[^>]*\bbegin="([^"]+)"(?:\s+end="([^"]+)")?[^>]*>([\s\S]*?)<\/span>/ig
    const wordMatches = [...inner.matchAll(wordReg)]

    for (const wm of wordMatches) {
      const startTime = parseTime(wm[1])
      const endTime = wm[2] ? parseTime(wm[2]) : null
      const rawText = (wm[3] || '').replace(/<[^>]+>/g, '').trim()
      if (!rawText) continue

      if (lineEnd != null) {
        if (startTime > lineEnd + 0.001 || (startTime + (endTime || 0)) < (lineStart - 0.001)) {
          continue
        }
      }

      const subWords = rawText.split(/\s+/).filter(Boolean)
      if (subWords.length === 1) {
        words.push({ word: subWords[0], time: startTime, end: endTime })
      } else {
        const spanDur = Math.max(0.001, (endTime ? endTime - startTime : subWords.length * 0.3))
        subWords.forEach((sw, si) => {
          const swStart = startTime + si * (spanDur / subWords.length)
          const swEnd = startTime + (si + 1) * (spanDur / subWords.length)
          words.push({ word: sw, time: swStart, end: swEnd })
        })
      }
    }

    const finalizeWords = (arr, totalEnd) => {
      for (let i = 0; i < arr.length; i++) {
        const w = arr[i]
        if (w.end == null) {
          const next = arr[i + 1]
          w.end = next ? next.time : (totalEnd != null ? totalEnd : (w.time + 0.5))
        }
      }
      return arr
    }
    const finalMainWords = finalizeWords(words, lineEnd)
    const finalBgWords = finalizeWords(bgWords, lineEnd)

    const mergedWords = []
    for (let wi = 0; wi < finalMainWords.length; wi++) {
      const w = finalMainWords[wi]
      if (
        mergedWords.length > 0 &&
        mergedWords[mergedWords.length - 1].word.endsWith('-') &&
        !/^[\)\]\}\.,"']/.test(w.word)
      ) {
        const prev = mergedWords[mergedWords.length - 1]
        prev.word = prev.word + w.word
        prev.end = w.end || prev.end
      } else {
        mergedWords.push({ ...w })
      }
    }

    mergedWords.forEach(w => {
      const wStart = w.time || 0
      const wEnd = (w.end != null) ? w.end : (wStart + 0.5)
      w.chars = buildCharTimeline(w.word, wStart, wEnd)
    })
    finalBgWords.forEach(bw => {
      const bStart = bw.time || 0
      const bEnd = (bw.end != null) ? bw.end : (bStart + 0.5)
      bw.chars = buildCharTimeline(bw.word, bStart, bEnd)
    })

    const displayParts = mergedWords.map((w, i) => {
      if (i === 0) return w.word
      const prev = mergedWords[i - 1].word
      return prev.endsWith('-') ? w.word : ' ' + w.word
    })
    const displayText = displayParts.join('')

    if (mergedWords.length || bgText) {
      lines.push({
        time: lineStart,
        end: lineEnd,
        text: displayText.trim(),
        words: mergedWords,
        bgText: bgText ? `(${bgText})` : undefined,
        bgWords: finalBgWords.length ? finalBgWords : undefined
      })
    }
  }

  return lines.sort((a, b) => (a.time || 0) - (b.time || 0))
}

async function fetchLRCLIB(title, artist, album, duration) {
  const q = new URLSearchParams({ track_name: title, artist_name: artist })
  if (album) q.set('album_name', album)
  if (duration) q.set('duration', Math.round(duration))
  const r = await httpGet(`https://lrclib.net/api/get?${q}`)
  if (!r || typeof r === 'string') return null
  if (r.syncedLyrics) return { type: 'synced', lines: parseLRC(r.syncedLyrics, duration || 0), source: 'lrclib' }
  if (r.plainLyrics) return { type: 'unsynced', lines: r.plainLyrics.split('\n').filter(l => l.trim()).map(text => ({ text })), source: 'lrclib' }
  return null
}

async function fetchLyricsOVH(title, artist) {
  const r = await httpGet(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`)
  if (!r?.lyrics) return null
  return { type: 'unsynced', lines: r.lyrics.split('\n').filter(l => l.trim()).map(text => ({ text })), source: 'lyrics.ovh' }
}

function registerLyricsHandlers(ipcMain) {
  console.log("!!! LYRICS IPC LOADING !!!");

  
  try {
    const db = getDB()
    db.exec("ALTER TABLE lyrics_cache ADD COLUMN fetched_at INTEGER DEFAULT 0")
    db.exec("ALTER TABLE lyrics_cache ADD COLUMN file_path TEXT")
  } catch (e) {
    
  }

  ipcMain.handle('lyrics:import', (_, trackId, content, type, filePath) => {
    try {
      const db = getDB();
      let lines, lyricsType;

      if (type === 'ttml') {
        lines = parseTTML(content);
        console.log(`Parsed ${lines.length} lines from TTML content. Sample line:`, lines[0]);
        console.log(lines[0]?.bgWords?.length ? `First line has ${lines[0].bgWords.length} background words.` : 'First line has no background words.');
        console.log(`Lines with background vocals: ${lines.filter(l => l.bgText).length}`);
        console.log("Contains x-bg?", content.includes("x-bg"))
        
        lyricsType = lines.length > 0 ? 'synced' : 'unsynced';
      } else if (type === 'lrc') {
        lines = parseLRC(content);
        lyricsType = lines.some(l => l.time != null) ? 'synced' : 'unsynced';
      } else {
        lines = content.split('\n').filter(l => l.trim()).map(text => ({ text }));
        lyricsType = 'unsynced';
      }

      db.prepare('INSERT OR REPLACE INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at, file_path) VALUES (?, ?, ?, ?, ?, ?)')
        .run(trackId, lyricsType, JSON.stringify(lines), 'imported', Date.now(), filePath || null);

      return { type: lyricsType, lines, source: 'imported' };
    } catch (err) {
      console.error('Error during lyrics import handler:', err);
      throw err;
    }
  });

  ipcMain.handle('lyrics:get', async (_, trackId, title, artist, album, duration, filePath) => {
    const db = getDB()
    
    const cached = db.prepare('SELECT * FROM lyrics_cache WHERE track_id = ?').get(trackId)
    if (cached) { 
      console.log(`[LYRICS CACHE HIT] track_id: ${trackId}`)
      try { return { type: cached.lyrics_type, lines: JSON.parse(cached.content), source: cached.source } } catch {} 
    }
    
    if (filePath) {
      const cachedByPath = db.prepare('SELECT * FROM lyrics_cache WHERE file_path = ?').get(filePath)
      if (cachedByPath) {
        console.log(`[LYRICS CACHE HIT] file_path: ${filePath}`)
        if (cachedByPath.track_id !== trackId) {
          db.prepare('INSERT OR REPLACE INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at, file_path) VALUES (?, ?, ?, ?, ?, ?)')
            .run(trackId, cachedByPath.lyrics_type, cachedByPath.content, cachedByPath.source + '-migrated', Date.now(), filePath)
          console.log(`[LYRICS MIGRATED] from file_path to track_id: ${trackId}`)
        }
        try { return { type: cachedByPath.lyrics_type, lines: JSON.parse(cachedByPath.content), source: cachedByPath.source } } catch {}
      }
    }
    
    if (!title || !artist) return null

    
    
    
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
    
    if (source !== 'lyricsovh') result = await fetchLRCLIB(title, searchArtist, album, duration)
    if (!result) result = await fetchLyricsOVH(title, searchArtist)
    if (!result && source === 'lyricsovh') result = await fetchLRCLIB(title, searchArtist, album, duration)

    if (result) {
      console.log(`[LYRICS FETCHED] source: ${result.source}, type: ${result.type}`)
      db.prepare('INSERT OR REPLACE INTO lyrics_cache (track_id, lyrics_type, content, source, fetched_at) VALUES (?, ?, ?, ?, ?)').run(trackId, result.type, JSON.stringify(result.lines), result.source, Date.now())
    } else {
      console.log(`[LYRICS NOT FOUND] title: ${title}, artist: ${searchArtist}`)
    }
    return result
  });
}

module.exports = { registerLyricsHandlers }
