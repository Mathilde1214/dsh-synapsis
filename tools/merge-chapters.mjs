/* 把 tmp/chapters/*.json 合成一份完整的 .mindmap.json */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] || 'tmp/chapters'
const out = process.argv[3] || 'E:/dsh工作空间/析域/离散数学（第六版）.mindmap.json'
const title = process.argv[4] || '离散数学（第六版）'
const subtitle = process.argv[5] || '耿素云 · 屈婉玲 · 张立昂'

const files = fs.readdirSync(dir).filter((f) => /^ch\d+\.json$/.test(f)).sort((a, b) => {
  return parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10)
})
if (!files.length) throw new Error('no chapter json in ' + dir)

const nodes = []
const edges = []
const seen = new Set()
const chapters = []

for (const f of files) {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  const list = doc.nodes || []
  const chNode = list.find((n) => n.parent === 'root') || list[0]
  if (!chNode) continue
  chapters.push(chNode)
  for (const n of list) {
    if (n.id === chNode.id) {
      n.parent = 'root'
    }
    if (seen.has(n.id)) {
      console.warn('dup id', n.id, 'in', f)
      continue
    }
    seen.add(n.id)
    nodes.push({
      id: n.id,
      title: n.title || '未命名',
      en: n.en || '',
      parent: n.parent === 'root' ? 'root' : n.parent || 'root',
      summary: n.summary || '',
      definition: n.definition || '',
      formal: n.formal || '',
      intuition: n.intuition || '',
      examples: n.examples || '',
      pitfalls: n.pitfalls || '',
      ...(n.source && n.source.page ? { source: { page: n.source.page, snippet: n.source.snippet || '' } } : {}),
      mastery: 0,
      note: '',
    })
  }
  for (const e of doc.edges || []) edges.push(e)
}

const root = {
  id: 'root',
  title,
  en: 'Discrete Mathematics',
  parent: null,
  summary: subtitle + ' · ' + chapters.length + ' 章',
  definition: '以离散量为研究对象，研究其结构与相互关系，是计算机科学的数学基础。',
  formal: '',
  intuition: '把整本书铺成一张可以走进去的地图：从总览一路缩放到某个概念的原文出处。',
  examples: '',
  pitfalls: '',
  mastery: 0,
  note: '',
}

const ids = new Set(['root', ...nodes.map((n) => n.id)])
const badParent = nodes.filter((n) => n.parent !== 'root' && !ids.has(n.parent))
if (badParent.length) {
  console.warn('fix orphan parents:', badParent.map((n) => n.id + '<-' + n.parent).join(', '))
  for (const n of badParent) n.parent = 'root'
}
const cleanEdges = []
const edgeKey = new Set()
for (const e of edges) {
  if (!ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue
  const k = e.from + '>' + e.to + '>' + (e.type || 'related')
  if (edgeKey.has(k)) continue
  edgeKey.add(k)
  cleanEdges.push({ from: e.from, to: e.to, type: e.type || 'related' })
}

const doc = {
  version: 1,
  id: 'shulixue-diliuban',
  title,
  subtitle: subtitle + ' · 清华大学出版社',
  updated: new Date().toISOString().slice(0, 10),
  nodes: [root, ...nodes],
  edges: cleanEdges,
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify(doc, null, 1), 'utf8')

const byDepth = {}
for (const n of doc.nodes) {
  let d = 0
  let cur = n
  while (cur.parent && cur.parent !== 'root') {
    cur = doc.nodes.find((x) => x.id === cur.parent) || { parent: null }
    d++
  }
  byDepth[d] = (byDepth[d] || 0) + 1
}
console.log('wrote', out)
console.log('chapters', chapters.length, 'nodes', doc.nodes.length, 'edges', cleanEdges.length, 'byDepth', JSON.stringify(byDepth))
