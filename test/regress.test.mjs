import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { safeName } from '../lib/paths.mjs'
import { assertDoc, normalizeDoc } from '../lib/validate.mjs'
import { createStore } from '../lib/store.mjs'
import { registerTools } from '../lib/tools.mjs'

const source = await fs.readFile(new URL('../core/synapsis-core.js', import.meta.url), 'utf8')
const createMindMap = new Function(source + '\nreturn createMindMap;')()
/* 工厂返回 { MindMap, buildLayout, fitFor, createMathRenderer, sortReviewPool }：
   这里只测不依赖渲染器的几个纯函数，所以 React 给个空壳就够。 */
const mind = createMindMap({
  createElement: () => null,
  Fragment: 'fragment',
  useState: (v) => [v, () => {}],
  useMemo: (f) => f(),
  useRef: (v) => ({ current: v }),
  useCallback: (f) => f,
  useEffect: () => {},
})

const blank = (title) => ({
  version: 1,
  title,
  subtitle: '',
  updated: new Date().toISOString(),
  nodes: [{ id: 'root', title, parent: null, mastery: 0 }],
  edges: [],
})

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-regress-'))
  return { store: createStore(dir), dir }
}

test('Windows 设备名带扩展名也要拒绝', () => {
  assert.equal(safeName('CON.foo.mindmap.json'), null)
  assert.equal(safeName('lpt9.x.mindmap.json'), null)
  assert.equal(safeName('console.mindmap.json'), 'console.mindmap.json')
})

test('保存到不存在的文件返回 gone，新建只能走 create', async () => {
  const { store, dir } = await tempStore()
  await assert.rejects(
    () => store.save('不存在.mindmap.json', blank('x'), 'whatever'),
    (err) => err.code === 'gone',
  )
  await fs.rm(dir, { recursive: true, force: true })
})

test('版本令牌精确：内容变一次，旧令牌就失效', async () => {
  const { store, dir } = await tempStore()
  const made = await store.create('两个版本')
  const v1 = structuredClone(made.data)
  v1.nodes[0].title = 'A'
  const s1 = await store.save(made.name, v1, made.token)
  const v2 = structuredClone(v1)
  v2.nodes[0].title = 'B'
  const s2 = await store.save(made.name, v2, s1.token)
  assert.notEqual(s1.token, s2.token)
  await assert.rejects(
    () => store.save(made.name, v1, s1.token),
    (err) => err.code === 'conflict' && err.token === s2.token,
  )
  await fs.rm(dir, { recursive: true, force: true })
})

test('多根 / 自环 / 类型错误都会被拒；未知字段不会丢', () => {
  const multi = { ...blank('多根'), nodes: [{ id: 'a', title: 'a', parent: null }, { id: 'b', title: 'b', parent: null }] }
  assert.throws(() => assertDoc(multi), (err) => err.code === 'bad_doc' && err.issues.includes('multi-root'))

  const loop = { ...blank('环'), nodes: [{ id: 'root', title: 'r', parent: null }, { id: 'a', title: 'a', parent: 'b' }, { id: 'b', title: 'b', parent: 'a' }] }
  assert.throws(() => assertDoc(loop), (err) => err.code === 'bad_doc' && err.issues.includes('cycle'))

  const typed = { ...blank('类型'), nodes: [{ id: 'root', title: 'r', parent: null, mastery: 7 }] }
  assert.throws(() => assertDoc(typed), (err) => err.code === 'bad_doc')

  const rich = { ...blank('保留'), tags: ['a', 'b'], extra: { keep: true }, nodes: [{ id: 'root', title: 'r', parent: null, tags: ['x'], position: { x: 1 } }] }
  const { doc } = normalizeDoc(rich)
  assert.deepEqual(doc.tags, ['a', 'b'])
  assert.deepEqual(doc.extra, { keep: true })
  assert.deepEqual(doc.nodes[0].tags, ['x'])
  assert.deepEqual(doc.nodes[0].position, { x: 1 })
})

test('大图校验是线性的（5000 节点不卡）', () => {
  /* 深度限制是 32，所以这里做一棵「宽而浅」的树来测规模，而成环检测本身就是线性的 */
  const nodes = [{ id: 'root', title: 'r', parent: null }]
  for (let i = 0; i < 4999; i += 1) nodes.push({ id: `n${i}`, title: `n${i}`, parent: 'root' })
  const started = Date.now()
  assert.doesNotThrow(() => assertDoc({ ...blank('大图'), nodes }))
  assert.ok(Date.now() - started < 3000, '5000 节点应在 3 秒内完成')
})

test('本地没学过的概念和复习过的没印象不是一回事：排序仍分档', () => {
  const nodes = [
    { id: 'root', title: 'root', parent: null },
    { id: 'a', title: '甲', parent: 'root', mastery: 2, definition: 'x' },
    { id: 'b', title: '乙', parent: 'root', mastery: 0, definition: 'x' },
    { id: 'c', title: '丙', parent: 'root', mastery: 1, definition: 'x' },
  ]
  const pool = mind.sortReviewPool(nodes, 'root')
  assert.deepEqual(pool.map((n) => n.id), ['c', 'b', 'a'])
})

test('id 叫 constructor 的节点不会被顺手删掉', () => {
  const map = mind
  assert.equal(typeof map.buildLayout, 'function')
  const nodes = [
    { id: 'root', title: 'root', parent: null },
    { id: 'constructor', title: '构造器', parent: 'root' },
    { id: 'toString', title: '字符串', parent: 'root' },
  ]
  const layout = map.buildLayout(nodes, 'root')
  assert.ok(layout.byId.has('constructor'))
  assert.ok(layout.byId.has('toString'))
  assert.equal(layout.order.length, 3)
})

test('更新工具：局部改一个字段，不碰关系与掌握度；带旧令牌会被拒', async () => {
  const { store, dir } = await tempStore()
  const made = await store.create('局部更新')
  const v2 = structuredClone(made.data)
  v2.nodes[0].title = '局部更新'
  v2.nodes.push({ id: 'kid', title: '子', parent: 'root', mastery: 2, note: '我的笔记', definition: '原来的定义' })
  v2.edges = [{ from: 'root', to: 'kid', type: 'related' }]
  const saved = await store.save(made.name, v2, made.token)

  const { ctx, tools } = fakeCtx()
  registerTools(ctx, store)
  const update = tools.find((t) => t.name === 'synapsis_update_map')
  const loaded = await store.read(made.name)

  await update.execute({
    name: made.name,
    versionToken: loaded.token,
    nodes: [{ id: 'kid', definition: '改过的定义' }],
  })
  const after = await store.read(made.name)
  const kid = after.data.nodes.find((n) => n.id === 'kid')
  assert.equal(kid.definition, '改过的定义')
  assert.equal(kid.mastery, 2, '没传的掌握度要保留')
  assert.equal(kid.note, '我的笔记', '没传的笔记要保留')
  assert.equal(after.data.edges.length, 1, '不传 edges 时关系要保留')

  await assert.rejects(
    () => update.execute({ name: made.name, versionToken: saved.token, nodes: [{ id: 'kid', note: 'x' }] }),
    (err) => err.code === 'conflict',
  )
  await fs.rm(dir, { recursive: true, force: true })
})

function fakeCtx() {
  const tools = []
  return {
    tools,
    ctx: {
      tools: { register: (def) => { tools.push(def); return () => {} } },
    },
  }
}
