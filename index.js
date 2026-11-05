import path from 'node:path'
import os from 'node:os'
import fsSync, { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-synapsis'
export const inject = ['webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KATEX_DIR = path.join(HERE, 'assets', 'katex')
const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

/* 数据目录：按下面的顺序取第一个可用的
   1. SYNAPSIS_DATA 环境变量（绝对路径）
   2. 0.13 之前写死的旧默认目录（只在本机存在时才用，老用户不用搬数据）
   3. <用户主目录>/Synapsis（跨平台，Mac 是 /Users/xxx/Synapsis，Linux 是 /home/xxx/Synapsis） */
const LEGACY_HOME = 'E:\\dsh工作空间\\析域'

function resolveHome() {
  const fromEnv = String(process.env.SYNAPSIS_DATA || '').trim()
  if (fromEnv) return path.resolve(fromEnv)
  try {
    if (fsSync.statSync(LEGACY_HOME).isDirectory()) return LEGACY_HOME
  } catch {}
  return path.join(os.homedir(), 'Synapsis')
}

const HOME = resolveHome()
const NAME_RE = /^[^\u0000-\u001f\\/:*?"<>|]+\.mindmap\.json$/

function safeName(raw) {
  const name = String(raw || '').trim()
  if (!NAME_RE.test(name)) return null
  if (name.includes('..')) return null
  return name
}

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(obj))
}

async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('payload too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function listMaps() {
  await fs.mkdir(HOME, { recursive: true })
  const entries = await fs.readdir(HOME, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (!entry.isFile() || !NAME_RE.test(entry.name)) continue
    const full = path.join(HOME, entry.name)
    try {
      const stat = await fs.stat(full)
      let title = entry.name.replace(/\.mindmap\.json$/, '')
      let count = 0
      try {
        const parsed = JSON.parse(await fs.readFile(full, 'utf8'))
        if (parsed.title) title = parsed.title
        if (Array.isArray(parsed.nodes)) count = parsed.nodes.length
      } catch {}
      out.push({ name: entry.name, title, nodes: count, mtime: stat.mtimeMs })
    } catch {}
  }
  out.sort((a, b) => a.mtime - b.mtime)
  return out
}

async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  const sub = url.pathname.replace(/^\/synapsis-api/, '')

  if (sub === '/list' && req.method === 'GET') {
    try {
      return sendJSON(res, 200, { ok: true, dir: HOME, items: await listMaps() })
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message })
    }
  }

  if (sub === '/load' && req.method === 'GET') {
    const name = safeName(url.searchParams.get('name'))
    if (!name) return sendJSON(res, 400, { ok: false, error: 'bad name' })
    try {
      const text = await fs.readFile(path.join(HOME, name), 'utf8')
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(text)
    } catch {
      return sendJSON(res, 404, { ok: false, error: 'not found' })
    }
  }

  if (sub === '/save' && (req.method === 'POST' || req.method === 'PUT')) {
    try {
      const body = JSON.parse(await readBody(req))
      const name = safeName(body && body.name)
      if (!name) return sendJSON(res, 400, { ok: false, error: 'bad name' })
      if (!body.data || !Array.isArray(body.data.nodes)) return sendJSON(res, 400, { ok: false, error: 'bad data' })
      await fs.mkdir(HOME, { recursive: true })
      const full = path.join(HOME, name)
      try {
        await fs.copyFile(full, full + '.bak')
      } catch {}
      const tmp = full + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(body.data, null, 2), 'utf8')
      await fs.rename(tmp, full)
      const stat = await fs.stat(full)
      return sendJSON(res, 200, { ok: true, name, mtime: stat.mtimeMs })
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message })
    }
  }

  /* 删掉整份图：不直接 unlink，先挪到 <库>/.trash/ 里，误删还能捞回来 */
  if (sub === '/delete' && (req.method === 'POST' || req.method === 'DELETE')) {
    try {
      const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {}
      const name = safeName((body && body.name) || url.searchParams.get('name'))
      if (!name) return sendJSON(res, 400, { ok: false, error: 'bad name' })
      const trash = path.join(HOME, '.trash')
      await fs.mkdir(trash, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await fs.rename(path.join(HOME, name), path.join(trash, name + '.' + stamp))
      return sendJSON(res, 200, { ok: true, name, trashed: true })
    } catch (err) {
      return sendJSON(res, 500, { ok: false, error: err.message })
    }
  }

  /* 公式资源：插件自带一份 KaTeX（含字体），从自己的路由出，不依赖宿主模块表 */
  if (sub.startsWith('/katex/') && req.method === 'GET') {
    const rel = sub.slice('/katex/'.length)
    const file = path.join(KATEX_DIR, rel)
    if (rel.includes('..') || !file.startsWith(KATEX_DIR + path.sep)) {
      return sendJSON(res, 403, { ok: false, error: 'forbidden' })
    }
    try {
      const buf = await fs.readFile(file)
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'public, max-age=86400',
      })
      return res.end(buf)
    } catch {
      return sendJSON(res, 404, { ok: false, error: 'not found' })
    }
  }

  return sendJSON(res, 404, { ok: false, error: 'not found' })
}

export function apply(ctx) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: '/synapsis-api',
      handler: (req, res) => {
        handler(req, res).catch((err) => {
          try {
            sendJSON(res, 500, { ok: false, error: err && err.message ? err.message : String(err) })
          } catch {}
        })
      },
    }),
  )
}
