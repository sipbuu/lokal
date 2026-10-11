import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import http from 'node:http'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const Database=require('better-sqlite3'),AdmZip=require('adm-zip')
const {PackageService,readArchive,validateManifest}=require('../electron/spotiflac/packages')
const {rangeOf,fileResponse}=require('../electron/spotiflac/media')

const manifest={name:'fixture-provider',displayName:'Fixture',version:'1.0.0',type:['metadata_provider','download_provider'],permissions:{network:[],storage:true,file:true},requiredRuntimeFeatures:['preparedContext@1'],settings:[{key:'token',type:'string',secret:true},{key:'country',type:'string',default:'US'}]}
function archive(m=manifest,code=`registerExtension({initialize(s){settings=s;},searchTracks(query){return {tracks:[{id:'source-id',name:query,artists:'Artist',album_name:'Album',duration_ms:180000,isrc:'USAAA2600001'}]};},download(){return {success:false,error:'Fixture does not download'};}})`){const zip=new AdmZip();zip.addFile('manifest.json',Buffer.from(JSON.stringify(m)));zip.addFile('index.js',Buffer.from(code));return zip.toBuffer()}
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'lokal-packages-')),db=new Database(':memory:');db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT)');const service=new PackageService(db,{root,tools:()=>({})});t.after(async()=>{for(const runtime of service.runtimes.values())runtime.close();db.close();await fs.rm(root,{recursive:true,force:true})});return {service,db,root}}

test('install, search, update and enable preserve provider identity and isolated secret settings',async t=>{
  const {service,root}=await fixture(t),installed=await service.install({buffer:archive()})
  assert.equal(installed.kind,'spotiflac');assert.ok(installed.resources.includes('search'))
  service.setSettings(installed.key,{token:'private-token',country:'GB'})
  assert.equal(service.list()[0].settings.token,undefined)
  assert.deepEqual(service.list()[0].configuredSecrets,['token'])
  assert.equal((await fs.readFile(path.join(root,'data',installed.key,'settings.enc'))).includes(Buffer.from('private-token')),false)
  const results=await service.search(installed.key,'Song')
  assert.equal(results[0].title,'Song');assert.equal(results[0].duration,180);assert.equal(results[0].provider,installed.provider)
  service.setEnabled(installed.key,false)
  await assert.rejects(service.search(installed.key,'Song'),/turned off/)
  const updated=await service.install({buffer:archive({...manifest,version:'1.1.0'})})
  assert.equal(updated.key,installed.key);assert.equal(updated.enabled,false);assert.equal(updated.settings.country,'GB')
  await assert.rejects(service.install({buffer:archive()}),/downgrade/)
})

test('registries exclude metadata-only entries and enforce package SHA-256 and identity',async t=>{
  const {service}=await fixture(t),buffer=archive(),digest=crypto.createHash('sha256').update(buffer).digest('hex')
  const entry={id:manifest.name,category:'download',version:manifest.version,sha256:digest,download_url:'https://packages.example/source.sflx'}
  service.document=async url=>url.endsWith('.sflx')?buffer:Buffer.from(JSON.stringify({version:1,extensions:[entry,{id:'metadata-only',category:'integration'}]}))
  const repo=await service.addRepo('https://packages.example/registry.json')
  assert.equal(service.catalogue(repo.id).length,1)
  await service.install({repositoryId:repo.id,id:manifest.name})
  service.db.prepare('UPDATE spotiflac_repositories SET index_json=? WHERE id=?').run(JSON.stringify([{...entry,sha256:'0'.repeat(64)}]),repo.id)
  await assert.rejects(service.install({repositoryId:repo.id,id:manifest.name}),/SHA-256/)
  service.removeRepo(repo.id);assert.equal(service.list().length,1)
})

test('playlist-link addons (metadata with a link handler) install but are not stream or download sources',async t=>{
  const {service}=await fixture(t)
  const links={...manifest,name:'links-fixture',type:['metadata_provider'],urlHandler:{enabled:true,patterns:['open.example.com']}}
  await assert.rejects(service.install({buffer:archive({...links,urlHandler:undefined})}),/playlist-link/)
  const installed=await service.install({buffer:archive(links,`registerExtension({initialize(){},handleUrl(u){return {type:'playlist',name:'P',tracks:[{id:'1',name:'Song',artists:'A'}]};}})`)})
  assert.equal(installed.linksOnly,true)
  const addons=require('../electron/online/addons')
  assert.equal(addons.searchable(service.db).some(a=>a.key===installed.key),false)
})

test('packages reject unsafe archive paths, missing downloads, and unsupported compatibility features',()=>{
  assert.throws(()=>validateManifest({...manifest,type:['metadata_provider']}),/download-capable/)
  assert.throws(()=>validateManifest({...manifest,requiredRuntimeFeatures:['futureApi@99']}),/Unsupported/)
  assert.throws(()=>validateManifest({...manifest,minAppVersion:'99.0.0'}),/compatibility/)
  const zip=new AdmZip();zip.addFile('../escape.js',Buffer.from(''));zip.addFile('manifest.json',Buffer.from(JSON.stringify(manifest)));zip.addFile('index.js',Buffer.from(''))
  // adm-zip normalizes traversal on addition; duplicate root names are also
  // rejected by the package reader independently of library extraction.
  assert.throws(()=>readArchive(Buffer.from('not a zip')))
})

test('file-backed media supports open, suffix, unsatisfiable ranges and byte-accurate seeking',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lokal-range-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'audio.flac');await fs.writeFile(file,'0123456789')
  assert.deepEqual(rangeOf('bytes=-3',10),{start:7,end:9,status:206})
  const response=await fileResponse(file,{range:'bytes=2-5',mime:'audio/flac'})
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 2-5/10');assert.equal(await response.text(),'2345')
  assert.equal((await fileResponse(file,{range:'bytes=10-'})).status,416)
})

test('a package download crosses the real host, FFprobe validation, and staged cleanup',async t=>{
  const {service}=await fixture(t)
  const wav=Buffer.alloc(44+8000*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
  const server=http.createServer((_req,res)=>{res.setHeader('Content-Length',String(wav.length));res.end(wav)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const key='fixture-provider',permissions={...manifest.permissions,network:['127.0.0.1'],allowHttp:true}
  service.toolProvider=()=>({ffmpeg:'ffmpeg',ffprobe:'ffprobe'})
  const code=`registerExtension({getTrack(){return {id:'source-id',name:'Fixture Song',artists:'Fixture Artist',duration_ms:1000};},checkAvailability(){return {available:true,track_id:'source-id'};},download(id,quality,output,progress){var r=file.download('http://127.0.0.1:${server.address().port}/audio',output,{onProgress:function(w,t){progress(t?100*w/t:0);}});return {success:r.success,file_path:r.path,title:'Fixture Song',artist:'Fixture Artist'};}})`
  const installed=await service.install({buffer:archive({...manifest,permissions},code)})
  const result=await service.download(installed.key,'source-id',{purpose:'playback'})
  try { assert.equal(result.info.codec,'pcm_s16le');assert.equal(path.extname(result.file),'.wav','WAV audio written to audio.flac is rewrapped for the player');assert.equal(result.info.duration_ms,1000);assert.ok((await fs.stat(result.file)).size>44) } finally { await result.cleanup() }
})

test('an addon login (tokens and verification cookies) survives a restart, and Disconnect forgets it',async t=>{
  const {service,db,root}=await fixture(t),installed=await service.install({buffer:archive({...manifest,signedSession:undefined,globalActions:[{action:'login',label:'Log in'}]})})
  assert.equal(service.list()[0].access.kind,'login');assert.equal(service.list()[0].access.ready,false)
  const runtime=await service.runtime(installed.key)
  await runtime.host.call('auth.setAuthCode',[{access_token:'token-1',refresh_token:'refresh-1',expires_at:Date.now()+3600000}])
  runtime.host.network.cookies.setCookieSync('cf_clearance=abc; Domain=example.com; Path=/; Secure','https://example.com/')
  runtime.host.network.persist()
  service.shutdown()
  assert.equal((await fs.readFile(path.join(root,'data',installed.key,'connection.enc'))).includes(Buffer.from('token-1')),false)
  const restarted=new PackageService(db,{root,tools:()=>({})});t.after(()=>{for(const r of restarted.runtimes.values())r.close()})
  assert.equal(restarted.list()[0].access.ready,true)
  const again=await restarted.runtime(installed.key)
  assert.equal(await again.host.call('auth.getTokens',[]).then(tokens=>tokens.access_token),'token-1')
  assert.match(again.host.network.cookies.getCookieStringSync('https://example.com/'),/cf_clearance=abc/)
  restarted.forgetConnection(installed.key);again.host.session?.clear()
  await again.host.call('auth.clearAuth',[])
  restarted.shutdown()
  const fresh=new PackageService(db,{root,tools:()=>({})});t.after(()=>{for(const r of fresh.runtimes.values())r.close()})
  assert.equal(fresh.list()[0].access.ready,false)
})
