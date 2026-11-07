import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createStore } from '../lib/store.mjs'
import { createHandler } from '../lib/http.mjs'

async function boot(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-http2-'))
  const katexDir = path.join(dir, 'katex')
  await fs.mkdir(katexDir, { recursive: true })
  const store = createStore(path.join(dir, 'data'))
  const handler = createHandler({
    store,
    katexDir,
    connection: { requestRejection: () => undefined },
    log: { warn() {} },
    sampleName: '示例.mindmap.json',
    sampleFactory: () => ({ version: 1, title: '示例', nodes: [{ id: 'root', title: '示例', parent: null }], edges: [] }),
  })
  const server = http.createServer((req, res) => handler(req, res))
  server.keepAliveTimeout = 1
  server.headersTimeout = 5
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dir, { recursive: true, force: true })
  })
  return { base, store }
}

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('保存不带 baseToken → 428', async (t) => {
  const ctx = await boot(t)
  const made = await (await post(ctx.base + '/synapsis-api/create', { title: '要版本' })).json()
  const res = await post(ctx.base + '/synapsis-api/save', { name: made.name, data: made.data })
  assert.equal(res.status, 428)
  assert.equal((await res.json()).error, 'version_required')
})

test('文件被删掉之后保存 → 410 gone', async (t) => {
  const ctx = await boot(t)
  const made = await (await post(ctx.base + '/synapsis-api/create', { title: '会被删' })).json()
  const loaded = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  await post(ctx.base + '/synapsis-api/delete', { name: made.name })
  const res = await post(ctx.base + '/synapsis-api/save', {
    name: made.name,
    data: loaded.data,
    baseToken: loaded.mtime,
  })
  assert.equal(res.status, 410)
  assert.equal((await res.json()).error, 'gone')
})

test('保存一个不是文档的东西 → 400 bad_doc，并说明哪里不对', async (t) => {
  const ctx = await boot(t)
  const made = await (await post(ctx.base + '/synapsis-api/create', { title: '要校验' })).json()
  const loaded = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  const res = await post(ctx.base + '/synapsis-api/save', {
    name: made.name,
    data: { hello: 'world' },
    baseToken: loaded.mtime,
  })
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.equal(body.error, 'bad_doc')
  assert.ok(Array.isArray(body.issues) && body.issues.length > 0, '要带回具体问题')
  /* 原始文件没被写坏 */
  const after = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  assert.equal(after.data.title, '要校验')
})

test('历史接口：能列出并恢复到旧版本', async (t) => {
  const ctx = await boot(t)
  const made = await (await post(ctx.base + '/synapsis-api/create', { title: '历史接口' })).json()
  const first = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  const v2 = structuredClone(first.data)
  v2.nodes[0].title = '改过'
  const saved = await (await post(ctx.base + '/synapsis-api/save', {
    name: made.name,
    data: v2,
    baseToken: first.token,
  })).json()

  const hist = await (await fetch(ctx.base + '/synapsis-api/history?name=' + encodeURIComponent(made.name))).json()
  assert.equal(hist.ok, true)
  assert.ok(hist.items.length >= 1)
  const oldest = hist.items[hist.items.length - 1]

  const restored = await post(ctx.base + '/synapsis-api/history/restore', {
    name: made.name,
    file: oldest.file,
    baseToken: saved.token,
  })
  assert.equal(restored.status, 200)
  const after = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  assert.equal(after.data.nodes[0].title, '历史接口')
})

test('另存为副本：面板实际发的那份请求能成功，且原文件不会被写回来', async (t) => {
  const ctx = await boot(t)
  const made = await (await post(ctx.base + '/synapsis-api/create', { title: '副本来源' })).json()
  const loaded = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()

  /* 面板「另存为新图」发的就是 { title, data }，没有 name */
  const copyDoc = { ...loaded.data, title: '副本来源（副本）' }
  const res = await post(ctx.base + '/synapsis-api/create', { title: copyDoc.title, data: copyDoc })
  assert.equal(res.status, 200, '标题带括号也不能被 safeName 拒掉')
  const copy = await res.json()
  assert.match(copy.name, /\.mindmap\.json$/, '新文件名要带后缀：' + copy.name)
  assert.notEqual(copy.name, made.name)

  /* 原文件还在（本来就该在），但内容没被副本覆盖 */
  const original = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  assert.equal(original.data.title, '副本来源')

  /* 再另存一次，不能覆盖上一份副本 */
  const second = await (await post(ctx.base + '/synapsis-api/create', { title: copyDoc.title, data: copyDoc })).json()
  assert.notEqual(second.name, copy.name, '同名副本要自动避开：' + second.name)
  assert.match(second.name, /\.mindmap\.json$/)
})

test('另存为副本：原文件被删之后也能另存，不会把原文件写回来', async (t) => {
  const ctx = await boot(t)
  const made = await (await post(ctx.base + '/synapsis-api/create', { title: '被删的图' })).json()
  const loaded = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(made.name))).json()
  await post(ctx.base + '/synapsis-api/delete', { name: made.name })

  const copyDoc = { ...loaded.data, title: '被删的图（副本）' }
  const res = await post(ctx.base + '/synapsis-api/create', { title: copyDoc.title, data: copyDoc })
  assert.equal(res.status, 200)
  const copy = await res.json()
  assert.match(copy.name, /\.mindmap\.json$/)

  const list = await (await fetch(ctx.base + '/synapsis-api/list')).json()
  const names = list.items.map((x) => x.name)
  assert.ok(!names.includes(made.name), '被删掉的原文件不该被写回来')
  assert.ok(names.includes(copy.name))
})
