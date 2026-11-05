const React = window.React
const ReactDOM = window.ReactDOM
const h = React.createElement
const core = window.createMindMap(React)
const MindMap = core.MindMap

const CFG_KEY = 'synapsis.settings'
const $ = (id) => document.getElementById(id)

let settings = readSettings()
let state = {
  files: [],
  current: null,
  prep: null,
  busy: false,
  abort: null,
}
let mapRoot = null
let renderTimer = 0
let saveTimer = 0
let stopBtn = null

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

function readSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}')
    return {
      baseURL: raw.baseURL || 'https://api.deepseek.com/v1',
      model: raw.model || 'deepseek-chat',
      apiKey: raw.apiKey || '',
    }
  } catch {
    return { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' }
  }
}

function writeSettings(next) {
  settings = next
  localStorage.setItem(CFG_KEY, JSON.stringify(next))
}

$('setBtn').onclick = () => {
  $('cfgBase').value = settings.baseURL
  $('cfgModel').value = settings.model
  $('cfgKey').value = settings.apiKey
  $('modal').hidden = false
}
$('cfgCancel').onclick = () => {
  $('modal').hidden = true
}
$('cfgSave').onclick = () => {
  writeSettings({
    baseURL: $('cfgBase').value.trim() || 'https://api.deepseek.com/v1',
    model: $('cfgModel').value.trim() || 'deepseek-chat',
    apiKey: $('cfgKey').value.trim(),
  })
  $('modal').hidden = true
  toast('设置已保存')
}

/* ------------------------------------------------------------------ */
/* theme                                                               */
/* ------------------------------------------------------------------ */

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('synapsis.theme', theme)
  $('themeBtn').textContent = theme === 'dark' ? '切换日间纸' : '切换夜间纸'
  renderMap()
}

setTheme(localStorage.getItem('synapsis.theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
$('themeBtn').onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function toast(text) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = text
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2400)
}

function show(section) {
  $('welcome').hidden = section !== 'welcome'
  $('prep').hidden = section !== 'prep'
  $('viewer').hidden = section !== 'viewer'
}

function slug(text, fallback) {
  const base = String(text || '')
    .trim()
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || fallback || 'map-' + Date.now()
}

/* 公式渲染复用内核里那一份（同一个 KaTeX 实例，两壳字形一致） */
const renderMath = core.createMathRenderer(window.katex)

async function api(path, options) {
  const res = await fetch(path, options)
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  if (!res.ok) throw new Error((parsed && parsed.error) || text.slice(0, 300) || 'HTTP ' + res.status)
  return parsed
}

/* ------------------------------------------------------------------ */
/* library                                                             */
/* ------------------------------------------------------------------ */

async function loadLibrary() {
  try {
    const out = await api('/api/library')
    state.files = out.items || []
  } catch (err) {
    state.files = []
    toast('读取图库失败：' + err.message)
  }
  renderLib()
}

function renderLib() {
  const host = $('libList')
  host.textContent = ''
  if (!state.files.length) {
    const empty = document.createElement('div')
    empty.className = 'rail-label'
    empty.textContent = '还没有图'
    host.appendChild(empty)
    return
  }
  for (const file of state.files) {
    const btn = document.createElement('button')
    btn.className = 'libitem'
    btn.dataset.on = state.current && state.current.name === file.name ? '1' : '0'
    const title = document.createElement('b')
    title.textContent = file.title
    const meta = document.createElement('i')
    meta.textContent = file.nodes + ' 个概念'
    btn.append(title, meta)
    btn.onclick = () => openFile(file.name)
    host.appendChild(btn)
  }
}

async function openFile(name) {
  try {
    const data = await api('/api/library/' + encodeURIComponent(name))
    if (!data || !Array.isArray(data.nodes)) throw new Error('文件格式不对')
    state.current = { name, data, dir: 'library' }
    state.prep = null
    show('viewer')
    renderLib()
    mountMap()
  } catch (err) {
    toast('打开失败：' + err.message)
  }
}

function saveSoon() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, 600)
}

async function saveNow() {
  const current = state.current
  if (!current || !current.data) return
  try {
    await api('/api/library/' + encodeURIComponent(current.name), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(current.data),
    })
    state.saveState = 'saved'
  } catch (err) {
    state.saveState = 'error'
    toast('保存失败：' + err.message)
  }
  if (state.current === current) renderMap()
}

/* ------------------------------------------------------------------ */
/* map rendering                                                       */
/* ------------------------------------------------------------------ */

function mountMap() {
  if (!mapRoot) mapRoot = ReactDOM.createRoot($('mapHost'))
  renderMap()
}

function renderMap() {
  if (!mapRoot || !state.current) return
  const data = state.current.data
  const view = { ...data, nodes: data.nodes.slice(), edges: data.edges.slice() }
  mapRoot.render(
    h(MindMap, {
      key: (state.current && state.current.name) || data.id || 'map',
      data: view,
      theme: currentTheme(),
      statusText: state.busy ? '正在生成…' : state.saveState === 'saved' ? '已保存' : '',
      liveText: state.liveText || '',
      follow: state.follow || 0,
      renderMath,
      onChange: (next) => {
        state.current.data = next
        renderMap()
        saveSoon()
      },
      onSelect: () => {},
    }),
  )
}

function scheduleRender() {
  if (state.busy) state.follow = (state.follow || 0) + 1
  if (renderTimer) return
  renderTimer = setTimeout(() => {
    renderTimer = 0
    renderMap()
  }, 120)
}

function showStop(showIt) {
  if (showIt && !stopBtn) {
    stopBtn = document.createElement('button')
    stopBtn.className = 'ghost'
    stopBtn.style.cssText = 'position:absolute;right:16px;top:-34px;z-index:9;font-size:12px;padding:5px 12px'
    stopBtn.textContent = '停止生成'
    stopBtn.onclick = () => {
      if (state.abort) state.abort.abort()
    }
    $('viewer').style.position = 'relative'
    $('viewer').appendChild(stopBtn)
  }
  if (stopBtn) stopBtn.style.display = showIt ? '' : 'none'
}

/* ------------------------------------------------------------------ */
/* input: pdf / text                                                   */
/* ------------------------------------------------------------------ */

async function extractPDF(file) {
  const pdfjs = await import('./vendor/pdf.min.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href
  const buffer = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      text += item.str
      if (item.hasEOL) text += '\n'
      else if (!/\s$/.test(item.str)) text += ' '
    }
    pages.push(text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim())
  }
  return pages
}

function splitChapters(pages) {
  const marked = pages.map((text, index) => '[[P' + (index + 1) + ']]\n' + text).join('\n')
  const lines = marked.split('\n')
  const headRe = /^(第\s*[一二三四五六七八九十百零〇\d]+\s*[章节讲篇]|Chapter\s+\d+|CHAPTER\s+\d+|\d{1,2}(\.\d{1,2}){1,2})(\s+\S.{0,30})?$/
  const heads = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line && line.length <= 40 && headRe.test(line)) heads.push(i)
  }

  const chapters = []
  if (heads.length >= 2) {
    for (let i = 0; i < heads.length; i++) {
      const from = heads[i]
      const to = i + 1 < heads.length ? heads[i + 1] : lines.length
      const title = lines[from].trim().replace(/^\[\[P\d+\]\]\s*/, '')
      const body = lines.slice(from + 1, to).join('\n').trim()
      if (body.length > 40) chapters.push({ title, text: body })
    }
  }

  if (!chapters.length) {
    const paragraphs = marked.split(/\n{2,}/)
    let buffer = ''
    let index = 1
    const flush = () => {
      if (buffer.trim().length > 60) chapters.push({ title: '第 ' + index + ' 部分', text: buffer.trim() })
      index += 1
      buffer = ''
    }
    for (const para of paragraphs) {
      if ((buffer + para).length > 5200) flush()
      buffer += para + '\n\n'
    }
    flush()
  }
  return chapters.map((chapter, index) => ({ title: chapter.title.slice(0, 40), text: chapter.text, index }))
}

async function prepare(title, pages) {
  const chapters = splitChapters(pages)
  if (!chapters.length) throw new Error('没读到正文（可能是扫描件，请改用粘贴文本）')
  const total = pages.join('').length
  state.prep = { title, pages, chapters, total }
  $('prepTitle').textContent = title
  $('prepMeta').textContent = pages.length + ' 页 · 约 ' + Math.round(total / 1000) + 'k 字 · 切成 ' + chapters.length + ' 段'
  const host = $('chapters')
  host.textContent = ''
  for (const chapter of chapters) {
    const row = document.createElement('div')
    row.className = 'chap'
    const name = document.createElement('b')
    name.textContent = chapter.title
    const count = document.createElement('span')
    count.textContent = chapter.text.length + ' 字'
    row.append(name, count)
    host.appendChild(row)
  }
  show('prep')
}

async function takeFile(file) {
  try {
    $('welcomeErr').hidden = true
    const title = $('titleInput').value.trim() || file.name.replace(/\.[^.]+$/, '')
    let pages
    if (/\.pdf$/i.test(file.name)) pages = await extractPDF(file)
    else pages = [(await file.text())]
    await prepare(title, pages)
  } catch (err) {
    fail(err)
  }
}

function fail(err) {
  const box = $('welcomeErr')
  box.textContent = err && err.message ? err.message : String(err)
  box.hidden = false
  show('welcome')
}

/* ------------------------------------------------------------------ */
/* generation                                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = [
  '你是一位课程助教，负责把讲义片段整理成"概念图"数据。',
  '你只输出 NDJSON：每一行是一个独立的 JSON 对象。不要输出 Markdown 代码块，不要输出任何解释文字。',
  '不要编造讲义里没有的内容；如果某字段讲义里没讲，就写空字符串。',
  '数学写法：definition/intuition/examples/pitfalls 里的行内公式用 \\( … \\) 包起来；formal 整段直接写 LaTeX（如 a \\in A, A \\subseteq B \\iff \\forall x(x \\in A \\to x \\in B)），不必加定界符。',
].join('\n')

function chapterPrompt(title, chapter) {
  return [
    '讲义：《' + title + '》',
    '本次片段标题：' + chapter.title,
    '',
    '请从下面的片段中抽出 6–14 个概念，按以下顺序输出：',
    '1. 第一行：{"type":"chapter","title":"本片段标题"}',
    '2. 每个概念一行：{"type":"node","id":"english-slug","title":"中文概念名","en":"English term","parent":"父概念 id 或 __chapter__","summary":"一句话，不超过30字","definition":"严格定义，2-4句","formal":"公式或形式化描述（纯文本），没有就空","intuition":"直觉解释，1-3句","examples":"具体例子，1-3个，分号隔开","pitfalls":"常见误区，1-2句","source":{"page":页码,"snippet":"原文原句，不超过60字"}}',
    '3. 最后若干行：{"type":"edge","from":"概念id","to":"概念id","kind":"prereq"}，kind 取 prereq（必须先学）/related（相关）/contrast（易混对比）',
    '',
    '规则：',
    '- id 用小写英文短横线，本片段内唯一',
    '- parent 必须指向本片段已输出过的 id，或写 "__chapter__"',
    '- 页码从正文里的 [[P数字]] 标记推断',
    '- 中文概念名要给 en 字段；数学用普通文本，不要 $ 符号',
    '',
    '讲义片段：',
    chapter.text,
  ].join('\n')
}

async function streamChat(messages, onDelta, signal) {
  if (!settings.apiKey) throw new Error('还没填 API Key，点左下角「设置」')
  const res = await fetch('/api/llm?stream=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      baseURL: settings.baseURL,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
      temperature: 0.3,
      max_tokens: 8000,
    }),
    signal,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 300)
    } catch {}
    throw new Error('模型接口出错 ' + res.status + ' ' + detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    let cut
    while ((cut = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, cut).trim()
      pending = pending.slice(cut + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload)
        const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta
        const text = delta && delta.content ? delta.content : ''
        if (text) onDelta(text)
      } catch {}
    }
  }
}

function makeNode(partial) {
  return {
    id: partial.id,
    title: partial.title || partial.id,
    en: partial.en || '',
    parent: partial.parent || null,
    summary: partial.summary || '',
    definition: partial.definition || '',
    formal: partial.formal || '',
    intuition: partial.intuition || '',
    examples: partial.examples || '',
    pitfalls: partial.pitfalls || '',
    source: partial.source && (partial.source.page || partial.source.snippet) ? partial.source : undefined,
    mastery: 0,
    note: '',
  }
}

function mergeLine(line, ctx) {
  const text = line.trim().replace(/^```.*$/, '').replace(/,$/, '')
  if (!text || text === '```' || text[0] !== '{') return
  let obj
  try {
    obj = JSON.parse(text)
  } catch {
    return
  }
  const data = ctx.data
  if (obj.type === 'chapter' && obj.title && !ctx.chapterNodeId) {
    ctx.chapterNodeId = 'c' + ctx.chapterIndex
    if (!data.nodes.some((n) => n.id === ctx.chapterNodeId)) {
      data.nodes.push(makeNode({ id: ctx.chapterNodeId, title: obj.title, parent: 'root', summary: '' }))
    }
    ctx.rootHasChapter = true
    scheduleRender()
    return
  }
  if (obj.type === 'node' && obj.id) {
    const id = String(obj.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'n-' + Date.now()
    if (ctx.seen.has(id) || data.nodes.some((n) => n.id === id)) return
    ctx.seen.add(id)
    let parent = obj.parent && obj.parent !== '__chapter__' ? String(obj.parent) : null
    if (!parent || !data.nodes.some((n) => n.id === parent)) {
      if (!ctx.chapterNodeId) {
        ctx.chapterNodeId = 'c' + ctx.chapterIndex
        data.nodes.push(makeNode({ id: ctx.chapterNodeId, title: ctx.chapterTitle, parent: 'root' }))
        ctx.rootHasChapter = true
      }
      parent = ctx.chapterNodeId
    }
    data.nodes.push(makeNode(Object.assign({}, obj, { id, parent })))
    scheduleRender()
    return
  }
  if (obj.type === 'edge' && obj.from && obj.to) {
    const from = String(obj.from)
    const to = String(obj.to)
    if (from === to) return
    if (!data.nodes.some((n) => n.id === from) || !data.nodes.some((n) => n.id === to)) return
    const kind = ['prereq', 'related', 'contrast'].includes(obj.kind) ? obj.kind : 'related'
    const exists = data.edges.some((e) => e.from === from && e.to === to && e.type === kind)
    if (exists) return
    data.edges.push({ from, to, type: kind })
    scheduleRender()
  }
}

async function generate() {
  const prep = state.prep
  if (!prep) return
  if (!settings.apiKey) {
    toast('先点左下角「设置」填 API Key')
    $('setBtn').click()
    return
  }
  const name = slug(prep.title) + '.mindmap.json'
  const data = {
    version: 1,
    id: name,
    title: prep.title,
    subtitle: '',
    updated: new Date().toISOString(),
    nodes: [makeNode({ id: 'root', title: prep.title, parent: null, summary: prep.chapters.length + ' 个部分' })],
    edges: [],
  }
  state.current = { name, data }
  state.busy = true
  state.abort = new AbortController()
  state.liveText = '准备中…'
  show('viewer')
  renderLib()
  mountMap()
  showStop(true)
  $('genBtn').disabled = true

  let failed = null
  try {
    for (let i = 0; i < prep.chapters.length; i++) {
      const chapter = prep.chapters[i]
      state.liveText = '正在读《' + chapter.title + '》… (' + (i + 1) + '/' + prep.chapters.length + ')'
      renderMap()
      const ctx = { data, seen: new Set(data.nodes.map((n) => n.id)), chapterIndex: i, chapterTitle: chapter.title, chapterNodeId: null, rootHasChapter: data.nodes.some((n) => n.parent === 'root') }
      let buffer = ''
      let partialLine = ''
      await streamChat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: chapterPrompt(prep.title, chapter) },
        ],
        (delta) => {
          buffer += delta
          let cut
          while ((cut = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, cut)
            buffer = buffer.slice(cut + 1)
            mergeLine(line, ctx)
          }
          partialLine = buffer
          state.liveText = '正在读《' + chapter.title + '》… ' + data.nodes.length + ' 个概念 (' + (i + 1) + '/' + prep.chapters.length + ')'
        },
        state.abort.signal,
      )
      if (buffer.trim()) mergeLine(buffer, ctx)
      await saveNow()
    }
    state.liveText = ''
  } catch (err) {
    failed = err
  } finally {
    state.busy = false
    state.abort = null
    showStop(false)
    $('genBtn').disabled = false
    renderMap()
  }

  if (failed) {
    if (failed.name === 'AbortError') toast('已停止，已完成的部分已保存')
    else toast('生成中断：' + failed.message)
  } else {
    toast('完成：' + data.nodes.length + ' 个概念')
  }
  await loadLibrary()
}

/* ------------------------------------------------------------------ */
/* wiring                                                             */
/* ------------------------------------------------------------------ */

$('newBtn').onclick = () => {
  state.prep = null
  $('welcomeErr').hidden = true
  show('welcome')
}

$('pickBtn').onclick = () => $('fileInput').click()
$('fileInput').onchange = (event) => {
  const file = event.target.files && event.target.files[0]
  if (file) takeFile(file)
  event.target.value = ''
}

const drop = $('drop')
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault()
    drop.dataset.over = '1'
  })
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (event) => {
    event.preventDefault()
    drop.dataset.over = '0'
  })
}
drop.addEventListener('drop', (event) => {
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]
  if (file) takeFile(file)
})

$('analyzeBtn').onclick = async () => {
  try {
    const text = $('pasteBox').value.trim()
    if (text.length < 60) throw new Error('至少要粘贴一小段正文')
    const title = $('titleInput').value.trim() || '未命名讲义'
    await prepare(title, [text])
  } catch (err) {
    fail(err)
  }
}

$('backBtn').onclick = () => show('welcome')
$('genBtn').onclick = generate

loadLibrary().then(() => {
  const params = new URLSearchParams(location.search)
  const open = params.get('open')
  if (open && state.files.some((f) => f.name === open)) openFile(open)
  if (params.get('demo') === '1') runDemo()
})

/* 演示模式：?mock=1&demo=1 —— 用本地假模型跑一遍完整流程 */
const SAMPLE = [
  '第1章 集合',
  '集合是一些确定的、彼此不同的对象组成的整体。若 A 的每个元素都是 B 的元素，则称 A 包含于 B，记作 A⊆B。',
  'A 的所有子集组成的集合称为 A 的幂集，记作 P(A)，其元素个数为 2 的 |A| 次方。集合之间还可以做并、交、差、补运算。',
  '第2章 命题逻辑',
  '命题是能够判断真假的陈述句。由命题通过联结词可以构成复合命题，基本的联结词有否定、合取、析取、蕴含、等价五种。',
  '蕴含式 p→q 只在 p 真而 q 假时为假。推理规则如假言推理、拒取式都建立在蕴含的真值表之上。',
].join('\n')

function runDemo() {
  settings = { baseURL: 'http://127.0.0.1:7800/v1', model: 'mock', apiKey: 'mock' }
  $('pasteBox').value = SAMPLE
  $('titleInput').value = '离散数学 · 演示'
  prepare('离散数学 · 演示', [SAMPLE]).then(() => {
    setTimeout(() => generate(), 300)
  })
}
