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

/* 第一次装上、库里一张图都没有时，放一张四节点的小样图。
   它只教「这个面板怎么用」，不是教材；`.seeded` 落盘后就不再生，
   所以用户把它删掉也不会再冒出来。 */
const SEEDED = path.join(HOME, '.seeded')
const SAMPLE_NAME = '示例-从这里开始.mindmap.json'

function sampleDoc() {
  const node = (id, title, parent, summary, extra) =>
    Object.assign(
      {
        id,
        title,
        parent,
        summary,
        definition: '',
        formal: '',
        intuition: '',
        examples: '',
        pitfalls: '',
        mastery: 0,
        note: '',
      },
      extra || {},
    )
  return {
    version: 1,
    title: '示例 · 从这里开始',
    subtitle: '一张很小的图，看完就知道怎么用',
    updated: new Date().toISOString(),
    nodes: [
      node('root', '示例 · 从这里开始', null, '一张很小的示例图', {
        definition: '越往里越细，缩回去就是上一层。删掉它不影响别的图。',
        intuition: '把它当成有纵深的导图：近的概念详细，远的只是一个点。',
      }),
      node('scroll', '滚轮就是层级', 'root', '往前推进入下一层，缩一半退回上一层', {
        definition: '滚轮以光标为锚缩放：每一层的字号都被钉在可读的大小，再往前推就走进离你最近的子分支。',
        intuition: '不需要「打开新窗口」。深度就是缩放本身。',
      }),
      node('sidebar', '侧栏是概念卡', 'root', '选中一个概念，右边是它的定义、形式化、直觉、例子、易错点', {
        definition:
          '点一张卡，右侧栏显示它的正文、原文出处、前置与引出、掌握度和个人笔记。双击任意一栏就能改，改完自动存回文件。',
        examples: '形式化那一栏支持 LaTeX，编辑时显示源码，下面实时给出排版后的样子。',
      }),
      node('keys', '几个顺手的键', 'root', '⌘K 搜索 · Tab 加子概念 · Shift 拖拽连边 · ⌘Z 撤销', {
        definition:
          'Tab 加子概念、Enter 加同级、F2 改名、Delete 删除；按住 Shift 从一张卡拖到另一张建一条关系边；⌘K 搜索全图。',
        pitfalls: '删除一个有子概念的节点时会问：一起删掉，还是只删它、把子概念上提。',
      }),
      node('export', '导出与换纸', 'root', '顶栏右边：搜索、导出、日光纸/夜光纸', {
        definition: '导出给 PNG、SVG 和 Markdown 大纲；导的是当前这一层。纸色两套，会记住你的选择。',
      }),
    ],
    edges: [
      { from: 'scroll', to: 'sidebar', type: 'related' },
      { from: 'sidebar', to: 'keys', type: 'related' },
    ],
  }
}

async function ensureSample() {
  try {
    await fs.mkdir(HOME, { recursive: true })
    if (fsSync.existsSync(SEEDED)) return
    const names = await fs.readdir(HOME)
    if (names.some((n) => NAME_RE.test(n))) return
    await fs.writeFile(path.join(HOME, SAMPLE_NAME), JSON.stringify(sampleDoc(), null, 2), 'utf8')
    await fs.writeFile(SEEDED, new Date().toISOString() + '\n', 'utf8')
  } catch {
    /* 示例图是可选的，写不进去也不该影响插件启动 */
  }
}

async function listMaps() {  await fs.mkdir(HOME, { recursive: true })
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

  /* 新建一份空白图：只放一个根节点，图库下拉里立刻能看到 */
  if (sub === '/create' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}')
      const rawTitle = String((body && body.title) || '').trim() || '未命名图'
      const requested = String((body && body.name) || '').trim()
      await fs.mkdir(HOME, { recursive: true })

      let name = ''
      if (requested && safeName(requested)) {
        name = requested
      } else {
        const slug = rawTitle
          .replace(/\.mindmap\.json$/i, '')
          .replace(/[^\p{L}\p{N}_-]+/gu, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || 'map'
        name = slug + '.mindmap.json'
        let n = 2
        while (true) {
          try {
            await fs.access(path.join(HOME, name))
            name = slug + '-' + n + '.mindmap.json'
            n += 1
          } catch {
            break
          }
        }
      }

      const now = new Date().toISOString()
      const doc = {
        version: 1,
        title: rawTitle,
        subtitle: '',
        updated: now,
        nodes: [
          {
            id: 'root',
            title: rawTitle,
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
      const full = path.join(HOME, name)
      const tmp = full + '.tmp'
      await fs.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
      await fs.rename(tmp, full)
      return sendJSON(res, 200, { ok: true, name, dir: HOME, data: doc })
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
  ensureSample()
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
