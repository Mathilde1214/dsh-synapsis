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

test('评分会安排下一次：0 分明天，1 分三天，2 分按上次翻倍且有上下限', () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const day = 86400000
  const g0 = comp.gradePlan({ interval: 30 }, 0, now)
  assert.equal(g0.interval, 1)
  assert.equal(Date.parse(g0.dueAt) - now, day)
  assert.equal(g0.mastery, 0)
  assert.ok(g0.reviewedAt, '记下这次复习的时间')

  const g1 = comp.gradePlan({ interval: 30 }, 1, now)
  assert.equal(g1.interval, 3)
  assert.equal(Date.parse(g1.dueAt) - now, 3 * day)

  /* 会了：从 3 天翻到 7 天（最小值），从 60 天翻到 120（上限），没记过按 3 天起 */
  assert.equal(comp.gradePlan({ interval: 3 }, 2, now).interval, 7)
  assert.equal(comp.gradePlan({ interval: 60 }, 2, now).interval, 120)
  assert.equal(comp.gradePlan({}, 2, now).interval, 7)
})

test('到期的排前面，没到期的按到期时间排队', () => {
  const now = Date.UTC(2026, 0, 10, 0, 0, 0)
  const day = 86400000
  const iso = (d) => new Date(now + d * day).toISOString()
  const nodes = [
    { id: 'mastered-later', parent: 'root', title: 'c', definition: 'x', mastery: 2, dueAt: iso(5) },
    { id: 'fuzzy-overdue', parent: 'root', title: 'a', definition: 'x', mastery: 1, dueAt: iso(-2) },
    { id: 'fresh', parent: 'root', title: 'b', definition: 'x', mastery: 0 },
    { id: 'soon', parent: 'root', title: 'd', definition: 'x', mastery: 0, dueAt: iso(3) },
  ]
  const ids = comp.sortReviewPool(nodes, null, now).map((x) => x.id)
  /* 没设 dueAt 的视为到期；到期的里 dueAt 早的在前；没到期的排最后 */
  assert.deepEqual(ids, ['fuzzy-overdue', 'fresh', 'soon', 'mastered-later'])
})

test('isDue / dueAtOf 对坏值不炸', () => {
  assert.equal(comp.isDue({}, 0), true)
  assert.equal(comp.isDue({ dueAt: 'not-a-date' }, Date.now()), true)
  assert.equal(comp.dueAtOf({ dueAt: '2026-01-01T00:00:00.000Z' }) > 0, true)
})

test('批量删除：子节点上提到最近活着的祖先，边一起清', () => {
  const nodes = [
    { id: 'root', parent: null, title: 'r' },
    { id: 'a', parent: 'root', title: 'a' },
    { id: 'a1', parent: 'a', title: 'a1' },
    { id: 'a2', parent: 'a1', title: 'a2' },
    { id: 'b', parent: 'root', title: 'b' },
  ]
  const edges = [
    { from: 'a', to: 'b', type: 'related' },
    { from: 'a2', to: 'b', type: 'prereq' },
    { from: 'a', to: 'a1', type: 'related' },
  ]
  const plan = comp.pruneMany(nodes, edges, ['a'], 'root')
  const byId = Object.fromEntries(plan.nodes.map((n) => [n.id, n]))
  assert.equal(byId.a, undefined, '被删的节点不在了')
  assert.equal(byId.a1.parent, 'root', '子节点挂到 a 的父级')
  assert.equal(byId.a2.parent, 'a1', '孙子不受影响')
  assert.deepEqual(
    plan.edges.map((e) => e.from + '>' + e.to),
    ['a2>b'],
    '碰到被删节点的边被清掉',
  )
  assert.deepEqual(plan.removed, ['a'])
})

test('批量删除：根节点删不掉，多级祖先被删时一路往上提', () => {
  const nodes = [
    { id: 'root', parent: null, title: 'r' },
    { id: 'a', parent: 'root', title: 'a' },
    { id: 'a1', parent: 'a', title: 'a1' },
    { id: 'a1x', parent: 'a1', title: 'a1x' },
  ]
  const plan = comp.pruneMany(nodes, [], ['root', 'a', 'a1'], 'root')
  assert.deepEqual(plan.removed, ['a', 'a1'], 'root 被跳过')
  assert.equal(plan.nodes.find((n) => n.id === 'a1x').parent, 'root', '跳过两层已删祖先')
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

test('昨天打了「没印象」的卡，不会被一堆新卡挤出这一轮', () => {
  const now = Date.UTC(2026, 0, 10, 0, 0, 0)
  const day = 86400000
  const nodes = [
    { id: 'overdue', parent: 'root', title: 'zzz 昨天没印象', definition: 'x', mastery: 1, dueAt: new Date(now - day).toISOString() },
  ]
  for (let i = 0; i < 20; i += 1) {
    nodes.push({ id: 'new-' + i, parent: 'root', title: 'aaa 新概念 ' + i, definition: 'x', mastery: 0 })
  }
  const ids = comp.sortReviewPool(nodes, null, now).map((x) => x.id)
  assert.equal(ids[0], 'overdue')
  assert.ok(ids.slice(0, 15).includes('overdue'))
})
