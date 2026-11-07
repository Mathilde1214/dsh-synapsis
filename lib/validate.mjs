/* 一张图的规范化与校验。

   两条路：
   - normalizeDoc：读取 / 导入时「修好它并说清楚修了什么」——用户的图是长年积累的，
     静默丢节点比显示一条警告糟糕得多。
   - assertDoc：普通保存前「只检查，不改」——保存路径上悄悄改内容等于替用户做决定，
     真有问题应该告诉他，让他决定是修还是另存。 */

export const EDGE_TYPES = new Set(['prereq', 'related', 'contrast'])
export const TEXT_FIELDS = ['summary', 'definition', 'formal', 'intuition', 'examples', 'pitfalls', 'note']
export const SUPPORTED_VERSION = 1

export const LIMITS = {
  nodes: 5000,
  edges: 20000,
  textField: 20000,
  depth: 32,
  bytes: 8 * 1024 * 1024,
}

const str = (v) => (typeof v === 'string' ? v : '')
const bad = (code, extra) => Object.assign(new Error(code), { code }, extra || {})

export function blankNode(id, title, parent) {
  const node = { id, title, en: '', parent, mastery: 0 }
  for (const f of TEXT_FIELDS) node[f] = ''
  return node
}

export function blankDoc(title) {
  return {
    version: SUPPORTED_VERSION,
    title,
    subtitle: '',
    updated: new Date().toISOString(),
    nodes: [blankNode('root', title, null)],
    edges: [],
  }
}

function pickRoot(nodes, byId) {
  let root = byId.get('root')
  if (!root) root = nodes.find((n) => !n.parent || !byId.has(n.parent)) || nodes[0]
  return root
}

/* 从根往下算最大深度（边数量），坏数据里成环时按已访问集合截断 */
export function treeDepth(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const root = pickRoot(nodes, byId)
  const children = new Map()
  for (const n of nodes) {
    if (n === root) continue
    const p = byId.has(n.parent) ? n.parent : root.id
    if (!children.has(p)) children.set(p, [])
    children.get(p).push(n)
  }
  let max = 0
  const stack = [[root, 0]]
  const seen = new Set([root.id])
  while (stack.length) {
    const [node, d] = stack.pop()
    if (d > max) max = d
    for (const kid of children.get(node.id) || []) {
      if (seen.has(kid.id)) continue
      seen.add(kid.id)
      stack.push([kid, d + 1])
    }
  }
  return max
}

/* 顺 parent 链找环，O(n)：每个节点只走一次，走过的标 2；
   走到「本次路径里出现过」的节点就是环。 */
function cycleIds(parents) {
  const state = new Map()
  const inCycle = new Set()
  for (const start of parents.keys()) {
    if (state.get(start) === 2) continue
    const path = []
    const seenAt = new Map()
    let cursor = start
    while (cursor) {
      const st = state.get(cursor)
      if (st === 2) break
      if (seenAt.has(cursor)) {
        for (let i = seenAt.get(cursor); i < path.length; i += 1) inCycle.add(path[i])
        break
      }
      seenAt.set(cursor, path.length)
      path.push(cursor)
      cursor = parents.get(cursor) || null
    }
    for (const id of path) state.set(id, 2)
  }
  return inCycle
}

/* 保存前的严格检查：只报错，不动数据。返回 void，失败抛 code = 'bad_doc' 且带 issues。 */
export function assertDoc(input) {
  const issues = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw bad('bad_doc', { issues: ['not-object'] })
  }
  /* 版本号必须是真整数：Number('1') / Number(true) / Number(null) 都会「通过」，
     但它们不是合法的版本号，放过等于把畸形文件写回磁盘 */
  if (input.version !== undefined && !(Number.isInteger(input.version) && input.version >= 1)) {
    issues.push('version-invalid')
  }
  if (Number.isInteger(input.version) && input.version > SUPPORTED_VERSION) {
    throw bad('bad_doc', { issues: ['version-too-new'] })
  }
  if (!Array.isArray(input.nodes) || !input.nodes.length) throw bad('bad_doc', { issues: ['no-nodes'] })
  if (input.nodes.length > LIMITS.nodes) issues.push('too-many-nodes')
  if (Array.isArray(input.edges) && input.edges.length > LIMITS.edges) issues.push('too-many-edges')
  try {
    if (Buffer.byteLength(JSON.stringify(input), 'utf8') > LIMITS.bytes) issues.push('too-large')
  } catch {
    issues.push('not-object')
  }

  if (typeof input.title === 'string' && input.title.length > 400) issues.push('text-too-long')
  if (typeof input.subtitle === 'string' && input.subtitle.length > 400) issues.push('text-too-long')

  const ids = new Set()
  for (const raw of input.nodes) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push('node-invalid')
      continue
    }
    const id = str(raw.id).trim()
    if (!id || ids.has(id)) issues.push('node-id')
    else ids.add(id)
    if (raw.parent !== null && raw.parent !== undefined && typeof raw.parent !== 'string') issues.push('node-invalid')
    if (raw.mastery !== undefined && ![0, 1, 2].includes(raw.mastery)) issues.push('node-invalid')
    for (const f of TEXT_FIELDS) {
      if (typeof raw[f] !== 'string' && raw[f] !== undefined && raw[f] !== null) issues.push('node-invalid')
      if (str(raw[f]).length > LIMITS.textField) issues.push('text-too-long')
    }
    if (str(raw.title).length > 400) issues.push('text-too-long')
  }

  const parents = new Map()
  let roots = 0
  for (const raw of input.nodes) {
    if (!raw || typeof raw !== 'object') continue
    const id = str(raw.id).trim()
    if (!id) continue
    const parent = str(raw.parent).trim()
    parents.set(id, parent || null)
    if (!parent) roots += 1
    else if (!ids.has(parent)) issues.push('parent-missing')
    else if (parent === id) issues.push('self-parent')
  }
  /* 一张图只有一棵树：多根会让布局和删除语义都变得含糊 */
  if (roots > 1) issues.push('multi-root')
  if (cycleIds(parents).size) issues.push('cycle')

  if (Array.isArray(input.edges)) {
    const seenEdge = new Set()
    for (const raw of input.edges) {
      if (!raw || typeof raw !== 'object') {
        issues.push('edge-invalid')
        continue
      }
      const from = str(raw.from).trim()
      const to = str(raw.to).trim()
      if (!from || !to || !ids.has(from) || !ids.has(to) || from === to) {
        issues.push('edge-invalid')
        continue
      }
      const type = str(raw.type).trim() || 'related'
      if (!EDGE_TYPES.has(type)) issues.push('edge-type')
      const key = from + '->' + to + ':' + type
      if (seenEdge.has(key)) issues.push('edge-duplicate')
      seenEdge.add(key)
    }
  }

  if (!issues.length) {
    const depth = treeDepth(
      input.nodes
        .filter((n) => n && typeof n === 'object' && str(n.id).trim())
        .map((n) => ({
          id: str(n.id).trim(),
          parent: str(n.parent).trim() || null,
        })),
    )
    if (depth > LIMITS.depth) issues.push('too-deep')
  }

  if (issues.length) throw bad('bad_doc', { issues: [...new Set(issues)] })
}

/* 返回 { doc, warnings }；warnings 是稳定错误码，界面负责翻译成中文。
   结构完全不可用时抛 code = 'bad_doc'。 */
export function normalizeDoc(input) {
  const warnings = []
  if (!input || typeof input !== 'object' || !Array.isArray(input.nodes)) {
    throw bad('bad_doc', { issues: ['not-object'] })
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
    /* 先原样带上不认识的字段（tags / position / 别人工具写的 key），再覆盖已知字段：
       这样「读一遍再存回去」不会把别人的东西抹掉。 */
    const node = { ...raw }
    node.id = id
    node.title = str(raw.title).trim() || id
    node.en = str(raw.en)
    node.parent = typeof raw.parent === 'string' && raw.parent.trim() ? raw.parent.trim() : null
    node.mastery = raw.mastery === 1 || raw.mastery === 2 ? raw.mastery : 0
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

  const root = pickRoot(nodes, byId)
  root.parent = null

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

  /* 不认识的顶层字段原样留着（数组、对象都留），下次保存别丢 */
  const known = new Set(['version', 'title', 'subtitle', 'updated', 'nodes', 'edges'])
  const extra = {}
  for (const key of Object.keys(input)) {
    if (known.has(key)) continue
    extra[key] = input[key]
  }

  const versionOk = Number.isInteger(input.version) && input.version >= 1
  if (versionOk && input.version > SUPPORTED_VERSION) warnings.push('version-newer')
  if (!versionOk && input.version !== undefined) warnings.push('version-invalid')

  const doc = {
    ...extra,
    /* 版本更高的文件不降级：降了之后保存校验就拦不住「用旧结构盖新结构」 */
    version: versionOk && input.version > SUPPORTED_VERSION ? input.version : SUPPORTED_VERSION,
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
  'version-newer': '文件版本比这个插件新，已按旧结构读，可能有字段没认出来',
  'version-invalid': '文件的版本号不是合法整数（已按 1 处理，保存前会拦下）',
}

/* 保存被拒时，界面要把 issues 翻成人话 */
export const ISSUE_TEXT = {
  'not-object': '内容不是一张图',
  'no-nodes': '一个节点都没有',
  'version-too-new': '这个文件是更新版本的析域写的，当前插件读不了',
  'version-invalid': '文件的版本号不是合法整数',
  'too-many-nodes': '节点太多（上限 5000）',
  'too-many-edges': '连边太多（上限 20000）',
  'text-too-long': '有字段太长（单字段上限 20000 字）',
  'node-invalid': '有节点不是对象',
  'node-id': '有节点缺 id 或 id 重复',
  'parent-missing': '有节点的父节点不存在',
  'self-parent': '有节点把自己当成父节点',
  cycle: '节点父子成环',
  'multi-root': '有不止一个根节点（一张图只能有一棵树）',
  'too-large': '文件太大（上限 8MB）',
  'edge-invalid': '有边指向不存在的节点或自己连自己',
  'edge-type': '有边的类型不认识',
  'too-deep': '层级太深（上限 32 层）',
}
