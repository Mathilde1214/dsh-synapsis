import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createStore } from '../lib/store.mjs'
import { blankDoc } from '../lib/validate.mjs'

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-store-'))
  return { dir, store: createStore(dir) }
}

test('新建、读回、列表（按修改时间倒序）', async () => {
  const { store, dir } = await tempStore()
  const a = await store.create('甲图')
  assert.equal(a.name, '甲图.mindmap.json')
  await new Promise((r) => setTimeout(r, 12))
  const b = await store.createFrom(blankDoc('乙图'))
  assert.equal(b.name, '乙图.mindmap.json')

  const items = await store.list()
  assert.equal(items.length, 2)
  assert.equal(items[0].name, '乙图.mindmap.json', '最近修改的排最前')
  assert.equal(items[0].title, '乙图')
  assert.equal(items[0].nodes, 1)

  const loaded = await store.read(b.name)
  assert.equal(loaded.data.title, '乙图')
  assert.ok(typeof loaded.mtime === 'number')
  assert.deepEqual(loaded.warnings, [])
  await fs.rm(dir, { recursive: true, force: true })
})

test('保存带 baseMtime：对得上就成功，对不上返回 conflict', async () => {
  const { store, dir } = await tempStore()
  const created = await store.create('冲突图')
  const doc = structuredClone(created.data)
  doc.nodes[0].title = '第一改'
  const first = await store.save(created.name, doc, created.mtime)
  assert.ok(first.mtime > 0)

  const doc2 = structuredClone(doc)
  doc2.nodes[0].title = '第二改'
  await assert.rejects(
    () => store.save(created.name, doc2, created.mtime),
    (err) => err.code === 'conflict' && typeof err.mtime === 'number',
  )

  /* 拿最新的 mtime 再存就能过 */
  const ok = await store.save(created.name, doc2, first.mtime)
  assert.ok(ok.mtime > 0)
  const back = await store.read(created.name)
  assert.equal(back.data.nodes[0].title, '第二改')
  await fs.rm(dir, { recursive: true, force: true })
})

test('覆盖保存会留下 .history 快照', async () => {
  const { store, dir } = await tempStore()
  const created = await store.create('有历史')
  const doc = structuredClone(created.data)
  doc.nodes[0].title = '改一版'
  const saved = await store.save(created.name, doc, created.mtime)
  const historyDir = path.join(dir, '.history', '有历史')
  const files = await fs.readdir(historyDir)
  assert.ok(files.length >= 1, '应该有至少一份快照')
  const snapshot = JSON.parse(await fs.readFile(path.join(historyDir, files[0]), 'utf8'))
  assert.equal(snapshot.nodes[0].title, '有历史', '快照保存的是上一版')
  assert.ok(saved.mtime > 0)
  await fs.rm(dir, { recursive: true, force: true })
})

test('指定名字重复时返回 exists，不会覆盖已有图', async () => {
  const { store, dir } = await tempStore()
  await store.createFrom(blankDoc('重名图'), '重名图.mindmap.json')
  await assert.rejects(
    () => store.createFrom(blankDoc('重名图'), '重名图.mindmap.json'),
    (err) => err.code === 'exists',
  )
  /* 不指定名字时，自动起名遇到重名会追加 -2 */
  const second = await store.createFrom(blankDoc('重名图'))
  assert.equal(second.name, '重名图-2.mindmap.json')
  await fs.rm(dir, { recursive: true, force: true })
})

test('删除是挪进 .trash，不是 unlink；之后列表里不再出现', async () => {
  const { store, dir } = await tempStore()
  const created = await store.create('要删的图')
  const removed = await store.trash(created.name)
  assert.equal(removed.trashed, true)
  assert.ok(removed.path.includes('.trash'))
  const files = await fs.readdir(path.join(dir, '.trash'))
  assert.equal(files.length, 1)
  assert.equal((await store.list()).length, 0)
  await assert.rejects(() => store.trash(created.name), (err) => err.code === 'not_found')
  await fs.rm(dir, { recursive: true, force: true })
})

test('坏 JSON：read 抛 bad_json，但 list 仍然把它列出来', async () => {
  const { store, dir } = await tempStore()
  await fs.writeFile(path.join(dir, '坏图.mindmap.json'), '{ 这不是 json', 'utf8')
  await assert.rejects(() => store.read('坏图.mindmap.json'), (err) => err.code === 'bad_json')
  const items = await store.list()
  assert.equal(items.length, 1)
  assert.equal(items[0].title, '坏图', '解析失败时退回文件名，不显示成「没有图」')
  await fs.rm(dir, { recursive: true, force: true })
})

test('非法文件名一律拒绝', async () => {
  const { store, dir } = await tempStore()
  for (const bad of ['../x.mindmap.json', 'a/b.mindmap.json', 'x.json']) {
    await assert.rejects(() => store.read(bad), (err) => err.code === 'bad_name')
  }
  await fs.rm(dir, { recursive: true, force: true })
})

test('ensureSample 只在空库第一次写入，不会重复', async () => {
  const { store, dir } = await tempStore()
  const factory = () => blankDoc('示例')
  assert.equal(await store.ensureSample('示例-从这里开始.mindmap.json', factory), true)
  assert.equal(await store.ensureSample('示例-从这里开始.mindmap.json', factory), false)
  assert.equal((await store.list()).length, 1)
  /* 有图之后即使 .seeded 被删掉也不再生成 */
  await fs.rm(path.join(dir, '.seeded'))
  assert.equal(await store.ensureSample('示例-从这里开始.mindmap.json', factory), false)
  assert.equal((await store.list()).length, 1)
  await fs.rm(dir, { recursive: true, force: true })
})

test('保存后的文件是 2 空格缩进的 JSON，且能被再次读回', async () => {
  const { store, dir } = await tempStore()
  const created = await store.create('格式图')
  await store.save(created.name, created.data, created.mtime)
  const text = await fs.readFile(path.join(dir, created.name), 'utf8')
  assert.ok(text.includes('\n  "version"') || text.startsWith('{\n  "version"'))
  const back = await store.read(created.name)
  assert.equal(back.data.title, '格式图')
  await fs.rm(dir, { recursive: true, force: true })
})
