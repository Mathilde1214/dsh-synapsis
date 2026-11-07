import path from 'node:path'
import { promises as fs } from 'node:fs'
import { assertDoc } from './validate.mjs'

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

const MAX_BODY = 8 * 1024 * 1024

const STATUS = {
  bad_name: 400,
  bad_doc: 400,
  bad_json: 422,
  not_found: 404,
  conflict: 409,
  gone: 410,
  version_required: 428,
  exists: 409,
  too_large: 413,
  unsupported_media: 415,
  unauthorized: 401,
  forbidden: 403,
}

function sendJSON(res, code, obj) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(obj))
}

function fail(res, code, extra) {
  return sendJSON(res, STATUS[code] || 500, Object.assign({ ok: false, error: code }, extra || {}))
}

async function readBody(req, limit = MAX_BODY) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('too large'), { code: 'too_large' })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const jsonType = (req) => String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')

/* 所有 /synapsis-api/* 请求的唯一入口。
   · 除公开的 KaTeX 静态资源外，先问 connection 能不能放行
   · 写操作要求 application/json（跨站表单发不出来，也就发不进 JSON 预检）
   · 保存必须带版本，且内容要先过 assertDoc（只检查不改）
   · 错误只回错误码，堆栈留给宿主日志 */
export function createHandler({ store, katexDir, connection, log = console, sampleName, sampleFactory }) {
  async function serveKatex(req, res, sub) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 'not_found')
    const rel = decodeURIComponent(sub.replace(/^\/katex\/?/, ''))
    if (!rel || rel.includes('..')) return fail(res, 'not_found')
    const file = path.join(katexDir, rel)
    if (!file.startsWith(katexDir + path.sep)) return fail(res, 'not_found')
    try {
      const body = await fs.readFile(file)
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'public, max-age=86400',
        'content-length': body.length,
      })
      return res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      return fail(res, 'not_found')
    }
  }

  async function handler(req, res) {
    let url
    try {
      url = new URL(req.url || '/', 'http://localhost')
    } catch {
      return fail(res, 'bad_name')
    }
    const sub = url.pathname.replace(/^\/synapsis-api/, '')

    if (sub.startsWith('/katex/')) return serveKatex(req, res, sub)

    /* 鉴权：DSH 的 connection 服务只信任带登录票据的同源请求。
       任意网页对 127.0.0.1 发的请求都会在这里被拒。 */
    if (connection && typeof connection.requestRejection === 'function') {
      let rejection
      try {
        rejection = await connection.requestRejection({ headers: req.headers })
      } catch (err) {
        log.warn?.('[synapsis] trust check failed', err)
        return fail(res, 'forbidden')
      }
      if (rejection === 401) return fail(res, 'unauthorized')
      if (rejection === 403) return fail(res, 'forbidden')
    }

    const write = req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE'
    if (write && !jsonType(req)) return fail(res, 'unsupported_media')

    try {
      if (sub === '/list' && req.method === 'GET') {
        return sendJSON(res, 200, { ok: true, dir: store.root, items: await store.list() })
      }

      if (sub === '/load' && req.method === 'GET') {
        const loaded = await store.read(url.searchParams.get('name'))
        return sendJSON(res, 200, {
          ok: true,
          name: loaded.name,
          mtime: loaded.mtime,
    token: loaded.token,
          data: loaded.data,
          warnings: loaded.warnings,
        })
      }

      if (sub === '/save' && write) {
        const body = JSON.parse(await readBody(req))
        if (!body || !body.name) return fail(res, 'bad_name')
        if (!('baseToken' in body)) return fail(res, 'version_required')
        assertDoc(body.data)
        const saved = await store.save(body.name, body.data, body.baseToken)
        return sendJSON(res, 200, { ok: true, mtime: saved.mtime, token: saved.token })
      }

      if (sub === '/create' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req))
        /* 带 data 就是「用这份内容另存一张」，用于「文件被删了但本地还有改动」；
           不带就建一张空白图。两条路都走 createFrom，从不覆盖同名文件。
           面板传的是「标题」，不是文件名，所以这里要自己补 .mindmap.json 后缀，
           否则「xx（副本）」这种标题会被 safeName 当坏名字拒掉。 */
        /* 只有明确给了 name 才当成「指定文件名」；只给 title 时交给 store 自动起名
           （它自己会避开重名）。面板「另存为副本」走的正是标题这条路。 */
        const explicit = body && typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ''
        const fileName = explicit
          ? (/\.mindmap\.json$/i.test(explicit) ? explicit : explicit + '.mindmap.json')
          : undefined
        const made = body && body.data
          ? await store.createFrom(body.data, fileName)
          : await store.create(body && body.title, fileName)
        return sendJSON(res, 200, { ok: true, name: made.name, data: made.data, mtime: made.mtime, token: made.token, dir: store.root })
      }

      if (sub === '/delete' && write) {
        const body = JSON.parse(await readBody(req))
        const gone = await store.trash(body && (body.name || url.searchParams.get('name')))
        return sendJSON(res, 200, { ok: true, trashed: true })
      }

      /* 撤销删除：把刚才进 .trash 的那份捡回来 */
      if (sub === '/restore' && write) {
        const body = JSON.parse(await readBody(req))
        const back = await store.restore(body && body.name)
        return sendJSON(res, 200, { ok: true, name: back.name, mtime: back.mtime })
      }

      /* 历史版本：列表与读回 */
      if (sub === '/history' && req.method === 'GET') {
        const name = url.searchParams.get('name')
        return sendJSON(res, 200, { ok: true, items: await store.history(name) })
      }

      if (sub === '/history/read' && req.method === 'GET') {
        const name = url.searchParams.get('name')
        const data = await store.readHistory(name, url.searchParams.get('file'))
        return sendJSON(res, 200, { ok: true, data })
      }

      if (sub === '/history/restore' && write) {
        const body = JSON.parse(await readBody(req))
        if (!body || !body.name || !body.file) return fail(res, 'bad_name')
        if (!('baseToken' in body)) return fail(res, 'version_required')
        const back = await store.restoreHistory(body.name, body.file, body.baseToken)
        return sendJSON(res, 200, { ok: true, mtime: back.mtime, token: back.token })
      }

      /* 往库里再放一张示例图（空态/设置里用） */
      if (sub === '/sample' && req.method === 'POST') {
        const made = await store.ensureSample(sampleName, sampleFactory, { force: true })
        if (!made) return sendJSON(res, 500, { ok: false, error: 'sample_failed' })
        return sendJSON(res, 200, { ok: true, name: typeof made === 'string' ? made : made.name || sampleName })
      }

      return fail(res, 'not_found')
    } catch (err) {
      const code = err && err.code
      if (code && STATUS[code]) {
        const extra = {}
        if (code === 'conflict' || code === 'version_required') extra.mtime = err.mtime
    extra.token = err.token
        if (err.issues) extra.issues = err.issues
        return fail(res, code, extra)
      }
      if (err instanceof SyntaxError) return fail(res, 'bad_doc', { issues: ['bad-json'] })
      log.warn?.('[synapsis] request failed', err)
      return fail(res, 'internal')
    }
  }

  return handler
}
