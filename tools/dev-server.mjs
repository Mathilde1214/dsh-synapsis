/**
 * 开发用的小服务（不属于插件运行时，不进 npm 包）。
 *
 *   node tools/dev-server.mjs            # 默认 7788
 *
 * 它做三件事：
 *   1. 把 tools/dev-panel/ 当站点根，托管联调页；
 *   2. 把仓库里的 /client.js、/core/*、/assets/katex/* 直接端出去（改完 rebuild 刷新即可）；
 *   3. 提供图库读写 /api/library*，以及插件路由 /synapsis-api/katex/* 的等价映射。
 *
 * 生产形态里这些路由由 DSH 的 Host 半边（index.js）提供。
 */
import http from 'node:http'
import path from 'node:path'
import { promises as fs, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PANEL = path.join(HERE, 'dev-panel')
const PORT = Number(process.env.PORT || 7788)
const HOST = process.env.SYNAPSIS_HOST || '127.0.0.1'
const DATA = process.env.SYNAPSIS_DATA || 'E:\\dsh工作空间\\析域'
const NAME_RE = /^[^\u0000-\u001f\\/:*?"<>|]+\.mindmap\.json$/

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
}

function sendJson(res, code, value) {
  const body = JSON.stringify(value)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

async function sendFile(res, file) {
  try {
    const buf = await fs.readFile(file)
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      /* 联调时改完 rebuild 就刷新，别让浏览器缓存旧的 client.js */
      'cache-control': 'no-store',
    })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('not found')
  }
}

function safeName(raw) {
  const name = decodeURIComponent(String(raw || ''))
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null
  return NAME_RE.test(name) ? name : null
}

async function listMaps() {
  let names = []
  try {
    names = await fs.readdir(DATA)
  } catch {
    return []
  }
  const items = []
  for (const name of names) {
    if (!NAME_RE.test(name)) continue
    try {
      const full = path.join(DATA, name)
      const [stat, text] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf8')])
      const doc = JSON.parse(text)
      items.push({
        name,
        title: doc.title || name.replace(/\.mindmap\.json$/, ''),
        nodes: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
        mtime: stat.mtimeMs,
      })
    } catch {
      /* 坏文件跳过 */
    }
  }
  items.sort((a, b) => b.mtime - a.mtime)
  return items
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || HOST))
  const pathname = url.pathname

  /* ---- 图库 ---- */
  if (pathname === '/api/library' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, dir: DATA, items: await listMaps() })
  }
  if (pathname.startsWith('/api/library/')) {
    const name = safeName(pathname.slice('/api/library/'.length))
    if (!name) return sendJson(res, 400, { ok: false, error: 'bad name' })
    const full = path.join(DATA, name)
    if (req.method === 'GET') {
      try {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        return res.end(await fs.readFile(full, 'utf8'))
      } catch {
        return sendJson(res, 404, { ok: false, error: 'not found' })
      }
    }
    if (req.method === 'PUT') {
      const body = await readBody(req)
      let doc = null
      try {
        doc = JSON.parse(body)
      } catch {
        return sendJson(res, 400, { ok: false, error: 'bad json' })
      }
      if (!doc || !Array.isArray(doc.nodes)) return sendJson(res, 400, { ok: false, error: 'nodes required' })
      await fs.mkdir(DATA, { recursive: true })
      await fs.writeFile(full, JSON.stringify(doc, null, 2), 'utf8')
      return sendJson(res, 200, { ok: true, name, nodes: doc.nodes.length })
    }
    if (req.method === 'DELETE') {
      const trash = path.join(DATA, '.trash')
      await fs.mkdir(trash, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await fs.rename(full, path.join(trash, name + '.' + stamp))
      return sendJson(res, 200, { ok: true, name, trashed: true })
    }
  }

  /* ---- 新建空白图（联调页用；生产由 index.js 的 /create 提供） ---- */
  if (pathname === '/api/library-create' && req.method === 'POST') {
    let title = '未命名图'
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}')
      if (parsed && parsed.title) title = String(parsed.title)
    } catch {}
    const slug = title.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'map'
    let name = slug + '.mindmap.json'
    let n = 2
    while (existsSync(path.join(DATA, name))) {
      name = slug + '-' + n + '.mindmap.json'
      n += 1
    }
    const doc = {
      version: 1,
      title,
      subtitle: '',
      updated: new Date().toISOString(),
      nodes: [
        {
          id: 'root',
          title,
          parent: null,
          summary: '',
          definition: '',
          formal: '',
          intuition: '',
          examples: '',
          pitfalls: '',
          mastery: 0,
          note: '',
        },
      ],
      edges: [],
    }
    await fs.mkdir(DATA, { recursive: true })
    await fs.writeFile(path.join(DATA, name), JSON.stringify(doc, null, 2), 'utf8')
    return sendJson(res, 200, { ok: true, name, dir: DATA, data: doc })
  }

  /* ---- 插件路由的等价映射：让联调页用和生产一样的 URL ---- */
  if (pathname.startsWith('/synapsis-api/katex/')) {
    const rel = pathname.slice('/synapsis-api/katex/'.length)
    if (rel.includes('..')) return sendJson(res, 403, { ok: false })
    return sendFile(res, path.join(ROOT, 'assets', 'katex', rel))
  }
  if (pathname === '/synapsis-api/_client.js') return sendFile(res, path.join(ROOT, 'client.js'))

  /* ---- 静态 ---- */
  if (pathname === '/' || pathname === '/index.html') return sendFile(res, path.join(PANEL, 'index.html'))
  if (pathname === '/client.js') return sendFile(res, path.join(ROOT, 'client.js'))
  if (pathname.startsWith('/core/')) return sendFile(res, path.join(ROOT, pathname.slice(1)))

  /* 联调页自己的静态资源（dev.css、vendor/react*.js 之类），越界一律 403 */
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, '')
  if (rel && !rel.includes('..')) {
    const candidate = path.join(PANEL, rel)
    if (candidate.startsWith(PANEL) && existsSync(candidate)) return sendFile(res, candidate)
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
})

if (!existsSync(DATA)) console.warn('[dev] 图库目录不存在：' + DATA)
server.listen(PORT, HOST, () => {
  console.log('[dev] 联调页 http://' + HOST + ':' + PORT + '/')
  console.log('[dev] 图库 ' + DATA)
})
