const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { Readable } = require('stream')
const { service } = require('./packages')

const jobs = new WeakMap()
const MIME = { flac:'audio/flac',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'audio/mp4',ogg:'audio/ogg',opus:'audio/ogg',wav:'audio/wav',webm:'audio/webm',aac:'audio/aac' }
const redact=text=>String(text||'').replace(/(hmac|token|signature|sig|key|secret|grant|code)=([^&\s"]+)/gi,'$1=…').replace(/qbza_[\w-]+/g,'qbza_…').slice(0,500)
function logFailure(db,key,id,error){
  try{
    const name=service(db).find(key)?.manifest?.displayName || key
    const line=`[SpotiFLAC] ${name}: couldn't prepare ${String(id).slice(0,80)} for playback: ${redact(error?.message)}${error?.errorType?` (${error.errorType})`:''}`
    try{require('electron-log').warn(line)}catch{console.warn(line)}
  }catch{}
}
function state(db) {let value=jobs.get(db);if(!value){value=new Map();jobs.set(db,value)}return value}
function cacheKey(db,key,id){const addon=service(db).find(key);if(!addon?.enabled)throw new Error('Addon is not available');return crypto.createHash('sha256').update(JSON.stringify([key,id,addon.digest,service(db).settings(addon).downloadQuality])).digest('hex')}
function cached(db,key,id){
  const hash=cacheKey(db,key,id),dir=path.join(service(db).root,'audio-cache')
  for(const ext of Object.keys(MIME)){const file=path.join(dir,`${hash}.${ext}`);try{if(fs.statSync(file).size){const now=new Date();fs.utimesSync(file,now,now);return {type:'file',file,mime:MIME[ext],headers:{},format:ext}}}catch{}}
  return null
}
function prepare(db,key,id,{force=false}={}){
  if(!force){const hit=cached(db,key,id);if(hit)return {ok:true}}
  const map=state(db),hash=cacheKey(db,key,id)
  const existing=[...map.values()].find(job=>job.hash===hash&&job.status==='running')
  if(existing)return {pending:true,operationId:existing.id}
  const job={id:crypto.randomUUID(),hash,key,itemId:id,status:'running',progress:0,controller:new AbortController()};map.set(job.id,job)
  const fetchAudio=()=>service(db).download(key,id,{purpose:'playback',signal:job.controller.signal,onProgress:update=>{job.progress=update.percent ?? job.progress;job.message=update.message || 'Preparing audio…'}})
  // A worker that ran out of memory is retried once, in a fresh worker.
  job.promise=fetchAudio().catch(error=>{if(job.controller.signal.aborted||!/memory limit|out of memory/i.test(error?.message))throw error;logFailure(db,key,id,error);job.message='Retrying…';return fetchAudio()}).then(async result=>{
    try{
      const dir=path.join(service(db).root,'audio-cache');await fsp.mkdir(dir,{recursive:true})
      const ext=path.extname(result.file).slice(1).toLowerCase()
      if(!MIME[ext])throw new Error('Unsupported cached audio container')
      const file=path.join(dir,`${hash}.${ext}`)
      job.controller.signal.throwIfAborted()
      await fsp.copyFile(result.file,`${file}.tmp`);job.controller.signal.throwIfAborted();await fsp.rename(`${file}.tmp`,file)
      job.status='done';job.progress=100;job.result={type:'file',file,mime:MIME[ext],headers:{},format:ext}
      // The cache joins Lokal's shared limit; installed code and credentials do not.
      require('../cache').trim({keep:[file]})
    }finally{await result.cleanup()}
  }).catch(error=>{
    job.status=job.controller.signal.aborted?'cancelled':'error';job.error=error.message
    // Kept in Lokal's log: without it a song that won't stream says nothing about why.
    if(job.status==='error')logFailure(db,key,id,error)
  }).finally(()=>{
    job.finishedAt=Date.now();const timer=setTimeout(()=>map.delete(job.id),5*60*1000);timer.unref?.()
  })
  return {pending:true,operationId:job.id}
}
function operation(db,id,cancel=false){
  const job=state(db).get(id)
  if(!job)return {error:'Audio preparation operation not found'}
  if(cancel)job.controller.abort()
  return {id:job.id,status:job.status,progress:job.progress,message:job.message,error:job.error,ok:job.status==='done'}
}
async function resolve(db,key,id,{signal,force=false}={}){
  const hit=!force&&cached(db,key,id);if(hit)return hit
  const started=prepare(db,key,id,{force});if(started.ok)return cached(db,key,id)
  const job=state(db).get(started.operationId)
  const abort=()=>job.controller.abort();signal?.addEventListener('abort',abort,{once:true})
  try{await job.promise;if(job.status!=='done')throw new Error(job.error || 'Audio preparation cancelled');return job.result}finally{signal?.removeEventListener('abort',abort)}
}
function rangeOf(value,size){
  if(!value)return {start:0,end:size-1,status:200}
  const match=String(value).match(/^bytes=(\d*)-(\d*)$/)
  if(!match||!match[1]&&!match[2]||!size)return null
  const start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2])),end=match[1]?(match[2]?Math.min(size-1,Number(match[2])):size-1):size-1
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&start<size&&end>=start?{start,end,status:206}:null
}
async function fileResponse(file,{range,signal,mime='audio/*'}={}){
  const handle=await fsp.open(file,'r'),size=(await handle.stat()).size,slice=rangeOf(range,size)
  const headers={'content-type':mime,'accept-ranges':'bytes'}
  if(!slice){await handle.close();return new Response(null,{status:416,headers:{...headers,'content-range':`bytes */${size}`}})}
  headers['content-length']=String(slice.end-slice.start+1)
  if(slice.status===206)headers['content-range']=`bytes ${slice.start}-${slice.end}/${size}`
  const body=handle.createReadStream({start:slice.start,end:slice.end,autoClose:true,signal})
  return new Response(Readable.toWeb(body),{status:slice.status,headers})
}
module.exports={prepare,operation,resolve,cached,fileResponse,rangeOf}
