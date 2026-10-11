const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { setTimeout: delay } = require('timers/promises')
const binary = require('./crypto')
const { validateURL } = require('./network')

const MAX_READ = 16 * 1024 * 1024
const sanitize = value => String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 180)
function contained(root, value) { const relative = path.relative(root, value); return relative === '' || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative) }
function safePath(root, raw, grants = []) {
  if (typeof raw !== 'string' || !raw || /\0/.test(raw) || !path.isAbsolute(raw) && /(^|[\\/])\.\.([\\/]|$)/.test(raw)) throw new Error('Invalid addon file path')
  const value = path.resolve(root, raw)
  const allowed = [root, ...grants].map(p => path.resolve(p)).find(p => contained(p, value))
  if (!allowed) throw new Error('File path is outside the addon sandbox')
  // Validate every existing component, including the granted root. Packages
  // cannot create symlinks, and a later symlink must not widen a file grant.
  let current = path.parse(value).root
  for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { const stat = fs.lstatSync(current); if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('Addon paths cannot contain links or special files') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return value
}
async function runTool(binaryPath, args, signal) {
  if (!binaryPath) throw new Error('FFmpeg/ffprobe is required. Install it in Settings → External Tools.')
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, { windowsHide: true, shell: false })
    let output = '', errorOutput = ''
    const abort = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => { if (output.length < MAX_READ) output += chunk })
    child.stderr.on('data', chunk => { if (errorOutput.length < 16000) errorOutput += chunk })
    child.on('error', reject)
    child.on('close', code => { signal?.removeEventListener('abort', abort); signal?.aborted ? reject(new Error('Cancelled')) : code === 0 ? resolve(output) : reject(new Error(`Media conversion failed: ${errorOutput.slice(-1000)}`)) })
  })
}
async function mediaInfo(file, tools, signal) {
  const raw = JSON.parse(await runTool(tools.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], signal))
  const audio = raw.streams?.find(s => s.codec_type === 'audio')
  if (!audio) throw new Error('The addon produced no audio stream')
  const bitDepth = Number(audio.bits_per_raw_sample || audio.bits_per_sample) || 0, sampleRate = Number(audio.sample_rate) || 0
  return { success: true, codec: audio.codec_name, audio_codec: audio.codec_name, bit_depth: bitDepth, bitDepth, sample_rate: sampleRate, sampleRate, channels: audio.channels || 0, duration: Number(raw.format?.duration || audio.duration) || 0, duration_ms: Math.round((Number(raw.format?.duration || audio.duration) || 0) * 1000), bitrate: Number(raw.format?.bit_rate || audio.bit_rate) || 0, format: raw.format?.format_name || '' }
}

class ExtensionHost {
  constructor({ addon, storage, network, session, root, grants = [], tools = {}, db, onProgress, signal }) {
    Object.assign(this, { addon, storage, network, session, root, grants, tools, db, onProgress })
    this.controller = new AbortController()
    this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal
    this.startedAt = Date.now(); this.auth = network.auth ||= {}
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  abort() { this.controller.abort() }
  file(raw) { if (!this.addon.manifest.permissions.file) throw new Error('File permission denied'); return safePath(this.root, raw, this.grants) }
  async transfer(url, destination, options = {}, onProgress = async () => {}) {
    options = { ...this.addon.manifest.capabilities?.downloadTransfer, ...options }
    const file = this.file(destination)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const part = this.file(`${file}.part`), checkpoint = this.file(`${file}.checkpoint`)
    const attempts = Math.max(1, Math.min(6, Number(options.maxAttempts || this.addon.manifest.capabilities?.downloadTransfer?.maxAttempts) || 3))
    const resume = options.resume !== false
    let validator = '', written = 0, total = 0
    if (options.persistentCheckpoint && resume) {
      try { const saved = JSON.parse(await fsp.readFile(checkpoint, 'utf8')); if (saved.urlHash === crypto.createHash('sha256').update(url).digest('hex')) validator = saved.validator } catch {}
    }
    for (let attempt = 1; attempt <= attempts; attempt++) {
      this.signal.throwIfAborted()
      const headers = { ...options.headers }
      let offset = resume && validator ? (await fsp.stat(part).catch(() => ({ size: 0 }))).size : 0
      if (offset) { headers.Range = `bytes=${offset}-`; headers['If-Range'] = validator }
      let response, output
      try {
        const result = await this.network.request(url, { headers, signal: this.signal, directMedia: !!options.directMedia })
        response = result.response
        if (result.status < 200 || result.status >= 300) { const error = new Error(`Download returned HTTP ${result.status}`); error.status = result.status; throw error }
        const range = String(result.headers['content-range'] || '').match(/^bytes (\d+)-(\d+)\/(\d+)$/)
        if (offset && (result.status !== 206 || !range || Number(range[1]) !== offset)) {
          if (result.status === 206) throw new Error('Invalid resumed content range')
          offset = 0
        }
        const nextValidator = result.headers.etag && !String(result.headers.etag).startsWith('W/') ? result.headers.etag : result.headers['last-modified'] || ''
        if (offset && nextValidator !== validator) throw new Error('Download validator changed')
        validator = nextValidator
        total = range ? Number(range[3]) : Number(result.headers['content-length']) + offset || 0
        if (total > 4 * 1024 ** 3) throw new Error('Addon audio exceeds the file size limit')
        if (options.persistentCheckpoint) await fsp.writeFile(checkpoint, JSON.stringify({ urlHash: crypto.createHash('sha256').update(url).digest('hex'), validator }), { mode: 0o600 })
        output = await fsp.open(part, offset ? 'a' : 'w', 0o600)
        written = offset
        for await (const chunk of response) {
          this.signal.throwIfAborted()
          let done = 0; while (done < chunk.length) done += (await output.write(chunk, done, chunk.length - done)).bytesWritten
          written += chunk.length
          if (written > 4 * 1024 ** 3) throw new Error('Addon audio exceeds the file size limit')
          await onProgress(written, total)
        }
        if (!written || total && written !== total) throw new Error('Incomplete addon audio download')
        await output.close(); output = null
        this.signal.throwIfAborted()
        await fsp.rename(part, file); await fsp.rm(checkpoint, { force: true })
        return { success: true, path: destination, size: written, attempts: attempt, ...(offset ? { resumed: true } : {}) }
      } catch (error) {
        if (this.signal.aborted) throw error
        if (!validator || !resume) await fsp.rm(part, { force: true })
        if (attempt === attempts || error.status && ![408, 429, 500, 502, 503, 504].includes(error.status)) throw error
        await delay(Math.min(8000, 500 * 2 ** (attempt - 1)), undefined, { signal: this.signal })
      } finally { response?.destroy(); await output?.close().catch(() => {}) }
    }
  }
  async segments(segments, destination, options, callback) {
    if (!Array.isArray(segments) || !segments.length || segments.length > 20000) throw new Error('Invalid download segments')
    const output = this.file(destination), dir = this.file(`${output}.segments`)
    await fsp.mkdir(dir, { recursive: true })
    const progress = new Map(); let completed = 0, serial = Promise.resolve()
    const report = () => { serial = serial.then(() => callback(options.onProgress, [[...progress.values()].reduce((a,b) => a+b,0), 0, completed, segments.length])); return serial }
    const width = Math.max(1, Math.min(8, Number(options.maxParallel || this.addon.manifest.capabilities?.downloadTransfer?.maxParallelSegments) || 3))
    try {
      const temp = this.file(`${output}.tmp`), fd = await fsp.open(temp, 'w', 0o600)
      let size = 0
      try {
        // A bounded window of segments is fetched and immediately assembled;
        // an out-of-order server cannot fill disk with an entire second copy.
        for (let start = 0; start < segments.length; start += width) {
          const indices = Array.from({ length: Math.min(width, segments.length - start) }, (_, i) => start + i)
          const settled = await Promise.allSettled(indices.map(async index => {
            const segment = segments[index], url = typeof segment === 'string' ? segment : segment?.url
            await this.transfer(url, path.join(dir, String(index)), { ...options, headers: { ...options.headers, ...segment?.headers } }, async written => { progress.set(index, written); await report() })
            completed++; await report()
          }))
          const failure = settled.find(result => result.status === 'rejected')
          if (failure) throw failure.reason
          for (const index of indices) {
            for await (const chunk of fs.createReadStream(path.join(dir, String(index)))) {
              this.signal.throwIfAborted(); size += chunk.length
              if (size > 4 * 1024 ** 3) throw new Error('Segmented audio exceeds the file size limit')
              let offset = 0; while (offset < chunk.length) offset += (await fd.write(chunk, offset, chunk.length - offset)).bytesWritten
            }
            await fsp.rm(path.join(dir, String(index)), { force: true })
          }
        }
      } finally { await fd.close() }
      await fsp.rename(temp, output)
      return { success: true, path: destination, size, segments: segments.length }
    } finally { await fsp.rm(dir, { recursive: true, force: true }) }
  }
  async patterned(input, output, options, progress, callback) {
    const source = this.file(input), target = this.file(output), temp = this.file(`${target}.tmp`)
    const segmentSize = Number(options.segmentSize), every = Number(options.transformEvery ?? 1), offset = Number(options.transformOffset || 0)
    if (!Number.isSafeInteger(segmentSize) || segmentSize < 1 || segmentSize > MAX_READ || !Number.isInteger(every) || every < 1 || offset < 0 || offset >= every || options.padding && options.padding !== 'none') throw new Error('Invalid patterned transform options')
    const reader = await fsp.open(source, 'r'); await fsp.mkdir(path.dirname(target), { recursive: true }); const writer = await fsp.open(temp, 'w', 0o600)
    let processed = 0, index = 0, transformed = 0
    try {
      const total = (await reader.stat()).size, buffer = Buffer.alloc(segmentSize)
      for (;;) {
        this.signal.throwIfAborted()
        let count = 0
        while (count < segmentSize) { const read = await reader.read(buffer, count, segmentSize - count); if (!read.bytesRead) break; count += read.bytesRead }
        if (!count) break
        let chunk = buffer.subarray(0,count)
        if (index % every === offset && (count === segmentSize || options.transformPartial)) { chunk = await binary.transform(chunk, options, options.operation !== 'encrypt'); transformed++ }
        let written = 0; while (written < chunk.length) written += (await writer.write(chunk, written, chunk.length - written)).bytesWritten
        processed += count; index++; await callback(progress, [processed,total], true)
      }
      await reader.close(); await writer.close(); this.signal.throwIfAborted(); await fsp.rename(temp,target)
      return { success: true, path: output, bytes_processed: processed, segments_processed: index, segments_transformed: transformed }
    } finally { await reader.close().catch(() => {}); await writer.close().catch(() => {}); await fsp.rm(temp,{force:true}) }
  }
  async fileCall(name, args, callback) {
    const [raw, data, opts = {}] = args, file = name === 'download' || name === 'downloadSegments' ? null : this.file(raw)
    if (name === 'download') return this.transfer(raw, data, opts || {}, (written,total) => callback(opts?.onProgress,[written,total]))
    if (name === 'downloadSegments') return this.segments(raw,data,opts || {},callback)
    if (name === 'transformPatternedBlocks') return this.patterned(raw,data,opts,args[3],callback)
    if (name === 'exists') return fs.existsSync(file)
    if (name === 'getSize') return { success: true, size: (await fsp.stat(file)).size }
    if (name === 'delete') { await fsp.rm(file,{force:true}); return {success:true} }
    if (name === 'copy' || name === 'move') {
      const target=this.file(data); await fsp.mkdir(path.dirname(target),{recursive:true})
      name === 'copy' ? await fsp.copyFile(file,target) : await fsp.rename(file,target)
      return {success:true}
    }
    if (name === 'read' || name === 'readBytes') {
      const options = name === 'readBytes' ? data || {} : {}, offset = Number(options.offset || 0), length = Number(options.length ?? MAX_READ)
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0 || length > MAX_READ) throw new Error('Invalid binary read range')
      const fd = await fsp.open(file,'r')
      try {
        const size = (await fd.stat()).size
        if (name === 'read' && size > MAX_READ) throw new Error('File read exceeds 16 MB')
        const buffer=Buffer.alloc(Math.min(length,Math.max(0,size-offset))), {bytesRead}=await fd.read(buffer,0,buffer.length,offset)
        return {success:true,data:name==='read'?buffer.toString():binary.encoded(buffer,options.encoding || 'base64'),offset,size,eof:offset+bytesRead>=size,bytes_read:bytesRead}
      } finally { await fd.close() }
    }
    if (name === 'write' || name === 'writeBytes') {
      const options=opts || {}, value=name==='write'?Buffer.from(String(data)):binary.bytes(data,options.encoding || 'base64')
      if (value.length>MAX_READ) throw new Error('File write exceeds 16 MB')
      await fsp.mkdir(path.dirname(file),{recursive:true})
      if (name==='write') await fsp.writeFile(file,value,{mode:0o600})
      else {
        const offset=Number(options.offset || 0)
        if (!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid write offset')
        const fd=await fsp.open(file,options.append?'a':options.truncate?'w':fs.existsSync(file)?'r+':'w',0o600)
        try { let count=0;while(count<value.length)count+=(await fd.write(value,count,value.length-count,options.append?null:offset+count)).bytesWritten } finally {await fd.close()}
      }
      return {success:true,bytes_written:value.length}
    }
    throw new Error('Unknown file API')
  }
  async authCall(name, args) {
    const value=args[0]
    if (name==='getAuthCode')return this.auth.code || null
    if (name==='getTokens')return {access_token:this.auth.access_token || '',refresh_token:this.auth.refresh_token || '',expires_at:this.auth.expires_at || null}
    if (name==='isAuthenticated')return !!this.auth.access_token && (!this.auth.expires_at || this.auth.expires_at>Date.now())
    if (name==='clearAuth'){for(const key of Object.keys(this.auth))delete this.auth[key];return true}
    if (name==='setAuthCode'){if(typeof value==='string')this.auth.code=value;else Object.assign(this.auth,value || {});return true}
    if (name==='generatePKCE'){
      const verifier=crypto.randomBytes(96).toString('base64url').slice(0,Math.max(43,Math.min(128,Number(value)||64)))
      this.auth.pkce={verifier,challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),method:'S256'};return this.auth.pkce
    }
    if (name==='getPKCE')return this.auth.pkce || {}
    if (name==='openAuthUrl'||name==='startOAuthWithPKCE'){
      const config=typeof value==='object'?value:{authUrl:value,redirectUri:args[1]}
      const url=validateURL(config.authUrl,this.network.permissions),state=crypto.randomBytes(24).toString('base64url')
      url.searchParams.set('state',state)
      if(name==='startOAuthWithPKCE'){
        const pkce=await this.authCall('generatePKCE',[64])
        for(const [key,v]of Object.entries({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:config.scope || (config.scopes || []).join(' '),code_challenge:pkce.challenge,code_challenge_method:'S256',...config.extraParams}))if(v!=null)url.searchParams.set(key,String(v))
      }
      this.auth.pending={url:url.href,state,createdAt:Date.now(),callback:config.redirectUri || ''};return {success:true,open_auth_url:url.href,message:'Log in on the page Lokal opens; access is checked when it closes.'}
    }
    if(name==='exchangeCodeWithPKCE'){
      const config=value || {},body=new URLSearchParams({grant_type:'authorization_code',client_id:config.clientId,code:config.code || this.auth.code || '',code_verifier:this.auth.pkce?.verifier || '',...(config.redirectUri?{redirect_uri:config.redirectUri}:{}),...config.extraParams})
      const generation=this.network.generation || 0
      const result=await this.network.jsonResponse(config.tokenUrl,{method:'POST',body:body.toString(),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:this.signal})
      if(!result.ok)throw new Error(`OAuth exchange returned HTTP ${result.status}`)
      if((this.network.generation || 0)!==generation)return {success:false,error:'Disconnected'}
      const tokens=JSON.parse(result.body);Object.assign(this.auth,tokens,{expires_at:Date.now()+Number(tokens.expires_in || 3600)*1000});return {success:true,...tokens}
    }
    throw new Error('Unknown auth API')
  }
  async call(method, args, callback) {
    this.signal.throwIfAborted()
    const [name, action] = method.split('.')
    if (name==='file') { try { return await this.fileCall(action,args,callback) } catch(error) {return action==='exists'?false:{success:false,error:error.message,error_type:this.signal.aborted?'cancelled':'download_error'}} }
    if (name==='http') {
      if(action==='clearCookies'){this.network.cookies.removeAllCookiesSync();return true}
      try {
        const options = args[1] || {}, headers = { ...options.headers }
        if (!options.asFetch && (options.body || options.method === 'POST') && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json'
        return await this.network.jsonResponse(args[0],{...options,headers,signal:this.signal})
      } catch(error){return {ok:false,status:0,error:error.message}}
    }
    if (name==='storage'||name==='credentials') {
      if(!this.addon.manifest.permissions.storage)throw new Error('Storage permission denied')
      const purpose=name==='storage'?'storage':'credentials'
      if(action==='get'){const saved=this.storage.read(this.addon.key,purpose);return {found:Object.hasOwn(saved,String(args[0])),value:saved[String(args[0])]}}
      if(action==='clear'){this.storage.write(this.addon.key,purpose,{});return {success:true}}
      return this.storage.update(this.addon.key,purpose,String(args[0]),args[1],action==='remove')
    }
    if(name==='session'){
      if(!this.session)throw new Error('Signed sessions are not configured')
      if(action==='signedFetch')return this.session.signedFetch(...args,this.signal)
      if(action==='completeGrant')return this.session.completeGrant(args[0],this.signal)
      if(action==='status'||action==='clear')return this.session[action]()
    }
    if(name==='auth'){
      const generation=this.network.generation || 0
      const result=await this.authCall(action,args)
      // Disconnected meanwhile: don't save what this call left behind.
      if((this.network.generation || 0)!==generation)return {success:false,error:'Disconnected'}
      if(!['getAuthCode','getTokens','isAuthenticated','getPKCE'].includes(action))this.network.persist?.()
      return result
    }
    if(name==='ffmpeg'){
      try {
        if(action==='getInfo')return await mediaInfo(this.file(args[0]),this.tools,this.signal)
        const input=this.file(args[0]),output=this.file(args[1]),opts=args[2] || {},argv=['-nostdin','-y','-i',input,'-vn']
        const codec=opts.codec || 'copy'
        if(!['copy','flac','alac','aac','libopus','opus','libmp3lame','mp3','pcm_s16le','vorbis','libvorbis'].includes(codec))throw new Error('Unsupported conversion codec')
        argv.push('-c:a',codec)
        if(opts.bitrate){if(!/^\d{1,4}k?$/.test(String(opts.bitrate)))throw new Error('Invalid bitrate');argv.push('-b:a',String(opts.bitrate))}
        if(opts.sample_rate){if(![8000,16000,22050,24000,32000,44100,48000,88200,96000,176400,192000].includes(Number(opts.sample_rate)))throw new Error('Invalid sample rate');argv.push('-ar',String(opts.sample_rate))}
        if(opts.channels){if(!Number.isInteger(opts.channels)||opts.channels<1||opts.channels>16)throw new Error('Invalid channel count');argv.push('-ac',String(opts.channels))}
        await fsp.mkdir(path.dirname(output),{recursive:true});await runTool(this.tools.ffmpeg,[...argv,output],this.signal);return {success:true,path:args[1]}
      }catch(error){return {success:false,error:error.message}}
    }
    if(method==='progress'){this.onProgress?.({percent:args[0]});return true}
    if(method==='log')return true // Guest logs never expose account tokens to application logs.
    if(method==='encode')return {__bytes:[...Buffer.from(args[0])]}
    if(method==='decode')return Buffer.from(args[0]).toString()
    if(method==='base64Bytes')return Buffer.from(args[0]).toString('base64')
    if(method==='decodeBase64Bytes')return [...Buffer.from(args[0],'base64')]
    if(name==='url'){
      if(action==='parse'){const u=new URL(args[0],args[1] || undefined);return Object.fromEntries(['href','origin','protocol','host','hostname','port','pathname','search','hash','username','password'].map(k=>[k,u[k]]))}
      if(action==='query')return [...new URLSearchParams(args[0])]
      if(action==='encode')return new URLSearchParams(args[0]).toString()
    }
    if(name==='matching'){
      if(action==='normalizeString')return String(args[0]).toLowerCase().replace(/\s*[([](?:feat\.?|ft\.?|with|remaster(?:ed)?|official).*?[)\]]/g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim()
      const a=Buffer.from(String(args[0]).trim().toLowerCase()),b=Buffer.from(String(args[1]).trim().toLowerCase())
      if(!a.length||!b.length)return 0
      if(a.length>2000||b.length>2000)throw new Error('Matching input is too long')
      let row=Array.from({length:b.length+1},(_,i)=>i)
      for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next}
      return 1-row[b.length]/Math.max(a.length,b.length)
    }
    if(name==='gobackend'){
      if(action==='sanitizeFilename')return sanitize(args[0])
      if(action==='buildFilename')return sanitize(String(args[0]).replace(/\{([^}]+)\}/g,(_,key)=>args[1]?.[key] ?? ''))
      if(action==='getLocalTime'){const now=new Date();return {hour:now.getHours(),minute:now.getMinutes(),second:now.getSeconds(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,offset:-now.getTimezoneOffset()*60}}
      if(action==='getAudioQuality')return mediaInfo(this.file(args[0]),this.tools,this.signal)
      if(action==='checkISRCExists'){const row=this.db?.prepare("SELECT file_path FROM tracks WHERE isrc = ? AND file_path NOT LIKE 'ghost://%' LIMIT 1").get(String(args[1]));return {exists:!!row,file_path:row?.file_path || ''}}
      if(action==='addToISRCIndex')return {success:true}
      if(action==='getLyricsLRC'){const lyrics=await require('../download/postprocess').findLyrics(this.db,{title:args[1],artist:args[2],duration:Number(args[4])/1000},this.signal);const lrc=lyrics?require('../lyrics/embedded').toPortableLyrics(lyrics):'';return {lyrics:lrc,lrc}}
    }
    if(name==='utils'){
      if(action==='isDownloadCancelled'||action==='isRequestCancelled')return this.signal.aborted
      if(action==='appVersion')return '5.1.0'
      if(action==='appUserAgent')return `Lokal/${require('../../package.json').version} SpotiFLAC-compatible/5.1.0`
      if(action==='randomUserAgent')return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36'
      if(action==='setDownloadStatus'){this.onProgress?.({message:String(args[0]).slice(0,200)});return true}
      if(action==='getResolutionRemainingMs')return Math.max(0,60000-(Date.now()-this.startedAt))
      if(action==='sleep'){await delay(Math.min(300000,Math.max(0,Number(args[0])||0)),undefined,{signal:this.signal});return true}
      if(action==='base64Encode')return Buffer.from(String(args[0])).toString('base64')
      if(action==='base64Decode')return Buffer.from(String(args[0]),'base64').toString()
      if(action==='md5'||action==='sha256')return crypto.createHash(action).update(String(args[0])).digest('hex')
      if(action==='hmacSHA256'||action==='hmacSHA256Base64')return crypto.createHmac('sha256',String(args[1])).update(String(args[0])).digest(action==='hmacSHA256'?'hex':'base64')
      if(action==='hmacSHA1')return [...crypto.createHmac('sha1',Array.isArray(args[0])?Buffer.from(args[0]):String(args[0])).update(Array.isArray(args[1])?Buffer.from(args[1]):String(args[1])).digest()]
      if(action==='encrypt'||action==='decrypt')return binary.text(action==='decrypt',args[0],args[1])
      if(action==='generateKey'){const length=Number(args[0] ?? 32);if(!Number.isInteger(length)||length<1||length>4096)return {success:false,error:'Invalid key length'};const key=crypto.randomBytes(length);return {success:true,key:key.toString('base64'),hex:key.toString('hex')}}
      if(action==='encryptBlockCipher'||action==='decryptBlockCipher'||action==='decryptCTRSegments')return binary.block(action==='decryptCTRSegments'?'segments':action==='encryptBlockCipher'?'encrypt':'decrypt',args[0],args[1])
    }
    throw new Error(`Unsupported host API: ${method}`)
  }
}
module.exports = { ExtensionHost, safePath, contained, runTool, mediaInfo, sanitize }
