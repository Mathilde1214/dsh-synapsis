import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createStore } from '../lib/store.mjs'
import { registerTools } from '../lib/tools.mjs'

function fakeCtx() {
  const tools = []
  return {
    tools,
    ctx: {
      tools: {
        register(definition) {
          tools.push(definition)
          return () => {}
        },
      },
    },
  }
}

function textOf(value, args) {
  const tool = fakeCtx.tools
  return tool
}

test('模型能看见图库里有哪些图，也能读到图的正文', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-tools-'))
  const store = createStore(dir)
  const made = await store.create('讲义第一讲')
  const doc = structuredClone(made.data)
  doc.nodes[0].definition = '这是根节点的定义，模型必须看得到'
  doc.nodes.push({ id: 'n2', title: '子概念', parent: doc.nodes[0].id, definition: '子概念的解释' })
  await store.save(made.name, doc, made.mtime)

  const { ctx, tools } = fakeCtx()
  registerTools(ctx, store)
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]))

  const listed = await byName.synapsis_list_maps.execute({})
  const listText = byName.synapsis_list_maps.output.render({}, listed)
    .map((block) => block.text)
    .join('\n')
  assert.match(listText, /讲义第一讲/, '模型可见内容里要有标题')
  assert.match(listText, /2 个节点/, '要有节点数')

  const read = await byName.synapsis_read_map.execute({ name: made.name })
  const readText = byName.synapsis_read_map.output.render({ name: made.name }, read)
    .map((block) => block.text)
    .join('\n')
  assert.match(readText, /这是根节点的定义/, '模型可见内容里必须有正文')
  assert.match(readText, /子概念/, '要包含子节点')

  const full = byName.synapsis_read_map.execute({ name: made.name, detail: 'full' })
  const fullText = byName.synapsis_read_map.output.render({ detail: 'full' }, await full)
    .map((block) => block.text)
    .join('\n')
  assert.match(fullText, /"nodes"/, 'full 模式给原始 JSON')

  await fs.rm(dir, { recursive: true, force: true })
})

test('更新工具会先读版本，并给出改动摘要', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-tools2-'))
  const store = createStore(dir)
  const made = await store.create('要更新的图')
  const { ctx, tools } = fakeCtx()
  registerTools(ctx, store)
  const update = tools.find((t) => t.name === 'synapsis_update_map')
  const loaded = await store.read(made.name)

  const doc = structuredClone(loaded.data)
  doc.nodes[0].title = '改过的标题'
  const result = await update.execute({ name: made.name, nodes: doc.nodes, edges: doc.edges })
  const text = update.output.render({ name: made.name }, result)
    .map((b) => b.text)
    .join('\n')
  assert.match(text, /改动|更新|节点/, '要有改动摘要')

  const after = await store.read(made.name)
  assert.equal(after.data.nodes[0].title, '改过的标题')

  /* 版本落后 → conflict，而不是悄悄覆盖 */
  await assert.rejects(
    () => update.execute({ name: made.name, nodes: doc.nodes, expectMtime: loaded.mtime - 1 }),
    (err) => err.code === 'conflict',
  )
  await fs.rm(dir, { recursive: true, force: true })
})
