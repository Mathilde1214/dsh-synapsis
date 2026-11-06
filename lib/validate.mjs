/* 一张图的规范化与自检。

   目标不是「拒绝坏文件」，而是「修好它并说清楚修了什么」——
   用户的图是长年积累的，任何一次静默丢节点都比显示一条警告糟糕得多。 */

export const EDGE_TYPES = new Set(['prereq', 'related', 'contrast'])
export const TEXT_FIELDS = ['summary', 'definition', 'formal', 'intuition', 'examples', 'pitfalls', 'note']

const str = (v) => (typeof v === 'string' ? v : '')

export function blankNode(id, title, parent) {
  const node = { id, title, en: '', parent, mastery: 0 }
  for (const f of TEXT_FIELDS) node[f] = ''
  return node
}

export function blankDoc(title) {
  return {
    version: 1,
    title,
    subtitle: '',
    updated: new Date().toISOString(),
    nodes: [blankNode('root', title, null)],
    edges: [],
  }
}

/* 返回 { doc, warnings }；warnings 是稳定错误码，界面负责翻译成中文。
   结构完全不可用时抛 code = 'bad_doc'。 */
export function normalizeDoc(input) {
  const warnings = []
  if (!input || typeof input !== 'object' || !Array.isArray(input.nodes)) {
    throw Object.assign(new Error('bad document'), { code: 'bad_doc' })
  }

  const nodes = []
  const byId = new Map()
  for (const raw of input.nodes) {
    if (!raw || typeof raw !== 'object') {
      warnings.push('node-invalid')
      continue
    }
    const id = str(raw.id).trim()
    if (!id) {
      warnings.push('node-no-id')
      continue
    }
    if (byId.has(id)) {
      warnings.push('node-duplicate')
      continue
    }
    const node = {
      id,
      title: str(raw.title).trim() || id,
      en: str(raw.en),
      parent: typeof raw.parent === 'string' && raw.parent.trim() ? raw.parent.trim() : null,
      mastery: raw.mastery === 1 || raw.mastery === 2 ? raw.mastery : 0,
    }
    for (const f of TEXT_FIELDS) node[f] = str(raw[f])
    if (raw.source && typeof raw.source === 'object') {
      const page = Number(raw.source.page) || 0
      const snippet = str(raw.source.snippet)
      if (page || snippet) node.source = { page, snippet }
    }
    nodes.push(node)
    byId.set(id, node)
  }

  if (!nodes.length) {
    warnings.push('doc-empty')
    const root = blankNode('root', str(input.title).trim() || '未命名图', null)
    nodes.push(root)
    byId.set('root', root)
  }

  /* 根：优先 id 叫 root，其次第一个没有父节点的，最后兜底第一个 */
  let root = byId.get('root')
  if (!root) root = nodes.find((n) => !n.parent || !byId.has(n.parent)) || nodes[0]
  root.parent = null

  /* 父节点：不存在 / 指向自己 → 挂回根 */
  for (const n of nodes) {
    if (n === root) continue
    if (n.parent === n.id) {
      warnings.push('node-self-parent')
      n.parent = root.id
      continue
    }
    if (!n.parent || !byId.has(n.parent)) {
      if (n.parent) warnings.push('parent-missing')
      n.parent = root.id
    }
  }

  /* 环：顺着 parent 往上走，走超过节点数还没到根，就说明在环里 */
  const limit = nodes.length + 1
  for (const n of nodes) {
    if (n === root) continue
    let cursor = n
    let steps = 0
    while (cursor && cursor !== root && steps <= limit) {
      cursor = byId.get(cursor.parent)
      steps += 1
    }
    if (cursor !== root) {
      n.parent = root.id
      warnings.push('node-cycle')
    }
  }

  /* 边：端点必须存在、不能自环、同一条只留一个 */
  const seen = new Set()
  const edges = []
  const rawEdges = Array.isArray(input.edges) ? input.edges : []
  for (const raw of rawEdges) {
    if (!raw || typeof raw !== 'object') continue
    const from = str(raw.from).trim()
    const to = str(raw.to).trim()
    const type = str(raw.type).trim()
    if (!from || !to || !byId.has(from) || !byId.has(to) || from === to) {
      warnings.push('edge-dangling')
      continue
    }
    const kind = EDGE_TYPES.has(type) ? type : 'related'
    if (kind !== type) warnings.push('edge-type')
    const key = from + '->' + to + ':' + kind
    if (seen.has(key)) {
      warnings.push('edge-duplicate')
      continue
    }
    seen.add(key)
    edges.push({ from, to, type: kind })
  }

  const doc = {
    version: 1,
    title: str(input.title).trim() || root.title,
    subtitle: str(input.subtitle),
    updated: str(input.updated) || new Date().toISOString(),
    nodes,
    edges,
  }
  /* 注意：warnings 里同一个码可能出现多次，界面按「出现次数」报「已修复 N 处」，
     所以这里故意不去重。 */
  return { doc, warnings }
}

/* 界面文案：错误码 → 人话。未知码原样透出，便于以后加规则。 */
export const WARNING_TEXT = {
  'node-invalid': '有 %n% 个节点不是对象，已跳过',
  'node-no-id': '有 %n% 个节点没有 id，已跳过',
  'node-duplicate': '有 %n% 个节点 id 重复，只保留了第一个',
  'doc-empty': '文件里没有节点，已建了一个空根',
  'parent-missing': '有 %n% 个节点的父节点不存在，已挂回根下',
  'node-self-parent': '有 %n% 个节点把自己当成了父节点，已挂回根下',
  'node-cycle': '有 %n% 个节点父子成环，已断开挂回根下',
  'edge-dangling': '有 %n% 条边指向不存在的节点，已移除',
  'edge-type': '有 %n% 条边的类型不认识，已改成「关联」',
  'edge-duplicate': '有 %n% 条重复的边，已合并',
}
