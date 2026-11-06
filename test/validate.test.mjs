import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDoc, blankDoc, WARNING_TEXT } from '../lib/validate.mjs'

const node = (id, parent, extra = {}) => ({ id, title: id, parent, ...extra })

test('blankDoc 只有一个根节点', () => {
  const doc = blankDoc('未命名图')
  assert.equal(doc.nodes.length, 1)
  assert.equal(doc.nodes[0].id, 'root')
  assert.equal(doc.nodes[0].parent, null)
  assert.deepEqual(doc.edges, [])
})

test('正常文档原样通过，不产生警告', () => {
  const { doc, warnings } = normalizeDoc({
    title: '离散数学',
    nodes: [node('root', null), node('a', 'root'), node('b', 'a')],
    edges: [{ from: 'a', to: 'b', type: 'prereq' }],
  })
  assert.deepEqual(warnings, [])
  assert.equal(doc.nodes.length, 3)
  assert.equal(doc.edges.length, 1)
  assert.equal(doc.title, '离散数学')
})

test('重复 id 只保留第一个，并报警', () => {
  const { doc, warnings } = normalizeDoc({
    nodes: [node('root', null), node('x', 'root'), { ...node('x', 'root'), title: '第二个 x' }],
  })
  assert.equal(doc.nodes.filter((n) => n.id === 'x').length, 1)
  assert.equal(doc.nodes.find((n) => n.id === 'x').title, 'x')
  assert.ok(warnings.includes('node-duplicate'))
})

test('缺 id 与非法节点被跳过', () => {
  const { doc, warnings } = normalizeDoc({
    nodes: [node('root', null), { title: '没有 id' }, null, node('ok', 'root')],
  })
  assert.equal(doc.nodes.length, 2)
  assert.ok(warnings.includes('node-no-id'))
  assert.ok(warnings.includes('node-invalid'))
})

test('父节点不存在时挂回根，不丢节点', () => {
  const { doc, warnings } = normalizeDoc({
    nodes: [node('root', null), node('lost', 'ghost'), node('a', 'root')],
  })
  assert.equal(doc.nodes.length, 3)
  assert.equal(doc.nodes.find((n) => n.id === 'lost').parent, 'root')
  assert.equal(warnings.filter((w) => w === 'parent-missing').length, 1)
})

test('父子成环会被断开，节点仍在图上', () => {
  const { doc, warnings } = normalizeDoc({
    nodes: [node('root', null), node('a', 'b'), node('b', 'a')],
  })
  assert.equal(doc.nodes.length, 3)
  assert.ok(warnings.includes('node-cycle'))
  /* 环上至少有一个被挂回根，顺着 parent 一定能走到 root */
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  doc.nodes.forEach((n) => {
    let cursor = n
    let steps = 0
    while (cursor && cursor.parent && steps < 10) {
      cursor = byId.get(cursor.parent)
      steps += 1
    }
    assert.equal(cursor && cursor.id, 'root', 'node ' + n.id + ' 无法走到 root')
  })
})

test('自己当自己的父节点会被挂回根', () => {
  const { doc, warnings } = normalizeDoc({ nodes: [node('root', null), node('a', 'a')] })
  assert.equal(doc.nodes.find((n) => n.id === 'a').parent, 'root')
  assert.ok(warnings.includes('node-self-parent'))
})

test('边：悬空、自环、重复、未知类型都被清理', () => {
  const { doc, warnings } = normalizeDoc({
    nodes: [node('root', null), node('a', 'root'), node('b', 'root')],
    edges: [
      { from: 'a', to: 'ghost', type: 'prereq' },
      { from: 'a', to: 'a', type: 'prereq' },
      { from: 'a', to: 'b', type: 'prereq' },
      { from: 'a', to: 'b', type: 'prereq' },
      { from: 'b', to: 'a', type: 'weird' },
    ],
  })
  assert.deepEqual(
    doc.edges.map((e) => [e.from, e.to, e.type]),
    [
      ['a', 'b', 'prereq'],
      ['b', 'a', 'related'],
    ],
  )
  assert.ok(warnings.includes('edge-dangling'))
  assert.ok(warnings.includes('edge-duplicate'))
  assert.ok(warnings.includes('edge-type'))
})

test('空 nodes 会建一个空根并报警', () => {
  const { doc, warnings } = normalizeDoc({ title: '空的', nodes: [] })
  assert.equal(doc.nodes.length, 1)
  assert.equal(doc.nodes[0].id, 'root')
  assert.equal(doc.nodes[0].title, '空的')
  assert.ok(warnings.includes('doc-empty'))
})

test('nodes 不是数组时抛 bad_doc', () => {
  assert.throws(
    () => normalizeDoc({ nodes: 'nope' }),
    (err) => err.code === 'bad_doc',
  )
  assert.throws(
    () => normalizeDoc(null),
    (err) => err.code === 'bad_doc',
  )
})

test('mastery 只接受 0/1/2，其它归零；文本字段补空串', () => {
  const { doc } = normalizeDoc({
    nodes: [node('root', null), node('a', 'root', { mastery: 7, summary: 42, formal: 'x \\in y' })],
  })
  const a = doc.nodes.find((n) => n.id === 'a')
  assert.equal(a.mastery, 0)
  assert.equal(a.summary, '')
  assert.equal(a.formal, 'x \\in y')
  assert.equal(a.note, '')
})

test('WARNING_TEXT 覆盖所有可能出现的码', () => {
  const codes = [
    'node-invalid',
    'node-no-id',
    'node-duplicate',
    'doc-empty',
    'parent-missing',
    'node-cycle',
    'edge-dangling',
    'edge-type',
    'edge-duplicate',
  ]
  codes.forEach((code) => assert.ok(WARNING_TEXT[code], 'missing text for ' + code))
})
