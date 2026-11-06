import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* core/synapsis-core.js 是「无模块语法的工厂」，直接当脚本读进来跑。
   这是它唯一的模块边界，所以这里显式验证一次：文件能被求值、导出对得上。 */
const SRC = readFileSync(new URL('../core/synapsis-core.js', import.meta.url), 'utf8')
const factory = new Function(SRC + '\nreturn createMindMap;')()
const stubReact = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
}
const comp = factory(stubReact)

/* 复习池现在只收「有正文」的节点，所以夹具都带一句 definition */
const n = (id, mastery, title = id, parent = 'root') => ({ id, title, parent, mastery, definition: '定义一句话' })

test('工厂导出齐全', () => {
  assert.equal(typeof comp.MindMap, 'function')
  assert.equal(typeof comp.buildLayout, 'function')
  assert.equal(typeof comp.fitFor, 'function')
  assert.equal(typeof comp.createMathRenderer, 'function')
  assert.equal(typeof comp.sortReviewPool, 'function')
})

test('复习排序：模糊 → 未读 → 已掌握', () => {
  const pool = comp.sortReviewPool([
    n('甲', 2),
    n('乙', 0),
    n('丙', 1),
    n('丁', 2),
    n('戊', 1),
    n('A', 2),
    n('B', 0),
  ])
  const rank = (x) => (x.mastery === 1 ? 0 : x.mastery === 0 ? 1 : 2)
  assert.equal(pool.length, 7)
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      assert.ok(rank(pool[i]) <= rank(pool[j]), `第 ${i} 个的档位不应低于第 ${j} 个：${pool[i].title} / ${pool[j].title}`)
    }
  }
  /* 以前那个三元优先级 bug 会让已掌握的排到最前 */
  assert.equal(rank(pool[0]), 0, '第一张应该是「模糊」的')
  assert.equal(rank(pool[pool.length - 1]), 2, '最后一张应该是「已掌握」的')
})

test('复习排序：同档按标题，且结果是确定的', () => {
  const input = [n('c', 1), n('a', 1), n('b', 1)]
  const once = comp.sortReviewPool(input).map((x) => x.id)
  const twice = comp.sortReviewPool(input.slice().reverse()).map((x) => x.id)
  assert.deepEqual(once, twice, '输入顺序不该影响结果')
  assert.deepEqual(once, ['a', 'b', 'c'])
})

test('复习池排除根节点和没有 id 的条目', () => {
  const pool = comp.sortReviewPool([
    { id: 'root', title: '根', parent: null, mastery: 0, definition: 'x' },
    { title: '没有 id', parent: 'root', mastery: 0, definition: 'x' },
    null,
    n('ok', 1),
  ])
  assert.deepEqual(pool.map((x) => x.id), ['ok'])
})

test('复习池排除只有标题的层级卡（章 / 主题）', () => {
  const bare = { id: 'ch1', title: '第1章', parent: 'root', mastery: 0 }
  const blank = { id: 'ch2', title: '第2章', parent: 'root', mastery: 0, definition: '   ' }
  const withFormal = { id: 'c1', title: '概念', parent: 'ch1', mastery: 0, formal: 'a \\in A' }
  const pool = comp.sortReviewPool([bare, blank, withFormal])
  assert.deepEqual(pool.map((x) => x.id), ['c1'], '空的章不该占复习队列')
})

test('复习池不修改传入的数组', () => {
  const a = n('a', 2)
  const b = n('b', 1)
  const input = [a, b]
  comp.sortReviewPool(input)
  assert.deepEqual(input.map((x) => x.id), ['a', 'b'])
})
