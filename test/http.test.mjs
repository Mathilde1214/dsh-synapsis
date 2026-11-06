import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createStore } from '../lib/store.mjs'
import { createHandler } from '../lib/http.mjs'

/* 起一个真的 HTTP 服务来测路由：比 mock req/res 更接近线上，
   也能顺带验证状态码和 content-type。 */
async function boot(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-http-'))
  const katexDir = path.join(dir, 'katex')
  await fs.mkdir(katexDir, { recursive: true })
  await fs.writeFile(path.join(katexDir, 'katex.min.js'), 'window.katex={}', 'utf8')
  const store = createStore(path.join(dir, 'data'))
  const handler = createHandler({
    store,
    katexDir,
    connection: options.connection || { requestRejection: () => undefined },
    log: { warn() {} },
  })
  const server = http.createServer((req, res) => handler(req, res))
  /* 让 keep-alive 尽快过期：否则 fetch 的连接池会让进程迟迟不退出 */
  server.keepAliveTimeout = 1
  server.headersTimeout = 5
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const close = async () => {
    /* undici 会复用 keep-alive 连接，不主动断开的话 close() 永远等不到回调 */
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(dir, { recursive: true, force: true })
  }
  return { base, store, close, dir, katexDir }
}

const jsonPost = (url, body) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('不受信任的连接被拒绝', async () => {
  const ctx = await boot({ connection: { requestRejection: () => 401 } })
  const res = await fetch(ctx.base + '/synapsis-api/list')
  assert.equal(res.status, 401)
  const body = await res.json()
  assert.equal(body.ok, false)
  assert.equal(body.error, 'unauthorized')
  await ctx.close()
})

test('写操作必须声明 application/json', async () => {
  const ctx = await boot()
  const res = await fetch(ctx.base + '/synapsis-api/save', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{"name":"x.mindmap.json","data":{"nodes":[]}}',
  })
  assert.equal(res.status, 415)
  await ctx.close()
})

test('create → load → save 的完整一条链', async () => {
  const ctx = await boot()
  const created = await jsonPost(ctx.base + '/synapsis-api/create', { title: '接口测试' })
  assert.equal(created.status, 200)
  const payload = await created.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.name, '接口测试.mindmap.json')

  const loaded = await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(payload.name))
  assert.equal(loaded.status, 200)
  const doc = await loaded.json()
  assert.equal(doc.ok, true)
  assert.equal(typeof doc.mtime, 'number', 'load 必须回 mtime，前端才能做冲突检测')
  assert.ok(Array.isArray(doc.data.nodes))
  assert.ok(Array.isArray(doc.warnings))

  const next = structuredClone(doc.data)
  next.nodes[0].title = '改个名'
  const saved = await jsonPost(ctx.base + '/synapsis-api/save', {
    name: payload.name,
    data: next,
    baseMtime: doc.mtime,
  })
  assert.equal(saved.status, 200)
  const savedBody = await saved.json()
  assert.ok(savedBody.mtime >= doc.mtime)

  const again = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(payload.name))).json()
  assert.equal(again.data.nodes[0].title, '改个名')
  await ctx.close()
})

test('外部改过之后再用旧 mtime 保存 → 409 且带回新 mtime', async () => {
  const ctx = await boot()
  const created = await jsonPost(ctx.base + '/synapsis-api/create', { title: '冲突' })
  const { name } = await created.json()
  const first = await (await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent(name))).json()

  /* 模拟「另一个人 / 另一个标签页」改了这个文件 */
  await new Promise((r) => setTimeout(r, 8))
  const other = structuredClone(first.data)
  other.nodes[0].title = '别人改的'
  await ctx.store.save(name, other)

  const res = await jsonPost(ctx.base + '/synapsis-api/save', { name, data: first.data, baseMtime: first.mtime })
  assert.equal(res.status, 409)
  const body = await res.json()
  assert.equal(body.error, 'conflict')
  assert.equal(typeof body.mtime, 'number')
  await ctx.close()
})

test('同名新建：自动起名避开重名，指定名字重复则 409', async () => {
  const ctx = await boot()
  await jsonPost(ctx.base + '/synapsis-api/create', { title: '同名' })
  const auto = await (await jsonPost(ctx.base + '/synapsis-api/create', { title: '同名' })).json()
  assert.equal(auto.name, '同名-2.mindmap.json')

  const forced = await jsonPost(ctx.base + '/synapsis-api/create', { title: '同名', name: '同名.mindmap.json' })
  assert.equal(forced.status, 409)
  await ctx.close()
})

test('/katex/* 是公开静态资源，不受鉴权影响', async () => {
  const ctx = await boot({ connection: { requestRejection: () => 401 } })
  const res = await fetch(ctx.base + '/synapsis-api/katex/katex.min.js')
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') || '', /javascript/)
  await ctx.close()
})

test('目录穿越被挡住', async () => {
  const ctx = await boot()
  const res = await fetch(ctx.base + '/synapsis-api/katex/../../etc/passwd')
  assert.ok(res.status === 400 || res.status === 404, '越界请求不该成功，实际 ' + res.status)
  await ctx.close()
})

test('坏文件名与不存在的图给出对应状态码', async () => {
  const ctx = await boot()
  const bad = await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent('../x.mindmap.json'))
  assert.equal(bad.status, 400)
  const missing = await fetch(ctx.base + '/synapsis-api/load?name=' + encodeURIComponent('没有这个.mindmap.json'))
  assert.equal(missing.status, 404)
  await ctx.close()
})
