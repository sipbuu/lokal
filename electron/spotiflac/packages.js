const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')
const { AddonStorage, atomicWrite } = require('./storage')
const { CookieJar } = require('tough-cookie')
const { ExtensionNetwork, validateURL } = require('./network')
const { SignedSession } = require('./session')
const { ExtensionHost, safePath, runTool, mediaInfo } = require('./host')
const { ExtensionRuntime } = require('./runtime')

const REGISTRY = 'https://raw.githubusercontent.com/spotiflacapp/SpotiFLAC-Extension/main/registry.json'
const COMPAT_VERSION = '5.1.0'
const FEATURES = { signedSession: 3, sessionRefresh: 1, sessionGrant: 1, globalAction: 1, webviewAuth: 1, downloadSegments: 1, patternedFileTransform: 1, preparedContext: 1, accountForms: 1, accountDownloadMode: 1, directMedia: 1 }
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex')
const keyOf = name => crypto.createHash('sha1').update(`spotiflac:${name}`).digest('hex').slice(0,10)
function compareVersions(a,b) {
  const left=String(a || '0').split('.').map(v=>Number(v)||0),right=String(b || '0').split('.').map(v=>Number(v)||0)
  for(let i=0;i<Math.max(left.length,right.length);i++){const d=(left[i]||0)-(right[i]||0);if(d)return Math.sign(d)}return 0
}
function validateManifest(manifest) {
  if(!manifest || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(manifest.name || '') || typeof manifest.displayName!=='string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version || ''))throw new Error('Invalid SpotiFLAC package manifest')
  // Download providers, or metadata addons that read playlist links (Spotify
  // Web, Apple Music): those are only used to sync linked playlists.
  if(!Array.isArray(manifest.type)||!(manifest.type.includes('download_provider')||manifest.type.includes('metadata_provider')&&manifest.urlHandler?.enabled))throw new Error('Only download-capable or playlist-link SpotiFLAC addons can be installed')
  if(compareVersions(manifest.minAppVersion,COMPAT_VERSION)>0)throw new Error(`This addon requires SpotiFLAC compatibility ${manifest.minAppVersion}`)
  for(const required of manifest.requiredRuntimeFeatures || []){
    const match=String(required).match(/^([A-Za-z]+)@(\d+)$/)
    if(!match||!FEATURES[match[1]]||FEATURES[match[1]]<Number(match[2]))throw new Error(`Unsupported runtime feature: ${required}`)
  }
  const permissions=manifest.permissions
  if(!permissions || !Array.isArray(permissions.network)||permissions.network.length>100||permissions.network.some(d=>typeof d!=='string'||!/^(?:\*\.)?[a-z0-9.-]+$/i.test(d)))throw new Error('Invalid addon network permissions')
  if(manifest.signedSession){validateURL(manifest.signedSession.baseUrl,permissions);if(!permissions.storage)throw new Error('Signed sessions require storage permission')}
  if((manifest.settings || []).length>100||(manifest.qualityOptions || []).length>30)throw new Error('Addon manifest is too large')
  return manifest
}
function readArchive(buffer) {
  if(buffer.length>32*1024*1024)throw new Error('Addon package exceeds 32 MB')
  const zip=new AdmZip(buffer),entries=zip.getEntries(),names=new Set();let total=0
  if(entries.length>100)throw new Error('Addon package contains too many files')
  for(const entry of entries){
    const name=entry.entryName
    if(names.has(name)||!name||name.includes('\\')||name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(part=>part==='..'||part==='.')||((entry.header.attr>>>16)&0o170000)===0o120000)throw new Error('Addon package contains an unsafe archive path')
    names.add(name);total+=entry.header.size
    if(total>64*1024*1024)throw new Error('Unpacked addon package exceeds 64 MB')
  }
  if(!names.has('manifest.json')||!names.has('index.js'))throw new Error('A SpotiFLAC package needs manifest.json and index.js at its root')
  const manifest=validateManifest(JSON.parse(zip.readAsText('manifest.json'))),code=zip.readAsText('index.js')
  if(Buffer.byteLength(code)>8*1024*1024)throw new Error('Addon script exceeds 8 MB')
  return {zip,manifest,code}
}
function trackOf(track, provider) {
  const artists=Array.isArray(track.artists)?track.artists.map(a=>typeof a==='string'?a:a.name).filter(Boolean):[String(track.artists || track.artist || '')].filter(Boolean)
  return {provider,id:String(track.id),title:String(track.name || track.title || '').slice(0,500),artist:artists.join(', '),artists,artistIds:track.artist_id?[String(track.artist_id)]:[],album:track.album_name || track.albumName || null,albumId:track.album_id || track.albumId || null,track_num:Number(track.track_number || track.trackNumber)||null,disc_num:Number(track.disc_number || track.discNumber)||null,year:Number(String(track.release_date || '').slice(0,4))||null,isrc:track.isrc || null,genre:track.genre || null,duration:(Number(track.duration_ms ?? track.durationMs)||0)/1000 || null,thumbnail:track.cover_url || track.coverUrl || (typeof track.images==='string'?track.images:null),quality:track.audio_quality || null,spotify_id:track.spotify_id || track.spotifyId || null,deezer_id:track.deezer_id || track.deezerId || null,qobuz_id:track.qobuz_id || track.qobuzId || null,tidal_id:track.tidal_id || track.tidalId || null,kind:'song'}
}
class PackageService {
  constructor(db, {root, fetchImpl = fetch, tools}={}) {
    this.db=db;this.root=root || path.join(require('../ipc/db').getStorageDir() || process.env.LOKAL_DATA_DIR || path.join(process.cwd(),'data'),'spotiflac');this.fetch=fetchImpl;this.toolProvider=tools
    this.storage=new AddonStorage(this.root);this.runtimes=new Map();this.networks=new Map();this.sessions=new Map();this.operations=new Map();this.locks=new Map();this.forms=new Map()
    db.exec('CREATE TABLE IF NOT EXISTS spotiflac_repositories (id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT, refreshed_at INTEGER, index_json TEXT, error TEXT); CREATE TABLE IF NOT EXISTS spotiflac_packages (key TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, manifest_json TEXT NOT NULL, repository_id TEXT, digest TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, installed_at INTEGER NOT NULL, methods_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS spotiflac_tracks (provider TEXT NOT NULL, id TEXT NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY(provider,id));')
    const defaultId=hash(REGISTRY).slice(0,16)
    db.prepare('INSERT OR IGNORE INTO spotiflac_repositories (id,url,name) VALUES (?,?,?)').run(defaultId,REGISTRY,'SpotiFLAC official')
  }
  tools() {
    if(this.toolProvider)return this.toolProvider()
    if(process.versions.electron){const t=require('../ipc/tools');return {ffmpeg:t.findFfmpeg(),ffprobe:t.findFfprobe()}}
    const settings=Object.fromEntries(this.db.prepare("SELECT key,value FROM settings WHERE key IN ('ffmpeg_path','ffprobe_path')").all().map(r=>[r.key,r.value]))
    return {ffmpeg:settings.ffmpeg_path || 'ffmpeg',ffprobe:settings.ffprobe_path || 'ffprobe'}
  }
  find(key) {const row=this.db.prepare('SELECT * FROM spotiflac_packages WHERE key=?').get(key);return row?{...row,manifest:JSON.parse(row.manifest_json),methods:JSON.parse(row.methods_json)}:null}
  settings(addon) {
    const values=this.storage.read(addon.key,'settings'),defaults={}
    for(const field of addon.manifest.settings || [])if(field.default!==undefined)defaults[field.key]=field.default
    const qualitySettings={}
    for(const quality of addon.manifest.qualityOptions || [])qualitySettings[quality.id]=Object.fromEntries((quality.settings || []).filter(f=>f.default!==undefined).map(f=>[f.key,f.default]))
    return {...defaults,qualitySettings,...values}
  }
  publicView(addon) {
    const values=this.settings(addon),schema=(addon.manifest.settings || []).map(field=>({...field,type:field.type==='boolean'?'toggle':field.type,help:field.description,options:field.options?.map(o=>typeof o==='object'?o:{value:o,label:o})}))
    const secretKeys=new Set(schema.filter(f=>f.secret).map(f=>f.key))
    const qualitySettings={}
    for(const quality of addon.manifest.qualityOptions || [])qualitySettings[quality.id]=Object.fromEntries((quality.settings || []).filter(f=>!f.secret).map(f=>[f.key,values.qualitySettings?.[quality.id]?.[f.key] ?? f.default]))
    const resources=['stream',...(addon.methods.includes('customSearch')||addon.methods.includes('searchTracks')?['search']:[]),...['album','artist','playlist'].filter(r=>addon.methods.includes(`get${r[0].toUpperCase()+r.slice(1)}`))]
    let icon=null
    if(addon.manifest.icon){try{const file=safePath(path.join(this.root,'packages',addon.key),addon.manifest.icon);const data=fs.readFileSync(file);if(data.length<256*1024&&/\.(png|jpg|jpeg|webp)$/i.test(file))icon=`data:image/${/\.png$/i.test(file)?'png':/\.webp$/i.test(file)?'webp':'jpeg'};base64,${data.toString('base64')}`}catch{}}
    return {key:addon.key,provider:`a-${addon.key}`,id:addon.name,name:addon.manifest.displayName,version:addon.manifest.version,description:addon.manifest.description || '',icon,resources,enabled:!!addon.enabled,installedAt:addon.installed_at,kind:'spotiflac',host:'SpotiFLAC package',repositoryId:addon.repository_id,settingsSchema:schema,settings:{...Object.fromEntries(Object.entries(values).filter(([k])=>!secretKeys.has(k)&&k!=='qualitySettings')),qualitySettings},configuredSecrets:[...secretKeys].filter(k=>values[k]),qualityOptions:addon.manifest.qualityOptions || [],signedSession:!!addon.manifest.signedSession,actions:addon.manifest.globalActions || [],searchFilters:addon.manifest.searchBehavior?.filters || [],compatibilityVersion:COMPAT_VERSION,access:this.access(addon,values),linksOnly:!addon.manifest.type.includes('download_provider')}
  }
  /**
   * Whether an addon still needs setting up before it can stream or download:
   * an unverified signed session, an account login it hasn't done, or a
   * required setting left empty. Read from what's saved (no runtime starts).
   */
  access(addon,values=this.settings(addon)) {
    const missing=(addon.manifest.settings || []).filter(field=>field.required&&field.type!=='button'&&(values[field.key]===undefined||values[field.key]==='')).map(field=>field.label || field.key)
    if(addon.manifest.signedSession){
      const config=addon.manifest.signedSession,live=this.sessions.get(hash(JSON.stringify(config)))
      let verified=false;try{verified=!!(live || new SignedSession(config,this.storage,null,addon.key)).status().authenticated}catch{}
      return {kind:'verification',ready:verified&&!missing.length,verified,missing}
    }
    const login=(addon.manifest.globalActions || []).some(item=>/log\s*in|sign\s*in|connect|auth|account/i.test(`${item.action} ${item.label || ''}`))
    if(login){
      let auth=this.networks.get(addon.key)?.auth;if(!auth){try{auth=this.storage.read(addon.key,'connection').auth}catch{}}
      const tokens=!!(auth?.access_token || auth?.refresh_token || auth?.code)
      let account=false;try{account=Object.keys(this.storage.read(addon.key,'credentials')).length>0}catch{}
      return {kind:'login',ready:(tokens||account)&&!missing.length,verified:tokens||account,missing}
    }
    return {kind:missing.length?'settings':'none',ready:!missing.length,verified:true,missing}
  }
  list() {return this.db.prepare('SELECT key FROM spotiflac_packages ORDER BY installed_at').all().map(({key})=>this.publicView(this.find(key)))}
  repos() {return this.db.prepare('SELECT id,url,name,refreshed_at,error FROM spotiflac_repositories ORDER BY rowid').all()}
  async refreshDue(maxAgeMs=6*60*60*1000) {
    const repos=this.repos().filter(repo=>!repo.refreshed_at || Date.now()-repo.refreshed_at>maxAgeMs)
    await Promise.all(repos.map(repo=>this.refreshRepo(repo.id).catch(()=>null)))
    return this.repos()
  }
  async addRepo(raw) {
    const url=new URL(String(raw).trim())
    if(url.protocol!=='https:'||url.username||url.password)throw new Error('Repository URLs must use HTTPS')
    if(!/\.json$/i.test(url.pathname))url.pathname=url.pathname.replace(/\/$/,'')+'/registry.json'
    url.hash='';const id=hash(url.href).slice(0,16)
    this.db.prepare('INSERT OR IGNORE INTO spotiflac_repositories (id,url,name) VALUES (?,?,?)').run(id,url.href,url.hostname)
    await this.refreshRepo(id);return this.repos().find(r=>r.id===id)
  }
  async document(raw, max=2*1024*1024) {
    // Registry/package redirects use the same domain-restricted, DNS-checked
    // transport as runtime calls. A repository cannot redirect to local files.
    const url=new URL(raw),network=new ExtensionNetwork({network:[url.hostname],storage:false,file:false})
    const {response,status}=await network.request(raw,{signal:AbortSignal.timeout(30000)})
    try {
      if(status!==200)throw new Error(`Repository returned HTTP ${status}`)
      const chunks=[];let bytes=0
      for await(const chunk of response){bytes+=chunk.length;if(bytes>max)throw new Error('Repository response is too large');chunks.push(chunk)}
      return Buffer.concat(chunks)
    }finally{response.destroy()}
  }
  async refreshRepo(id) {
    const repo=this.db.prepare('SELECT * FROM spotiflac_repositories WHERE id=?').get(id)
    if(!repo)throw new Error('Repository not found')
    try{
      const index=JSON.parse((await this.document(repo.url)).toString())
      if(index.version!==1||!Array.isArray(index.extensions)||index.extensions.length>2000)throw new Error('Invalid SpotiFLAC registry')
      const valid=e=>{try{return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(e.id || e.name || '')&&typeof e.version==='string'&&/^[a-f0-9]{64}$/i.test(e.sha256 || '')&&new URL(e.download_url).protocol==='https:'}catch{return false}}
      // Download sources must all be well formed; metadata ("integration")
      // entries are only offered as playlist-link readers, and skipped when
      // incomplete (installing one still checks it reads links).
      const entries=index.extensions.filter(e=>e.category==='download'||e.category==='integration'&&valid(e)).map(e=>{
        if(!valid(e))throw new Error('Invalid registry package entry')
        return {...e,id:e.id || e.name}
      })
      if(new Set(entries.map(e=>e.id)).size!==entries.length)throw new Error('Duplicate registry package IDs')
      this.db.prepare('UPDATE spotiflac_repositories SET index_json=?,refreshed_at=?,error=NULL WHERE id=?').run(JSON.stringify(entries),Date.now(),id)
    }catch(error){this.db.prepare('UPDATE spotiflac_repositories SET error=? WHERE id=?').run(error.message,id);throw error}
    return this.catalogue(id)
  }
  catalogue(id) {
    const repos=id?[this.db.prepare('SELECT * FROM spotiflac_repositories WHERE id=?').get(id)].filter(Boolean):this.db.prepare('SELECT * FROM spotiflac_repositories').all()
    return repos.flatMap(repo=>JSON.parse(repo.index_json || '[]').map(entry=>{const installed=this.find(keyOf(entry.id));return {...entry,repositoryId:repo.id,installed:!!installed,installedVersion:installed?.manifest.version,updateAvailable:!!installed&&compareVersions(entry.version,installed.manifest.version)>0,compatible:compareVersions(entry.min_app_version,COMPAT_VERSION)<=0}}))
  }
  removeRepo(id) {this.db.prepare('DELETE FROM spotiflac_repositories WHERE id=?').run(id);return {ok:true}}
  async locked(key, action) {
    const previous=this.locks.get(key) || Promise.resolve()
    const promise=previous.catch(()=>{}).then(action);this.locks.set(key,promise)
    try{return await promise}finally{if(this.locks.get(key)===promise)this.locks.delete(key)}
  }
  async install({repositoryId,id,url,buffer}={}) {
    let entry
    if(repositoryId){entry=this.catalogue(repositoryId).find(e=>e.id===id);if(!entry)throw new Error('Package not found in this repository');url=entry.download_url}
    if(!buffer){if(!url||!/[.]sflx$|[.]spotiflac-ext$/i.test(new URL(url).pathname))throw new Error('Choose a .sflx or .spotiflac-ext package');buffer=await this.document(url,32*1024*1024)}
    const digest=crypto.createHash('sha256').update(buffer).digest('hex')
    if(entry && digest!==entry.sha256.toLowerCase())throw new Error('Package SHA-256 does not match its repository')
    const {zip,manifest,code}=readArchive(buffer)
    if(entry&&(manifest.name!==entry.id||manifest.version!==entry.version))throw new Error('Package identity/version does not match its registry entry')
    const key=keyOf(manifest.name)
    return this.locked(key,async()=>{
      const existing=this.find(key)
      if(existing&&existing.name!==manifest.name)throw new Error('Addon identity collision')
      if(existing&&compareVersions(manifest.version,existing.manifest.version)<0)throw new Error('Cannot downgrade an installed addon')
      const staged=path.join(this.root,'staging',crypto.randomUUID()),target=path.join(this.root,'packages',key),backup=target+'.previous'
      await fsp.mkdir(staged,{recursive:true})
      let runtime
      try{
        for(const entry of zip.getEntries()){if(entry.isDirectory)continue;const file=safePath(staged,entry.entryName);await fsp.mkdir(path.dirname(file),{recursive:true});await fsp.writeFile(file,entry.getData(),{mode:0o600})}
        const candidate={key,name:manifest.name,manifest,enabled:1}
        runtime=this.createRuntime(candidate,code,{root:path.join(staged,'validation-data')})
        await runtime.ready
        if(manifest.type.includes('download_provider')&&!runtime.methods.includes('download'))throw new Error('Download provider has no registered download() method')
        if(!manifest.type.includes('download_provider')&&!runtime.methods.includes('handleUrl'))throw new Error('Playlist-link addon has no registered handleUrl() method')
        const methods=runtime.methods
        runtime.close();runtime=null
        await fsp.rm(path.join(staged,'validation-data'),{recursive:true,force:true})
        this.retire(key)
        await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.rm(backup,{recursive:true,force:true})
        if(fs.existsSync(target))await fsp.rename(target,backup)
        try{
          await fsp.rename(staged,target)
          this.db.prepare('INSERT INTO spotiflac_packages (key,name,manifest_json,repository_id,digest,enabled,installed_at,methods_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET manifest_json=excluded.manifest_json,repository_id=excluded.repository_id,digest=excluded.digest,methods_json=excluded.methods_json').run(key,manifest.name,JSON.stringify(manifest),repositoryId || null,digest,existing?.enabled ?? 1,existing?.installed_at || Date.now(),JSON.stringify(methods))
        }catch(error){await fsp.rm(target,{recursive:true,force:true});if(fs.existsSync(backup))await fsp.rename(backup,target);throw error}
        await fsp.rm(backup,{recursive:true,force:true})
        return this.publicView(this.find(key))
      }finally{runtime?.close();await fsp.rm(staged,{recursive:true,force:true})}
    })
  }
  createRuntime(addon,code,{root,grants=[],onProgress,signal}={}) {
    let network=this.networks.get(addon.key)
    if(!network){network=new ExtensionNetwork(addon.manifest.permissions);this.restoreConnection(addon.key,network);this.networks.set(addon.key,network)}
    let session
    if(addon.manifest.signedSession){const scope=hash(JSON.stringify(addon.manifest.signedSession));session=this.sessions.get(scope);if(!session){session=new SignedSession(addon.manifest.signedSession,this.storage,network,addon.key);this.sessions.set(scope,session)}}
    const host=new ExtensionHost({addon,storage:this.storage,network,session,root:root || path.join(this.root,'data',addon.key,'files'),grants,tools:this.tools(),db:this.db,onProgress,signal})
    const runtime=new ExtensionRuntime(code,{permissions:addon.manifest.permissions,signedSession:addon.manifest.signedSession,settings:this.settings(addon),rawFfmpeg:addon.manifest.capabilities?.rawFfmpeg},host)
    runtime.ready.catch(()=>{})
    return runtime
  }
  async runtime(key) {
    const addon=this.find(key)
    if(!addon||!addon.enabled)throw new Error('This addon is not installed or is turned off')
    let runtime=this.runtimes.get(key)
    if(!runtime||runtime.closed){
      const code=fs.readFileSync(path.join(this.root,'packages',key,'index.js'),'utf8')
      runtime=this.createRuntime(addon,code);this.runtimes.set(key,runtime)
      runtime.initialized = runtime.ready.then(() => runtime.invoke('initialize',[this.settings(addon)]))
    }
    await runtime.initialized
    return runtime
  }
  // A login (tokens, the cookies a verification page set) outlives restarts:
  // it's kept sealed with the addon's other credentials.
  restoreConnection(key,network) {
    let saved={};try{saved=this.storage.read(key,'connection')}catch{}
    if(saved.auth&&typeof saved.auth==='object')network.auth={...saved.auth}
    if(saved.cookies){try{network.cookies=CookieJar.deserializeSync(saved.cookies)}catch{}}
    network.persist=()=>this.saveConnection(key,network)
  }
  saveConnection(key,network,{now=false}={}) {
    clearTimeout(network.persistTimer);network.persistTimer=null
    const write=()=>{network.persistTimer=null;try{if(!this.find(key))return;const {pending,...auth}=network.auth || {};this.storage.write(key,'connection',{auth,cookies:network.cookies.serializeSync()})}catch{}}
    if(now)return write()
    network.persistTimer=setTimeout(write,250);network.persistTimer.unref?.()
  }
  forgetConnection(key) {const network=this.networks.get(key);if(network){clearTimeout(network.persistTimer);network.persistTimer=null;for(const field of Object.keys(network.auth || {}))delete network.auth[field];network.cookies=new CookieJar()}try{this.storage.write(key,'connection',{})}catch{}}
  retire(key) {const network=this.networks.get(key);if(network?.persistTimer)this.saveConnection(key,network,{now:true});this.runtimes.get(key)?.close();this.runtimes.delete(key);for(const op of this.operations.values())if(op.key===key)op.controller.abort();this.networks.delete(key);if(process.versions.electron)require('./authWindow').closeAuthWindow(key)}
  shutdown() { for(const [key,network] of this.networks)if(network.persistTimer)this.saveConnection(key,network,{now:true}); for(const key of [...this.runtimes.keys()]) this.retire(key); for(const op of this.operations.values()) op.controller.abort(); this.operations.clear() }
  async remove(key) {
    if(!/^[a-f0-9]{10}$/.test(key))throw new Error('Invalid addon key')
    return this.locked(key,async()=>{this.retire(key);this.db.prepare('DELETE FROM spotiflac_packages WHERE key=?').run(key);await fsp.rm(path.join(this.root,'packages',key),{recursive:true,force:true});await fsp.rm(path.join(this.root,'data',key),{recursive:true,force:true});return {ok:true}})
  }
  setEnabled(key,enabled){this.retire(key);this.db.prepare('UPDATE spotiflac_packages SET enabled=? WHERE key=?').run(enabled?1:0,key);return {ok:true}}
  setSettings(key,values) {
    const addon=this.find(key);if(!addon)throw new Error('Addon not found')
    const current=this.storage.read(key,'settings')
    const fields=addon.manifest.settings || []
    const assign=(schema,input,target)=>{for(const field of schema){if(field.type==='button'||!Object.hasOwn(input || {},field.key))continue;const value=input[field.key];if(field.secret&&value==='')continue;if(field.type==='boolean'&&typeof value!=='boolean'||field.type==='number'&&!Number.isFinite(Number(value))||field.type==='select'&&!(field.options || []).some(o=>(typeof o==='object'?o.value:o)===value))throw new Error(`Invalid setting: ${field.key}`);target[field.key]=field.type==='number'?Number(value):field.type==='boolean'?value:String(value??'').slice(0,8000)}}
    assign(fields,values,current)
    if(values.qualitySettings){current.qualitySettings ||= {};for(const quality of addon.manifest.qualityOptions || []){current.qualitySettings[quality.id] ||= {};assign(quality.settings || [],values.qualitySettings[quality.id],current.qualitySettings[quality.id])}}
    if(values.downloadQuality && (addon.manifest.qualityOptions || []).some(q=>q.id===values.downloadQuality))current.downloadQuality=values.downloadQuality
    this.storage.write(key,'settings',current);this.retire(key);return {ok:true}
  }
  remember(key,tracks) {
    const stmt=this.db.prepare('INSERT OR REPLACE INTO spotiflac_tracks (provider,id,metadata_json) VALUES (?,?,?)')
    for(const track of tracks)if(track?.id!=null)stmt.run(`a-${key}`,String(track.id),JSON.stringify(track))
  }
  async search(key,query,{limit=20}={}) {
    const runtime=await this.runtime(key),addon=this.find(key)
    let results
    if(addon.manifest.urlHandler?.enabled && /^(https?:|[a-z]+:)/i.test(query))results=await runtime.invoke('handleUrl',[query])
    else results=await runtime.invoke(runtime.methods.includes('searchTracks')?'searchTracks':'customSearch',runtime.methods.includes('searchTracks')?[query,limit]:[query,{limit,filter:addon.manifest.searchBehavior?.filters?.find(f=>/^(songs?|tracks?)$/.test(f.id))?.id || 'tracks'}])
    const tracks=Array.isArray(results)?results:results?.tracks || results?.album?.tracks || results?.artist?.top_tracks || (results?.track?[results.track]:[])
    const songs=tracks.filter(t=>t?.id!=null&&(t.name||t.title)&&(!t.item_type||t.item_type==='track'))
    this.remember(key,songs);return songs.slice(0,limit).map(t=>trackOf(t,`a-${key}`))
  }
  async browse(key,query,filter) {
    const runtime=await this.runtime(key),addon=this.find(key)
    const allowed=addon.manifest.searchBehavior?.filters || []
    if(!allowed.some(f=>f.id===filter))throw new Error('Unknown addon search filter')
    const result=await runtime.invoke('customSearch',[String(query).slice(0,500),{filter,limit:30}])
    return (Array.isArray(result)?result:result?.tracks || []).filter(item=>item?.id && ['album','artist','playlist'].includes(item.item_type || item.itemType)).slice(0,100).map(item=>({id:String(item.id),provider:`a-${key}`,type:item.item_type || item.itemType,title:item.name,artist:item.artists,thumbnail:item.cover_url || item.images,year:item.release_date,totalTracks:item.total_tracks}))
  }
  async album(key,id,playlist=false) {
    const runtime=await this.runtime(key),data=await runtime.invoke(playlist?'getPlaylist':'getAlbum',[id])
    if(!data)throw new Error('Addon returned no album')
    this.remember(key,data.tracks || [])
    return {provider:`a-${key}`,id:String(data.id || id),title:data.name,artist:data.artists || data.owner || '',artistId:data.artist_id,artwork_url:data.cover_url || data.images,year:Number(String(data.release_date || '').slice(0,4))||null,release_type:data.album_type || 'album',tracks:(data.tracks || []).map(t=>trackOf({...t,album_id:t.album_id || id,album_name:t.album_name || data.name,cover_url:t.cover_url || data.cover_url},`a-${key}`))}
  }
  async artist(key,id) {
    const data=await (await this.runtime(key)).invoke('getArtist',[id]);if(!data)throw new Error('Addon returned no artist')
    this.remember(key,data.top_tracks || data.tracks || [])
    return {provider:`a-${key}`,id:String(data.id || id),name:data.name,image:data.image_url,albums:(data.albums || []).map(a=>({provider:`a-${key}`,albumId:a.id,title:a.name,artist:a.artists || data.name,year:Number(String(a.release_date || '').slice(0,4))||null,release_type:a.album_type || 'album',artwork_url:a.cover_url,track_count:a.total_tracks})),tracks:(data.top_tracks || data.tracks || []).map(t=>trackOf(t,`a-${key}`))}
  }
  async invokeAction(key,action,input,token) {
    const runtime=await this.runtime(key),addon=this.find(key)
    const form=token&&this.forms.get(token)
    const declared=[...(addon.manifest.settings || []).filter(s=>s.type==='button').map(s=>s.action),...(addon.manifest.globalActions || []).map(a=>a.action)]
    if(form){if(form.key!==key||form.action!==action||form.expires<Date.now()||form.steps>=8)throw new Error('Invalid or expired addon form');this.forms.delete(token)}
    else if(!declared.includes(action) && !(action === 'completeGrant' && addon.manifest.signedSession))throw new Error('This action is not declared by the addon')
    const result=await runtime.invoke(action,input?[input]:[],{timeoutMs:Math.min(120000,Math.max(1000,Number(addon.manifest.capabilities?.actionTimeoutSeconds || 30)*1000))})
    const payload=result?.result || result || {},schema=payload.action_form || payload.byoa_form
    if(schema){if(schema.version!==1||!runtime.methods.includes(schema.submit_action)||!Array.isArray(schema.fields)||schema.fields.length>12)throw new Error('Invalid addon account form');const next=crypto.randomUUID();this.forms.set(next,{key,action:schema.submit_action,steps:(form?.steps || 0)+1,expires:Date.now()+300000});payload.formToken=next}
    return payload
  }
  async authStatus(key) {const runtime=await this.runtime(key),access=this.access(this.find(key)),session=runtime.host.session?.status();return {...session,authenticated:session?session.authenticated:access.verified,access,open_auth_url:runtime.host.session?.pending?.url || runtime.host.auth.pending?.url || ''}}
  async authCallback(key,raw) {
    const runtime=await this.runtime(key)
    if(runtime.host.session?.pending)return runtime.host.session.callback(raw,runtime.host.signal)
    const pending=runtime.host.auth.pending,url=new URL(raw)
    if(!pending||Date.now()-pending.createdAt>180000||url.searchParams.get('state')!==pending.state)throw new Error('Invalid or expired OAuth callback')
    if(pending.callback){const expected=new URL(pending.callback);if(url.protocol!==expected.protocol||url.host!==expected.host||url.pathname!==expected.pathname)throw new Error('Unexpected OAuth callback URL')}
    runtime.host.auth.code=url.searchParams.get('code') || '';runtime.host.auth.pending=null;runtime.host.network.persist?.();return {success:true}
  }
  async download(key,id,{signal,onProgress,quality,purpose='download'}={}) {
    const addon=this.find(key);if(!addon||!addon.enabled)throw new Error('Addon is not available')
    const controller=new AbortController(),opId=crypto.randomUUID(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal
    this.operations.set(opId,{key,controller})
    const staged=path.join(this.root,'work',opId);await fsp.mkdir(staged,{recursive:true})
    const runtime=this.createRuntime(addon,fs.readFileSync(path.join(this.root,'packages',key,'index.js'),'utf8'),{grants:[staged],onProgress,signal:combined})
    try{
      await runtime.ready;await runtime.invoke('initialize',[this.settings(addon)],{signal:combined})
      let track=JSON.parse(this.db.prepare('SELECT metadata_json FROM spotiflac_tracks WHERE provider=? AND id=?').get(`a-${key}`,String(id))?.metadata_json || 'null')
      if(!track&&runtime.methods.includes('getTrack'))track=await runtime.invoke('getTrack',[String(id)],{signal:combined})
      track ||= {id:String(id),name:'',artists:'',duration_ms:0,provider_id:addon.name}
      const providerName=addon.name.replace(/-web$/,'')
      const options={track,duration_ms:track.duration_ms || 0}
      const directFields={qobuz:'qobuz_id',tidal:'tidal_id',deezer:'deezer_id',soundcloud:'spotify_id',amazon:'spotify_id'}
      const directField=directFields[providerName]
      if(directField) options[directField]=String(track[directField] || (providerName === 'amazon' || providerName === 'soundcloud' ? track.id : id))
      const available=runtime.methods.includes('checkAvailability')?await runtime.invoke('checkAvailability',[track.isrc || '',track.name || '',track.artists || '',options],{signal:combined}):{available:true,track_id:String(id)}
      if(!available?.available)throw new Error(available?.reason || 'The addon cannot download this track')
      const prepared={...(available.prepared_context || available.preparedContext || {}),host_track:track}
      const chosen=quality || this.settings(addon).downloadQuality || addon.manifest.qualityOptions?.find(q=>q.kind==='lossless')?.id || addon.manifest.qualityOptions?.[0]?.id || 'default'
      const result=await runtime.invoke('download',[available.track_id || available.trackId || String(id),chosen,path.join(staged,'audio.flac'),{preparedContext:prepared,resolutionTimeoutMs:60000}],{timeoutMs:24*3600000,signal:combined})
      if(!result?.success)throw Object.assign(new Error(result?.error_message || result?.error || 'Addon download failed'),{authUrl:result?.auth_url,errorType:result?.error_type})
      let file=safePath(runtime.host.root,result.file_path || result.filePath || result.path,runtime.host.grants)
      if(!fs.statSync(file).isFile()||!fs.statSync(file).size)throw new Error('Addon produced an empty file')
      const tools=this.tools(),decryption=result.decryption || (result.decryption_key?{strategy:'ffmpeg.mov_key',key:result.decryption_key}:null)
      if(decryption){
        if(decryption.strategy!=='ffmpeg.mov_key'||! /^[a-f0-9]{32}$/i.test(decryption.key || ''))throw new Error('Unsupported audio decryption descriptor')
        const ext=result.output_extension || decryption.output_extension || '.flac'
        if(!['.flac','.m4a','.mp4','.ogg','.opus'].includes(ext))throw new Error('Invalid decrypted output container')
        const target=path.join(staged,`decrypted${ext}`)
        onProgress?.({message:'Decrypting audio…'})
        await runTool(tools.ffmpeg,['-nostdin','-y','-decryption_key',decryption.key,'-i',file,'-map','0:a:0','-c:a','copy',target],combined)
        file=target
      }
      let info=await mediaInfo(file,tools,combined)
      if(info.codec==='flac'&&!/\.flac$/i.test(file)||result.requires_container_conversion || result.requiresContainerConversion){
        const target=path.join(staged,'remuxed.flac');onProgress?.({message:'Converting audio container…'})
        await runTool(tools.ffmpeg,['-nostdin','-y','-i',file,'-map','0:a:0','-c:a',info.codec==='flac'?'copy':'flac',target],combined);file=target;info=await mediaInfo(file,tools,combined)
      }
      for(const hook of addon.manifest.postProcessing?.enabled ? addon.manifest.postProcessing.hooks || [] : []){
        const formats=hook.supportedFormats || hook.formats
        if(!hook.defaultEnabled||formats?.length&&!formats.includes(path.extname(file).slice(1)))continue
        const processed=await runtime.invoke('postProcessV2',[{path:file},track,hook.id],{timeoutMs:120000,signal:combined})
        if(!processed?.success)throw new Error(processed?.error || 'Addon post-processing failed')
        if(processed.new_file_uri || processed.newFileUri)throw new Error('Addon post-processing cannot replace destination URIs')
        if(processed.new_file_path || processed.newFilePath)file=safePath(runtime.host.root,processed.new_file_path || processed.newFilePath,runtime.host.grants)
      }
      info=await mediaInfo(file,tools,combined)
      if(track.duration_ms && Math.abs(info.duration_ms-Number(track.duration_ms))>12000)throw new Error('Downloaded audio does not match the track duration')
      if(purpose==='playback'&&!['flac','mp3','aac','opus','vorbis','pcm_s16le','pcm_s24le','pcm_f32le'].includes(info.codec)){
        const lossless=['alac','flac','wavpack','ape'].includes(info.codec),target=path.join(staged,lossless?'playable.flac':'playable.m4a')
        await runTool(tools.ffmpeg,['-nostdin','-y','-i',file,'-map','0:a:0','-c:a',lossless?'flac':'aac',...(lossless?[]:['-b:a','256k']),target],combined);file=target;info=await mediaInfo(file,tools,combined)
      }
      // The player is told the type from the file name: an addon that writes
      // MP3 or AAC into "audio.flac" (a lower quality it fell back to) gets a
      // file the player can't open. Rewrap it in the container its audio needs.
      const containers={flac:['flac'],mp3:['mp3'],aac:['m4a','mp4','aac'],alac:['m4a','mp4'],opus:['ogg','opus','webm'],vorbis:['ogg','webm'],pcm_s16le:['wav'],pcm_s24le:['wav'],pcm_f32le:['wav']}
      if(purpose==='playback'&&containers[info.codec]&&!containers[info.codec].includes(path.extname(file).slice(1).toLowerCase())){
        const target=path.join(staged,`playable-copy.${containers[info.codec][0]}`)
        await runTool(tools.ffmpeg,['-nostdin','-y','-i',file,'-map','0:a:0','-c:a','copy',target],combined);file=target;info=await mediaInfo(file,tools,combined)
      }
      combined.throwIfAborted()
      return {file,staging:staged,metadata:{...track,...result},info,cleanup:()=>fsp.rm(staged,{recursive:true,force:true})}
    }catch(error){await fsp.rm(staged,{recursive:true,force:true});throw error}
    finally{runtime.close();this.operations.delete(opId)}
  }
}
const services=new WeakMap()
function service(db,options){let instance=services.get(db);if(!instance){instance=new PackageService(db,options);services.set(db,instance)}return instance}
function shutdown(db){services.get(db)?.shutdown()}
module.exports={PackageService,service,shutdown,REGISTRY,COMPAT_VERSION,FEATURES,compareVersions,validateManifest,readArchive,trackOf,keyOf}
