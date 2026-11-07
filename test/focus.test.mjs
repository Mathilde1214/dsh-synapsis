import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'

import { createStore } from '../lib/store.mjs'
import { registerTools } from '../lib/tools.mjs'

/* 「让面板跳到某个概念」：意图文件写读往返，以及工具能否按标题找到节点 */
function fakeCtx(box) {
  return {
    tools: { register: (def) => { box.push(def); return () => {} } },
  }
}

test('聚焦意图：写进去再读回来，坏名字直接拒', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-focus-'))
  const store = createStore(dir)
  const made = await store.create({ title: '聚焦测试' })

  const saved = await store.setFocus({ name: made.name, nodeId: 'root', title: '根' })
  assert.equal(saved.nodeId, 'root')
  assert.ok(saved.at > 0)

  const back = await store.readFocus()
  assert.equal(back.name, made.name)
  assert.equal(back.nodeId, 'root')
  assert.equal(back.title, '根')

  await assert.rejects(() => store.setFocus({ name: '../x.mindmap.json' }), (err) => err.code === 'bad_name')
  await fs.rm(dir, { recursive: true, force: true })
})

test('聚焦工具：能按标题找到节点，找不到报 not_found', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-focus-tool-'))
  const store = createStore(dir)
  const doc = {
    title: '工具聚焦',
    nodes: [
      { id: 'root', title: '根', parent: null },
      { id: 'a', title: '哈夫曼算法', parent: 'root', summary: '反复合并两个最小权顶点' },
    ],
    edges: [],
  }
  await store.createFrom(doc, '工具聚焦.mindmap.json')

  const box = []
  registerTools(fakeCtx(box), store)
  const tool = box.find((d) => d.name === 'synapsis_focus_map')
  assert.ok(tool, '应当注册了 synapsis_focus_map')

  const hit = await tool.execute({ name: '工具聚焦.mindmap.json', query: '哈夫曼' })
  assert.equal(hit.nodeId, 'a')

  const again = await store.readFocus()
  assert.equal(again.nodeId, 'a')
  assert.equal(again.title, '哈夫曼算法')

  await assert.rejects(() => tool.execute({ name: '工具聚焦.mindmap.json', query: '不存在的词' }), (err) => err.code === 'not_found')
  await fs.rm(dir, { recursive: true, force: true })
})
