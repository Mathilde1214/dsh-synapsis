import { normalizeDoc } from './validate.mjs'

const text = (t) => [{ type: 'text', text: t }]

/* agent 侧的三个工具：列、读、写。
   这是「把讲义变成图」的真正入口 —— 模型不知道 .mindmap.json 长什么样，
   所以它必须从这里拿到 schema，也必须是这里替它把文件写对。 */
export function registerTools(ctx, store) {
  const disposers = []

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_list_maps',
      description:
        '列出「析域」图库里的所有概念图（文件名、标题、节点数、修改时间）。在做新图之前先看一眼，避免同名覆盖。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            dir: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  title: { type: 'string' },
                  nodes: { type: 'number' },
                  mtime: { type: 'number' },
                },
              },
            },
          },
        },
        render: (_args, value) => text(`图库：${value.dir}\n共 ${value.items.length} 张图`),
      },
      async execute() {
        return { dir: store.root, items: await store.list() }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_read_map',
      description: '读取「析域」里某一张概念图的完整内容（节点、边、原文出处）。改图之前先读。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: '文件名，如 离散数学.mindmap.json' } },
        required: ['name'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object', properties: { name: { type: 'string' }, data: { type: 'object' } } },
        render: (_args, value) => text(`已读取 ${value.name}（${(value.data.nodes || []).length} 个节点）`),
      },
      async execute(args) {
        const loaded = await store.read(args.name)
        return { name: loaded.name, mtime: loaded.mtime, data: loaded.data, warnings: loaded.warnings }
      },
    }),
  )

  disposers.push(
    ctx.tools.register({
      name: 'synapsis_write_map',
      description:
        '把一份结构化概念写成新的「析域」概念图文件，写完会立刻出现在 DSH 的「析域」面板里。只能新建、不会覆盖已有文件（重名会报错，换个名字即可）。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '这张图的标题，如「离散数学（第六版）」' },
          name: { type: 'string', description: '可选文件名（须以 .mindmap.json 结尾）；不传则按标题自动起名' },
          nodes: {
            type: 'array',
            description: '节点数组。第一条通常是根（parent 为 null）。',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '唯一 id，建议 ch1 / ch1-topic-xxx' },
                title: { type: 'string' },
                en: { type: 'string' },
                parent: { type: ['string', 'null'], description: '父节点 id；根用 null' },
                summary: { type: 'string', description: '一行摘要，≤40 字' },
                definition: { type: 'string' },
                formal: { type: 'string', description: 'LaTeX，可用 $…$' },
                intuition: { type: 'string' },
                examples: { type: 'string' },
                pitfalls: { type: 'string' },
                source: {
                  type: 'object',
                  properties: { page: { type: 'number' }, snippet: { type: 'string' } },
                },
              },
              required: ['id', 'title'],
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                type: { type: 'string', enum: ['prereq', 'related', 'contrast'] },
              },
              required: ['from', 'to'],
            },
          },
        },
        required: ['title', 'nodes'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, name: { type: 'string' }, dir: { type: 'string' }, nodes: { type: 'number' } },
        },
        render: (_args, value) => text(`已写入《${value.title || value.name}》：${value.nodes} 个节点\n${value.dir}\\${value.name}`),
      },
      async execute(args) {
        const { doc, warnings } = normalizeDoc({
          title: args.title,
          nodes: args.nodes,
          edges: args.edges || [],
        })
        const made = await store.createFrom(doc, args.name)
        return {
          ok: true,
          name: made.name,
          title: doc.title,
          dir: store.root,
          nodes: doc.nodes.length,
          warnings,
        }
      },
    }),
  )

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* 卸载期间忽略 */
      }
    }
  }
}

/* 系统提示：让模型知道「析域」是什么、文件长什么样、以及为什么不能直接覆盖。 */
export function promptSection(store) {
  return [
    '「析域」(Synapsis) 是当前 DSH 里的一个概念图面板，用户会把教材讲义做成概念图来复习。',
    `图库目录：${store.root}。每张图是一个 .mindmap.json 文件，面板只读这个目录。`,
    '把讲义做成图时请走工具，不要自己写文件：',
    '1) 先用 synapsis_list_maps 看有没有同名图；2) 拆出章节与概念后，先用普通对话把「章节清单」给用户确认；3) 确认后用 synapsis_write_map 写入（它只能新建，重名会失败，换个名字即可）。',
    '文档结构：{ title, nodes[], edges[] }。节点必填 id、title、parent（根为 null），可选 en/summary/definition/formal/intuition/examples/pitfalls/source{page,snippet}。',
    '建议结构：根 → 章（depth 1）→ 主题（depth 2）→ 概念（depth 3），最深三层；id 用 chN / chN-topic-x / chN-x 这类稳定写法。',
    'formal 里可以直接写 LaTeX（$…$ 或 $$…$$），面板会用 KaTeX 渲染；summary 控制在一行 40 字内。',
    'edges 只表达跨分支关系：type 取 prereq（前置）、related（关联）、contrast（对比），父子从属关系由 parent 表达，不要写成边。',
    '写完告诉用户图的标题与文件名，并提示回面板按 F5 或点 ⇅ 刷新即可看到。',
  ].join('\n')
}
