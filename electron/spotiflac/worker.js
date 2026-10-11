const { parentPort, workerData } = require('worker_threads')
const { getQuickJS } = require('quickjs-emscripten')
const bootstrap = require('./bootstrap')

let vm, runtime, api, deadline = Infinity
function unwrap(result) {
  if (result.error) { const error = vm.dump(result.error); result.error.dispose(); throw new Error(error?.message || String(error)) }
  return result.value
}
function invoke(name, args) {
  const fn = vm.getProp(api, name)
  const handles = args.map(value => typeof value === 'number' ? vm.newNumber(value) : vm.newString(value))
  try { return unwrap(vm.callFunction(fn, api, ...handles)) } finally { fn.dispose(); handles.forEach(h => h.dispose()) }
}
// Only this worker blocks. The application thread remains asynchronous, including
// nested guest callbacks which can make their own independent host calls.
// One reply buffer per nesting depth, reused: a call made from a progress
// callback (inside another call) gets the next one. A fresh 32 MB buffer for
// every call (thousands during a download) is freed only once both threads
// collect it, and could exhaust the worker's memory mid-download.
const buffers = []
let depth = 0
function bridge(method, json) {
  const buffer = buffers[depth] ||= new SharedArrayBuffer(32 * 1024 * 1024 + 16)
  const state = new Int32Array(buffer, 0, 4)
  Atomics.store(state, 0, 0); Atomics.store(state, 1, 0)
  depth++
  try { return exchange(buffer, state, method, json) } finally { depth-- }
}
function exchange(buffer, state, method, json) {
  parentPort.postMessage({ type: 'host', method, json, buffer })
  for (;;) {
    while (Atomics.load(state, 0) === 0) {
      if (Date.now() > deadline) throw new Error('Extension execution timed out')
      Atomics.wait(state, 0, 0, 250)
    }
    const status = Atomics.load(state, 0)
    const text = Buffer.from(buffer, 16, Atomics.load(state, 1)).toString()
    if (status === 1) return text
    let failure = ''
    try {
      const { id, args } = JSON.parse(text)
      invoke('callback', [id, JSON.stringify(args)]).dispose()
    } catch (error) { failure = error.message }
    const bytes = Buffer.from(failure)
    new Uint8Array(buffer, 16, bytes.length).set(bytes)
    Atomics.store(state, 1, bytes.length)
    Atomics.store(state, 0, 3)
    Atomics.notify(state, 0)
    while (Atomics.load(state, 0) === 3) Atomics.wait(state, 0, 3, 250)
  }
}
async function start() {
  const engine = await getQuickJS()
  runtime = engine.newRuntime()
  runtime.setMemoryLimit(64 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  runtime.setInterruptHandler(() => Date.now() > deadline)
  vm = runtime.newContext()
  const host = vm.newFunction('host', (method, json) => vm.newString(bridge(vm.getString(method), vm.getString(json))))
  const factory = unwrap(vm.evalCode(bootstrap))
  const config = unwrap(vm.evalCode(`(${JSON.stringify(workerData.config)})`))
  api = unwrap(vm.callFunction(factory, vm.undefined, host, config))
  host.dispose(); factory.dispose(); config.dispose()
  deadline = Date.now() + 30000
  unwrap(vm.evalCode(workerData.code, 'extension.js', { type: 'global' })).dispose()
  while (runtime.hasPendingJob()) unwrap(runtime.executePendingJobs())
  const registered = invoke('registered', [])
  const valid = vm.dump(registered); registered.dispose()
  if (!valid) throw new Error('Package did not call registerExtension()')
  const methods = invoke('methods', [])
  parentPort.postMessage({ type: 'ready', methods: JSON.parse(vm.getString(methods)) })
  methods.dispose()
  parentPort.on('message', async message => {
    if (message.type !== 'invoke') return
    deadline = Date.now() + message.timeoutMs
    try {
      let value = invoke('invoke', [message.method, JSON.stringify(message.args)])
      const pending = vm.resolvePromise(value)
      while (runtime.hasPendingJob()) unwrap(runtime.executePendingJobs())
      const resolved = await pending
      value.dispose(); value = unwrap(resolved)
      const json = vm.getString(value); value.dispose()
      parentPort.postMessage({ type: 'result', id: message.id, value: JSON.parse(json || 'null') })
    } catch (error) {
      parentPort.postMessage({ type: 'result', id: message.id, error: error.message })
    } finally { deadline = Infinity }
  })
}
start().catch(error => { parentPort.postMessage({ type: 'fatal', error: error.message }); process.exitCode = 1 })
