import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/* core/synapsis-core.js 是「无模块语法的工厂」：直接当脚本读进来执行，
   这是它唯一的模块边界，所以这里显式验证一次——能求值、导出的东西对得上。 */
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

/* 复习池只收「有正文」的节点，所以夹具都带一句 definition */
const n = (id, mastery, title = id, parent = 'root', extra = {}) => ({
  id,
  title,
  parent,
  mastery,
  definition: '定义一句话',
  ...extra,
})

const tier = (x) => {
  if (x.mastery === 1) return 0
  if (x.mastery === 0) return x.lastReviewed ? 1 : 2
  return 3
}

test('工厂导出齐全', () => {
  assert.equal(typeof comp.MindMap, 'function')
  assert.equal(typeof comp.buildLayout, 'function')
  assert.equal(typeof comp.fitFor, 'function')
  assert.equal(typeof comp.createMathRenderer, 'function')
  assert.equal(typeof comp.sortReviewPool, 'function')
  assert.equal(typeof comp.flipReview, 'function')
  assert.equal(typeof comp.weakReview, 'function')
})

test('翻面保住这一轮的进度与范围', () => {
  const state = {
    queue: ['a', 'b', 'c'],
    graded: { a: 0, b: 1 },
    scopeId: 'ch1',
    i: 1,
    shown: false,
  }
  const after = comp.flipReview(state)
  assert.equal(after.shown, true, '翻面之后要显示正文')
  assert.equal(after.i, 1, '还停在这一张')
  assert.equal(after.scopeId, 'ch1', '范围不能被丢掉，否则「再来一轮」会变成整张图')
  assert.deepEqual(after.graded, { a: 0, b: 1 }, '本轮成绩不能被丢掉')
  assert.deepEqual(state.graded, { a: 0, b: 1 }, '不改原对象')
  assert.equal(comp.flipReview(null), null)
})

test('「再来一遍模糊的」取 0 分与 1 分，顺序不变', () => {
  const state = { queue: ['a', 'b', 'c', 'd'], graded: { a: 0, b: 2, c: 1, d: 2 }, i: 4, shown: false }
  assert.deepEqual(comp.weakReview(state), ['a', 'c'])
  assert.deepEqual(comp.weakReview({ queue: ['a'], graded: {} }), [])
  assert.deepEqual(comp.weakReview(null), [])
})

test('复习排序：模糊 → 复习过没印象 → 没学过 → 已掌握', () => {
  const pool = comp.sortReviewPool([
    n('done', 2),
    n('fresh', 0),
    n('fuzzy', 1),
    n('seen0', 0, 'seen0', 'root', { lastReviewed: '2026-11-07T00:00:00.000Z' }),
    n('A', 2),
    n('B', 0),
  ])
  assert.equal(pool.length, 6)
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      assert.ok(
        tier(pool[i]) <= tier(pool[j]),
        `第 ${i} 个的档位不应高于第 ${j} 个：${pool[i].title} / ${pool[j].title}`,
      )
    }
  }
  /* 旧的三元优先级 bug 会让「已掌握」排到最前 */
  assert.equal(tier(pool[0]), 0, '第一张应该是「模糊」的')
  assert.equal(tier(pool[pool.length - 1]), 3, '最后一张应该是「已掌握」的')
  /* 「没学过」和「复习后没印象」必须分开：前者在前，后者靠后 */
  assert.ok(
    pool.findIndex((x) => x.id === 'seen0') < pool.findIndex((x) => x.id === 'fresh'),
    '复习过但没印象的，应该排在从没学过的之前',
  )
})

test('复习排序：同档按标题，且结果与输入顺序无关', () => {
  const input = [n('c', 1), n('a', 1), n('b', 1)]
  const once = comp.sortReviewPool(input).map((x) => x.id)
  const twice = comp.sortReviewPool(input.slice().reverse()).map((x) => x.id)
  assert.deepEqual(once, twice, '输入顺序不该影响结果')
  assert.deepEqual(once, ['a', 'b', 'c'])
})

test('复习池排除根节点、没有 id 的条目、只有标题的层级卡', () => {
  const pool = comp.sortReviewPool([
    n('root', 1, 'root', null),
    { title: '没有 id', mastery: 1, definition: '一句' },
    { id: 'bare-topic', title: '只有标题的章', parent: 'root', mastery: 0 },
    n('ok', 1),
  ])
  assert.deepEqual(
    pool.map((x) => x.id),
    ['ok'],
  )
})

test('只复习某一支时按 id 集合过滤', () => {
  const nodes = [n('ch1-a', 1), n('ch2-a', 1), n('ch1-b', 1)]
  const scope = new Set(['ch1-a', 'ch1-b'])
  const pool = comp.sortReviewPool(nodes, scope)
  assert.deepEqual(
    pool.map((x) => x.id),
    ['ch1-a', 'ch1-b'],
  )
  /* 不传集合时不做过滤 */
  assert.equal(comp.sortReviewPool(nodes).length, 3)
})

test('传进来的不是 Set 时按整张图处理，不当成空范围', () => {
  const nodes = [n('a', 1), n('b', 0)]
  /* 顶栏按钮曾经直接把点击事件当 scopeId 传进来，结果一个都收不到 */
  assert.equal(comp.sortReviewPool(nodes, { type: 'click' }).length, 2)
  assert.equal(comp.sortReviewPool(nodes, []).length, 2)
  assert.equal(comp.sortReviewPool(nodes, new Set()).length, 2)
})

test('排序不会改动调用方传进来的数组', () => {
  const input = [n('b', 1), n('a', 1)]
  const snapshot = input.map((x) => x.id)
  comp.sortReviewPool(input)
  assert.deepEqual(
    input.map((x) => x.id),
    snapshot,
  )
})
