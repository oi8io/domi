/**
 * 沙箱里跑的那段脚本 —— docs/adr/023
 *
 * 写成字符串：单二进制里没有可读的源码目录，启动时把它写进 ~/.domi/plugins/.runtime/runner.mjs 再绑进沙箱。
 * 它只做三件事：读宿主发来的 start、把 ctx（全部经宿主代理）交给插件、把结果写回去。
 * stdout 是协议通道：插件的 console.log 改道到 stderr，免得搅乱协议。
 */
export const RUNNER_SOURCE = `// domi plugin runner (generated)
const out = process.stdout
const send = (msg) => out.write(JSON.stringify(msg) + '\\n')
console.log = (...a) => process.stderr.write(a.map(String).join(' ') + '\\n')
console.info = console.log

const pending = new Map()
let nextId = 1
let started = null
let buf = ''

function call(op, params) {
  const id = nextId++
  send({ t: 'call', id, op, params })
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

function onLine(line) {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (msg.t === 'start') {
    started = msg
    run(msg)
    return
  }
  if (msg.t === 'reply') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.value)
    else p.reject(new Error(msg.error))
  }
}

async function run(start) {
  const ctx = {
    cwd: start.cwd,
    readFile: (path) => call('readFile', { path }),
    writeFile: (path, content) => call('writeFile', { path, content: String(content) }),
    fetch: (url, init = {}) => call('fetch', { url: String(url), method: init.method, headers: init.headers, body: init.body }),
    log: (message) => call('log', { message: String(message) }),
  }
  try {
    const mod = await import(start.entry)
    const impl = mod.default ?? mod
    if (!impl || typeof impl.execute !== 'function') throw new Error('入口模块没有 default export 的 execute(args, ctx)')
    const payload = await impl.execute(start.args, ctx)
    send({ t: 'result', ok: true, payload: payload === undefined ? null : payload })
  } catch (e) {
    send({ t: 'result', ok: false, error: e && e.message ? e.message : String(e) })
  }
  process.exit(0)
}

for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk)
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, i)
    buf = buf.slice(i + 1)
    try { onLine(line) } catch (e) { send({ t: 'result', ok: false, error: 'runner 读不懂宿主消息：' + e.message }); process.exit(1) }
  }
}
if (!started) process.exit(1)
`
