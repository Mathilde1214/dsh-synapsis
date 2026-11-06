/**
 * 开发用的小服务（不属于插件运行时，不进 npm 包）。
 *
 *   node tools/dev-server.mjs            # 默认 7788
 *
 * 它只做三件事：
 *   1. 把 tools/dev-panel/ 当站点根，托管联调页；
 *   2. 把仓库里的 /client.js、/core/* 直接端出去（改完 rebuild 刷新即可）；
 *   3. 把 /synapsis-api/* 原样交给插件真正的 handler —— 联调和生产同一套代码，
 *      免得「开发能过、装进 DSH 就坏」。这里只是把 connection 换成一个放行的桩。
 *
 * 生产形态里这些路由由 DSH 的 Host 半边（index.js）提供。
 */
import http from 'node:http'
import path from 'node:path'
import { promises as fs, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createStore } from '../lib/store.mjs'
import { createHandler } from '../lib/http.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const PANEL = path.join(HERE, 'dev-panel')
const PORT = Number(process.env.PORT || 7788)
const HOST = process.env.SYNAPSIS_HOST || '127.0.0.1'
const DATA = process.env.SYNAPSIS_DATA || path.join(ROOT, '.dev-data')
const KATEX_DIR = path.join(ROOT, 'assets', 'katex')

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

const store = createStore(DATA)
const api = createHandler({
  store,
  katexDir: KATEX_DIR,
  /* 联调页没有 DSH 登录票据，用一个永远放行的桩代替 connection 服务 */
  connection: { requestRejection: () => undefined },
})

const sampleDoc = () => ({
  version: 1,
  title: '示例 · 从这里开始',
  subtitle: '一张很小的图，看完就知道怎么用',
  updated: new Date().toISOString(),
  nodes: [
    { id: 'root', title: '示例 · 从这里开始', parent: null, summary: '一张很小的示例图', definition: '', formal: '', intuition: '', examples: '', pitfalls: '', mastery: 0, note: '' },
    { id: 'scroll', title: '滚轮就是层级', parent: 'root', summary: '往下滚进一层，往上滚退一层', definition: '', formal: '', intuition: '', examples: '', pitfalls: '', mastery: 0, note: '' },
    { id: 'sidebar', title: '侧栏是概念卡', parent: 'root', summary: '点卡片，右边展开细节', definition: '', formal: '', intuition: '', examples: '', pitfalls: '', mastery: 0, note: '' },
    { id: 'keys', title: '几个顺手的键', parent: 'root', summary: 'Tab 新建 · F2 改名 · Del 删除', definition: '', formal: '', intuition: '', examples: '', pitfalls: '', mastery: 0, note: '' },
    { id: 'export', title: '导出与换纸', parent: 'root', summary: '顶栏右边能导出和换纸', definition: '', formal: '', intuition: '', examples: '', pitfalls: '', mastery: 0, note: '' },
  ],
  edges: [
    { from: 'scroll', to: 'sidebar', type: 'related' },
    { from: 'sidebar', to: 'keys', type: 'related' },
  ],
})

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || HOST))
  const pathname = url.pathname

  /* 联调页要加载构建产物本身；它必须排在 /synapsis-api/* 兜底之前 */
  if (pathname === '/synapsis-api/_client.js') return sendFile(res, path.join(ROOT, 'client.js'))

  /* 插件路由（含 /katex/*）：原样交给真实 handler */
  if (pathname.startsWith('/synapsis-api/')) {
    return api(req, res)
  }

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
await store.ensureSample('示例-从这里开始.mindmap.json', sampleDoc)
server.listen(PORT, HOST, () => {
  console.log('[dev] 联调页 http://' + HOST + ':' + PORT + '/')
  console.log('[dev] 图库 ' + DATA)
})
