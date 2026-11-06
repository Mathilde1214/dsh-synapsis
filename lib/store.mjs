import path from 'node:path'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { NAME_RE, safeName } from './paths.mjs'
import { blankDoc, normalizeDoc } from './validate.mjs'

const HISTORY_KEEP = 20
const HISTORY_GAP_MS = 5 * 60 * 1000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* rename 在 Windows 上会被杀毒 / OneDrive / 索引服务短暂占用，重试三次基本都能过 */
async function renameRetry(from, to) {
  const waits = [50, 120, 300]
  for (let i = 0; ; i += 1) {
    try {
      return await fs.rename(from, to)
    } catch (err) {
      const retriable = err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')
      if (!retriable || i >= waits.length) throw err
      await sleep(waits[i])
    }
  }
}

function slugify(title) {
  const base = String(title || '')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || '未命名图'
}

const fail = (code, extra) => Object.assign(new Error(code), { code }, extra || {})

export function createStore(home) {
  const root = path.resolve(home)
  const cache = new Map()

  const full = (name) => path.join(root, name)

  async function ensureDir(dir = root) {
    await fs.mkdir(dir, { recursive: true })
  }

  async function list() {
    await ensureDir()
    const entries = await fs.readdir(root, { withFileTypes: true })
    const out = []
    for (const entry of entries) {
      if (!entry.isFile() || !NAME_RE.test(entry.name)) continue
      const file = full(entry.name)
      try {
        const stat = await fs.stat(file)
        const cached = cache.get(entry.name)
        if (cached && cached.mtime === stat.mtimeMs) {
          out.push({ name: entry.name, title: cached.title, nodes: cached.nodes, mtime: stat.mtimeMs })
          continue
        }
        let title = entry.name.replace(/\.mindmap\.json$/, '')
        let count = 0
        try {
          const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
          if (typeof parsed.title === 'string' && parsed.title.trim()) title = parsed.title
          if (Array.isArray(parsed.nodes)) count = parsed.nodes.length
        } catch {
          /* 坏文件也列出来，让用户看得见它、自己去处理，而不是凭空消失 */
        }
        cache.set(entry.name, { mtime: stat.mtimeMs, title, nodes: count })
        out.push({ name: entry.name, title, nodes: count, mtime: stat.mtimeMs })
      } catch {
        /* 读不到的条目跳过 */
      }
    }
    out.sort((a, b) => b.mtime - a.mtime)
    return out
  }

  async function read(name) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    const file = full(safe)
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      throw fail('not_found')
    }
    const text = await fs.readFile(file, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw fail('bad_json', { mtime: stat.mtimeMs })
    }
    const { doc, warnings } = normalizeDoc(parsed)
    return { name: safe, data: doc, mtime: stat.mtimeMs, warnings }
  }

  /* 每次真正覆盖前，把「上一版」留一份快照：5 分钟内内容没变就不重复留。 */
  async function snapshot(name, text) {
    const dir = path.join(root, '.history', name.replace(/\.mindmap\.json$/i, ''))
    await ensureDir(dir)
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort()
    if (files.length) {
      const last = path.join(dir, files[files.length - 1])
      try {
        const stat = await fs.stat(last)
        if (Date.now() - stat.mtimeMs < HISTORY_GAP_MS && (await fs.readFile(last, 'utf8')) === text) return
      } catch {
        /* 快照坏了就再写一份 */
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.writeFile(path.join(dir, stamp + '.json'), text, 'utf8')
    const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort()
    while (all.length > HISTORY_KEEP) {
      await fs.rm(path.join(dir, all.shift()), { force: true })
    }
  }

  async function write(name, text) {
    await ensureDir()
    const file = full(name)
    const tmp = path.join(root, `.${name}.${crypto.randomBytes(4).toString('hex')}.tmp`)
    await fs.writeFile(tmp, text, 'utf8')
    try {
      await renameRetry(tmp, file)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
    const stat = await fs.stat(file)
    cache.delete(name)
    return stat.mtimeMs
  }

  async function save(name, data, baseMtime) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    const file = full(safe)
    let stat = null
    let prev = null
    try {
      stat = await fs.stat(file)
      prev = await fs.readFile(file, 'utf8')
    } catch (err) {
      if (err && err.code !== 'ENOENT') throw err
    }
    if (stat && baseMtime !== undefined && baseMtime !== null && baseMtime !== '') {
      if (Math.abs(stat.mtimeMs - Number(baseMtime)) > 1.5) {
        throw fail('conflict', { mtime: stat.mtimeMs })
      }
    }
    const text = JSON.stringify(data, null, 2)
    if (prev !== null && prev !== text) await snapshot(safe, prev)
    const mtime = await write(safe, text)
    return { mtime }
  }

  async function create(title, requestedName) {
    const doc = blankDoc(String(title || '').trim() || '未命名图')
    return createFrom(doc, requestedName)
  }

  /* 用一个已经完整的文档占住名字：agent 工具走这条，一次写盘、原子占名。 */
  async function createFrom(doc, requestedName) {
    await ensureDir()
    const name0 = String((doc && doc.title) || '').trim() || '未命名图'
    let name
    if (requestedName) {
      name = safeName(requestedName)
      if (!name) throw fail('bad_name')
      if (await exists(name)) throw fail('exists')
    } else {
      const base = slugify(name0)
      name = base + '.mindmap.json'
      for (let i = 2; i < 100 && (await exists(name)); i += 1) name = `${base}-${i}.mindmap.json`
      if (await exists(name)) throw fail('exists')
    }
    const text = JSON.stringify(doc, null, 2)
    try {
      /* wx：名字已经被别人占住时直接失败，不留「检查完再写」的空档 */
      await fs.writeFile(full(name), text, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      if (err && err.code === 'EEXIST') throw fail('exists')
      throw err
    }
    cache.delete(name)
    const stat = await fs.stat(full(name))
    return { name, data: doc, mtime: stat.mtimeMs }
  }

  async function exists(name) {
    try {
      await fs.access(full(name))
      return true
    } catch {
      return false
    }
  }

  async function trash(name) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    if (!(await exists(safe))) throw fail('not_found')
    const dir = path.join(root, '.trash')
    await ensureDir(dir)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(dir, `${safe}.${stamp}`)
    await renameRetry(full(safe), target)
    cache.delete(safe)
    return { trashed: true, path: target }
  }

  /* 从 .trash 里把最近一次删掉的同名文件捡回来；目标名已经被占就加 -2 */
  async function restore(name) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    const dir = path.join(root, '.trash')
    let entries = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      throw fail('not_found')
    }
    const mine = entries
      .filter((entry) => entry === safe || entry.startsWith(safe + '.'))
      .sort()
    const latest = mine[mine.length - 1]
    if (!latest) throw fail('not_found')
    let target = safe
    for (let i = 2; i < 100 && (await exists(target)); i += 1) {
      target = `${safe.replace(/\.mindmap\.json$/, '')}-${i}.mindmap.json`
    }
    await renameRetry(path.join(dir, latest), full(target))
    cache.delete(target)
    const stat = await fs.stat(full(target))
    return { name: target, mtime: stat.mtimeMs }
  }

  /* force=true 时忽略 .seeded，用来在设置/空态里「再放一张示例」 */
  async function ensureSample(name, factory, opts) {
    const force = !!(opts && opts.force)
    const seeded = path.join(root, '.seeded')
    try {
      await ensureDir()
      if (!force && (await exists('.seeded'))) return false
      const entries = await fs.readdir(root)
      if (entries.some((n) => NAME_RE.test(n))) {
        /* 库里已经有图时，不往里塞示例，除非明确要求 */
        if (!force) return false
        let alt = safeName(name)
        for (let i = 2; i < 100 && (await exists(alt)); i += 1) {
          alt = name.replace(/\.mindmap\.json$/, `-${i}.mindmap.json`)
        }
        const doc = typeof factory === 'function' ? factory() : factory
        await fs.writeFile(full(alt), JSON.stringify(doc, null, 2), 'utf8')
        cache.delete(alt)
        return alt
      }
      const doc = typeof factory === 'function' ? factory() : factory
      await fs.writeFile(full(name), JSON.stringify(doc, null, 2), 'utf8')
      await fs.writeFile(seeded, new Date().toISOString() + '\n', 'utf8')
      return true
    } catch {
      /* 示例图是可选的，写不进去也不该影响插件启动 */
      return false
    }
  }

  return { root, list, read, save, create, createFrom, trash, restore, exists, ensureSample }
}
