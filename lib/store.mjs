import path from 'node:path'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import { NAME_RE, safeName } from './paths.mjs'
import { blankDoc, normalizeDoc } from './validate.mjs'

/* 历史快照：latest.json 永远留上一版；带时间戳的检查点每 5 分钟最多一份，按份数轮转。
   这样「上一次保存」可以立刻回退，也能翻到几十分钟前的版本。 */
const HISTORY_KEEP = 40
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
  /* 同一个文件的所有读写都排进同一条链：检查 mtime、留快照、写盘这三步之间
     不能插进另一个请求，否则两个旧版本会一起通过 mtime 检查再互相覆盖。 */
  const queues = new Map()

  const full = (name) => path.join(root, name)

  function withFile(key, fn) {
    const prev = queues.get(key) || Promise.resolve()
    const next = prev.then(fn, fn)
    queues.set(
      key,
      next.catch(() => {}),
    )
    return next
  }

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
          out.push({ ...cached.row, mtime: stat.mtimeMs })
          continue
        }
        let title = entry.name.replace(/\.mindmap\.json$/, '')
        let count = 0
        let broken = false
        try {
          const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
          if (typeof parsed.title === 'string' && parsed.title.trim()) title = parsed.title
          if (Array.isArray(parsed.nodes)) count = parsed.nodes.length
        } catch {
          /* 坏文件也列出来，让用户看得见它、自己去处理，而不是凭空消失 */
          broken = true
        }
        const row = { name: entry.name, title, nodes: count, broken }
        cache.set(entry.name, { mtime: stat.mtimeMs, row })
        out.push({ ...row, mtime: stat.mtimeMs })
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
    return { name: safe, raw: text, parsed, data: doc, warnings, mtime: stat.mtimeMs }
  }

  /* 覆盖前留一份「上一版」：latest.json 每次覆盖都更新，检查点每 5 分钟一份 */
  async function snapshot(name, text) {
    const dir = path.join(root, '.history', name.replace(/\.mindmap\.json$/i, ''))
    await ensureDir(dir)
    await fs.writeFile(path.join(dir, 'latest.json'), text, 'utf8')
    const stamps = (await fs.readdir(dir)).filter((f) => /^\d{4}-/.test(f) && f.endsWith('.json')).sort()
    let needCheckpoint = true
    if (stamps.length) {
      const st = await fs.stat(path.join(dir, stamps[stamps.length - 1])).catch(() => null)
      if (st && Date.now() - st.mtimeMs < HISTORY_GAP_MS) needCheckpoint = false
    }
    if (needCheckpoint) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await fs.writeFile(path.join(dir, stamp + '.json'), text, 'utf8')
    }
    const all = (await fs.readdir(dir)).filter((f) => /^\d{4}-/.test(f) && f.endsWith('.json')).sort()
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

  /* 保存：必须带版本。
     - 文件在：baseMtime 必须是有限数字，且与磁盘一致，否则 conflict
     - 文件不在：只有显式 baseMtime === null 才允许落地，否则 gone（别把别人删掉的图写回来） */
  async function save(name, data, baseMtime) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    return withFile(safe, async () => {
      const file = full(safe)
      let stat = null
      let prev = null
      try {
        stat = await fs.stat(file)
        prev = await fs.readFile(file, 'utf8')
      } catch (err) {
        if (err && err.code !== 'ENOENT') throw err
      }
      const base = Number(baseMtime)
      if (stat) {
        if (!Number.isFinite(base)) throw fail('version_required', { mtime: stat.mtimeMs })
        if (Math.abs(stat.mtimeMs - base) > 1.5) throw fail('conflict', { mtime: stat.mtimeMs })
      } else if (baseMtime !== null) {
        throw fail('gone')
      }
      const text = JSON.stringify(data, null, 2)
      if (prev !== null && prev !== text) await snapshot(safe, prev)
      const mtime = await write(safe, text)
      return { mtime }
    })
  }

  async function createFrom(doc, requestedName) {
    await ensureDir()
    const name0 = String((doc && doc.title) || '').trim() || '未命名图'
    /* 自动起名也走一遍 safeName：标题叫 CON / NUL 时不能造出自己都拒绝读的文件名 */
    const slug = slugify(name0)
    let name
    if (requestedName) {
      name = safeName(requestedName)
      if (!name) throw fail('bad_name')
    } else {
      const base = safeName(slug + '.mindmap.json') ? slug : '图-' + slug
      name = base + '.mindmap.json'
    }
    return withFile(name, async () => {
      if (requestedName && (await exists(name))) throw fail('exists')
      if (!requestedName) {
        let i = 2
        while ((await exists(name)) && i < 200) {
          name = `${slug}-${i}.mindmap.json`
          i += 1
        }
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
    })
  }

  async function create(title, requestedName) {
    return createFrom(blankDoc(String(title || '').trim() || '未命名图'), requestedName)
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
    return withFile(safe, async () => {
      if (!(await exists(safe))) throw fail('not_found')
      const dir = path.join(root, '.trash')
      await ensureDir(dir)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const target = path.join(dir, `${safe}.${stamp}`)
      await renameRetry(full(safe), target)
      cache.delete(safe)
      return { trashed: true, path: target }
    })
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
    const mine = entries.filter((entry) => entry === safe || entry.startsWith(safe + '.')).sort()
    const latest = mine[mine.length - 1]
    if (!latest) throw fail('not_found')
    let target = safe
    return withFile(target, async () => {
      for (let i = 2; i < 100 && (await exists(target)); i += 1) {
        target = `${safe.replace(/\.mindmap\.json$/, '')}-${i}.mindmap.json`
      }
      await renameRetry(path.join(dir, latest), full(target))
      cache.delete(target)
      const stat = await fs.stat(full(target))
      return { name: target, mtime: stat.mtimeMs }
    })
  }

  /* 历史版本列表：latest 排最前，其余按时间倒序 */
  async function history(name) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    const dir = path.join(root, '.history', safe.replace(/\.mindmap\.json$/i, ''))
    let entries = []
    try {
      entries = await fs.readdir(dir)
    } catch {
      return []
    }
    const out = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const stat = await fs.stat(path.join(dir, entry)).catch(() => null)
      if (!stat) continue
      out.push({
        file: entry,
        at: stat.mtimeMs,
        latest: entry === 'latest.json',
        size: stat.size,
      })
    }
    out.sort((a, b) => b.at - a.at)
    return out
  }

  async function readHistory(name, file) {
    const safe = safeName(name)
    if (!safe) throw fail('bad_name')
    if (!/^[A-Za-z0-9._-]+\.json$/.test(String(file || ''))) throw fail('bad_name')
    const dir = path.join(root, '.history', safe.replace(/\.mindmap\.json$/i, ''))
    const target = path.join(dir, path.basename(file))
    if (!target.startsWith(dir + path.sep)) throw fail('bad_name')
    try {
      return JSON.parse(await fs.readFile(target, 'utf8'))
    } catch (err) {
      if (err && err.code === 'ENOENT') throw fail('not_found')
      throw fail('bad_json')
    }
  }

  /* 把某个历史版本写回正本：同样要版本，避免把别人刚改的内容盖掉 */
  async function restoreHistory(name, file, baseMtime) {
    const doc = await readHistory(name, file)
    const res = await save(name, doc, baseMtime)
    return { ...res, data: doc }
  }

  /* force=true 时忽略 .seeded，用来在设置/空态里「再放一张示例」 */
  async function ensureSample(name, factory, opts) {
    const force = !!(opts && opts.force)
    const seeded = path.join(root, '.seeded')
    try {
      await ensureDir()
      if (!force && (await exists('.seeded'))) return false
      const entries = await fs.readdir(root)
      const hasMaps = entries.some((n) => NAME_RE.test(n))
      const doc = typeof factory === 'function' ? factory() : factory
      if (hasMaps && !force) return false
      let target = name
      let i = 2
      while ((await exists(target)) && i < 100) {
        target = name.replace(/\.mindmap\.json$/, `-${i}.mindmap.json`)
        i += 1
      }
      await fs.writeFile(full(target), JSON.stringify(doc, null, 2), 'utf8')
      cache.delete(target)
      if (!hasMaps) await fs.writeFile(seeded, new Date().toISOString() + '\n', 'utf8')
      return force ? target : true
    } catch {
      /* 示例图是可选的，写不进去也不该影响插件启动 */
      return false
    }
  }

  return {
    root,
    list,
    read,
    save,
    create,
    createFrom,
    trash,
    restore,
    exists,
    history,
    readHistory,
    restoreHistory,
    ensureSample,
  }
}
