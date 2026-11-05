/* 用 CDP 驱动 headless Edge 截图（比 --screenshot 更可控：可等真实时间、可执行 JS、可读控制台）。
 * 用法：
 *   node tools/shot.mjs --url "http://127.0.0.1:7788/?demo=1" --out shots/demo.png --wait 15000
 *   可选 --eval "表达式"（结果打印出来）、--w 1680 --h 1000
 * 前置：Edge 以 --headless=new --remote-debugging-port=9222 启动。
 */
import fs from 'node:fs'
import path from 'node:path'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'])
    return acc
  }, []),
)

const PORT = Number(args.port || 9222)
const URL_ = args.url || 'about:blank'
const OUT = args.out || 'shots/shot.png'
const WAIT = Number(args.wait || 3000)
const W = Number(args.w || 1680)
const H = Number(args.h || 1000)

const version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json()
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

let seq = 0
const pending = new Map()
const logs = []
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text))
  }
}

function send(method, params = {}, sessionId) {
  const id = ++seq
  const payload = { id, method, params }
  if (sessionId) payload.sessionId = sessionId
  ws.send(JSON.stringify(payload))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId)
await send('Page.navigate', { url: URL_ }, sessionId)
await new Promise((r) => setTimeout(r, WAIT))

let evalResult = null
const evalSrc = args.evalfile ? fs.readFileSync(args.evalfile, 'utf8') : args.eval
if (evalSrc) {
  const r = await send('Runtime.evaluate', { expression: evalSrc, returnByValue: true, awaitPromise: true }, sessionId)
  evalResult = r.result?.value ?? r.result?.description ?? null
}

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))

await send('Target.closeTarget', { targetId })
ws.close()

console.log('saved', OUT, fs.statSync(OUT).size + 'B')
if (evalResult !== null) console.log('eval:', typeof evalResult === 'string' ? evalResult : JSON.stringify(evalResult))
if (logs.length) console.log('console:\n' + logs.join('\n'))
process.exit(0)
