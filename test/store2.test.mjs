import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createStore } from '../lib/store.mjs'
import { blankDoc } from '../lib/validate.mjs'

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'syn-store2-'))
  return { dir, store: createStore(dir) }
}

test('已有文件但不传版本号 → version_required', async () => {
  const { store, dir } = await tempStore()
  const made = await store.create('要版本')
  await assert.rejects(
    () => store.save(made.name, made.data, undefined),
    (err) => err.code === 'version_required' && typeof err.mtime === 'number',
  )
  await fs.rm(dir, { recursive: true, force: true })
})

test('文件被别人删掉之后再保存 → gone，不会把图写回来', async () => {
  const { store, dir } = await tempStore()
  const made = await store.create('会被删')
  await store.trash(made.name)
  await assert.rejects(
    () => store.save(made.name, made.data, made.token),
    (err) => err.code === 'gone',
  )
  assert.equal((await store.list()).length, 0, '不能凭空复活')
  await fs.rm(dir, { recursive: true, force: true })
})

test('历史：列表、读回、恢复某一版', async () => {
  const { store, dir } = await tempStore()
  const made = await store.create('有历史')
  const v1 = structuredClone(made.data)
  v1.nodes[0].title = '第一版'
  const s1 = await store.save(made.name, v1, made.token)

  const v2 = structuredClone(v1)
  v2.nodes[0].title = '第二版'
  const s2 = await store.save(made.name, v2, s1.token)
  assert.ok(s2.mtime >= s1.mtime)

  const list = await store.history(made.name)
  assert.ok(list.length >= 1, '至少要有一份快照')
  assert.equal(list[0].latest, true, '最新的那份是 latest.json')

  const older = await store.readHistory(made.name, list[list.length - 1].file)
  assert.ok(older.nodes.length >= 1, '快照读回来是原始文档')

  /* 把最老的一版恢复到文件里，之后读到的是它 */
  await store.restoreHistory(made.name, list[list.length - 1].file, s2.token)
  const back = await store.read(made.name)
  assert.notEqual(back.data.nodes[0].title, '第二版', '恢复之后不该还是最新那版')
  await fs.rm(dir, { recursive: true, force: true })
})

test('同一版本号并发保存：只有一个能成功', async () => {
  const { store, dir } = await tempStore()
  const made = await store.create('并发')
  const a = structuredClone(made.data)
  a.nodes[0].title = 'A'
  const b = structuredClone(made.data)
  b.nodes[0].title = 'B'
  const results = await Promise.allSettled([
    store.save(made.name, a, made.token),
    store.save(made.name, b, made.token),
  ])
  const ok = results.filter((r) => r.status === 'fulfilled').length
  const conflicts = results.filter((r) => r.status === 'rejected' && r.reason.code === 'conflict').length
  assert.equal(ok, 1, '只能有一个写成功')
  assert.equal(conflicts, 1, '另一个必须收到 conflict，不能悄悄覆盖')
  await fs.rm(dir, { recursive: true, force: true })
})

test('自动起名也走 safeName：Windows 保留名会加前缀', async () => {
  const { store, dir } = await tempStore()
  const made = await store.createFrom(blankDoc('CON'))
  assert.ok(!/^CON\./i.test(made.name), 'CON 不能直接当文件名，实际 ' + made.name)
  assert.ok(made.name.endsWith('.mindmap.json'))
  await fs.rm(dir, { recursive: true, force: true })
})
