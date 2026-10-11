const http = require('http')
const https = require('https')
const dns = require('dns').promises
const net = require('net')
const { CookieJar } = require('tough-cookie')

const REDIRECTS = new Set([301, 302, 303, 307, 308])
function privateAddress(address) {
  const value = address.toLowerCase().replace(/^::ffff:/, '')
  if (net.isIPv4(value)) {
    const [a, b] = value.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127
  }
  return value === '::' || value === '::1' || /^(fc|fd|fe[89ab])/.test(value)
}
function domainAllowed(host, domains) {
  return domains.some(domain => domain.startsWith('*.') ? host.endsWith(domain.slice(1)) && host !== domain.slice(2) : host === domain.toLowerCase())
}
function validateURL(raw, permissions) {
  const url = new URL(raw)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (url.username || url.password || !domainAllowed(host, permissions.network || [])) throw new Error(`Network permission denied for ${host}`)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && permissions.allowHttp)) throw new Error('This addon requires HTTPS')
  return url
}
class ExtensionNetwork {
  constructor(permissions) { this.permissions = permissions; this.cookies = new CookieJar() }
  async request(raw, { method = 'GET', body, headers = {}, signal, directMedia = false } = {}) {
    let url = validateURL(raw, this.permissions)
    headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(host|content-length|connection|transfer-encoding|proxy-authorization)$/i.test(k)).map(([k,v]) => [k, String(v)]))
    for (let hop = 0; hop <= 5; hop++) {
      signal?.throwIfAborted()
      const host = url.hostname.replace(/^\[|\]$/g, '')
      const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true })
      const explicitLocal = (this.permissions.network || []).some(d => d === host) && (host === 'localhost' || net.isIP(host) && privateAddress(host))
      if (!addresses.length || !explicitLocal && addresses.some(a => privateAddress(a.address))) throw new Error('Addon request resolved to a private address without explicit permission')
      const cookie = directMedia ? '' : this.cookies.getCookieStringSync(url.href)
      const requestHeaders = { 'User-Agent': `Lokal/${require('../../package.json').version}`, ...headers }
      if (cookie && !Object.keys(requestHeaders).some(k => k.toLowerCase() === 'cookie')) requestHeaders.Cookie = cookie
      const response = await new Promise((resolve, reject) => {
        const req = (url.protocol === 'https:' ? https : http).request(url, {
          method, headers: requestHeaders, signal,
          lookup: (_host, options, cb) => options?.all ? cb(null, addresses) : cb(null, addresses[0].address, addresses[0].family),
        }, resolve)
        req.on('error', reject)
        req.setTimeout(30000, () => req.destroy(new Error('Addon network request stalled')))
        if (body && method !== 'GET' && method !== 'HEAD') req.write(body)
        req.end()
      })
      if (!directMedia && response.headers['set-cookie']?.length) {
        for (const cookie of response.headers['set-cookie']) { try { this.cookies.setCookieSync(cookie, url.href) } catch {} }
        this.persist?.()
      }
      const status = response.statusCode || 0
      if (REDIRECTS.has(status) && response.headers.location) {
        response.destroy()
        if (directMedia) throw new Error('Direct-media downloads do not follow redirects')
        const next = validateURL(new URL(response.headers.location, url).href, this.permissions)
        if (next.origin !== url.origin) headers = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(authorization|cookie|x-.*(?:token|key|signature|session))$/i.test(k)))
        if (status === 303 || (status === 301 || status === 302) && method === 'POST') { method = 'GET'; body = undefined }
        url = next; continue
      }
      return { response, url: url.href, status, headers: response.headers }
    }
    throw new Error('Too many addon redirects')
  }
  async jsonResponse(url, options = {}) {
    const { response, status, headers, url: finalUrl } = await this.request(url, options)
    const chunks = []; let size = 0
    try {
      for await (const chunk of response) {
        size += chunk.length
        if (size > 16 * 1024 * 1024) throw new Error('Addon network response exceeds 16 MB')
        chunks.push(chunk)
      }
    } finally { response.destroy() }
    const bytes = Buffer.concat(chunks)
    return { statusCode: status, status, ok: status >= 200 && status < 300, url: finalUrl, headers, body: bytes.toString(), ...(options.asFetch ? { binary: bytes.toString('base64') } : {}) }
  }
}
module.exports = { ExtensionNetwork, validateURL, domainAllowed, privateAddress }
