import { normalizeDoc, assertDoc, ISSUE_TEXT } from './validate.mjs'

const text = (t) => [{ type: 'text', text: t }]

const NODE_FIELDS = ['summary', 'definition', 'formal', 'intuition', 'examples', 'pitfalls']

function stamp(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/* 给模型看的节点行：够它判断「这图里有什么」，又不至于把上下文撑爆 */
function nodeLine(n, depth) {
  const pad = '  '.repeat(depth)
  const bits = [n.title || n.id]
  if (n.en) bits.push(`(${n.en})`)
  const line = `${pad}- ${bits.join(' ')} [${n.id}]`
  const sum = (n.summary || '').trim()
  const head = sum ? `${line}：${sum}` : line
  /* 正文也要给模型看：只给标题的话，模型没法引用书里的说法，
     也就没法在回答里指到具体概念。定义截到 200 字，足够判断内容。 */
  const def = (n.definition || '').trim()
  if (!def) return head
  const clipped = def.length > 200 ? def.slice(0, 200) + '…' : def
  return `${head}\n${pad}    定义：${clipped}`
}

function outlineText(doc, limit = 160) {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const kids = new Map()
  for (const n of doc.nodes) {
    const p = n.parent && byId.has(n.parent) ? n.parent : null
    if (!p) continue
    if (!kids.has(p)) kids.set(p, [])
    kids.get(p).push(n)
  }
  const root = doc.nodes.find((n) => !n.parent) || doc.nodes[0]
  const out = []
  let shown = 0
  let cut = false
  const walk = (node, depth) => {
    if (shown >= limit) {
      cut = true
      return
    }
    out.push(nodeLine(node, depth))
    shown += 1
    for (const kid of kids.get(node.id) || []) walk(kid, Math.min(depth + 1, 6))
  }
  walk(root, 0)
  if (cut) out.push(`…（还有 ${doc.nodes.length - shown} 个节点没列，可用 detail:"full" 取完整内容）`)
  const edgeRows = (doc.edges || []).slice(0, 40).map((e) => `  · ${e.from} →(${e.type}) ${e.to}`)
  if (edgeRows.length) {
    out.push('跨分支关系：')
    out.push(...edgeRows)
    if ((doc.edges || []).length > edgeRows.length) out.push(`  …还有 ${doc.edges.length - edgeRows.length} 条`)
  }
  return out.join('\n')
}

function diffDocs(before, after) {
  const beforeById = new Map((before.nodes || []).map((n) => [n.id, n]))
  const afterById = new Map((after.nodes || []).map((n) => [n.id, n]))
  const added = []
  const removed = []
  const renamed = []
  const retitled = []
  const edited = []
  const CONTENT = ['summary', 'definition', 'formal', 'intuition', 'examples', 'pitfalls', 'note', 'mastery', 'en', 'source']
  const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b)
  for (const n of after.nodes) if (!beforeById.has(n.id)) added.push(n.id)
  for (const n of before.nodes) if (!afterById.has(n.id)) removed.push(n.id)
  for (const n of after.nodes) {
    const old = beforeById.get(n.id)
    if (!old) continue
    if (old.parent !== n.parent) renamed.push(`${n.id}: ${old.parent || 'root'} → ${n.parent || 'root'}`)
    if ((old.title || '') !== (n.title || '')) retitled.push(`${n.id}: ${old.title} → ${n.title}`)
    /* 正文变化也算改动：只报「改归属 / 改标题」会让模型以为内容没动 */
    const changedFields = CONTENT.filter((f) => !same(old[f], n[f]))
    if (changedFields.length) edited.push(`${n.title || n.id}（${changedFields.join('、')}）`)
  }
  const key = (e) => `${e.from}->${e.to}:${e.type}`
  const beforeEdges = new Set((before.edges || []).map(key))
  const afterEdges = new Set((after.edges || []).map(key))
  const edgesAdded = [...afterEdges].filter((k) => !beforeEdges.has(k))
  const edgesRemoved = [...beforeEdges].filter((k) => !afterEdges.has(k))
  return { added, removed, renamed, retitled, edited, edgesAdded, edgesRemoved }
}

function diffText(d) {
  const lines = []
  if (d.added.length) lines.push(`新增节点 ${d.added.length}：${d.added.slice(0, 12).join(', ')}${d.added.length > 12 ? ' …' : ''}`)
  if (d.removed.length) lines.push(`删除节点 ${d.removed.length}：${d.removed.slice(0, 12).join(', ')}${d.removed.length > 12 ? ' …' : ''}`)
  if (d.renamed.length) lines.push(`改归属 ${d.renamed.length}：${d.renamed.slice(0, 6).join('；')}`)
  if (d.retitled.length) lines.push(`改标题 ${d.retitled.length}：${d.retitled.slice(0, 6).join('；')}`)
  if (d.edited.length) lines.push(`改正文 ${d.edited.length}：${d.edited.slice(0, 8).join('；')}`)
  if (d.edgesAdded.length) lines.push(`新增关系 ${d.edgesAdded.length}`)
  if (d.edgesRemoved.length) lines.push(`移除关系 ${d.edgesRemoved.length}`)
  return lines.length ? lines.join('\n') : '内容没有实际变化'
}

const NODE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '唯一 id，建议 ch1 / ch1-topic-xxx / ch1-x' },
    title: { type: 'string' },
    en: { type: 'string' },
    parent: { type: ['string', 'null'], description: '父节点 id；根用 null' },
    summary: { type: 'string', description: '一行摘要，≤40 字' },
    definition: { type: 'string' },
    formal: { type: 'string', description: 'LaTeX，可用 $…$ 或 $$…$$' },
    intuition: { type: 'string' },
    examples: { type: 'string' },
    pitfalls: { type: 'string' },
    source: { type: 'object', properties: { page: { type: 'number' }, snippet: { type: 'string' } } },
  },
  required: ['id', 'title'],
}

const EDGE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      type: { type: 'string', enum: ['prereq', 'related', 'contrast'] },
    },
    required: ['from', 'to'],
  },
}

/* agent 侧的四个工具：列、读、新建、更新。
   这是「把讲义变成图」的真正入口 —— 模型不知道 .mindmap.json 长什么样，
   所以它必须从这里拿到 schema，也必须是这里替它把文件写对。
   注意：output.render 才是模型看到的内容，execute 的返回值只是一个对象。 */
export function registerTools(ctx, store) {
  const disposers = []

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_list_maps',
      description: '列出「析域」图库里的所有概念图（文件名、标题、节点数、修改时间）。做新图之前先看一眼，避免同名覆盖。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            dir: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  title: { type: 'string' },
                  nodes: { type: 'number' },
                  mtime: { type: 'number' },
                  broken: { type: 'boolean' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (!value.items.length) return text(`图库：${value.dir}\n还是空的，一张图都没有。`)
          const rows = value.items.map(
            (it) => `- ${it.title}（${it.nodes} 个节点，${stamp(it.mtime)}${it.broken ? '，文件损坏' : ''}）\n  ${it.name}`,
          )
          return text(`图库：${value.dir}\n共 ${value.items.length} 张：\n${rows.join('\n')}`)
        },
      },
      async execute() {
        const items = await store.list()
        return { dir: store.root, items }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_read_map',
      description: '读取「析域」里某一张概念图的内容。默认给层级大纲（id、标题、摘要、跨分支关系）；detail:"full" 给完整 JSON。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名，如 离散数学（第六版）.mindmap.json' },
          detail: { type: 'string', enum: ['outline', 'full'], description: '默认 outline' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            title: { type: 'string' },
            mtime: { type: 'number' },
            versionToken: { type: 'string' },
            nodes: { type: 'number' },
            edges: { type: 'number' },
            data: { type: 'object' },
          },
        },
        render: (args, value) => {
          const head = `《${value.title}》 ${value.nodes} 个节点 / ${value.edges} 条关系（${value.name}，改于 ${stamp(value.mtime)}）`
          const tail = `\n\n版本令牌 versionToken=${value.versionToken}（要改这张图，把它传给 synapsis_update_map，否则会被拒绝）`
          if (args.detail === 'full') return text(`${head}\n\n${JSON.stringify(value.data, null, 2)}${tail}`)
          return text(`${head}\n\n${outlineText(value.data)}${tail}`)
        },
      },
      async execute(args) {
        const loaded = await store.read(args.name)
        return {
          name: loaded.name,
          title: loaded.data.title,
          mtime: loaded.mtime,
          versionToken: loaded.token,
          nodes: loaded.data.nodes.length,
          edges: loaded.data.edges.length,
          data: loaded.data,
        }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_write_map',
      description:
        '把一份结构化概念写成**新的**「析域」概念图文件。只能新建，不会覆盖已有文件（重名会报错，换个名字即可）；要改已有的图请用 synapsis_update_map。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '这张图的标题，如「离散数学（第六版）」' },
          name: { type: 'string', description: '可选文件名（须以 .mindmap.json 结尾）；不传则按标题自动起名' },
          nodes: { type: 'array', description: '节点数组。第一条通常是根（parent 为 null）。', items: NODE_SCHEMA },
          edges: EDGE_SCHEMA,
        },
        required: ['title', 'nodes'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            name: { type: 'string' },
            title: { type: 'string' },
            dir: { type: 'string' },
            nodes: { type: 'number' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
        render: (_args, value) => {
          const warn = value.warnings && value.warnings.length ? `\n修复了 ${value.warnings.length} 处结构问题（${[...new Set(value.warnings)].join(', ')}）` : ''
          return text(`已写入《${value.title}》：${value.nodes} 个节点\n${value.dir}\\${value.name}${warn}\n面板里点刷新（↻）即可看到。`)
        },
      },
      async execute(args) {
        const { doc, warnings } = normalizeDoc({ title: args.title, nodes: args.nodes, edges: args.edges || [] })
        assertDoc(JSON.parse(JSON.stringify(doc)))
        const made = await store.createFrom(doc, args.name)
        return { ok: true, name: made.name, title: doc.title, dir: store.root, nodes: doc.nodes.length, warnings }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_update_map',
      description:
        '局部更新一张**已有**的图：只传要改的节点与字段，没传的保持不变。必须先调用 synapsis_read_map 拿到 versionToken 并原样传回来，否则会被拒绝（防止覆盖用户后来的编辑）。不传 edges 就保留原有关系。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '要改的文件名，如 离散数学.mindmap.json' },
          versionToken: { type: 'string', description: 'synapsis_read_map 返回的 versionToken，必填' },
          title: { type: 'string', description: '可选，改整张图的标题；不传保留原值' },
          nodes: {
            type: 'array',
            description: '只列要改/要加的节点；每项必须带 id，其余字段只写要改的那些。',
            items: NODE_SCHEMA,
          },
          edges: { ...EDGE_SCHEMA, description: '可选。不传就保留原有关系；传了则整体替换。' },
          removeNodes: {
            type: 'array',
            items: { type: 'string' },
            description: '可选，要删掉的节点 id；其子节点会上提到它的父节点。',
          },
        },
        required: ['name', 'versionToken'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            name: { type: 'string' },
            mtime: { type: 'number' },
            versionToken: { type: 'string' },
            nodes: { type: 'number' },
            summary: { type: 'string' },
          },
        },
        render: (_args, value) =>
          text(`已更新 ${value.name}：现在 ${value.nodes} 个节点\n${value.summary}\n新版本令牌 versionToken=${value.versionToken}（继续改要重新读一次或用它）`),
      },
      async execute(args) {
        const loaded = await store.read(args.name)
        if (args.versionToken !== loaded.token) {
          throw Object.assign(new Error('stale'), { code: 'conflict', token: loaded.token, mtime: loaded.mtime })
        }
        const before = loaded.data
        const PATCH = ['title', 'en', 'parent', 'summary', 'definition', 'formal', 'intuition', 'examples', 'pitfalls', 'note', 'mastery', 'source']
        const nodes = before.nodes.map((n) => ({ ...n }))
        const byId = new Map(nodes.map((n) => [n.id, n]))
        for (const patch of args.nodes || []) {
          const id = String((patch && patch.id) || '').trim()
          if (!id) throw Object.assign(new Error('bad_doc'), { code: 'bad_doc', issues: ['node-id'] })
          const cur = byId.get(id)
          if (cur) {
            for (const k of PATCH) if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k]
          } else {
            const fresh = { id, title: patch.title || id, parent: patch.parent ?? null }
            for (const k of PATCH) if (Object.prototype.hasOwnProperty.call(patch, k)) fresh[k] = patch[k]
            nodes.push(fresh)
            byId.set(id, fresh)
          }
        }
        const drop = new Set((args.removeNodes || []).map((x) => String(x)))
        let kept = nodes
        if (drop.size) {
          const victimParent = new Map()
          for (const n of nodes) if (drop.has(n.id)) victimParent.set(n.id, n.parent)
          kept = nodes
            .filter((n) => !drop.has(n.id))
            .map((n) => (drop.has(n.parent) ? { ...n, parent: victimParent.get(n.parent) || null } : n))
        }
        const edges = Array.isArray(args.edges)
          ? args.edges
          : (before.edges || []).filter((e) => !drop.has(e.from) && !drop.has(e.to))
        const next = {
          ...before,
          title: typeof args.title === 'string' && args.title.trim() ? args.title.trim() : before.title,
          updated: new Date().toISOString(),
          nodes: kept,
          edges,
        }
        /* normalizeDoc 只做兼容性修补；save() 里还有 assertDoc 这道硬关口 */
        const { doc, warnings } = normalizeDoc(next)
        const diff = diffDocs(before, doc)
        const saved = await store.save(loaded.name, doc, loaded.token)
        return {
          ok: true,
          name: loaded.name,
          mtime: saved.mtime,
          versionToken: saved.token,
          nodes: doc.nodes.length,
          summary: diffText(diff) + (warnings.length ? `\n修复了 ${warnings.length} 处结构问题` : ''),
        }
      },
    }),
  )

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* 卸载期间忽略 */
      }
    }
  }
}

export function issuesText(issues) {
  return (issues || []).map((code) => ISSUE_TEXT[code] || code).join('；')
}

/* 系统提示：让模型知道「析域」是什么、文件长什么样、以及为什么不能直接覆盖。 */
export function promptSection(store) {
  return [
    '「析域」(Synapsis) 是当前 DSH 里的一个概念图面板，用户会把手里的教材讲义做成概念图来复习。',
    `图库目录：${store.root}。每张图是一个 .mindmap.json 文件，面板只读这个目录。`,
    '把讲义做成图时请走工具，不要自己写文件：',
    '1) 先用 synapsis_list_maps 看有没有同名图；2) 拆出章节与概念后，先用普通对话把「章节清单」给用户确认；3) 确认后用 synapsis_write_map 新建，或用 synapsis_update_map 整体替换已有图（update 会先读当前版本、给出改动摘要，再带版本校验写入）。',
    '文档结构：{ title, nodes[], edges[] }。节点必填 id、title、parent（根为 null），可选 en/summary/definition/formal/intuition/examples/pitfalls/source{page,snippet}。',
    '建议结构：根 → 章（depth 1）→ 主题（depth 2）→ 概念（depth 3），最深三层；id 用 chN / chN-topic-x / chN-x 这类稳定写法。',
    'formal 里可以直接写 LaTeX（$…$ 或 $$…$$），面板会用 KaTeX 渲染；summary 控制在一行 40 字内。',
    'edges 只表达跨分支关系：type 取 prereq（前置）、related（关联）、contrast（对比），父子从属关系由 parent 表达，不要写成边。',
    '规模上限：节点 5000、边 20000、单个文字字段 20000 字、层级 32。超过会被拒绝，宁可拆成两张图。',
    '写完告诉用户图的标题与文件名，并提示回面板点刷新（↻）即可看到；面板不会自动弹出来。',
  ].join('\n')
}
