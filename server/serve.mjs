import http from 'node:http'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const WEB = path.join(ROOT, 'web')
const CORE = path.join(ROOT, 'core')
const DATA = process.env.SYNAPSIS_DATA || 'E:\\dsh工作空间\\析域'
const PORT = Number(process.env.PORT || 7788)
const HOST = process.env.SYNAPSIS_HOST || '127.0.0.1'

const NAME_RE = /^[^\u0000-\u001f\\/:*?"<>|]+\.mindmap\.json$/
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function send(res, code, body, headers) {
  const h = Object.assign({ 'cache-control': 'no-store' }, headers || {})
  res.writeHead(code, h)
  res.end(body)
}

function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' })
}

async function readBody(req, limit = 32 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function safeName(raw) {
  const name = String(raw || '').trim()
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null
  return NAME_RE.test(name) ? name : null
}

function inside(root, candidate) {
  const rel = path.relative(root, candidate)
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
}

async function serveStatic(res, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  let base = WEB
  let rel = clean
  if (clean.startsWith('/core/')) {
    base = CORE
    rel = clean.slice('/core'.length)
  }
  /* 开发用：把插件自带的 KaTeX 资源也吐出来，好在 dev-panel.html 里跑真插件面板 */
  if (clean.startsWith('/synapsis-api/katex/')) {
    base = path.join(ROOT, 'plugin', 'assets', 'katex')
    rel = clean.slice('/synapsis-api/katex'.length)
  }
  /* 开发用：直接读插件产物，避免再拷一份副本 */
  if (clean === '/synapsis-api/_client.js') {
    base = path.join(ROOT, 'plugin')
    rel = '/client.js'
  }
  const target = path.resolve(base, '.' + rel)
  if (!inside(base, target) && target !== base) return send(res, 403, 'forbidden')
  let full = target
  try {
    const st = await fs.stat(full)
    if (st.isDirectory()) full = path.join(full, 'index.html')
  } catch {
    if (clean === '/' || clean === '') full = path.join(WEB, 'index.html')
    else return send(res, 404, 'not found')
  }
  try {
    const buf = await fs.readFile(full)
    send(res, 200, buf, { 'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' })
  } catch {
    send(res, 404, 'not found')
  }
}

async function listLibrary() {
  await fs.mkdir(DATA, { recursive: true })
  const entries = await fs.readdir(DATA, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (!entry.isFile() || !NAME_RE.test(entry.name)) continue
    const full = path.join(DATA, entry.name)
    try {
      const st = await fs.stat(full)
      let title = entry.name.replace(/\.mindmap\.json$/, '')
      let count = 0
      try {
        const parsed = JSON.parse(await fs.readFile(full, 'utf8'))
        if (parsed.title) title = parsed.title
        if (Array.isArray(parsed.nodes)) count = parsed.nodes.length
      } catch {}
      out.push({ name: entry.name, title, nodes: count, mtime: st.mtimeMs })
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

async function handleLLM(req, res, wantStream) {
  let body
  try {
    body = JSON.parse(await readBody(req))
  } catch (err) {
    return sendJSON(res, 400, { ok: false, error: 'bad json: ' + err.message })
  }
  const baseURL = String(body.baseURL || 'https://api.deepseek.com/v1').replace(/\/+$/, '')
  const apiKey = String(body.apiKey || '')
  const model = String(body.model || 'deepseek-chat')
  if (!/^https?:\/\//i.test(baseURL)) return sendJSON(res, 400, { ok: false, error: 'baseURL must be http(s)' })
  if (!apiKey) return sendJSON(res, 400, { ok: false, error: 'missing apiKey' })

  const payload = {
    model,
    messages: body.messages || [],
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.3,
    stream: !!wantStream,
  }
  if (body.max_tokens) payload.max_tokens = body.max_tokens
  if (body.response_format) payload.response_format = body.response_format

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 240000)
  try {
    const upstream = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (wantStream) {
      if (!upstream.ok) {
        const detail = await upstream.text()
        return sendJSON(res, 502, { ok: false, error: 'upstream ' + upstream.status + ': ' + detail.slice(0, 500) })
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      res.on('close', () => controller.abort())
      for await (const chunk of upstream.body) {
        if (res.writableEnded) break
        res.write(chunk)
      }
      res.end()
      return
    }
    const text = await upstream.text()
    if (!upstream.ok) {
      return sendJSON(res, 502, { ok: false, error: 'upstream ' + upstream.status + ': ' + text.slice(0, 500) })
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return sendJSON(res, 502, { ok: false, error: 'upstream returned non-json' })
    }
    const choice = parsed.choices && parsed.choices[0]
    const content = choice && choice.message ? choice.message.content : ''
    return sendJSON(res, 200, { ok: true, content, usage: parsed.usage || null, model: parsed.model || model })
  } catch (err) {
    const message = err.name === 'AbortError' ? '模型响应超时（4 分钟）' : err.message
    return sendJSON(res, 502, { ok: false, error: message })
  } finally {
    clearTimeout(timer)
  }
}

async function route(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const p = url.pathname

  if (p === '/api/health') return sendJSON(res, 200, { ok: true, data: DATA })
  if (p === '/api/library' && req.method === 'GET') {
    try {
      return sendJSON(res, 200, { ok: true, dir: DATA, items: await listLibrary() })
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message })
    }
  }
  if (p.startsWith('/api/library/')) {
    const name = safeName(decodeURIComponent(p.slice('/api/library/'.length)))
    if (!name) return sendJSON(res, 400, { ok: false, error: 'bad name' })
    const full = path.join(DATA, name)
    if (req.method === 'GET') {
      try {
        const text = await fs.readFile(full, 'utf8')
        return send(res, 200, text, { 'content-type': 'application/json; charset=utf-8' })
      } catch {
        return sendJSON(res, 404, { ok: false, error: 'not found' })
      }
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const text = await readBody(req)
        const parsed = JSON.parse(text)
        if (!parsed || !Array.isArray(parsed.nodes)) return sendJSON(res, 400, { ok: false, error: 'bad mindmap' })
        await fs.mkdir(DATA, { recursive: true })
        const tmp = full + '.tmp'
        await fs.writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8')
        await fs.rename(tmp, full)
        const st = await fs.stat(full)
        return sendJSON(res, 200, { ok: true, name, mtime: st.mtimeMs })
      } catch (err) {
        return sendJSON(res, 500, { ok: false, error: err.message })
      }
    }
    if (req.method === 'DELETE') {
      try {
        await fs.unlink(full)
        return sendJSON(res, 200, { ok: true })
      } catch {
        return sendJSON(res, 404, { ok: false, error: 'not found' })
      }
    }
    return sendJSON(res, 405, { ok: false, error: 'method not allowed' })
  }
  if (p === '/api/llm' && req.method === 'POST') return handleLLM(req, res, url.searchParams.get('stream') === '1')

  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, p)
  return send(res, 405, 'method not allowed')
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    try {
      sendJSON(res, 500, { ok: false, error: err && err.message ? err.message : String(err) })
    } catch {}
  })
})

server.listen(PORT, HOST, () => {
  console.log('[synapsis] http://' + HOST + ':' + PORT + '  data=' + DATA)
})
