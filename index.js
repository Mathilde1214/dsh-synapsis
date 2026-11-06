import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Schema from '@deepseek-ai/schemastery'
import { createStore } from './lib/store.mjs'
import { createHandler } from './lib/http.mjs'
import { resolveHome } from './lib/paths.mjs'
import { promptSection, registerTools } from './lib/tools.mjs'

export const name = 'dsh-synapsis'
export const inject = ['webServer', 'connection', 'tools', 'systemPrompt']

export const Config = Schema.object({
  dataDir: Schema.string()
    .default('')
    .description('图库目录。留空则依次看环境变量 SYNAPSIS_DATA、再退回 ~/Synapsis。'),
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KATEX_DIR = path.join(HERE, 'assets', 'katex')
const SAMPLE_NAME = '示例-从这里开始.mindmap.json'

/* 第一张图 —— 五个节点，只讲「怎么用」，不抢戏。 */
function sampleDoc() {
  const node = (id, title, parent, summary, definition, intuition) => ({
    id,
    title,
    en: '',
    parent,
    mastery: 0,
    summary,
    definition,
    formal: '',
    intuition,
    examples: '',
    pitfalls: '',
    note: '',
  })
  return {
    version: 1,
    title: '示例 · 从这里开始',
    subtitle: '一张很小的图，看完就知道怎么用',
    updated: new Date().toISOString(),
    nodes: [
      node('root', '示例 · 从这里开始', null, '一张很小的示例图', '这是一张示例图。', ''),
      node('scroll', '滚轮就是层级', 'root', '往下滚进一层，往上滚退一层', '', '越靠近你的卡越大，字始终清楚。'),
      node('sidebar', '侧栏是概念卡', 'root', '点卡片，右边展开细节', '', '定义、形式化、例子、易错点都在这里。'),
      node('keys', '几个顺手的键', 'root', 'Tab 新建 · F2 改名 · Del 删除', '', '⌘K 搜索、⌘Z 撤销、Shift 拖拽连边。'),
      node('export', '导出与换纸', 'root', '顶栏右边能导出和换纸', '', '有 PNG / SVG / Markdown 三种，也可以换日光/夜光纸。'),
    ],
    edges: [
      { from: 'scroll', to: 'sidebar', type: 'related' },
      { from: 'sidebar', to: 'keys', type: 'related' },
    ],
  }
}

export function apply(ctx, config) {
  const home = resolveHome({
    configDir: config && config.dataDir,
    env: process.env.SYNAPSIS_DATA,
    homedir: os.homedir(),
  })
  const store = createStore(home)
  const handler = createHandler({
    store,
    katexDir: KATEX_DIR,
    connection: ctx.connection,
    log: ctx.logger || console,
    sampleName: SAMPLE_NAME,
    sampleFactory: sampleDoc,
  })

  /* 首装的小样图：库里一张图都没有时才写，写完落 .seeded，删了不会复活 */
  ctx.effect(() => {
    store.ensureSample(SAMPLE_NAME, sampleDoc).catch(() => {})
    return () => {}
  })

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/synapsis-api', handler }))
  ctx.effect(() => registerTools(ctx, store))
  ctx.effect(() =>
    ctx.systemPrompt.section({ name: 'synapsis', order: 120, text: promptSection(store) }),
  )
}
