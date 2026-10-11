const { Worker } = require('worker_threads')
const path = require('path')

class ExtensionRuntime {
  constructor(code, config, host) {
    this.host = host
    this.pending = new Map()
    this.nextId = 0
    this.queue = Promise.resolve()
    this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { code, config }, resourceLimits: { maxOldGenerationSizeMb: config.heapMb || 128 } })
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject })
    this.startTimer = setTimeout(() => this.close(new Error('Extension loading timed out')), 30000)
    this.worker.on('message', message => {
      if (message.type === 'host') { this.handleHost(message); return }
      if (message.type === 'ready') { clearTimeout(this.startTimer); this.methods = message.methods; this.readyResolve(this); this.worker.unref(); return }
      if (message.type === 'fatal') { this.close(new Error(message.error)); return }
      const pending = this.pending.get(message.id)
      if (!pending) return
      if (message.error && /interrupt|timed out/i.test(message.error)) { this.close(new Error(message.error)); return }
      this.pending.delete(message.id); clearTimeout(pending.timer)
      if (!this.pending.size) this.worker.unref()
      message.error ? pending.reject(new Error(message.error)) : pending.resolve(message.value)
    })
    this.worker.on('error', error => this.close(error))
    this.worker.on('exit', code => { if (!this.closed) this.close(new Error(`Extension worker exited (${code})`)) })
  }

  async handleHost({ method, json, buffer }) {
    const state = new Int32Array(buffer, 0, 4)
    const write = (value, status) => {
      let bytes = Buffer.from(JSON.stringify(value))
      if (bytes.length > buffer.byteLength - 16) bytes = Buffer.from(JSON.stringify({ failure: 'Host response exceeds the runtime limit' }))
      new Uint8Array(buffer, 16, bytes.length).set(bytes)
      Atomics.store(state, 1, bytes.length); Atomics.store(state, 0, status); Atomics.notify(state, 0)
    }
    const callback = async (descriptor, args, strict = false) => {
      if (!descriptor?.__callback || this.closed) return
      // There is only one writer per call. The worker acknowledges callbacks
      // before the broker publishes another progress event or the final reply.
      write({ id: descriptor.__callback, args }, 2)
      while (Atomics.load(state, 0) !== 3) {
        if (this.closed) throw new Error('Extension operation cancelled')
        await Atomics.waitAsync(state, 0, 2, 250).value
      }
      const error = Buffer.from(buffer, 16, Atomics.load(state, 1)).toString()
      Atomics.store(state, 0, 0); Atomics.notify(state, 0)
      if (strict && error) throw new Error(error)
    }
    try { write({ value: await this.host.call(method, JSON.parse(json), callback) }, 1) }
    catch (error) { write({ failure: error.message }, 1) }
  }

  invoke(method, args = [], { timeoutMs = 30000, signal } = {}) {
    const run = async () => {
      await this.ready
      if (this.closed || signal?.aborted) throw new Error('Extension operation cancelled')
      const abort = () => this.close(new Error('Extension operation cancelled'))
      signal?.addEventListener('abort', abort, { once: true })
      try {
        return await new Promise((resolve, reject) => {
          const id = ++this.nextId
          const timer = setTimeout(() => this.close(new Error('Extension execution timed out')), timeoutMs + 100)
          this.pending.set(id, { resolve, reject, timer })
          this.worker.ref()
          this.worker.postMessage({ type: 'invoke', id, method, args, timeoutMs })
        })
      } finally { signal?.removeEventListener('abort', abort) }
    }
    const promise = this.queue.then(run)
    this.queue = promise.catch(() => {})
    return promise
  }

  close(error = new Error('Extension runtime closed')) {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.startTimer)
    this.readyReject(error)
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.host.abort?.()
    this.worker.terminate().catch(() => {})
  }
}

module.exports = { ExtensionRuntime }
