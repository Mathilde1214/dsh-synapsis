/* Synapsis · 析域 —— 概念图内核
 * 一个工厂：createMindMap(React) -> { MindMap, buildLayout }
 * 无模块语法，可作为普通脚本加载，也可被插件拼接进 __ModuleLoader__ 工厂。
 */
function createMindMap(React) {
  var h = React.createElement
  var useState = React.useState
  var useEffect = React.useEffect
  var useRef = React.useRef
  var useMemo = React.useMemo
  var useCallback = React.useCallback

  /* 复习排序：模糊(1) → 未读(0) → 已掌握(2)，同档按标题。
     注意 `a - b || c` 这种写法里 || 的右侧必须是完整比较结果，
     以前写成 `a - b || c < d ? -1 : 1` 会让「只要档位不同就返回 -1」。
     另外只收「有正文」的节点：章、主题这些层级卡翻过来是空的，
     排在复习队列里只是浪费一轮。 */
  var REVIEW_FIELDS = ['definition', 'formal', 'examples', 'intuition', 'pitfalls']

  function hasSomethingToSay(n) {
    if (!n) return false
    for (var i = 0; i < REVIEW_FIELDS.length; i++) {
      var v = n[REVIEW_FIELDS[i]]
      if (typeof v === 'string' && v.trim()) return true
    }
    return false
  }

  /* 复习排序：先「有点模糊」，再「复习过还是没印象」，再「压根没学过」，最后「会了」。
     「没学过」与「复习后没印象」不再混成同一档：前者 mastery 还是 0 且从没评过，
     后者 mastery 是 0 但 lastReviewed 有值（点过「没印象」）。 */
  function sortReviewPool(nodes, scopeIds) {
    var inScope = scopeIds && scopeIds.size ? scopeIds : null
    var pool = (nodes || []).filter(function (n) {
      if (!n || !n.id || !n.parent) return false
      if (inScope && !inScope.has(n.id)) return false
      return hasSomethingToSay(n)
    })
    var reviewed = function (n) {
      return typeof n.lastReviewed === 'string' && n.lastReviewed.length > 0
    }
    var rank = function (n) {
      if (n.mastery === 1) return 0
      if (n.mastery === 0) return reviewed(n) ? 1 : 2
      return 3
    }
    return pool.sort(function (a, b) {
      return rank(a) - rank(b) || String(a.title || '').localeCompare(String(b.title || ''), 'zh')
    })
  }

  /* ---------------------------------------------------------------- */
  /* geometry                                                          */
  /* ---------------------------------------------------------------- */

  var S = 1.6
  var INV = 1 / S
  var RING = 300
  var W0 = 196
  var H0 = 82

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v
  }

  function buildLayout(nodes, rootId) {
    var byId = new Map()
    var i
    for (i = 0; i < nodes.length; i++) {
      var raw = nodes[i]
      if (!raw || !raw.id || byId.has(raw.id)) continue /* 重复 id：保留第一个，别让同一节点进树两次 */
      byId.set(raw.id, {
        id: raw.id,
        title: raw.title || '未命名',
        en: raw.en || '',
        summary: raw.summary || '',
        parent: raw.parent || null,
        children: [],
        depth: 0,
        weight: 1,
        x: 0,
        y: 0,
        w: W0,
        h: H0,
      })
    }
    var root = null
    var forced = rootId ? byId.get(rootId) : null
    var orphans = []
    for (i = 0; i < nodes.length; i++) {
      var item = nodes[i]
      if (!item || !item.id) continue
      var node = byId.get(item.id)
      if (!node) continue
      var parent = item.parent ? byId.get(item.parent) : null
      if (parent && parent !== node) parent.children.push(node)
      else if (!root) root = node
      else orphans.push(node)
    }
    if (forced) root = forced
    if (!root) return null
    /* 悬空的 parent（写错的 id）不该让节点消失：按「根的直接子节点」接回来 */
    for (i = 0; i < orphans.length; i++) {
      var orphan = orphans[i]
      if (orphan !== root && orphan.parent !== root.id) {
        orphan.parent = root.id
        root.children.push(orphan)
      }
    }

    var order = []
    /* 防环：坏数据里父子互指会让递归无限下去，seen 兜住（数据修复前至少不白屏） */
    var seen = new Set()
    var walk = function (n, depth) {
      if (!n || seen.has(n)) return
      seen.add(n)
      n.depth = depth
      order.push(n)
      for (var k = 0; k < n.children.length; k++) walk(n.children[k], depth + 1)
    }
    walk(root, 0)

    for (i = order.length - 1; i >= 0; i--) {
      var cur = order[i]
      if (cur.children.length === 0) {
        cur.weight = 1
      } else {
        var sum = 0
        for (var c = 0; c < cur.children.length; c++) sum += cur.children[c].weight
        cur.weight = sum
      }
    }

    var counts = []
    for (i = 0; i < order.length; i++) {
      var d = order[i].depth
      counts[d] = (counts[d] || 0) + 1
    }

    var radius = []
    for (i = 0; i < counts.length; i++) {
      var w = W0 * Math.pow(INV, i)
      /* 第 3 层往下画的是圆点（LOD 里 detail>=3），按点径算，别按卡片宽度把环撑开 */
      var effW = i >= 3 ? w * 0.36 : w
      var geometric = i === 0 ? 0 : radius[i - 1] + RING * Math.pow(INV, i - 1)
      var needed = counts[i] ? (counts[i] * effW * 1.18) / (2 * Math.PI) : 0
      radius[i] = Math.max(geometric, needed)
    }

    root.x = 0
    root.y = 0
    var placed = new Set()
    var place = function (n, a0, a1) {
      if (!n || placed.has(n)) return
      placed.add(n)
      var total = n.weight || 1
      var cursor = a0
      for (var k = 0; k < n.children.length; k++) {
        var child = n.children[k]
        var span = (a1 - a0) * ((child.weight || 1) / total)
        var mid = cursor + span / 2
        var r = radius[child.depth] || 0
        child.x = Math.cos(mid) * r
        child.y = Math.sin(mid) * r
        place(child, cursor, cursor + span)
        cursor += span
      }
    }
    place(root, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2)

    var minX = 0
    var minY = 0
    var maxX = 0
    var maxY = 0
    for (i = 0; i < order.length; i++) {
      var it = order[i]
      it.w = W0 * Math.pow(INV, it.depth)
      it.h = H0 * Math.pow(INV, it.depth)
      minX = Math.min(minX, it.x - it.w / 2)
      minY = Math.min(minY, it.y - it.h / 2)
      maxX = Math.max(maxX, it.x + it.w / 2)
      maxY = Math.max(maxY, it.y + it.h / 2)
    }

    var pad = 80
    var visible = new Set()
    for (i = 0; i < order.length; i++) visible.add(order[i].id)
    return {
      root: root,
      byId: byId,
      order: order,
      visible: visible,
      bounds: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
      maxDepth: counts.length - 1,
    }
  }

  function fitFor(layout, focusId, vw, vh, wide) {
    var node = layout.byId.get(focusId) || layout.root
    var minX = node.x - node.w / 2
    var maxX = node.x + node.w / 2
    var minY = node.y - node.h / 2
    var maxY = node.y + node.h / 2
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i]
      minX = Math.min(minX, child.x - child.w / 2)
      maxX = Math.max(maxX, child.x + child.w / 2)
      minY = Math.min(minY, child.y - child.h / 2)
      maxY = Math.max(maxY, child.y + child.h / 2)
      /* 孙辈也算进来：焦点层之外还看得见一层（wide 模式，用于生成中） */
      if (wide === true) for (var j = 0; j < child.children.length; j++) {
        var grand = child.children[j]
        minX = Math.min(minX, grand.x - grand.w / 2)
        maxX = Math.max(maxX, grand.x + grand.w / 2)
        minY = Math.min(minY, grand.y - grand.h / 2)
        maxY = Math.max(maxY, grand.y + grand.h / 2)
      }
    }
    var boxW = Math.max(maxX - minX, node.w * 2.4)
    var boxH = Math.max(maxY - minY, node.h * 2.4)
    /* 上限：焦点卡在屏幕上不超过 260px 宽，否则一个孤零零的子图会被吹成满屏 */
    var cap = 260 / Math.max(1, node.w)
    var k = Math.min(clamp(Math.min(vw / (boxW * 1.2), vh / (boxH * 1.2)), 0.16, 8), cap)
    return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, k: k }
  }

  /* 公式渲染：$..$ / $$..$$ / \(..\) / \[..\] 交给 KaTeX；
     「形式化」字段整段都是 LaTeX，没写定界符时按整段渲染。
     两个壳共用这一份，只是把 katex 实例从外面递进来。 */
  var HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
  function escapeHtml(text) {
    return String(text).replace(/[&<>]/g, function (c) {
      return HTML_ESCAPE[c]
    })
  }

  function createMathRenderer(katex) {
    if (!katex || typeof katex.renderToString !== 'function') return null
    var opts = { throwOnError: false, strict: false, output: 'html' }
    return function (text, wholeAsMath) {
      var src = String(text == null ? '' : text)
      var re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g
      var hasMath = re.test(src)
      re.lastIndex = 0
      if (!hasMath) {
        if (!wholeAsMath) return null
        try {
          return katex.renderToString(src, Object.assign({ displayMode: false }, opts))
        } catch (err) {
          return null
        }
      }
      var out = ''
      var last = 0
      var match
      while ((match = re.exec(src))) {
        out += escapeHtml(src.slice(last, match.index))
        var tex = match[1] || match[2] || match[3] || match[4]
        var display = Boolean(match[1] || match[4])
        try {
          out += katex.renderToString(tex, Object.assign({ displayMode: display }, opts))
        } catch (err) {
          out += escapeHtml(match[0])
        }
        last = match.index + match[0].length
      }
      out += escapeHtml(src.slice(last))
      return out
    }
  }

  /* ---------------------------------------------------------------- */
  /* styles                                                            */
  /* ---------------------------------------------------------------- */

  var CSS = [
    /* 画布艺术层调色板：整张图是「纸」，属于 docs/web-styling 里说的艺术层，
       所以下面这套纸色集中声明一次，其余 CSS 只引用变量，不再散落字面色。
       语义上与宿主 token 对应的项，一律 var(--dsw-alias-…, 纸色) 兜底。 */
    '.sn-root{',
    '--sn-paper:var(--dsw-alias-bg-base,#f4efe3);',
    '--sn-paper-2:var(--dsw-alias-bg-layer-1,#fbf7ec);',
    '--sn-surface:var(--dsw-alias-bg-layer-2,#fffdf6);',
    '--sn-surface-focus:#fffaf0;',
    '--sn-ink:var(--dsw-alias-label-primary,#2f2a24);',
    '--sn-ink-2:var(--dsw-alias-label-secondary,#4a4034);',
    '--sn-ink-3:var(--dsw-alias-label-tertiary,#a2957f);',
    '--sn-line:var(--dsw-alias-border-l1,rgba(86,68,45,.24));',
    '--sn-line-2:rgba(120,100,70,.16);',
    '--sn-line-strong:rgba(120,88,52,.5);',
    '--sn-accent:var(--dsw-alias-brand-primary,#9a6b3f);',
    '--sn-accent-soft:rgba(154,107,63,.24);',
    '--sn-amber:var(--dsw-alias-state-warn-primary,#b2782a);',
    '--sn-teal:var(--dsw-alias-state-success-primary,#208a78);',
    '--sn-rose:var(--dsw-alias-state-error-primary,#b43c60);',
    '--sn-dot:#bfad90;',
    '--sn-shadow-card:0 1px 0 rgba(255,255,255,.7) inset,0 2px 6px rgba(70,55,35,.10);',
    '--sn-shadow-sel:0 0 0 2px rgba(154,107,63,.24),0 4px 14px rgba(70,55,35,.18);',
    '--sn-shadow-float:var(--dsw-elevation-prominent,0 10px 30px rgba(60,44,26,.18));',
    '--sn-shadow-panel:var(--dsw-elevation-panel,0 8px 24px rgba(60,44,26,.16));',
    '}',
    /* 纸的两套调色板写死在这里，不再跟着宿主 token 走：
       深色宿主里的 label token 是浅色的，落到米黄纸上就成了「白字白底」。
       用户还可以在「设置」里覆盖其中几项（内联 style 优先级更高）。 */
    '.sn-root[data-theme="light"]{',
    '--sn-paper:#f4efe3;--sn-paper-2:#fbf7ec;--sn-surface:#fffdf6;--sn-surface-focus:#fffaf0;',
    '--sn-ink:#2f2a24;--sn-ink-2:#4a4034;--sn-ink-3:#8c8071;',
    '--sn-line:rgba(86,68,45,.24);--sn-line-2:rgba(120,100,70,.16);--sn-line-strong:rgba(120,88,52,.5);',
    '--sn-accent:#9a6b3f;--sn-accent-soft:rgba(154,107,63,.24);',
    '--sn-amber:#b2782a;--sn-teal:#208a78;--sn-rose:#b43c60;--sn-dot:#bfad90;',
    '--sn-shadow-card:0 1px 0 rgba(255,255,255,.7) inset,0 2px 6px rgba(70,55,35,.10);',
    '--sn-shadow-sel:0 0 0 2px rgba(154,107,63,.24),0 4px 14px rgba(70,55,35,.18);',
    '}',
    '.sn-root[data-theme="dark"]{',
    '--sn-paper:#1c1a17;--sn-paper-2:#211e1a;--sn-surface:#241f1a;--sn-surface-focus:#2a241d;',
    '--sn-ink:#efe7d8;--sn-ink-2:#d6c9b4;--sn-ink-3:#a1917b;',
    '--sn-line:rgba(210,190,160,.22);--sn-line-2:rgba(210,190,160,.14);--sn-line-strong:rgba(210,190,160,.42);',
    '--sn-accent:#c99b62;--sn-accent-soft:rgba(201,155,98,.26);',
    '--sn-amber:#d9a253;--sn-teal:#4fb3a0;--sn-rose:#d4738f;--sn-dot:#6b5f4e;',
    '--sn-shadow-card:0 1px 0 rgba(255,255,255,.04) inset,0 2px 8px rgba(0,0,0,.42);',
    '--sn-shadow-sel:0 0 0 2px rgba(201,155,98,.34),0 6px 18px rgba(0,0,0,.5);',
    '}',
    '.sn-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;',
    'background:var(--sn-paper,#f4efe3);color:var(--sn-ink,#2f2a24);',
    'font-family:var(--sn-font,"KaiTi","STKaiti","Kaiti SC","Songti SC",serif);font-size:var(--sn-font-size,14px);}',
    '.sn-topbar{position:relative;z-index:6;display:flex;align-items:center;gap:10px;flex:none;height:42px;padding:0 12px;',
    'border-bottom:1px solid var(--sn-line-2,rgba(120,100,70,.16));',
    'background:var(--sn-paper-2,rgba(255,253,246,.9));}',
    '.sn-crumbs{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden;flex:1;}',
    '.sn-leading{display:flex;align-items:center;gap:6px;flex:none;max-width:40%;}',
    '.sn-libsel{font:inherit;font-size:12.5px;max-width:180px;padding:3px 6px;border-radius:6px;',
    'border:1px solid var(--sn-line);background:transparent;color:inherit;cursor:pointer;}',
    '.sn-libsel:focus{outline:none;border-color:var(--sn-line-strong);}',
    '.sn-libsel option{background:var(--sn-surface);color:var(--sn-ink);}',
    '.sn-crumb{font:inherit;font-size:13px;line-height:1;padding:5px 7px;border-radius:6px;border:0;background:transparent;',
    'color:var(--sn-ink-2);cursor:pointer;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;}',
    '.sn-crumb[data-on="1"]{color:var(--sn-ink);font-weight:700;}',
    '.sn-sep{color:var(--sn-ink-3);font-size:12px;flex:none;}',
    '.sn-status{font-size:11.5px;color:var(--sn-ink-3);white-space:nowrap;flex:none;}',
    '.sn-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;',
    'border:1px solid transparent;background:transparent;color:var(--sn-ink-2);cursor:pointer;flex:none;}',
    '.sn-body{position:relative;display:flex;flex:1;min-height:0;}',
    '.sn-canvas{position:relative;flex:1;min-width:0;overflow:hidden;cursor:grab;touch-action:none;',
    'background-image:radial-gradient(circle at 1px 1px, var(--sn-dot,rgba(120,100,70,.16)) 1px, transparent 0);background-size:26px 26px;}',
    '.sn-canvas[data-dragging="1"]{cursor:grabbing;}',
    '.sn-canvas:before{content:"";position:absolute;inset:0;pointer-events:none;',
    'background:radial-gradient(120% 90% at 50% 45%, transparent 42%, rgba(96,78,52,.10) 100%);}',
    '.sn-scene{position:absolute;left:0;top:0;transform-origin:0 0;}',
    '.sn-scene[data-moving="1"]{will-change:transform;}',
    '.sn-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}',
    '.sn-linklayer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible;}',
    '.sn-root[data-linking="1"] .sn-card{transition:box-shadow .12s ease;}',
    /* 悬停效果只在真有指针的设备上生效（触屏上 :hover 会「粘住」） */
    '@media (hover:hover){',
    '.sn-root[data-linking="1"] .sn-card:hover{box-shadow:0 0 0 2px rgba(190,128,35,.75);}',
    '}',
    '.sn-card{position:absolute;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:2px;overflow:hidden;',
    'background:var(--sn-surface);color:var(--sn-ink);border:1px solid var(--sn-line);',
    'box-shadow:var(--sn-shadow-card);',
    'transition:box-shadow .16s ease, background-color .16s ease, border-color .16s ease;}',
    '.sn-card[data-sel="1"]{border-color:var(--sn-accent);box-shadow:var(--sn-shadow-sel);}',
    '.sn-card[data-focus="1"]{background:var(--sn-surface-focus);border-color:var(--sn-line-strong);}',
    '.sn-card[data-dim="1"]{opacity:.55;}',
    '.sn-card[data-dot="1"]{border-radius:50%;background:var(--sn-dot);border-color:var(--sn-line);}',
    ".sn-title{font-family:'KaiTi','STKaiti','Songti SC',serif;font-weight:700;line-height:1.15;padding:0 .14em;",
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.sn-title[data-wrap="1"]{white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;',
    '-webkit-line-clamp:2;text-align:center;}',
    '.sn-en{font-family:ui-serif,Georgia,serif;font-style:italic;opacity:.5;line-height:1.1;padding:0 .2em;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.02em;}',
    '.sn-summary{opacity:.68;line-height:1.25;padding:0 .18em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;}',
    '.sn-def{margin-top:.35em;opacity:.74;line-height:1.34;padding:0 .18em;display:-webkit-box;-webkit-box-orient:vertical;',
    '-webkit-line-clamp:4;overflow:hidden;}',
    '.sn-sidebar{position:relative;z-index:5;display:flex;flex-direction:column;flex:none;width:380px;min-width:0;',
    'border-left:1px solid var(--sn-line));background:var(--sn-paper-2);overflow:hidden;}',
    '.sn-sidebar[data-collapsed="1"]{width:0;border-left:0;}',
    '.sn-side{display:flex;flex-direction:column;min-height:0;height:100%;overflow-y:auto;padding:16px 16px 40px;}',
    '.sn-side-head{display:flex;align-items:flex-start;gap:8px;}',
    '.sn-side-title{font-size:calc(21px * var(--sn-fs,1));font-weight:700;line-height:1.25;flex:1;min-width:0;}',
    '.sn-side-en{font-size:12px;font-style:italic;opacity:.55;margin-top:2px;}',
    '.sn-field{margin-top:14px;}',
    '.sn-label{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--sn-ink-3);',
    'margin-bottom:4px;display:flex;align-items:center;gap:6px;}',
    '.sn-label:after{content:"";flex:1;height:1px;background:var(--sn-line-2);}',
    '.sn-text{font-size:calc(13.5px * var(--sn-fs,1));line-height:1.72;white-space:pre-wrap;word-break:break-word;}',
    '.sn-math{font-family:ui-serif,Georgia,"Times New Roman",serif;font-size:14px;line-height:1.7;',
    'background:rgba(120,100,70,.07);border-radius:6px;padding:6px 9px;white-space:pre-wrap;word-break:break-word;}',
    '.sn-rel{display:flex;flex-wrap:wrap;gap:5px;}',
    '.sn-chip{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;line-height:1;padding:4px 8px;',
    'border-radius:999px;cursor:pointer;border:1px solid var(--sn-line);background:var(--sn-surface);color:var(--sn-ink-2);',
    'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.sn-chip[data-t="prereq"]{border-color:var(--sn-amber);color:var(--sn-amber);background:rgba(214,163,74,.12);}',
    '.sn-chip[data-t="related"]{border-color:var(--sn-teal);color:var(--sn-teal);background:rgba(52,168,148,.12);}',
    '.sn-chip[data-t="contrast"]{border-color:var(--sn-rose);color:var(--sn-rose);background:rgba(200,70,110,.10);}',
    '.sn-chip[data-on="1"]{font-weight:700;box-shadow:0 0 0 2px var(--sn-accent-soft);}',
    '.sn-chip-danger{border-color:var(--sn-rose);color:var(--sn-rose);}',
    '.sn-edgehit{pointer-events:stroke;cursor:pointer;}',
    '.sn-edgebar{position:absolute;left:50%;top:44px;transform:translateX(-50%);z-index:6;display:flex;align-items:center;gap:8px;',
    'max-width:calc(100% - 36px);padding:6px 10px;border-radius:999px;border:1px solid var(--sn-line);',
    'background:var(--sn-surface);box-shadow:var(--sn-shadow-panel);font-size:12px;}',
    '.sn-edgebar-title{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--sn-ink-2);}',
    '.sn-edgebar-kinds{display:flex;gap:6px;}',
    '.sn-mut{font-size:11.5px;color:var(--sn-ink-3);}',
    '.sn-note{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;font:inherit;font-size:13px;line-height:1.6;',
    'padding:8px 9px;border-radius:8px;border:1px dashed var(--sn-line);background:var(--sn-surface);color:inherit;}',
    '.sn-note:focus{outline:none;border-color:var(--sn-line-strong);background:var(--sn-surface);}',
    '.sn-field-edit{margin-top:2px;}',
    '.sn-field-input{width:100%;box-sizing:border-box;resize:none;overflow:hidden;font:inherit;font-size:13px;line-height:1.62;',
    'padding:6px 8px;border-radius:7px;border:1px solid var(--sn-line-strong);background:var(--sn-surface);color:inherit;}',
    '.sn-field-input:focus{outline:none;border-color:var(--sn-line-strong);box-shadow:0 0 0 2px var(--sn-accent-soft);}',
    '.sn-field-input-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;}',
    '.sn-field-preview{margin-top:6px;padding:5px 7px;border-radius:6px;background:rgba(120,88,52,.07);font-size:13px;line-height:1.5;}',
    '.sn-field-emptytext{color:rgba(90,72,48,.42);}',
    '.sn-mastery{display:flex;gap:6px;}',
    '.sn-mbtn{flex:1;font:inherit;font-size:12px;padding:6px 0;border-radius:7px;cursor:pointer;',
    'border:1px solid rgba(120,100,70,.24);background:transparent;color:var(--sn-ink-2);}',
    '.sn-mbtn[data-on="1"]{background:rgba(120,88,52,.14);border-color:rgba(120,88,52,.5);color:#3a2f22;font-weight:700;}',
    '.sn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;',
    'color:var(--sn-ink-3);font-size:13px;}',
    '.sn-mini{position:absolute;right:12px;bottom:12px;z-index:4;width:168px;height:116px;border-radius:8px;',
    'background:rgba(255,253,246,.86);border:1px solid rgba(120,100,70,.24);box-shadow:0 2px 10px rgba(70,55,35,.12);overflow:hidden;pointer-events:none;}',
    '.sn-legend{position:absolute;left:12px;bottom:12px;z-index:4;display:flex;flex-direction:column;gap:3px;',
    'font-size:12px;color:var(--sn-ink-3);pointer-events:none;}',
    '.sn-legend i{display:inline-block;width:16px;height:0;margin-right:6px;vertical-align:middle;}',
    '.sn-pathlist{list-style:none;margin:10px 0 0;padding:0;}',
    '.sn-pathstep{display:flex;gap:8px;align-items:flex-start;padding:7px 8px;border-radius:7px;cursor:pointer;}',
    '.sn-pathstep[data-on="1"]{background:rgba(154,107,63,.14);}',
    '.sn-pathnum{flex:none;width:20px;height:20px;border-radius:50%;border:1px solid rgba(154,107,63,.5);color:#9a6b3f;',
    'font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:2px;}',
    '.sn-pathstep[data-last="1"] .sn-pathnum{background:#9a6b3f;color:#fff;border-color:#9a6b3f;}',
    '.sn-pathtxt{display:flex;flex-direction:column;gap:2px;min-width:0;}',
    '.sn-pathtitle{font-size:13.5px;color:var(--sn-ink);}',
    '.sn-pathsum{font-size:11.5px;line-height:1.45;color:var(--sn-ink-3);}',
    '.sn-pathsub{font-size:11.5px;line-height:1.6;color:var(--sn-ink-3);margin-top:4px;}',
    '.sn-card[data-path="1"]{box-shadow:0 0 0 2px rgba(154,107,63,.42),0 10px 20px -16px rgba(60,40,20,.7);}',
    '.sn-root[data-theme="dark"] .sn-pathtitle{color:#efe7d8;}',
    '.sn-root[data-theme="dark"] .sn-pathsum,.sn-root[data-theme="dark"] .sn-pathsub{color:#a89a84;}',
    '.sn-root[data-theme="dark"] .sn-pathnum{color:#e8c184;border-color:rgba(232,193,132,.5);}',
    '.sn-root[data-theme="dark"] .sn-pathstep[data-on="1"]{background:rgba(232,193,132,.16);}',
    '.sn-emptyfield{margin:.1em 0 .5em;padding:.5em .6em;border:1px dashed rgba(150,120,80,.35);border-radius:7px;color:rgba(90,72,48,.65);font-size:12.5px;line-height:1.5;}',
    '.sn-hint{position:absolute;left:12px;top:10px;z-index:4;font-size:12px;color:var(--sn-ink-3);',
    'background:rgba(255,253,246,.7);padding:3px 8px;border-radius:999px;pointer-events:none;}',
    '.sn-src{margin-top:8px;border-left:2px solid rgba(154,107,63,.45);padding-left:9px;font-size:12.5px;line-height:1.65;opacity:.82;}',
    '.sn-src-meta{font-size:12px;letter-spacing:.06em;opacity:.7;margin-bottom:3px;}',
    '.sn-live{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;font-size:12px;',
    'background:rgba(255,253,246,.92);border:1px solid rgba(120,100,70,.24);border-radius:999px;padding:5px 12px;pointer-events:none;}',
    /* 搜索 */
    '.sn-searchbtn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border-radius:6px;flex:none;',
    'border:1px solid rgba(120,100,70,.24);background:transparent;color:var(--sn-ink-2);font:inherit;font-size:12px;cursor:pointer;}',
    '.sn-searchbtn kbd{font:inherit;font-size:10.5px;opacity:.62;}',
    '.sn-searchbtn[data-on="1"]{background:rgba(190,128,35,.16);}',
    '.sn-exportwrap{position:relative;flex:none;}',
    '.sn-exportmenu{position:absolute;right:0;top:30px;min-width:140px;display:flex;flex-direction:column;padding:4px;',
    'border-radius:8px;background:var(--sn-surface,#fffaf0);border:1px solid var(--sn-line,rgba(120,100,70,.24));',
    'box-shadow:var(--sn-shadow-float,0 10px 26px rgba(60,45,28,.22));z-index:40;}',
    '.sn-exportitem{appearance:none;border:0;background:transparent;font:inherit;font-size:12.5px;text-align:left;',
    'padding:6px 9px;border-radius:6px;cursor:pointer;color:var(--sn-ink,#2f2a24);}',
    '.sn-exportitem:hover{background:rgba(120,100,70,.12);}',
    '.sn-card[data-dragging="1"]{opacity:.6;outline:1.5px dashed rgba(190,128,35,.92);outline-offset:3px;}',
    '.sn-card[data-drop="1"]{box-shadow:0 0 0 2px rgba(190,128,35,.92),0 0 22px rgba(190,128,35,.28);}',
    /* 大纲视图 */
    '.sn-outline{position:absolute;inset:0;z-index:6;overflow:auto;padding:18px 18px 42px;',
    'background:var(--sn-paper,#f4efe3);}',
    '.sn-olinner{max-width:780px;margin:0 auto;}',
    '.sn-olrow{display:flex;align-items:center;gap:7px;min-height:28px;font-size:calc(14px * var(--sn-fs,1));border-radius:6px;cursor:pointer;',
    'color:var(--sn-ink,#2f2a24);font:inherit;font-size:13.5px;padding:2px 8px;}',
    '.sn-olrow:hover{background:rgba(120,100,70,.1);}',
    '.sn-olrow[data-on="1"]{background:rgba(190,128,35,.16);}',
    '.sn-olcaret{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;',
    'border-radius:4px;color:var(--sn-ink-2,#6b5f4e);opacity:.66;}',
    '.sn-olcaret:before{content:"";width:0;height:0;border-left:5px solid currentColor;',
    'border-top:4px solid transparent;border-bottom:4px solid transparent;transform:rotate(90deg);}',
    '.sn-olcaret[data-folded="1"]:before{transform:none;}',
    '.sn-olcaret:hover{background:rgba(120,100,70,.16);opacity:1;}',
    '.sn-olcaret[data-empty="1"]{visibility:hidden;}',
    '.sn-oltitle{flex:none;max-width:62%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.sn-olrow[data-lv="0"] .sn-oltitle{font-weight:700;font-size:calc(15px * var(--sn-fs,1));}',
    '.sn-olspacer{flex:1;min-width:8px;}',
    '.sn-olen{font-size:12px;opacity:.66;font-style:italic;flex:none;}',
    '.sn-oldot{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.22;}',
    '.sn-oldot[data-m="1"]{background:#c98a2e;opacity:.9;}',
    '.sn-oldot[data-m="2"]{background:#2f8f7d;opacity:.9;}',
    /* 复习浮窗 */
    '.sn-review{position:absolute;inset:0;z-index:12;display:flex;align-items:center;justify-content:center;',
    'padding:24px;background:rgba(30,24,18,.42);}',
    '.sn-rvcard{width:100%;max-width:620px;max-height:100%;overflow:auto;border-radius:14px;padding:20px 22px 16px;',
    'color:var(--sn-ink,#2f2a24);',
    'background:var(--sn-surface,#fffaf0);border:1px solid var(--sn-line,rgba(120,100,70,.24));',
    'box-shadow:var(--sn-shadow-panel,0 18px 48px rgba(60,45,28,.3));}',
    '.sn-rvhead{display:flex;align-items:baseline;gap:10px;font-size:12px;color:var(--sn-ink-3,#8c8071);',
    '.sn-rvscope{margin-left:2px;padding:1px 7px;border-radius:999px;font-size:11.5px;',
    'background:var(--sn-paper-2,#f6f1e6);border:1px solid var(--sn-line-2,rgba(120,100,70,.16));color:var(--sn-ink-2,#5c5142);}',
    'cursor:move;user-select:none;touch-action:none;}',
    '.sn-rvtitle{margin:8px 0 4px;font-size:calc(22px * var(--sn-fs,1));font-weight:700;letter-spacing:.02em;}',
    '.sn-rven{font-size:12.5px;font-style:italic;opacity:.6;margin-bottom:10px;}',
    '.sn-rvbody{border-top:1px solid var(--sn-line-2,rgba(120,100,70,.16));padding-top:10px;',
    'font-size:calc(13.5px * var(--sn-fs,1));line-height:1.62;}',
    '.sn-rvacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;}',
    '.sn-rvbtn{appearance:none;font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer;',
    'border:1px solid var(--sn-line,rgba(120,100,70,.24));background:transparent;color:var(--sn-ink,#2f2a24);}',
    '.sn-rvbtn:hover{background:rgba(120,100,70,.1);}',
    '.sn-rvbtn[data-main="1"]{border-color:transparent;background:var(--sn-accent,#9a6b3f);color:#fffaf0;}',
    '.sn-searchwrap{position:absolute;inset:0;z-index:30;display:flex;justify-content:center;align-items:flex-start;',
    'padding:56px 16px 16px;background:rgba(30,24,18,.22);}',
    '.sn-search{width:100%;max-width:560px;border-radius:12px;overflow:hidden;',
    'border:1px solid rgba(120,100,70,.3);background:var(--sn-surface);box-shadow:0 12px 40px rgba(60,45,28,.28);}',
    '.sn-search input{display:block;width:100%;border:0;outline:0;background:transparent;color:inherit;',
    'font:inherit;font-size:15px;padding:13px 15px;}',
    '.sn-search-list{max-height:44vh;overflow:auto;border-top:1px solid var(--sn-line-2);}',
    '.sn-search-row{display:flex;flex-direction:column;gap:1px;padding:8px 15px;cursor:pointer;}',
    '.sn-search-row[data-on="1"]{background:rgba(154,107,63,.14);}',
    '.sn-search-t{font-size:13.5px;line-height:1.35;}',
    '.sn-search-p{font-size:12px;opacity:.58;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sn-search-empty{padding:13px 15px;font-size:12.5px;opacity:.55;}',
    /* 编辑 */
    '.sn-title-input{flex:1;min-width:0;font:inherit;font-size:21px;font-weight:700;line-height:1.25;padding:1px 6px;',
    'border-radius:5px;border:1px solid rgba(154,107,63,.5);background:rgba(255,255,255,.35);color:inherit;outline:none;}',
    '.sn-dialog{width:100%;max-width:420px;border-radius:12px;padding:18px 20px 16px;',
    'border:1px solid rgba(120,100,70,.3);background:var(--sn-surface);box-shadow:0 12px 40px rgba(60,45,28,.28);}',
    '.sn-dialog h4{margin:0 0 6px;font-size:15px;font-weight:700;}',
    '.sn-dialog p{margin:0 0 14px;font-size:12.5px;line-height:1.7;opacity:.72;}',
    '.sn-dlg-acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;clear:both;padding-top:14px;}',
    '.sn-dbtn{font:inherit;font-size:12.5px;padding:6px 11px;border-radius:7px;cursor:pointer;',
    'border:1px solid rgba(120,100,70,.3);background:transparent;color:inherit;}',
    '.sn-dbtn[data-danger="1"]{border-color:rgba(186,64,104,.55);color:#b03a5b;}',
    '.sn-dbtn[data-primary="1"]{border-color:transparent;background:var(--sn-accent);color:#fffaf0;}',
    /* 设置弹窗：一行一个选项 */
    '.sn-setdlg{max-width:440px;}',
    '.sn-setrow{float:left;clear:both;margin:14px 10px 0 0;}',
    '.sn-setlabel{display:inline-block;font-size:12px;opacity:.6;vertical-align:middle;}',
    '.sn-setopts{float:left;display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;margin:14px 0 0;vertical-align:middle;}',
    '.sn-sethint{font-size:11.5px;opacity:.55;}',
    '.sn-setrange{width:132px;accent-color:var(--sn-accent);}',
    '.sn-impdlg{max-width:520px;}',
    '.sn-implabel{margin:12px 0 4px!important;font-size:12px!important;font-weight:700;opacity:.8!important;}',
    '.sn-impcode{margin:0;padding:9px 11px;border-radius:8px;font-family:ui-monospace,Menlo,Consolas,monospace;',
    'font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;',
    'background:rgba(120,100,70,.1);border:1px solid var(--sn-line-2);}',
    '.sn-impdir{user-select:all;}',
    /* dark */
    /* 悬停效果只在真有指针的设备上生效（触屏上 :hover 会「粘住」） */
    '@media (hover: hover){',
      '.sn-crumb:hover{background:rgba(120,100,70,.1);color:var(--sn-ink);}',
      '.sn-iconbtn:hover{background:rgba(120,100,70,.12);color:var(--sn-ink);}',
      '.sn-card:hover{border-color:rgba(86,68,45,.42);box-shadow:0 3px 12px rgba(70,55,35,.18);}',
      '.sn-chip:hover{border-color:rgba(120,88,52,.55);}',
      '.sn-pathstep:hover{background:rgba(154,107,63,.08);}',
      '.sn-root[data-theme="dark"] .sn-pathstep:hover{background:rgba(232,193,132,.1);}',
      '.sn-searchbtn:hover{background:rgba(120,100,70,.1);color:var(--sn-ink);}',
      '.sn-dbtn:hover{background:rgba(120,100,70,.12);}',
      '.sn-dbtn[data-danger="1"]:hover{background:rgba(186,64,104,.14);}',
    '}',

    /* 键盘焦点必须看得见（鼠标点击不触发，避免满屏描边） */
    '.sn-root :focus-visible{outline:2px solid var(--sn-accent);outline-offset:2px;}',
    '.sn-root .sn-card:focus-visible{outline-offset:3px;}',

    /* 系统开了「减弱动态效果」就关掉推镜与过渡 */
    '@media (prefers-reduced-motion: reduce){',
    '.sn-root *{transition:none!important;animation:none!important;}',
    '}',
    '.sn-root[data-theme="dark"]{background:var(--sn-paper,#1c1a17);color:var(--sn-ink,#e8e1d4);}',
    '.sn-root[data-theme="dark"] .sn-topbar{background:rgba(28,26,23,.92);border-color:rgba(200,180,150,.16);}',
    '.sn-root[data-theme="dark"] .sn-card{background:#2a2621;color:#efe7d8;border-color:rgba(210,190,160,.22);box-shadow:0 2px 8px rgba(0,0,0,.35);}',
    '.sn-root[data-theme="dark"] .sn-card[data-focus="1"]{background:#332d26;border-color:rgba(210,175,120,.5);}',
    '.sn-root[data-theme="dark"] .sn-card[data-dot="1"]{background:#6d6152;}',
    '.sn-root[data-theme="dark"] .sn-sidebar{background:#201d19;border-color:rgba(200,180,150,.16);}',
    '.sn-root[data-theme="dark"] .sn-chip{background:#2a2621;color:#ddd3c2;border-color:rgba(210,190,160,.24);}',
    '.sn-root[data-theme="dark"] .sn-edgebar{background:rgba(38,34,29,.97);border-color:rgba(210,190,160,.28);}',
    '.sn-root[data-theme="dark"] .sn-edgebar-title{color:#e8e1d4;}',
    '.sn-root[data-theme="dark"] .sn-note{background:rgba(42,38,33,.8);border-color:rgba(210,190,160,.3);}',
    '.sn-root[data-theme="dark"] .sn-field-input{background:#241f1a;border-color:rgba(210,190,160,.34);color:#e8e1d4;}',
    '.sn-root[data-theme="dark"] .sn-field-preview{background:rgba(210,190,160,.08);}',
    '.sn-root[data-theme="dark"] .sn-field-emptytext{color:rgba(232,225,212,.44);}',
    '.sn-root[data-theme="dark"] .sn-mini{background:rgba(32,29,25,.9);border-color:rgba(200,180,150,.22);}',
    '.sn-root[data-theme="dark"] .sn-hint{background:rgba(32,29,25,.8);}',
    '.sn-root[data-theme="dark"] .sn-live{background:rgba(32,29,25,.95);border-color:rgba(200,180,150,.24);}',
    '.sn-root[data-theme="dark"] .sn-search{background:#252119;border-color:rgba(200,180,150,.24);}',
    '.sn-root[data-theme="dark"] .sn-search-list{border-color:rgba(200,180,150,.18);}',
    '.sn-root[data-theme="dark"] .sn-search-row[data-on="1"]{background:rgba(201,155,98,.2);}',
    '.sn-root[data-theme="dark"] .sn-dialog{background:#252119;border-color:rgba(200,180,150,.24);}',
    '.sn-root[data-theme="dark"] .sn-title-input{background:rgba(255,255,255,.06);border-color:rgba(201,155,98,.55);}',
    /* 学习路径：夜里也要一眼看见（金边 + 外发光），无关的卡片和线退到很暗 */
    '.sn-root[data-theme="dark"] .sn-card[data-path="1"],.sn-root[data-theme="dark"] .sn-card[data-path="1"]{border-color:rgba(240,200,130,.95);background:#3a3128;color:#fdf6e8;box-shadow:0 0 0 2px rgba(240,200,130,.9),0 0 26px rgba(240,200,130,.34);}',
    '.sn-root[data-theme="dark"] .sn-card[data-dim="1"],.sn-root[data-theme="dark"] .sn-card[data-dim="1"]{opacity:.3;}',
    /* 顶栏这排在「日光纸」下必须用纸上的墨色：宿主的 label token 是给深色底用的，套在米黄底上根本看不清 */
    '.sn-root[data-theme="light"] .sn-topbar{color:#2f2a24;}',
    '.sn-root[data-theme="light"] .sn-topbar .sn-crumb{color:#6b5f4e;}',
    '.sn-root[data-theme="light"] .sn-topbar .sn-crumb[data-on="1"]{color:#241f1a;}',
    '.sn-root[data-theme="light"] .sn-topbar .sn-status{color:#7d7060;}',
    '.sn-root[data-theme="light"] .sn-topbar .sn-iconbtn{color:#5c4d3c;}',
    '.sn-root[data-theme="light"] .sn-topbar .sn-searchbtn{color:#3f352a;border-color:rgba(120,100,70,.34);}',
    '.sn-root[data-theme="light"] .sn-topbar .sn-libsel{color:#2f2a24;background:#fffdf6;border-color:rgba(120,100,70,.34);}',
    /* 复习卡是纸，不跟宿主的 token 走：深色宿主里 --sn-ink 是浅色的，落在米黄卡上就看不见字了 */
    '.sn-root[data-theme="light"] .sn-rvcard{background:#fffaf0;color:#2f2a24;border-color:rgba(86,68,45,.24);}',
    '.sn-root[data-theme="light"] .sn-rvhead{color:#8c8071;}',
    '.sn-root[data-theme="light"] .sn-hint{color:#6f6455;}',
    '.sn-root[data-theme="light"] .sn-legend{color:#5c5142;}',
    '.sn-root[data-theme="light"] .sn-label{color:#6f6455;}',
    '.sn-root[data-theme="dark"] .sn-hint{color:#c0b09a;}',
    '.sn-root[data-theme="dark"] .sn-legend{color:#cec0a9;}',
    '.sn-root[data-theme="dark"] .sn-label{color:#b3a48e;}',
    /* 窄屏：先让侧栏收窄、提示条让位，顶栏允许横向滚动，别把按钮裁掉 */
    '@media (max-width:1100px){.sn-sidebar{width:320px;} .sn-searchbtn{padding:0 7px;}}',
    '@media (max-width:960px){.sn-sidebar{width:272px;} .sn-hint{display:none;}',
    '.sn-topbar{overflow-x:auto;scrollbar-width:none;} .sn-topbar::-webkit-scrollbar{display:none;}}',
    '.sn-root[data-theme="dark"] .sn-rvcard{background:#241f1a;color:#efe7d8;border-color:rgba(210,190,160,.24);}',
    '.sn-root[data-theme="dark"] .sn-rvhead{color:#a1917b;}',
    '.sn-root[data-theme="dark"] .sn-topbar .sn-crumb{color:#c3b59e;}',
    '.sn-root[data-theme="dark"] .sn-topbar .sn-crumb[data-on="1"]{color:#f3ece0;}',
    '.sn-root[data-theme="dark"] .sn-topbar .sn-searchbtn{color:#ded3c1;border-color:rgba(210,190,160,.28);}',
    '.sn-root[data-theme="dark"] .sn-topbar .sn-libsel{color:#efe7d8;background:#241f1a;border-color:rgba(210,190,160,.28);}',
  ].join('')

  /* ---------------------------------------------------------------- */
  /* small pieces                                                      */
  /* ---------------------------------------------------------------- */

  function Field(props) {
    var editing = !!props.editing
    var taRef = useRef(null)
    /* 编辑框跟着内容长高，长文不用在小框里滚 */
    useEffect(function () {
      if (!editing) return
      var ta = taRef.current
      if (!ta) return
      ta.style.height = 'auto'
      ta.style.height = Math.max(66, ta.scrollHeight) + 'px'
    }, [editing, props.draft])

    if (!props.text && !editing && !props.editable) return null
    var html = !editing && props.render && props.text ? props.render(props.text, !!props.mono) : null
    var cls = props.mono ? 'sn-math' : 'sn-text'
    var body
    if (editing) {
      var preview = null
      if (props.mono && props.render) {
        var ph = props.render(props.draft, true)
        preview = h(
          'div',
          { className: 'sn-field-preview' },
          h('span', { className: 'sn-muted' }, '预览 '),
          ph
            ? h('span', { className: 'sn-math', dangerouslySetInnerHTML: { __html: ph } })
            : h('span', { className: 'sn-muted' }, '（还没写）'),
        )
      }
      body = h(
        'div',
        { className: 'sn-field-edit' },
        h('textarea', {
          ref: taRef,
          className: 'sn-field-input' + (props.mono ? ' sn-field-input-mono' : ''),
          value: props.draft,
          placeholder: '点这里写…',
          spellCheck: false,
          autoFocus: true,
          onChange: function (event) {
            props.onDraft(event.target.value)
          },
          onKeyDown: function (event) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              props.onCancel()
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              event.stopPropagation()
              props.onCommit()
            }
          },
          onBlur: function () {
            props.onCommit()
          },
        }),
        preview,
      )
    } else if (html) {
      body = h('div', { className: cls, dangerouslySetInnerHTML: { __html: html } })
    } else {
      body = h('div', { className: cls + (props.text ? '' : ' sn-field-emptytext') }, props.text || '点这里写…')
    }
    return h(
      'div',
      {
        className: 'sn-field',
        onDoubleClick: props.editable && !editing
          ? function (event) {
              event.stopPropagation()
              props.onStart()
            }
          : undefined,
        title: props.editable && !editing ? '双击编辑' : undefined,
      },
      h('div', { className: 'sn-label' }, props.label),
      body,
    )
  }

  function pathBetween(a, b) {
    var dx = b.x - a.x
    var dy = b.y - a.y
    var len = Math.sqrt(dx * dx + dy * dy) || 1
    var nx = -dy / len
    var ny = dx / len
    var bow = len * 0.09
    var mx = (a.x + b.x) / 2 + nx * bow
    var my = (a.y + b.y) / 2 + ny * bow
    return 'M ' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1)
  }

  function relBlock(list, label, prefix) {
    if (!list.length) return null
    return h(
      'div',
      { className: 'sn-field' },
      h('div', { className: 'sn-label' }, label),
      h(
        'div',
        { className: 'sn-rel' },
        list.map(function (item) {
          var kind = item.edge.type === 'prereq' ? '需先学 ' : item.edge.type === 'contrast' ? '对比 ' : '参见 '
          return h(
            'span',
            { key: item.edge.from + '-' + item.edge.to + '-' + item.dir, className: 'sn-chip', 'data-t': item.edge.type || 'related' },
            (prefix || '') + kind + item.other.title,
          )
        }),
      ),
    )
  }

  /* ---------------------------------------------------------------- */
  /* MindMap                                                           */
  /* ---------------------------------------------------------------- */

  /* 纸的几套调色板。日光纸可选米黄 / 灰白 / 淡绿，夜光纸一套；
     「深一点 / 浅一点」只动四个底色的亮度，不动墨色。 */
  var PAPERS = {
    cream: {
      paper: '#f4efe3', paper2: '#fbf7ec', surface: '#fffdf6', focus: '#fffaf0',
      ink: '#2f2a24', ink2: '#4a4034', ink3: '#8c8071',
      line: 'rgba(86,68,45,.24)', line2: 'rgba(120,100,70,.16)', dot: '#bfad90',
    },
    grey: {
      paper: '#eceef0', paper2: '#f6f7f8', surface: '#ffffff', focus: '#fbfcfd',
      ink: '#22262a', ink2: '#424b53', ink3: '#7c848c',
      line: 'rgba(60,70,80,.22)', line2: 'rgba(60,70,80,.12)', dot: '#b6bec5',
    },
    green: {
      paper: '#e9efe3', paper2: '#f4f8ee', surface: '#fdfefa', focus: '#f9fcf4',
      ink: '#28312a', ink2: '#47543f', ink3: '#7d8a75',
      line: 'rgba(66,88,56,.22)', line2: 'rgba(66,88,56,.12)', dot: '#b4c3a8',
    },
    night: {
      paper: '#1c1a17', paper2: '#211e1a', surface: '#241f1a', focus: '#2a241d',
      ink: '#efe7d8', ink2: '#d6c9b4', ink3: '#a1917b',
      line: 'rgba(210,190,160,.22)', line2: 'rgba(210,190,160,.14)', dot: 'rgba(214,210,202,.075)',
    },
  }

  var FONT_STACKS = {
    kai: "'KaiTi','STKaiti','Kaiti SC','Songti SC',serif",
    song: "'Songti SC','SimSun','STSong','Noto Serif SC',serif",
    hei: "'Microsoft YaHei','PingFang SC','Noto Sans SC',sans-serif",
  }

  var FONT_SCALES = { s: 0.94, m: 1, l: 1.12 }

  var APPEARANCE_DEFAULT = { paper: 'cream', font: 'kai', size: 'm', tone: 0 }
  var APPEARANCE_KEY = 'synapsis.appearance'

  function readAppearance() {
    try {
      var raw = window.localStorage.getItem(APPEARANCE_KEY)
      if (!raw) return APPEARANCE_DEFAULT
      var parsed = JSON.parse(raw)
      return {
        paper: PAPERS[parsed.paper] ? parsed.paper : APPEARANCE_DEFAULT.paper,
        font: FONT_STACKS[parsed.font] ? parsed.font : APPEARANCE_DEFAULT.font,
        size: FONT_SCALES[parsed.size] ? parsed.size : APPEARANCE_DEFAULT.size,
        tone: typeof parsed.tone === 'number' ? Math.max(-2, Math.min(2, parsed.tone)) : 0,
      }
    } catch (e) {
      return APPEARANCE_DEFAULT
    }
  }

  /* 把 #rrggbb 提亮 / 压暗一点：tone 一档约 7/255 */
  function shiftHex(hex, delta) {
    if (!delta) return hex
    var m = /^#([0-9a-f]{6})$/i.exec(hex)
    if (!m) return hex
    var n = parseInt(m[1], 16)
    var clamp = function (v) {
      return Math.max(0, Math.min(255, Math.round(v)))
    }
    var r = clamp(((n >> 16) & 255) + delta)
    var g = clamp(((n >> 8) & 255) + delta)
    var b = clamp((n & 255) + delta)
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
  }

  function appearanceVars(theme, appear) {
    var pal = theme === 'dark' ? PAPERS.night : PAPERS[appear.paper] || PAPERS.cream
    var d = appear.tone * 7
    return {
      '--sn-paper': shiftHex(pal.paper, d),
      '--sn-paper-2': shiftHex(pal.paper2, d),
      '--sn-surface': shiftHex(pal.surface, d),
      '--sn-surface-focus': shiftHex(pal.focus, d),
      '--sn-ink': pal.ink,
      '--sn-ink-2': pal.ink2,
      '--sn-ink-3': pal.ink3,
      '--sn-line': pal.line,
      '--sn-line-2': pal.line2,
      '--sn-dot': pal.dot,
      '--sn-font': FONT_STACKS[appear.font],
      '--sn-fs': String(FONT_SCALES[appear.size]),
    }
  }

  function MindMap(props) {
    var data = props.data
    var editable = typeof props.onChange === 'function'

    var statusState = useState('ready')
    var focusState = useState('')
    var selectedState = useState('')
    var collapsedState = useState(false)
    var status = statusState[0]
    var setStatus = statusState[1]
    var focusId = focusState[0]
    var setFocusId = focusState[1]
    var selectedId = selectedState[0]
    var setSelectedId = selectedState[1]
    var collapsed = collapsedState[0]
    var setCollapsed = collapsedState[1]

    var searchState = useState(false)
    var searchQueryState = useState('')
    var searchCursorState = useState(0)
    var searchOpen = searchState[0]
    var setSearchOpen = searchState[1]
    var searchQuery = searchQueryState[0]
    var setSearchQuery = searchQueryState[1]
    var searchCursor = searchCursorState[0]
    var setSearchCursor = searchCursorState[1]
    var searchInputRef = useRef(null)

    var editState = useState(null)
    var editing = editState[0]
    var setEditing = editState[1]
    var delState = useState(null)
    var pendingDelete = delState[0]
    var setPendingDelete = delState[1]

    /* 概念卡正文的哪一栏正在编辑（{key, draft}；key 是 d/f/i/e/p） */
    var fieldEditState = useState(null)
    var fieldEdit = fieldEditState[0]
    var setFieldEdit = fieldEditState[1]

    /* Shift 拖拽连边：linking 只用来切提示文案，橡皮筋线走命令式更新 */
    var linkState = useState(null)
    var linking = linkState[0]
    var setLinking = linkState[1]
    var linkFromRef = useRef('')
    var linkPathRef = useRef(null)
    var linkOverlayRef = useRef(null)
    var historyRef = useRef([])
    var lastLabelRef = useRef('')

    /* 选中的关系边（只有跨分支的关系边可选可编辑；从属线由树表达，不参与） */
    var edgeSelState = useState(null)
    var edgeSel = edgeSelState[0]
    var setEdgeSel = edgeSelState[1]

    /* 导出菜单开关 */
    var exportState = useState(false)
    var exportOpen = exportState[0]
    var setExportOpen = exportState[1]

    /* 纸 / 字体 / 字号 / 深浅：存在 localStorage，插件重启还在 */
    var appearState = useState(readAppearance)
    var appear = appearState[0]
    var setAppear = appearState[1]
    useEffect(function () {
      try {
        window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appear))
      } catch (e) {
        /* 隐私模式下写不进去就算了，不该因此崩掉 */
      }
    }, [appear])

    var settingsState = useState(false)
    var settingsOpen = settingsState[0]
    var setSettingsOpen = settingsState[1]

    var importState = useState(false)
    var importOpen = importState[0]
    var setImportOpen = importState[1]

    var copiedState = useState('')
    var copied = copiedState[0]
    var setCopied = copiedState[1]

    /* 拖拽改父：正在搬的节点 + 悬停的目标 */
    var moveState = useState(null)
    var moving = moveState[0]
    var setMoving = moveState[1]

    /* 视图模式：'map' 画布 / 'outline' 大纲；复习是一层浮窗，与模式无关 */
    var viewState = useState('map')
    var viewMode = viewState[0]
    var setViewMode = viewState[1]

    /* 大纲里收起来的节点（只有 id，不进文件） */
    var foldState = useState(function () {
      return {}
    })
    var folds = foldState[0]
    var setFolds = foldState[1]

    /* 复习：队列 + 当前下标 + 是否已翻面 */
    var reviewState = useState(null)
    var review = reviewState[0]
    var setReview = reviewState[1]

    /* 复习卡可以被拖走，别挡住底下的图 */
    var rvPosState = useState({ x: 0, y: 0 })
    var rvPos = rvPosState[0]
    var setRvPos = rvPosState[1]
    var rvDragRef = useRef(null)

    var canvasRef = useRef(null)
    var sceneRef = useRef(null)
    var miniRectRef = useRef(null)
    var camRef = useRef({ x: 0, y: 0, k: 1 })
    var rafRef = useRef(0)
    var initDoneRef = useRef(false)
    var focusIdRef = useRef('')
    var pendingFitRef = useRef(null)
    var settleRef = useRef(0)
    var lodState = useState(0)
    var lodK = lodState[0]
    var setLodK = lodState[1]
    var renderMath = props.renderMath || null

    /* 学习路径面板：null = 关闭；{kind:'to'|'between', toId, fromId} */
    var pathStatePair = useState(null)
    var pathState = pathStatePair[0]
    var setPathState = pathStatePair[1]

    var layout = useMemo(function () {
      /* 看学习路径时铺开整张图，这样链上的概念都在场，才可能被高亮出来 */
      return data && data.nodes ? buildLayout(data.nodes, pathState ? null : focusId || null) : null
    }, [data, focusId, pathState])

    var nodesById = useMemo(function () {
      var map = new Map()
      if (data && data.nodes) for (var i = 0; i < data.nodes.length; i++) map.set(data.nodes[i].id, data.nodes[i])
      return map
    }, [data])

    focusIdRef.current = focusId

    /* 搜索索引：标题、英文名、摘要、五个正文块一起进 haystack，路径用于结果里的上下文 */
    var searchIndex = useMemo(function () {
      var out = []
      if (!data || !data.nodes) return out
      for (var i = 0; i < data.nodes.length; i++) {
        var node = data.nodes[i]
        var path = []
        var cur = node
        var guard = 0
        while (cur && guard++ < 16) {
          path.unshift(String(cur.title || ''))
          cur = cur.parent ? nodesById.get(cur.parent) : null
        }
        out.push({
          node: node,
          title: String(node.title || ''),
          path: path.join(' › '),
          hay: [
            node.title,
            node.en,
            node.summary,
            node.definition,
            node.formal,
            node.intuition,
            node.examples,
            node.pitfalls,
            node.note,
          ]
            .join(' ')
            .toLowerCase(),
        })
      }
      return out
    }, [data, nodesById])

    var results = useMemo(function () {
      var q = String(searchQuery || '').trim().toLowerCase()
      if (!q) return []
      var scored = []
      for (var i = 0; i < searchIndex.length; i++) {
        var item = searchIndex[i]
        var title = item.title.toLowerCase()
        var score = 0
        if (title === q) score = 120
        else if (title.indexOf(q) === 0) score = 100
        else if (title.indexOf(q) >= 0) score = 70
        else if (item.hay.indexOf(q) >= 0) score = 30
        if (score) scored.push({ item: item, score: score, at: i })
      }
      scored.sort(function (a, b) {
        return b.score - a.score || a.at - b.at
      })
      var out = []
      for (var j = 0; j < Math.min(scored.length, 12); j++) out.push(scored[j].item)
      return out
    }, [searchQuery, searchIndex])

    var openSearch = useCallback(function () {
      setSearchQuery('')
      setSearchCursor(0)
      setSearchOpen(true)
    }, [])

    /* ---- 大纲视图 ---- */
    var toggleFold = useCallback(function (id) {
      setFolds(function (prev) {
        /* 无原型对象：id 叫 constructor / toString 时才不会被当成「已折叠」 */
        var next = Object.assign(Object.create(null), prev)
        if (next[id]) delete next[id]
        else next[id] = 1
        return next
      })
    }, [])

    /* 大纲永远从整份图的根开始排（跟画布焦点无关），这样长图里才找得到东西 */
    var outlineRows = useMemo(
      function () {
        if (!data || !data.nodes) return []
        /* 用 Object.create(null)：父节点 id 万一是 constructor / toString 这类
           原型上的名字，普通对象会取到继承来的函数，随后 .push 就炸了 */
        var kids = Object.create(null)
        var rootId = ''
        for (var i = 0; i < data.nodes.length; i++) {
          var n = data.nodes[i]
          if (!n || !n.id) continue
          if (!n.parent) {
            if (!rootId) rootId = n.id
            continue
          }
          ;(kids[n.parent] || (kids[n.parent] = [])).push(n)
        }
        if (!rootId && data.nodes.length) rootId = data.nodes[0].id
        var rows = []
        var seen = Object.create(null)
        var walk = function (node, level) {
          if (!node || seen[node.id]) return
          seen[node.id] = 1
          var list = kids[node.id] || []
          rows.push({
            id: node.id,
            title: node.title,
            en: node.en || '',
            level: level,
            kids: list.length,
            mastery: node.mastery || 0,
            folded: !!folds[node.id],
          })
          if (folds[node.id]) return
          for (var j = 0; j < list.length; j++) walk(list[j], level + 1)
        }
        walk(nodesById.get(rootId), 0)
        return rows
      },
      [data, folds, nodesById],
    )

    /* ---- 复习：先收「模糊」的，再收「复习过还是没印象」的，然后「没学过」的，最后已掌握 ---- */
    var startReview = useCallback(
      function (scopeId) {
        var scope = null
        if (scopeId) {
          scope = new Set([scopeId])
          var kids = collectDescendants(scopeId)
          for (var k = 0; k < kids.length; k++) scope.add(kids[k])
        }
        var pool = sortReviewPool(data && data.nodes ? data.nodes : [], scope)
        /* 一张可复习的都没有时也要把卡弹出来，告诉用户为什么是空的 */
        setReview({
          queue: pool.slice(0, 15).map(function (n) {
            return n.id
          }),
          graded: {},
          scopeId: scopeId || null,
          i: 0,
          shown: false,
        })
        setRvPos({ x: 0, y: 0 })
      },
      [data],
    )

    var gradeReview = useCallback(
      function (level) {
        if (!review) return
        var id = review.queue[review.i]
        if (id) {
          /* lastReviewed 让「没学过」和「复习后没印象」区分开（都是 mastery 0） */
          updateNode(id, { mastery: level, lastReviewed: new Date().toISOString() }, 'mastery:' + id)
        }
        var graded = Object.assign({}, review.graded)
        if (id) graded[id] = level
        setReview({ queue: review.queue, graded: graded, scopeId: review.scopeId, i: review.i + 1, shown: false })
      },
      [review, updateNode],
    )

    /* 这一轮里「没印象 / 有点模糊」的，原样再来一遍（顺序按刚才评的先后） */
    var reviewAgainWeak = useCallback(
      function () {
        if (!review) return
        var weak = review.queue.filter(function (id) {
          return review.graded[id] === 0 || review.graded[id] === 1
        })
        if (!weak.length) return
        setReview({ queue: weak, graded: {}, scopeId: review.scopeId, i: 0, shown: false })
        setRvPos({ x: 0, y: 0 })
      },
      [review],
    )

    var closeReview = useCallback(function () {
      setReview(null)
    }, [])

    /* 拖复习卡：按住顶部那行挪，松手停在原地（位置只在这次会话里） */
    useEffect(
      function () {
        var move = function (event) {
          var start = rvDragRef.current
          if (!start) return
          setRvPos({ x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y })
        }
        var up = function () {
          rvDragRef.current = null
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        return function () {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
      },
      [],
    )

    var startReviewDrag = function (event) {
      if (event.target && event.target.closest && event.target.closest('[data-rvclose]')) return
      rvDragRef.current = { x: event.clientX, y: event.clientY, ox: rvPos.x, oy: rvPos.y }
      if (event.cancelable) event.preventDefault()
    }

    /* 键盘回调里用到的动作都经这个 ref 取：effect 只绑一次，永远拿到最新实现 */
    var actionsRef = useRef(null)

    /* 相机只改 transform：layout 走 ref，这样标识稳定，手势监听不会因为数据变化被反复重绑 */
    var layoutRef = useRef(null)
    layoutRef.current = layout

    var applyCamera = useCallback(function () {
      var cam = camRef.current
      if (sceneRef.current) {
        sceneRef.current.style.transform =
          'translate(' + cam.x.toFixed(2) + 'px,' + cam.y.toFixed(2) + 'px) scale(' + cam.k.toFixed(4) + ')'
        sceneRef.current.setAttribute('data-moving', '1')
      }
      if (settleRef.current) clearTimeout(settleRef.current)
      settleRef.current = setTimeout(function () {
        if (sceneRef.current) sceneRef.current.removeAttribute('data-moving')
        setLodK(camRef.current.k)
      }, 160)
      var el = canvasRef.current
      var rect = miniRectRef.current
      var lay = layoutRef.current
      if (el && rect && lay) {
        var b = lay.bounds
        var vw = el.clientWidth || 1
        var vh = el.clientHeight || 1
        var left = (0 - cam.x) / cam.k
        var top = (0 - cam.y) / cam.k
        var scale = Math.min(168 / b.w, 116 / b.h)
        var ox = (168 - b.w * scale) / 2
        var oy = (116 - b.h * scale) / 2
        rect.setAttribute('x', String(ox + (left - b.x) * scale))
        rect.setAttribute('y', String(oy + (top - b.y) * scale))
        rect.setAttribute('width', String(Math.max(4, (vw / cam.k) * scale)))
        rect.setAttribute('height', String(Math.max(4, (vh / cam.k) * scale)))
      }
    }, [])

    var animateTo = useCallback(function (target) {
      var el = canvasRef.current
      if (!el) return
      var vw = el.clientWidth || 1
      var vh = el.clientHeight || 1
      var from = camRef.current
      var fromCx = (vw / 2 - from.x) / from.k
      var fromCy = (vh / 2 - from.y) / from.k
      var t0 = performance.now()
      var dur = 420
      cancelAnimationFrame(rafRef.current)
      var step = function (now) {
        var p = Math.min(1, (now - t0) / dur)
        var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
        var cx = fromCx + (target.cx - fromCx) * e
        var cy = fromCy + (target.cy - fromCy) * e
        var k = from.k * Math.pow(target.k / from.k, e)
        camRef.current = { x: vw / 2 - cx * k, y: vh / 2 - cy * k, k: k }
        applyCamera()
        if (p < 1) rafRef.current = requestAnimationFrame(step)
      }
      rafRef.current = requestAnimationFrame(step)
    }, [applyCamera])

    /* 搜索跳转时，要把「跳过去的那个概念」摆在正中，而不只是把它的子树塞进视野 */
    var pendingCenterRef = useRef('')

    var focusOn = useCallback(function (id, animate, wide) {
      var el = canvasRef.current
      if (!el) return
      var next = id || ''
      if (next === focusIdRef.current) {
        if (!layout) return
        var centerId = pendingCenterRef.current
        pendingCenterRef.current = null
        pendingFitRef.current = null
        var t = fitFor(layout, next || layout.root.id, el.clientWidth || 1, el.clientHeight || 1)
        camRef.current = {
          x: (el.clientWidth || 1) / 2 - t.cx * t.k,
          y: (el.clientHeight || 1) / 2 - t.cy * t.k,
          k: t.k,
        }
        applyCamera()
        /* 已经是当前焦点了，但调用方还想把某个概念摆正中（搜索跳回同一层）：直接做，别留 pending */
        if (centerId) centerOn(centerId, animate !== false)
        return
      }
      pendingFitRef.current = { animate: animate !== false, wide: wide === true }
      setFocusId(next)
    }, [applyCamera, layout])

    /* 跳到某个概念：选中它；有子节点就以它为主根，没有就停在它的父层，免得跳过去只剩一张孤卡 */
    var goTo = useCallback(
      function (id) {
        setSearchOpen(false)
        setSearchQuery('')
        setEdgeSel(null)
        if (!id) return
        setSelectedId(id)
        var target = layout ? layout.byId.get(id) : null
        var kids = target && target.children ? target.children.length : 0
        if (kids > 0) {
          pendingCenterRef.current = id
          focusOn(id, true)
          return
        }
        var parentId = (target && target.parent) || (layout ? layout.root.id : '')
        pendingCenterRef.current = id
        focusOn(parentId, true)
      },
      [focusOn, layout],
    )

    /* 把某个概念摆到屏幕正中（关掉学习路径、回到聚焦视图时用） */
    var centerOn = useCallback(
      function (id, animate) {
        var el = canvasRef.current
        if (!el || !layout) return
        var node = layout.byId.get(id || layout.root.id) || layout.root
        var vw = el.clientWidth || 1
        var vh = el.clientHeight || 1
        var fit = fitFor(layout, node.id, vw, vh, false)
        var k = Math.max(0.16, Math.min(fit.k, 3))
        var target = { cx: node.x, cy: node.y, k: k }
        if (animate === false) {
          camRef.current = { x: vw / 2 - target.cx * target.k, y: vh / 2 - target.cy * target.k, k: target.k }
          applyCamera()
          return
        }
        animateTo(target)
      },
      [layout, animateTo, applyCamera],
    )

    /* 换根之后，布局会重算：等新布局落地再对准镜头 */
    useEffect(function () {
      var pending = pendingFitRef.current
      var el = canvasRef.current
      if (!pending || !el || !layout) return
      pendingFitRef.current = null
      var target = fitFor(layout, focusId || layout.root.id, el.clientWidth || 1, el.clientHeight || 1, pending.wide)
      /* 搜索跳转：缩放到合适大小，但把跳过去的那个概念摆正中 */
      var centerId = pendingCenterRef.current
      if (centerId) {
        pendingCenterRef.current = ''
        var cn = layout.byId.get(centerId)
        if (cn) target = { cx: cn.x, cy: cn.y, k: target.k }
      }
      if (pending.animate) {
        animateTo(target)
      } else {
        camRef.current = {
          x: (el.clientWidth || 1) / 2 - target.cx * target.k,
          y: (el.clientHeight || 1) / 2 - target.cy * target.k,
          k: target.k,
        }
        applyCamera()
      }
    }, [layout, focusId, animateTo, applyCamera])

    /* data sync: 首次拿到数据时把根（或上次停留的那一层）设为焦点 */
    useEffect(function () {
      if (!layout || initDoneRef.current) return
      var el = canvasRef.current
      if (!el || el.clientWidth < 460 || el.clientHeight < 300) return
      initDoneRef.current = true
      focusOn(props.initialFocusId || layout.root.id, false, true)
    }, [layout, focusOn])

    /* 把当前停在哪一层报给外面（面板用来记住每份图的视野） */
    useEffect(function () {
      if (!initDoneRef.current) return
      if (typeof props.onFocusChange === 'function') props.onFocusChange(focusId || '')
    }, [focusId])

    /* 生成中：概念变多时把视野缓缓拉远，让树"从中心长出来" */
    useEffect(function () {
      if (props.follow == null || !initDoneRef.current) return
      var el = canvasRef.current
      if (!el || !layout) return
      var target = fitFor(layout, focusId || layout.root.id, el.clientWidth || 1, el.clientHeight || 1, true)
      animateTo(target)
    }, [props.follow])

    useEffect(function () {
      var el = canvasRef.current
      if (!el) return
      var observer = new ResizeObserver(function () {
        if (!initDoneRef.current && el.clientWidth >= 460 && el.clientHeight >= 300 && layout) {
          initDoneRef.current = true
          focusOn(props.initialFocusId || layout.root.id, false, true)
          return
        }
        applyCamera()
      })
      observer.observe(el)
      return function () {
        observer.disconnect()
      }
    }, [applyCamera, focusOn, layout])

    /* gestures */
    useEffect(function () {
      var el = canvasRef.current
      if (!el) return
      var pointers = new Map()
      var dragging = false
      var lastX = 0
      var lastY = 0
      var pinchDist = 0

      var onWheel = function (event) {
        event.preventDefault()
        var rect = el.getBoundingClientRect()
        var mx = event.clientX - rect.left
        var my = event.clientY - rect.top
        var cam = camRef.current
        var fit = fitFor(layout, focusIdRef.current || (layout && layout.root.id), el.clientWidth || 1, el.clientHeight || 1)
        var cur = layout ? layout.byId.get(focusIdRef.current || layout.root.id) : null
        var hasKids = !!(cur && cur.children && cur.children.length)
        var factor = Math.exp(-event.deltaY * 0.0016)
        /* 没有更深的层可走时，把缩放钉在设计尺寸附近，避免把一张卡吹成满屏。 */
        var want = cam.k * factor
        var ceil = hasKids ? fit.k * 1.8 : fit.k * 1.05
        var nk = clamp(want, 0.12, ceil)
        var wx = (mx - cam.x) / cam.k
        var wy = (my - cam.y) / cam.k
        camRef.current = { k: nk, x: mx - wx * nk, y: my - wy * nk }
        /* 「棘轮」：放大到该层 2 倍就走进离光标最近的子分支；缩小到 1/2 就退回上一层。
           这样不管滚多少格，卡片都停在自己的设计字号上，永远清晰。 */
        if (layout && hasKids && nk >= ceil - 1e-6) {
          var px = wx
          var py = wy
          var best = cur.children[0]
          var bestD = Infinity
          for (var ci = 0; ci < cur.children.length; ci++) {
            var ch = cur.children[ci]
            var d = Math.hypot(ch.x - px, ch.y - py)
            if (d < bestD) {
              bestD = d
              best = ch
            }
          }
          focusOn(best.id, true)
          return
        }
        if (layout && want < fit.k * 0.5) {
          var cur2 = layout.byId.get(focusIdRef.current)
          if (cur2 && cur2.parent && cur2.parent !== cur2.id) {
            focusOn(cur2.parent, true)
            return
          }
        }
        applyCamera()
      }
      var onDown = function (event) {
        if (event.button !== 0) return
        /* Shift 是「连边」修饰键：不要同时把画布拖走 */
        if (event.shiftKey) return
        /* 卡片上的按下交给卡片自己（连边 / 拖拽改父），别顺手把画布也拖走 */
        var hitCard = event.target && event.target.closest ? event.target.closest('.sn-card') : null
        if (hitCard) return
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.size === 1) {
          dragging = true
          lastX = event.clientX
          lastY = event.clientY
          el.setAttribute('data-dragging', '1')
        } else if (pointers.size === 2) {
          var pts = Array.from(pointers.values())
          pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        }
      }
      var onMove = function (event) {
        if (!pointers.has(event.pointerId)) return
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointers.size === 2) {
          var pts = Array.from(pointers.values())
          var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
          if (pinchDist > 0) {
            var rect = el.getBoundingClientRect()
            var mx = (pts[0].x + pts[1].x) / 2 - rect.left
            var my = (pts[0].y + pts[1].y) / 2 - rect.top
            var cam = camRef.current
            var nk = clamp(cam.k * (dist / pinchDist), 0.12, 9)
            var wx = (mx - cam.x) / cam.k
            var wy = (my - cam.y) / cam.k
            camRef.current = { k: nk, x: mx - wx * nk, y: my - wy * nk }
            applyCamera()
          }
          pinchDist = dist
          return
        }
        if (!dragging) return
        var c = camRef.current
        camRef.current = { k: c.k, x: c.x + (event.clientX - lastX), y: c.y + (event.clientY - lastY) }
        lastX = event.clientX
        lastY = event.clientY
        applyCamera()
      }
      var onUp = function (event) {
        pointers.delete(event.pointerId)
        if (pointers.size < 2) pinchDist = 0
        if (pointers.size === 0) {
          dragging = false
          el.removeAttribute('data-dragging')
        }
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      el.addEventListener('pointerdown', onDown)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      return function () {
        el.removeEventListener('wheel', onWheel)
        el.removeEventListener('pointerdown', onDown)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        cancelAnimationFrame(rafRef.current)
      }
    }, [applyCamera])

    /* 弹窗打开时把焦点交给它，关掉之后还给刚才那个按钮：
       键盘用户不该被扔回页面开头。 */
    useEffect(
      function () {
        var open = settingsOpen || importOpen || !!review || !!pendingDelete
        if (!open) return
        var back = document.activeElement
        var raf = window.requestAnimationFrame(function () {
          var dialog = document.querySelector('.sn-root [role="dialog"][data-open="1"]')
          if (!dialog) return
          var first = dialog.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
          if (first && typeof first.focus === 'function') first.focus()
        })
        return function () {
          window.cancelAnimationFrame(raf)
          if (back && typeof back.focus === 'function' && document.contains(back)) back.focus()
        }
      },
      [settingsOpen, importOpen, review, pendingDelete],
    )

    useEffect(function () {
      var onKey = function (event) {
        var A = actionsRef.current || {}
        var key = String(event.key || '').toLowerCase()
        /* 输入法正在组字（打拼音、选候选词）时，按键不该被当成命令：
           否则敲「d」「e」「l」会把节点删掉。 */
        if (event.isComposing || event.keyCode === 229) return
        /* 弹窗开着时，把 Tab 圈在弹窗里，Esc 由下面的分支统一处理 */
        var dialog = document.querySelector('.sn-root [role="dialog"][data-open="1"]')
        if (dialog && event.key === 'Tab') {
          var items = Array.prototype.slice.call(
            dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
          ).filter(function (el) {
            return !el.disabled && el.offsetParent !== null
          })
          if (items.length) {
            event.preventDefault()
            var at = items.indexOf(document.activeElement)
            var next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 || at < 0 ? 0 : at + 1)
            items[next].focus()
            return
          }
        }
        /* 焦点在输入框里时，快捷键要先让路：⌘Z 应该撤销刚打的字，
           Tab 应该在字段之间跳，而不是删节点/加概念。 */
        var t = event.target
        var tag = t && t.tagName ? String(t.tagName).toUpperCase() : ''
        var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)
        if (typing) {
          if (event.key === 'Escape') {
            if (searchOpen) {
              setSearchOpen(false)
              return
            }
          }
          return
        }
        if ((event.metaKey || event.ctrlKey) && key === 'k') {
          event.preventDefault()
          setSearchQuery('')
          setSearchCursor(0)
          setSearchOpen(true)
          return
        }
        if ((event.metaKey || event.ctrlKey) && key === 'z') {
          event.preventDefault()
          if (A.undo) A.undo()
          return
        }
        if (event.key === 'Escape') {
          if (searchOpen) {
            setSearchOpen(false)
            return
          }
          if (editing) {
            setEditing(null)
            return
          }
          if (pendingDelete) {
            setPendingDelete(null)
            return
          }
          if (edgeSel) {
            setEdgeSel(null)
            return
          }
          if (A.closeReview && A.closeReview()) return
          if (A.closePanels && A.closePanels()) return
          if (A.closeExport && A.closeExport()) return
          if (selectedId) setSelectedId('')
          return
        }
        var tag = event.target && event.target.tagName ? String(event.target.tagName).toUpperCase() : ''
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
        /* 选中一条关系边时，删除键删的是这条线，不是节点 */
        if (edgeSel && (event.key === 'Delete' || event.key === 'Backspace')) {
          event.preventDefault()
          if (A.removeEdge) A.removeEdge()
          return
        }
        if (!selectedId || !editable) return
        if (event.key === 'Tab') {
          event.preventDefault()
          if (A.addChild) A.addChild(selectedId)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (A.addSibling) A.addSibling(selectedId)
        } else if (event.key === 'F2') {
          event.preventDefault()
          var cur = nodesById.get(selectedId)
          if (cur) setEditing({ id: cur.id, draft: cur.title || '' })
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          var kids = A.childCount ? A.childCount(selectedId) : 0
          if (kids > 0) {
            event.preventDefault()
            setPendingDelete({ id: selectedId, count: kids })
          } else {
            event.preventDefault()
            if (A.doDelete) A.doDelete(selectedId, true)
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return function () {
        window.removeEventListener('keydown', onKey)
      }
    }, [edgeSel, editing, nodesById, pendingDelete, searchOpen, selectedId, editable])

    /* 搜索框打开就聚焦；结果变了把光标收回第一行 */
    useEffect(function () {
      if (!searchOpen) return
      var timer = setTimeout(function () {
        if (searchInputRef.current) searchInputRef.current.focus()
      }, 0)
      return function () {
        clearTimeout(timer)
      }
    }, [searchOpen])

    useEffect(function () {
      setSearchCursor(0)
    }, [searchQuery])

    var focusNode = layout && focusId ? layout.byId.get(focusId) : null
    var selected = selectedId ? nodesById.get(selectedId) : null

    var crumbs = useMemo(function () {
      var out = []
      var cur = focusNode
      while (cur) {
        out.unshift(cur)
        cur = cur.parent && layout ? layout.byId.get(cur.parent) : null
      }
      return out
    }, [focusNode, layout])

    var relations = useMemo(function () {
      var out = []
      var into = []
      if (!data || !data.edges) return { out: out, into: into }
      for (var i = 0; i < data.edges.length; i++) {
        var edge = data.edges[i]
        var other = null
        if (edge.from === selectedId) {
          other = nodesById.get(edge.to)
          if (other) out.push({ edge: edge, other: other, dir: 'out' })
        }
        if (edge.to === selectedId) {
          other = nodesById.get(edge.from)
          if (other) into.push({ edge: edge, other: other, dir: 'in' })
        }
      }
      return { out: out, into: into }
    }, [data, selectedId, nodesById])

    var prereqMaps = useMemo(function () {
      var pre = new Map()
      var post = new Map()
      if (!data || !data.edges) return { pre: pre, post: post }
      for (var i = 0; i < data.edges.length; i++) {
        var e = data.edges[i]
        if (!e || !e.from || !e.to || e.from === e.to) continue
        if (e.type !== 'prereq' && e.type !== 'recommend') continue
        if (!nodesById.get(e.from) || !nodesById.get(e.to)) continue
        if (!pre.has(e.to)) pre.set(e.to, [])
        pre.get(e.to).push(e.from)
        if (!post.has(e.from)) post.set(e.from, [])
        post.get(e.from).push(e.to)
      }
      return { pre: pre, post: post }
    }, [data, nodesById])

    var path = useMemo(function () {
      if (!pathState || !data) return null
      var pre = prereqMaps.pre
      var post = prereqMaps.post
      var to = pathState.toId
      if (!nodesById.get(to)) return null
      if (pathState.kind !== 'between') {
        var seen = Object.create(null)
        var stack = [to]
        var ids = []
        while (stack.length) {
          var cur = stack.pop()
          if (seen[cur]) continue
          seen[cur] = true
          ids.push(cur)
          var list = pre.get(cur) || []
          for (var i = 0; i < list.length; i++) if (!seen[list[i]]) stack.push(list[i])
        }
        var indeg = Object.create(null)
        var order = []
        for (var a = 0; a < ids.length; a++) indeg[ids[a]] = 0
        for (var b = 0; b < ids.length; b++) {
          var outs = post.get(ids[b]) || []
          for (var c = 0; c < outs.length; c++) {
            if (outs[c] === ids[b] || !seen[outs[c]]) continue
            indeg[outs[c]]++
          }
        }
        var queue = ids.filter(function (id) {
          return indeg[id] === 0
        })
        queue.sort(function (x, y) {
          return (nodesById.get(x).depth || 0) - (nodesById.get(y).depth || 0)
        })
        while (queue.length) {
          var nid = queue.shift()
          order.push(nid)
          var outs2 = post.get(nid) || []
          for (var d = 0; d < outs2.length; d++) {
            var t = outs2[d]
            if (t === nid || !seen[t]) continue
            indeg[t]--
            if (indeg[t] === 0) queue.push(t)
          }
        }
        var cyclic = order.length !== ids.length
        if (cyclic) {
          for (var e2 = 0; e2 < ids.length; e2++) if (order.indexOf(ids[e2]) < 0) order.push(ids[e2])
        }
        return { kind: 'to', toId: to, ids: order, cyclic: cyclic }
      }
      var from = pathState.fromId
      if (!from || !nodesById.get(from)) return { kind: 'between', fromId: from || '', toId: to, ids: [], cyclic: false }
      var prevMap = Object.create(null)
      var q = [from]
      var seen2 = Object.create(null)
      seen2[from] = true
      var found = from === to
      while (q.length && !found) {
        var n2 = q.shift()
        var outs3 = post.get(n2) || []
        for (var k = 0; k < outs3.length; k++) {
          var t2 = outs3[k]
          if (seen2[t2]) continue
          seen2[t2] = true
          prevMap[t2] = n2
          if (t2 === to) {
            found = true
            break
          }
          q.push(t2)
        }
      }
      if (!found) return { kind: 'between', fromId: from, toId: to, ids: [], cyclic: false }
      var chain = [to]
      var walk = to
      while (walk !== from) {
        walk = prevMap[walk]
        if (!walk) break
        chain.unshift(walk)
      }
      return { kind: 'between', fromId: from, toId: to, ids: chain, cyclic: false }
    }, [pathState, data, nodesById, prereqMaps])

    var pathIds = useMemo(function () {
      var s = new Set()
      if (path && path.ids) for (var i = 0; i < path.ids.length; i++) s.add(path.ids[i])
      return s
    }, [path])

    /* 打开学习路径时，把整条链一次性框进视野（每次开一条新的才动镜头） */
    var pathFitRef = useRef('')
    useEffect(
      function () {
        if (!path || !path.ids.length || !layout) return
        var el = canvasRef.current
        if (!el || !el.clientWidth) return
        var key = path.ids.join('|')
        if (pathFitRef.current === key) return
        pathFitRef.current = key
        var minX = Infinity
        var minY = Infinity
        var maxX = -Infinity
        var maxY = -Infinity
        for (var i = 0; i < path.ids.length; i++) {
          var n = layout.byId.get(path.ids[i])
          if (!n) continue
          minX = Math.min(minX, n.x - n.w / 2)
          maxX = Math.max(maxX, n.x + n.w / 2)
          minY = Math.min(minY, n.y - n.h / 2)
          maxY = Math.max(maxY, n.y + n.h / 2)
        }
        if (!isFinite(minX)) return
        var bw = Math.max(1, maxX - minX)
        var bh = Math.max(1, maxY - minY)
        var k = Math.min((el.clientWidth * 0.82) / bw, (el.clientHeight * 0.82) / bh)
        k = Math.max(0.12, Math.min(k, 2.4))
        animateTo({ cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, k: k })
      },
      [path, layout, animateTo],
    )
    useEffect(
      function () {
        if (!pathState) pathFitRef.current = ''
      },
      [pathState],
    )

    /* 关掉学习路径时，回到「刚才在看的那张卡」并把它摆正中 */
    var returnFocusRef = useRef('')
    useEffect(
      function () {
        var want = returnFocusRef.current
        if (!want || pathState) return
        returnFocusRef.current = ''
        centerOn(want, true)
      },
      [pathState, layout, centerOn],
    )

    var updateNode = useCallback(function (id, patch, label) {
      if (!editable || !data) return
      pushHistory(label || 'edit')
      /* 同样整份展开：节点与文档上的额外字段保留下来 */
      var next = Object.assign({}, data, {
        version: data.version,
        id: data.id,
        title: data.title,
        subtitle: data.subtitle,
        updated: new Date().toISOString(),
        nodes: data.nodes.map(function (n) {
          if (n.id !== id) return n
          var merged = {}
          for (var k in n) merged[k] = n[k]
          for (var j in patch) merged[j] = patch[j]
          return merged
        }),
        edges: data.edges || [],
      })
      props.onChange(next)
    }, [data, editable, props, pushHistory])

    /* ---------------- 编辑：概念卡正文五栏 ---------------- */

    var FIELD_KEYS = { d: 'definition', f: 'formal', i: 'intuition', e: 'examples', p: 'pitfalls' }

    var startField = useCallback(function (key, value) {
      if (!editable || !selectedId) return
      setFieldEdit({ key: key, draft: value || '' })
    }, [editable, selectedId])

    var commitField = useCallback(function () {
      if (!fieldEdit || !selectedId) return
      var field = FIELD_KEYS[fieldEdit.key]
      var node = nodesById.get(selectedId)
      var cur = node ? node[field] || '' : ''
      if (field && fieldEdit.draft !== cur) {
        var patch = {}
        patch[field] = fieldEdit.draft
        updateNode(selectedId, patch, 'body:' + field + ':' + selectedId)
      }
      setFieldEdit(null)
    }, [fieldEdit, nodesById, selectedId, updateNode])

    /* ---------------- 编辑：加节点 / 改名 / 删节点 ---------------- */

    /* 撤销栈：只留下「提交之前」的样子；label 用来合并连续同类操作（比如一直敲笔记） */
    var pushHistory = useCallback(function (label) {
      if (!editable || !data) return
      var stack = historyRef.current
      var snap = { nodes: data.nodes, edges: data.edges || [], title: data.title, label: label || 'edit' }
      var merge = stack.length && label && label.indexOf(':') > 0 && stack[stack.length - 1].label === label
      /* 合并时保留**最早**那份「改之前」的快照：连敲笔记 / 连改同一栏，⌘Z 应该一次退回改动前 */
      if (!merge) {
        stack.push(snap)
        if (stack.length > 80) stack.shift()
      }
      lastLabelRef.current = snap.label
    }, [data, editable])

    var commitData = useCallback(function (nextNodes, nextEdges, label, extra) {
      if (!editable || !data) return
      if (label !== 'undo') pushHistory(label || 'edit')
      /* 用整份文档展开再覆盖：别的工具/更新版本写进来的额外字段不该被这次编辑抹掉 */
      props.onChange(Object.assign({}, data, {
        version: data.version,
        id: data.id,
        title: extra && typeof extra.title === 'string' ? extra.title : data.title,
        subtitle: data.subtitle,
        updated: new Date().toISOString(),
        nodes: nextNodes,
        edges: nextEdges || data.edges || [],
      }))
    }, [data, editable, props, pushHistory])

    var undo = useCallback(function () {
      var stack = historyRef.current
      if (!stack.length) return
      var snap = stack.pop()
      /* 快照里也带着 title：根改名产生的 title 变化撤销时才能一起退回去 */
      commitData(snap.nodes, snap.edges, 'undo', { title: snap.title })
    }, [commitData])

    var childCount = useCallback(function (id) {
      var n = 0
      for (var i = 0; i < (data ? data.nodes.length : 0); i++) if (data.nodes[i].parent === id) n++
      return n
    }, [data])

    var commitRename = useCallback(function (id, title) {
      var t = String(title == null ? '' : title).trim()
      if (!t) return
      /* 根节点就是这张图的标题：改名时同步文档 title，否则图库下拉里
         永远显示创建时的「未命名图」，多建几张就分不清 */
      var isRoot = !!(layout && layout.root && layout.root.id === id)
      if (isRoot && data && data.title !== t) {
        commitData(
          data.nodes.map(function (n) {
            return n.id === id ? Object.assign({}, n, { title: t }) : n
          }),
          data.edges,
          'title:' + id,
          { title: t },
        )
        return
      }
      updateNode(id, { title: t }, 'title:' + id)
    }, [commitData, data, layout, updateNode])

    var addChild = useCallback(function (parentId) {
      if (!editable || !data || !layout) return
      var parent = nodesById.get(parentId) || layout.root
      var id = 'n' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36)
      var node = {
        id: id,
        title: '新概念',
        parent: parent.id,
        summary: '',
        definition: '',
        formal: '',
        intuition: '',
        examples: '',
        pitfalls: '',
        mastery: 0,
        note: '',
      }
      var nodes = data.nodes.slice()
      var last = -1
      for (var i = 0; i < nodes.length; i++) if (nodes[i].parent === parent.id) last = i
      if (last >= 0) nodes.splice(last + 1, 0, node)
      else nodes.push(node)
      commitData(nodes, null, 'add')
      setSelectedId(id)
      setEditing({ id: id, draft: node.title })
    }, [commitData, data, editable, layout, nodesById])

    var addSibling = useCallback(function (id) {
      var node = nodesById.get(id)
      if (!node) return
      addChild(node.parent || (layout ? layout.root.id : ''))
    }, [addChild, layout, nodesById])

    var collectDescendants = useCallback(function (id) {
      var out = []
      var stack = [id]
      var seen = Object.create(null)
      seen[id] = true
      while (stack.length) {
        var cur = stack.pop()
        for (var i = 0; i < data.nodes.length; i++) {
          var child = data.nodes[i]
          if (child.parent === cur && !seen[child.id]) {
            seen[child.id] = true
            out.push(child.id)
            stack.push(child.id)
          }
        }
      }
      return out
    }, [data])

    /* cascade=true：连同子树一起删；false：只删这个点，子概念上提到它的父级 */
    var doDelete = useCallback(function (id, cascade) {
      var victim = nodesById.get(id)
      if (!victim || !layout) return
      /* 根没有父级可上提：只能连子树一起删，否则子节点会挂到一个不存在的 id 上 */
      var isRoot = !victim.parent || victim.id === layout.root.id
      if (isRoot) cascade = true
      var gone = cascade ? [id].concat(collectDescendants(id)) : [id]
      var goneSet = Object.create(null)
      for (var i = 0; i < gone.length; i++) goneSet[gone[i]] = true
      var liftTo = victim.parent || layout.root.id
      var nodes = []
      for (var j = 0; j < data.nodes.length; j++) {
        var n = data.nodes[j]
        if (goneSet[n.id]) continue
        if (!cascade && n.parent === id) {
          var copy = {}
          for (var k in n) copy[k] = n[k]
          copy.parent = liftTo
          nodes.push(copy)
        } else {
          nodes.push(n)
        }
      }
      var edges = (data.edges || []).filter(function (e) {
        return !goneSet[e.from] && !goneSet[e.to]
      })
      if (focusIdRef.current && goneSet[focusIdRef.current]) setFocusId(liftTo)
      if (selectedId && goneSet[selectedId]) setSelectedId('')
      commitData(nodes, edges, 'delete:' + id)
    }, [collectDescendants, commitData, data, layout, nodesById, selectedId])

    /* ---------------- 导出：整张图 → SVG / PNG / Markdown 大纲 ---------------- */

    var EXPORT_INK = '#2f2a24'
    var EXPORT_INK2 = '#6b5f4e'
    var EXPORT_LINE = '#604a2e'
    var EXPORT_LINE_OPACITY = '0.42'
    var EXPORT_AMBER = '#be8023'
    var EXPORT_TEAL = '#209682'
    var EXPORT_ROSE = '#ba4068'

    var escXml = function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    /* 按卡片宽度折行：中文近似 1 字宽 = 1em，英文按 0.55em 估 */
    var wrapTitle = function (title, px, fs, maxLines) {
      var per = Math.max(2, Math.floor((px * 0.86) / fs))
      var text = String(title || '')
      var lines = []
      var buf = ''
      var width = 0
      for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i)
        var w = /[\x00-\xff]/.test(ch) ? 0.55 : 1
        if (width + w > per) {
          lines.push(buf)
          buf = ''
          width = 0
          if (lines.length >= maxLines) break
        }
        buf += ch
        width += w
      }
      if (buf && lines.length < maxLines) lines.push(buf)
      if (!lines.length) lines.push('')
      if (lines.length === maxLines) {
        var joined = lines.join('')
        if (joined.length < text.length) lines[maxLines - 1] = lines[maxLines - 1].slice(0, Math.max(1, lines[maxLines - 1].length - 1)) + '…'
      }
      return lines
    }

    var buildExportSvg = useCallback(function () {
      if (!data || !data.nodes || !data.nodes.length) return null
      /* 导出「你现在看到的这一层」：和画布同一套换根逻辑，图才不会散成一整本书 */
      var lay = buildLayout(data.nodes, pathState ? null : focusId || null)
      if (!lay) return null
      var b = lay.bounds
      var pad = 60
      var w = Math.ceil(b.w + pad * 2)
      var h = Math.ceil(b.h + pad * 2)
      var ox = pad - b.x
      var oy = pad - b.y
      var parts = []
      parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">')
      parts.push('<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="#f4efe3"/>')

      /* 从属边 */
      for (var i = 0; i < lay.order.length; i++) {
        var n = lay.order[i]
        if (!n.parent) continue
        var p = lay.byId.get(n.parent)
        if (!p || !lay.visible.has(p.id)) continue
        var dx = n.x - p.x
        var dy = n.y - p.y
        var d = Math.hypot(dx, dy) || 1
        var ux = dx / d
        var uy = dy / d
        var sx = p.x + ux * (p.w / 2) * 0.96
        var sy = p.y + uy * (p.h / 2) * 0.96
        var ex = n.x - ux * (n.w / 2) * 0.96
        var ey = n.y - uy * (n.h / 2) * 0.96
        var mx = (sx + ex) / 2
        var my = (sy + ey) / 2
        var pull = 0.16
        var cx = mx + (mx - (p.x + n.x) / 2) * pull
        var cy = my + (my - (p.y + n.y) / 2) * pull
        /* 卡片是加过 ox/oy 的，线也必须抬到同一坐标系，否则全挤在左上角 */
        sx += ox
        sy += oy
        cx += ox
        cy += oy
        ex += ox
        ey += oy
        parts.push(
          '<path d="M' + sx.toFixed(1) + ' ' + sy.toFixed(1) + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + ex.toFixed(1) + ' ' + ey.toFixed(1) + '" fill="none" stroke="' + EXPORT_LINE + '" stroke-opacity="' + EXPORT_LINE_OPACITY + '" stroke-width="' + Math.max(0.8, 1.6 * Math.pow(0.75, n.depth)) + '"/>',
        )
      }

      /* 关系边 */
      var seenPair = Object.create(null)
      for (var e = 0; e < (data.edges || []).length; e++) {
        var edge = data.edges[e]
        var a = lay.byId.get(edge.from)
        var c = lay.byId.get(edge.to)
        if (!a || !c || a === c) continue
        if (!lay.visible.has(a.id) || !lay.visible.has(c.id)) continue
        var key = a.id + '>' + c.id
        if (seenPair[key]) continue
        seenPair[key] = true
        var color = edge.type === 'prereq' ? EXPORT_AMBER : edge.type === 'contrast' ? EXPORT_ROSE : EXPORT_TEAL
        var dash = edge.type === 'related' ? ' stroke-dasharray="1 5"' : edge.type === 'contrast' ? ' stroke-dasharray="9 4 2 4"' : ' stroke-dasharray="7 5"'
        var vx = c.x - a.x
        var vy = c.y - a.y
        var vd = Math.hypot(vx, vy) || 1
        var ax = a.x + (vx / vd) * (a.w / 2) * 0.9 + ox
        var ay = a.y + (vy / vd) * (a.h / 2) * 0.9 + oy
        var bx = c.x - (vx / vd) * (c.w / 2) * 0.9 + ox
        var by = c.y - (vy / vd) * (c.h / 2) * 0.9 + oy
        parts.push(
          '<path d="M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'L' + bx.toFixed(1) + ' ' + by.toFixed(1) + '" fill="none" stroke="' + color + '" stroke-opacity="0.85" stroke-width="1.4"' + dash + '/>',
        )
      }

      /* 卡片：深的层收成小圆点，跟画布上的 LOD 一致 */
      for (var k = 0; k < lay.order.length; k++) {
        var node = lay.order[k]
        var x = node.x + ox
        var y = node.y + oy
        if (node.depth >= 3) {
          parts.push('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (node.w * 0.18).toFixed(1) + '" fill="' + EXPORT_INK2 + '" fill-opacity="0.5"/>')
          continue
        }
        var fs = Math.max(5, node.w * (node.depth === 0 ? 0.115 : 0.1))
        var lines = wrapTitle(node.title, node.w, fs, node.depth === 0 ? 2 : 1)
        parts.push(
          '<rect x="' + (x - node.w / 2).toFixed(1) + '" y="' + (y - node.h / 2).toFixed(1) + '" width="' + node.w.toFixed(1) + '" height="' + node.h.toFixed(1) + '" rx="' + (8 * Math.pow(0.8, node.depth)).toFixed(1) + '" fill="#fffaf0" stroke="' + (node.depth === 0 ? EXPORT_INK : EXPORT_LINE) + '"' + (node.depth === 0 ? '' : ' stroke-opacity="' + EXPORT_LINE_OPACITY + '"') + ' stroke-width="' + (node.depth === 0 ? 1.6 : 1) + '"/>',
        )
        for (var li = 0; li < lines.length; li++) {
          var ly = y + (li - (lines.length - 1) / 2) * fs * 1.18 + fs * 0.34
          parts.push(
            '<text x="' + x.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" font-family="KaiTi, STKaiti, \'Noto Serif SC\', serif" font-size="' + fs.toFixed(1) + '" fill="' + EXPORT_INK + '">' + escXml(lines[li]) + '</text>',
          )
        }
      }

      parts.push('</svg>')
      return { svg: parts.join(''), w: w, h: h }
    }, [data, focusId, pathState])

    var downloadBlob = function (blob, filename) {
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(function () {
        URL.revokeObjectURL(url)
      }, 4000)
    }

    var exportBaseName = function () {
      var t = String((data && (data.title || data.id)) || 'synapsis').replace(/[\\/:*?"<>|]+/g, '-')
      return t || 'synapsis'
    }

    var exportMap = useCallback(function (kind) {
      var built = buildExportSvg()
      if (!built) return
      var name = exportBaseName()
      if (kind === 'md') {
        var lines = ['# ' + (data.title || '概念图'), '']
        if (data.subtitle) lines.push('> ' + data.subtitle, '')
        var walkMd = function (id, depth) {
          var node = nodesById.get(id)
          if (!node) return
          lines.push(new Array(depth + 1).join('  ') + '- **' + (node.title || '未命名') + '**' + (node.summary ? ' — ' + node.summary : ''))
          if (node.definition) lines.push(new Array(depth + 1).join('  ') + '  - 定义：' + node.definition)
          if (node.formal) lines.push(new Array(depth + 1).join('  ') + '  - 形式化：`' + node.formal + '`')
          if (node.intuition) lines.push(new Array(depth + 1).join('  ') + '  - 直觉：' + node.intuition)
          if (node.examples) lines.push(new Array(depth + 1).join('  ') + '  - 例子：' + node.examples)
          if (node.pitfalls) lines.push(new Array(depth + 1).join('  ') + '  - 易错点：' + node.pitfalls)
          if (node.source && node.source.page) lines.push(new Array(depth + 1).join('  ') + '  - 出处：第 ' + node.source.page + ' 页')
          for (var i = 0; i < data.nodes.length; i++) {
            if (data.nodes[i].parent === id) walkMd(data.nodes[i].id, depth + 1)
          }
        }
        var roots = data.nodes.filter(function (n) {
          return !n.parent || !nodesById.get(n.parent)
        })
        for (var r = 0; r < roots.length; r++) walkMd(roots[r].id, 0)
        downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), name + '.md')
        return
      }
      if (kind === 'svg') {
        downloadBlob(new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' }), name + '.svg')
        return
      }
      /* PNG：把 SVG 画进 canvas（2 倍超采样，最长边封顶 5000px） */
      var ratio = Math.min(2, 5000 / Math.max(built.w, built.h))
      var img = new Image()
      img.onload = function () {
        var canvas = document.createElement('canvas')
        canvas.width = Math.round(built.w * ratio)
        canvas.height = Math.round(built.h * ratio)
        var g = canvas.getContext('2d')
        g.fillStyle = '#f4efe3'
        g.fillRect(0, 0, canvas.width, canvas.height)
        g.drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(function (blob) {
          if (blob) downloadBlob(blob, name + '.png')
        }, 'image/png')
      }
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(built.svg)
    }, [buildExportSvg, data, nodesById])

    /* 拖拽改父：拖过 5px 才算「搬」，否则还是一次点击选中 */
    var dragRef = useRef(null)

    var beginMove = useCallback(
      function (id, event) {
        if (!editable || !data) return false
        dragRef.current = { id: id, x: event.clientX, y: event.clientY, active: false, over: '' }
        return true
      },
      [data, editable],
    )

    var reparent = useCallback(
      function (id, parentId) {
        if (!editable || !data || !layout || !id || !parentId || id === parentId) return
        var node = nodesById.get(id)
        var target = nodesById.get(parentId)
        if (!node || !target) return
        if (node.parent === parentId) return
        /* 不能把一个节点搬进它自己的子孙里，否则整棵树断开 */
        if (collectDescendants(id).indexOf(parentId) >= 0) return
        updateNode(id, { parent: parentId }, 'move:' + id)
      },
      [collectDescendants, data, editable, layout, nodesById, updateNode],
    )

    useEffect(
      function () {
        var onMove = function (event) {
          var st = dragRef.current
          if (!st) return
          if (!st.active) {
            if (Math.hypot(event.clientX - st.x, event.clientY - st.y) < 5) return
            st.active = true
            setMoving({ id: st.id, over: '' })
            setSelectedId(st.id)
          }
          var el = document.elementFromPoint(event.clientX, event.clientY)
          var card = el && el.closest ? el.closest('.sn-card') : null
          var over = card ? card.getAttribute('data-id') : ''
          if (over === st.id) over = ''
          if (over !== st.over) {
            st.over = over
            setMoving({ id: st.id, over: over })
          }
        }
        var finish = function (commit) {
          var st = dragRef.current
          dragRef.current = null
          if (!st) return
          setMoving(null)
          if (commit && st.active && st.over) reparent(st.id, st.over)
        }
        var onUp = function () {
          finish(true)
        }
        var onCancel = function () {
          finish(false)
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        return function () {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
        }
      },
      [reparent],
    )

    /* ---------------- 编辑：连边 ---------------- */

    /* 同一对概念只留一条关系：连第一次是「前置」，再连一次换「关联」→「对比」，第四次取消 */
    var linkEdge = useCallback(function (fromId, toId) {
      if (!editable || !data || !fromId || !toId || fromId === toId) return
      var a = nodesById.get(fromId)
      var b = nodesById.get(toId)
      if (!a || !b) return
      /* 从属关系已经由树表达了，不用再连一条 */
      if (a.parent === toId || b.parent === fromId) return
      var list = (data.edges || []).slice()
      var order = ['prereq', 'related', 'contrast']
      var at = -1
      for (var i = 0; i < list.length; i++) {
        if ((list[i].from === fromId && list[i].to === toId) || (list[i].from === toId && list[i].to === fromId)) {
          at = i
          break
        }
      }
      if (at < 0) {
        list.push({ from: fromId, to: toId, type: 'prereq' })
      } else if (list[at].from !== fromId) {
        /* 反过来连：方向改过来，类型回到前置 */
        list[at] = { from: fromId, to: toId, type: 'prereq' }
      } else {
        var idx = order.indexOf(list[at].type)
        if (idx < 0 || idx >= order.length - 1) list.splice(at, 1)
        else list[at] = { from: fromId, to: toId, type: order[idx + 1] }
      }
      commitData(data.nodes, list, 'edge')
    }, [commitData, data, editable, nodesById])

    /* 选中一条已有的关系边 */
    var pickEdge = useCallback(function (from, to, event) {
      if (event) {
        event.stopPropagation()
        event.preventDefault()
      }
      if (!editable) return
      setEdgeSel({ from: from, to: to })
      setSelectedId('')
    }, [editable])

    /* 改类型（同一条边，只换 type） */
    var setEdgeType = useCallback(function (type) {
      if (!editable || !data || !edgeSel) return
      var list = (data.edges || []).map(function (e) {
        if (e.from === edgeSel.from && e.to === edgeSel.to) return { from: e.from, to: e.to, type: type }
        return e
      })
      commitData(data.nodes, list, 'edge')
    }, [commitData, data, editable, edgeSel])

    /* 删掉选中的这条边 */
    var removeEdge = useCallback(function () {
      if (!editable || !data || !edgeSel) return
      var list = (data.edges || []).filter(function (e) {
        return !(e.from === edgeSel.from && e.to === edgeSel.to)
      })
      setEdgeSel(null)
      commitData(data.nodes, list, 'edge')
    }, [commitData, data, editable, edgeSel])

    /* 橡皮筋线：pointermove 里直接改属性，不进 React 状态，才不卡 */
    var drawLink = useCallback(function (clientX, clientY) {
      var el = canvasRef.current
      var path = linkPathRef.current
      var from = layout && layout.byId.get(linkFromRef.current)
      if (!el || !path || !from) return
      var box = el.getBoundingClientRect()
      var cam = camRef.current
      var x1 = from.x * cam.k + cam.x
      var y1 = from.y * cam.k + cam.y
      var x2 = clientX - box.left
      var y2 = clientY - box.top
      path.setAttribute('d', 'M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1))
    }, [layout])

    var beginLink = useCallback(function (id, event) {
      if (!editable) return false
      linkFromRef.current = id
      setLinking({ from: id })
      var path = linkPathRef.current
      if (path) path.setAttribute('d', '')
      drawLink(event.clientX, event.clientY)
      return true
    }, [drawLink, editable])

    /* 橡皮筋线必须能被彻底擦掉：松手、取消、失焦、按 Esc、滚轮缩放都要清，
       否则那条屏幕坐标的虚线会留在原地（不随缩放平移移动，也选不中） */
    var clearLink = useCallback(function () {
      var path = linkPathRef.current
      if (path) path.setAttribute('d', '')
    }, [])

    useEffect(function () {
      if (!linking) return
      var onMove = function (event) {
        drawLink(event.clientX, event.clientY)
      }
      var onUp = function (event) {
        var fromId = linkFromRef.current
        linkFromRef.current = ''
        clearLink()
        setLinking(null)
        var node = document.elementFromPoint(event.clientX, event.clientY)
        var card = node && node.closest ? node.closest('.sn-card') : null
        var toId = card ? card.getAttribute('data-id') : ''
        if (toId && toId !== fromId) linkEdge(fromId, toId)
      }
      var onCancel = function () {
        linkFromRef.current = ''
        clearLink()
        setLinking(null)
      }
      var onKey = function (event) {
        if (event.key === 'Escape') onCancel()
      }
      var onWheel = function () {
        onCancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('blur', onCancel)
      window.addEventListener('keydown', onKey)
      window.addEventListener('wheel', onWheel, { passive: true })
      return function () {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('blur', onCancel)
        window.removeEventListener('keydown', onKey)
        window.removeEventListener('wheel', onWheel)
      }
    }, [drawLink, linkEdge, linking, clearLink])

    /* 兜底：linking 一旦结束，残留的线一律擦掉（不管走的是哪条退出路径） */
    useEffect(
      function () {
        if (!linking) clearLink()
      },
      [linking, clearLink],
    )

    var focusLevel = focusNode ? focusNode.depth : 0
    var cards = []
    var edges = []
    if (layout && data) {
      for (var i = 0; i < layout.order.length; i++) {
        var node = layout.order[i]
        var rel = node.depth - focusLevel
        if (rel > 4) continue
        /* 细节层级由「屏幕上的大小」决定：放大到哪一步，就看到多少字。 */
        var screenW = node.w * (lodK || camRef.current.k || 1)
        var inPath = pathIds.has(node.id)
        if (!inPath && rel !== 0 && screenW < 34) continue
        var detail = screenW < 88 ? 3 : screenW < 190 ? 2 : screenW < 340 ? 1 : 0
        if (inPath && detail > 2) detail = 2
        /* 焦点和它的一级子节点永远至少显示标题，别缩成一堆灰点 */
        if (rel <= 1 && detail === 3) detail = 2
        var fontSize = node.w * 0.108
        var style = {
          left: node.x - node.w / 2,
          top: node.y - node.h / 2,
          width: node.w,
          height: node.h,
          borderRadius: Math.max(3, node.w * 0.075),
          borderWidth: Math.max(0.5, node.w * 0.006),
          padding: node.w * 0.05,
        }
        if (detail === 3) {
          style.width = node.w * 0.34
          style.height = node.w * 0.34
          style.left = node.x - node.w * 0.17
          style.top = node.y - node.w * 0.17
          style.borderRadius = '50%'
        } else if (detail === 0) {
          /* 全卡会带定义段落，允许长高一点，别把最后一行切掉 */
          style.height = 'auto'
          style.minHeight = node.h
          style.maxHeight = node.h * 2.2
        }
        var inner = []
        if (detail <= 2) {
          inner.push(h('div', { key: 't', className: 'sn-title', 'data-wrap': '1', style: { fontSize: Math.max(7, fontSize) } }, node.title))
        }
        if (detail === 0 && node.en) {
          inner.push(h('div', { key: 'e', className: 'sn-en', style: { fontSize: Math.max(5, fontSize * 0.5) } }, node.en))
        }
        if (detail <= 1 && node.summary) {
          inner.push(
            h('div', {
              key: 's',
              className: 'sn-summary',
              style: { fontSize: Math.max(6, fontSize * 0.6), WebkitLineClamp: detail === 0 ? 1 : 2 },
            }, node.summary),
          )
        }
        if (detail === 0 && node.definition) {
          inner.push(
            h('div', {
              key: 'b',
              className: 'sn-def',
              style: { fontSize: Math.max(6, fontSize * 0.5) },
            }, String(node.definition)),
          )
        }
        cards.push(
          h(
            'div',
            {
              key: node.id,
              className: 'sn-card',
              style: style,
              'data-id': node.id,
              'data-sel': node.id === selectedId ? '1' : '0',
              'data-focus': node.id === focusId ? '1' : '0',
              'data-dim': pathState ? (inPath ? '0' : '1') : rel < 0 ? '1' : '0',
              'data-path': pathIds.has(node.id) ? '1' : '0',
              'data-dot': detail === 3 ? '1' : '0',
              'data-dragging': moving && moving.id === node.id ? '1' : '0',
              'data-drop': moving && moving.over === node.id ? '1' : '0',
              onPointerDown: function (id) {
                return function (event) {
                  if (!editable) return
                  if (event.button !== 0) return
                  if (event.shiftKey) {
                    event.stopPropagation()
                    event.preventDefault()
                    beginLink(id, event)
                    return
                  }
                  event.stopPropagation()
                  beginMove(id, event)
                }
              }(node.id),
              onClick: function (id) {
                return function (event) {
                  event.stopPropagation()
                  setEdgeSel(null)
                  setSelectedId(id)
                  if (props.onSelect) props.onSelect(id)
                }
              }(node.id),
              onDoubleClick: function (id, hasKids) {
                return function (event) {
                  event.stopPropagation()
                  if (hasKids) focusOn(id, true)
                }
              }(node.id, node.children.length > 0),
              title: node.title,
            },
            detail === 3 ? null : inner,
          ),
        )

        if (node.parent) {
          var parentNode = layout.byId.get(node.parent)
          if (parentNode) {
            var relDepth = Math.max(node.depth - focusLevel, parentNode.depth - focusLevel)
            /* 看路径时只留路径上的从属线，别让整张图的线扫过来 */
            var keepEdge = !pathState || (inPath && pathIds.has(parentNode.id))
            if (keepEdge && relDepth <= 2) {
              edges.push(
                h('path', {
                  key: 'e-' + node.id,
                  d: pathBetween(parentNode, node),
                  fill: 'none',
                  stroke: 'rgba(96,74,46,.45)',
                  strokeWidth: 1.5,
                  strokeLinecap: 'round',
                }),
              )
              edges.push(
                h('path', {
                  key: 'e2-' + node.id,
                  d: pathBetween(parentNode, node),
                  fill: 'none',
                  stroke: 'rgba(96,74,46,.16)',
                  strokeWidth: 3.6,
                  strokeLinecap: 'round',
                  transform: 'translate(0.7,0.9)',
                }),
              )
            }
          }
        }
      }

      if (data.edges) {
        for (var j = 0; j < data.edges.length; j++) {
          var edge = data.edges[j]
          var a = layout.byId.get(edge.from)
          var b = layout.byId.get(edge.to)
          if (!a || !b) continue
          if (a.depth - focusLevel > 2 || b.depth - focusLevel > 2) continue
          var active = edge.from === selectedId || edge.to === selectedId
          /* 看学习路径时只留链上的关系线，其余全部让路 */
          var onPath = pathIds.has(edge.from) && pathIds.has(edge.to)
          if (pathState && !onPath) continue
          var color = edge.type === 'prereq' ? 'rgba(190,128,35,' : edge.type === 'contrast' ? 'rgba(186,64,104,' : 'rgba(32,150,130,'
          var picked = !!edgeSel && edgeSel.from === edge.from && edgeSel.to === edge.to
          /* 看不见的粗线当命中区：细虚线直接点很难点中 */
          if (editable) {
            edges.push(
              h('path', {
                key: 'rh-' + edge.from + '-' + edge.to,
                className: 'sn-edgehit',
                d: pathBetween(a, b),
                fill: 'none',
                stroke: 'transparent',
                strokeWidth: 16,
                onClick: function (from, to) {
                  return function (event) {
                    pickEdge(from, to, event)
                  }
                }(edge.from, edge.to),
              }),
            )
          }
          edges.push(
            h('path', {
              key: 'r-' + edge.from + '-' + edge.to,
              d: pathBetween(a, b),
              fill: 'none',
              stroke: color + (picked ? '1)' : active ? '0.9)' : onPath ? '0.88)' : '0.28)'),
              strokeWidth: picked ? 3.2 : active || onPath ? 2.4 : 1.4,
              strokeDasharray: edge.type === 'contrast' ? '7 4' : '5 4',
              strokeLinecap: 'round',
              style: picked ? { filter: 'drop-shadow(0 0 3px ' + color + '0.85))' } : undefined,
            }),
          )
        }
      }
    }

    var dots = []
    if (layout) {
      var b = layout.bounds
      var scale = Math.min(168 / b.w, 116 / b.h)
      var ox = (168 - b.w * scale) / 2
      var oy = (116 - b.h * scale) / 2
      for (var k = 0; k < layout.order.length; k++) {
        var n2 = layout.order[k]
        dots.push(
          h('circle', {
            key: n2.id,
            cx: ox + (n2.x - b.x) * scale,
            cy: oy + (n2.y - b.y) * scale,
            r: n2.depth === 0 ? 2.4 : Math.max(1, 2.4 - n2.depth * 0.35),
            fill: n2.id === selectedId ? '#8a5a10' : 'rgba(90,72,48,.55)',
          }),
        )
      }
    }

    var sideContent
    if (pathState && path) {
      var preNode = nodesById.get(path.toId) || {}
      var pathTitle =
        path.kind === 'between'
          ? '从「' + ((nodesById.get(path.fromId) || {}).title || '（选起点）') + '」到「' + (preNode.title || '') + '」'
          : '学「' + (preNode.title || '') + '」之前'
      var pathSteps = []
      if (!path.ids.length) {
        pathSteps.push(
          h(
            'div',
            { key: 'none', className: 'sn-mut', style: { marginTop: 12, lineHeight: 1.7 } },
            path.kind === 'between' ? '这两点之间没有一条前置链连着。' : '它还没有标出任何前置概念。',
          ),
        )
      } else {
        var stepNodes = path.ids
        for (var pi = 0; pi < stepNodes.length; pi++) {
          pathSteps.push(
            (function (id, idx) {
              var n = nodesById.get(id)
              return h(
                'li',
                {
                  key: id,
                  className: 'sn-pathstep',
                  'data-on': id === selectedId ? '1' : '0',
                  'data-last': idx === stepNodes.length - 1 ? '1' : '0',
                  onClick: function () {
                    setSelectedId(id)
                  },
                },
                h('span', { className: 'sn-pathnum' }, String(idx + 1)),
                h(
                  'span',
                  { className: 'sn-pathtxt' },
                  h('span', { className: 'sn-pathtitle' }, n.title || ''),
                  n.summary ? h('span', { className: 'sn-pathsum' }, n.summary) : null,
                ),
              )
            })(stepNodes[pi], pi),
          )
        }
      }
      var fromPicker = null
      if (path.kind === 'between') {
        var allNodes = Array.from(nodesById.values()).sort(function (x, y) {
          var dx = x.depth || 0
          var dy = y.depth || 0
          if (dx !== dy) return dx - dy
          return String(x.title || '').localeCompare(String(y.title || ''), 'zh')
        })
        fromPicker = h(
          'select',
          {
            className: 'sn-libsel',
            value: path.fromId || '',
            onChange: function (event) {
              setPathState({ kind: 'between', fromId: event.target.value, toId: path.toId })
            },
          },
          h('option', { value: '' }, '选一个起点…'),
          allNodes.map(function (n) {
            return h('option', { key: n.id, value: n.id }, n.title || n.id)
          }),
        )
      }
      sideContent = h(
        React.Fragment,
        null,
        h('div', { className: 'sn-side-head' }, h('div', { className: 'sn-side-title' }, pathTitle)),
        h(
          'div',
          { className: 'sn-pathsub' },
          path.kind === 'between'
            ? path.ids.length
              ? '这条链要经过 ' + path.ids.length + ' 个概念。点一步就选中它。'
              : '按硬前置找一条从起点通往终点的最短链。'
            : path.ids.length
              ? '按前置关系排好的 ' + path.ids.length + ' 步，从最底层走到它。'
              : '',
        ),
        path.cyclic ? h('div', { className: 'sn-pathsub', style: { marginTop: 6 } }, '（前置里有环，已把能排的部分排在前面）') : null,
        fromPicker ? h('div', { style: { marginTop: 10 } }, fromPicker) : null,
        pathSteps.length ? h('ol', { className: 'sn-pathlist' }, pathSteps) : null,
        h(
          'div',
          { className: 'sn-rel', style: { marginTop: 14 } },
          h(
            'button',
            {
              className: 'sn-chip',
              onClick: function () {
                returnFocusRef.current = selectedId || focusId || ''
                setPathState(null)
              },
            },
            '返回概念卡',
          ),
          path.kind !== 'between'
            ? h(
                'button',
                {
                  className: 'sn-chip',
                  onClick: function () {
                    setPathState({ kind: 'between', fromId: path.ids[0] || '', toId: path.toId })
                  },
                },
                '换成两点之间',
              )
            : null,
        ),
      )
    } else if (selected) {
      var blocks = []
      var titleNode =
        editable && editing && editing.id === selected.id
          ? h('input', {
              className: 'sn-title-input',
              value: editing.draft,
              autoFocus: true,
              spellCheck: false,
              onChange: function (event) {
                setEditing({ id: selected.id, draft: event.target.value })
              },
              onBlur: function () {
                commitRename(selected.id, editing.draft)
                setEditing(null)
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitRename(selected.id, editing.draft)
                  setEditing(null)
                } else if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                }
              },
            })
          : h(
              'div',
              {
                className: 'sn-side-title',
                title: editable ? '双击改名（或按 F2）' : selected.title,
                onDoubleClick: function () {
                  if (editable) setEditing({ id: selected.id, draft: selected.title || '' })
                },
              },
              selected.title,
            )
      blocks.push(h('div', { key: 'h', className: 'sn-side-head' }, titleNode))
      if (selected.en) blocks.push(h('div', { key: 'en', className: 'sn-side-en' }, selected.en))
      var fieldProps = function (key, label, value, mono) {
        return {
          key: key,
          label: label,
          text: value,
          mono: mono,
          render: renderMath,
          editable: editable,
          editing: !!fieldEdit && fieldEdit.key === key,
          draft: fieldEdit ? fieldEdit.draft : '',
          onStart: function () {
            startField(key, value)
          },
          onDraft: function (v) {
            setFieldEdit({ key: key, draft: v })
          },
          onCommit: commitField,
          onCancel: function () {
            setFieldEdit(null)
          },
        }
      }
      blocks.push(h(Field, fieldProps('d', '定义', selected.definition)))
      blocks.push(h(Field, fieldProps('f', '形式化', selected.formal, true)))
      blocks.push(h(Field, fieldProps('i', '直觉', selected.intuition)))
      blocks.push(h(Field, fieldProps('e', '例子', selected.examples)))
      blocks.push(h(Field, fieldProps('p', '易错点', selected.pitfalls)))
      if (!selected.definition && !selected.formal && !selected.intuition && !selected.examples && !selected.pitfalls) {
        if (selected.children && selected.children.length) {
          blocks.push(
            h(
              'div',
              { key: 'empty', className: 'sn-emptyfield' },
              editable
                ? '这一层是分支，正文可以留空（双击上面任意一栏也能写）。往下点一个子概念看细节。'
                : '这一层是分支，没有正文。往下点一个子概念看细节。',
            ),
          )
        }
      }
      if (selected.source && (selected.source.snippet || selected.source.page)) {
        blocks.push(
          h(
            'div',
            { key: 'src', className: 'sn-field' },
            h('div', { className: 'sn-label' }, '原文出处'),
            h(
              'div',
              { className: 'sn-src' },
              selected.source.page ? h('div', { className: 'sn-src-meta' }, '第 ' + selected.source.page + ' 页') : null,
              selected.source.snippet || '',
            ),
          ),
        )
      }
      var inBlock = relBlock(relations.into, '前置 · 引用它的')
      var outBlock = relBlock(relations.out, '引出 · 它指向的')
      if (inBlock) blocks.push(React.cloneElement(inBlock, { key: 'in' }))
      if (outBlock) blocks.push(React.cloneElement(outBlock, { key: 'out' }))
      if (editable) {
        blocks.push(
          h(
            'div',
            { key: 'm', className: 'sn-field' },
            h('div', { className: 'sn-label' }, '掌握度'),
            h(
              'div',
              { className: 'sn-mastery' },
              ['未读', '模糊', '掌握'].map(function (label, index) {
                return h(
                  'button',
                  {
                    key: label,
                    className: 'sn-mbtn',
                    'data-on': (selected.mastery || 0) === index ? '1' : '0',
                    onClick: function () {
                      updateNode(selected.id, { mastery: index }, 'mastery:' + selected.id)
                    },
                  },
                  label,
                )
              }),
            ),
          ),
        )
        blocks.push(
          h(
            'div',
            { key: 'n', className: 'sn-field' },
            h('div', { className: 'sn-label' }, '我的笔记'),
            h('textarea', {
              className: 'sn-note',
              value: selected.note || '',
              placeholder: '写点什么…',
              onChange: function (event) {
                updateNode(selected.id, { note: event.target.value }, 'note:' + selected.id)
              },
            }),
          ),
        )
      }
      blocks.push(
        h(
          'div',
          { key: 'acts', className: 'sn-rel', style: { marginTop: 14 } },
          h(
            'button',
            {
              className: 'sn-chip',
              onClick: function () {
                setPathState({ kind: 'to', toId: selected.id })
              },
              title: '看学它之前要先会哪些概念',
            },
            '学习路径',
          ),
          h(
            'button',
            {
              className: 'sn-chip',
              onClick: function () {
                setPathState({ kind: 'between', fromId: '', toId: selected.id })
              },
              title: '从某个概念走到它，中间的必经链',
            },
            'A → B',
          ),
          h(
            'button',
            { className: 'sn-chip', onClick: function () { focusOn(selected.id, true) } },
            '以它为主根展开',
          ),
          h(
            'button',
            {
              className: 'sn-chip',
              onClick: function () { startReview(selected.id) },
              title: '只复习这一支下面写了正文的概念',
            },
            '复习这一支',
          ),
          editable
            ? h(
                'button',
                { className: 'sn-chip', onClick: function () { addChild(selected.id) }, title: '在它下面加一个子概念（Tab）' },
                '+ 子概念',
              )
            : null,
          editable
            ? h(
                'button',
                {
                  className: 'sn-chip',
                  onClick: function () {
                    var kids = childCount(selected.id)
                    if (kids > 0) setPendingDelete({ id: selected.id, count: kids })
                    else doDelete(selected.id, true)
                  },
                  title: '删除这个概念（Del）',
                },
                '删除',
              )
            : null,
        ),
      )
      sideContent = h(React.Fragment, null, blocks)
    } else if (focusNode) {
      sideContent = h(
        React.Fragment,
        null,
        h('div', { className: 'sn-side-head' }, h('div', { className: 'sn-side-title' }, focusNode.title)),
        focusNode.en ? h('div', { className: 'sn-side-en' }, focusNode.en) : null,
        h('div', { className: 'sn-mut', style: { marginTop: 10, lineHeight: 1.7 } }, focusNode.summary || '点一个概念看详情。'),
        h('div', { className: 'sn-mut', style: { marginTop: 14 } }, '子分支 ' + focusNode.children.length + ' 个'),
      )
    } else {
      sideContent = h('div', { className: 'sn-mut' }, '点一个概念看详情。')
    }

    actionsRef.current = {
      undo: undo,
      removeEdge: removeEdge,
      addChild: addChild,
      addSibling: addSibling,
      doDelete: doDelete,
      childCount: childCount,
      exportMap: exportMap,
      closeExport: function () {
        if (!exportOpen) return false
        setExportOpen(false)
        return true
      },
      closeReview: function () {
        if (!review) return false
        setReview(null)
        return true
      },
      closePanels: function () {
        if (importOpen) {
          setImportOpen(false)
          return true
        }
        if (settingsOpen) {
          setSettingsOpen(false)
          return true
        }
        return false
      },
    }

    if (!layout) {
      return h('div', { className: 'sn-root', 'data-theme': props.theme }, h('style', null, CSS), h('div', { className: 'sn-empty' }, props.emptyText || '还没有内容'))
    }

    return h(
      'div',
      { className: 'sn-root', 'data-theme': props.theme, 'data-linking': linking ? '1' : '0', style: appearanceVars(props.theme, appear) },
      h('style', null, CSS),
      h(
        'div',
        { className: 'sn-topbar' },
        props.leading ? h('div', { className: 'sn-leading' }, props.leading) : null,
        h(
          'div',
          { className: 'sn-crumbs' },
          crumbs.map(function (node, index) {
            return h(
              React.Fragment,
              { key: node.id },
              index > 0 ? h('span', { className: 'sn-sep' }, '›') : null,
              h(
                'button',
                {
                  className: 'sn-crumb',
                  'data-on': node.id === focusId ? '1' : '0',
                  onClick: function () {
                    focusOn(node.id, true)
                  },
                  title: node.title,
                },
                node.title,
              ),
            )
          }),
        ),
        props.statusText ? h('span', { className: 'sn-status' }, props.statusText) : null,
        h(
          'button',
          {
            className: 'sn-searchbtn',
            'data-on': viewMode === 'outline' ? '1' : '0',
            onClick: function () {
              setViewMode(viewMode === 'outline' ? 'map' : 'outline')
            },
            title: viewMode === 'outline' ? '回到画布' : '换成大纲：一屏看到更多概念',
          },
          viewMode === 'outline' ? '画布' : '大纲',
        ),
        h(
          'button',
          {
            className: 'sn-searchbtn',
            onClick: startReview,
            title: '按掌握度抽一批概念过一遍（模糊的排前面）',
          },
          '复习',
        ),
        h(
          'button',
          {
            className: 'sn-searchbtn',
            onClick: openSearch,
            title: '搜索概念（Ctrl/⌘ + K）',
          },
          h('span', null, '搜索'),
          h('kbd', null, '⌘K'),
        ),
        props.dir
          ? h(
              'button',
              {
                className: 'sn-searchbtn',
                onClick: function () {
                  setImportOpen(true)
                },
                title: '把 PDF 讲义变成这张图：怎么交给我',
              },
              '导入',
            )
          : null,
        h(
          'button',
          {
            className: 'sn-searchbtn',
            'data-on': settingsOpen ? '1' : '0',
            onClick: function () {
              setSettingsOpen(!settingsOpen)
            },
            title: '纸、字体、字号',
          },
          '设置',
        ),
        h(
          'div',
          { className: 'sn-exportwrap', onClick: function (e) { e.stopPropagation() } },
          h(
            'button',
            {
              className: 'sn-searchbtn',
              onClick: function () {
                setExportOpen(!exportOpen)
              },
              title: '把这张图导出成图片或大纲',
            },
            '导出',
          ),
          exportOpen
            ? h(
                'div',
                { className: 'sn-exportmenu' },
                h('button', { className: 'sn-exportitem', onClick: function () { setExportOpen(false); exportMap('png') } }, 'PNG 图片'),
                h('button', { className: 'sn-exportitem', onClick: function () { setExportOpen(false); exportMap('svg') } }, 'SVG 矢量图'),
                h('button', { className: 'sn-exportitem', onClick: function () { setExportOpen(false); exportMap('md') } }, 'Markdown 大纲'),
              )
            : null,
        ),
        props.onToggleTheme
          ? h(
              'button',
              {
                className: 'sn-searchbtn',
                onClick: props.onToggleTheme,
                title: props.theme === 'dark' ? '换成日光纸（亮）' : '换成夜光纸（暗）',
              },
              props.theme === 'dark' ? '日光纸' : '夜光纸',
            )
          : null,
        h(
          'button',
          {
            className: 'sn-iconbtn',
            onClick: function () {
              setCollapsed(!collapsed)
            },
            title: collapsed ? '展开详情' : '收起详情',
            'aria-label': collapsed ? '展开详情' : '收起详情',
            'aria-expanded': collapsed ? 'false' : 'true',
          },
          collapsed ? '‹' : '›',
        ),
      ),
      h(
        'div',
        { className: 'sn-body' },
        h(
          'div',
          {
            className: 'sn-canvas',
            ref: canvasRef,
            onClick: function () {
              setSelectedId('')
              setEdgeSel(null)
              setExportOpen(false)
            },
          },
          edgeSel && editable
            ? (function () {
                var ea = nodesById.get(edgeSel.from)
                var eb = nodesById.get(edgeSel.to)
                if (!ea || !eb) return null
                var kinds = [
                  { t: 'prereq', label: '前置' },
                  { t: 'related', label: '关联' },
                  { t: 'contrast', label: '对比' },
                ]
                var now = 'related'
                for (var q = 0; q < (data.edges || []).length; q++) {
                  if (data.edges[q].from === edgeSel.from && data.edges[q].to === edgeSel.to) now = data.edges[q].type
                }
                return h(
                  'div',
                  {
                    className: 'sn-edgebar',
                    onClick: function (event) {
                      event.stopPropagation()
                    },
                  },
                  h('span', { className: 'sn-edgebar-title' }, (ea.title || '') + ' → ' + (eb.title || '')),
                  h(
                    'span',
                    { className: 'sn-edgebar-kinds' },
                    kinds.map(function (item) {
                      return h(
                        'button',
                        {
                          key: item.t,
                          className: 'sn-chip',
                          'data-t': item.t,
                          'data-on': now === item.t ? '1' : '0',
                          onClick: function () {
                            setEdgeType(item.t)
                          },
                        },
                        item.label,
                      )
                    }),
                  ),
                  h(
                    'button',
                    {
                      className: 'sn-chip sn-chip-danger',
                      onClick: function () {
                        removeEdge()
                      },
                    },
                    '删掉这条线',
                  ),
                  h(
                    'button',
                    {
                      className: 'sn-chip',
                      onClick: function () {
                        setEdgeSel(null)
                      },
                    },
                    '关闭',
                  ),
                )
              })()
            : null,
          h(
          'div',
          { className: 'sn-hint' },
          linking
            ? '拖到另一个概念上松开：连一条关系（同向再连一次换类型，第三次取消）'
            : moving
              ? '松手落在这张卡上，就把它挂到它下面（不能拖进自己的子孙里）'
              : edgeSel
                ? '选中了一条关系线：上面可换类型或删掉 · Esc 取消'
                : editable
                  ? '滚轮缩放 · 拖拽平移 · 拖卡片改归属 · 双击进入 · Tab 新建 · F2 改名 · Del 删除 · Shift 连边 · ⌘Z 撤销'
                  : '滚轮缩放 · 拖拽平移 · 双击进入子层',
        ),
          props.liveText ? h('div', { className: 'sn-live' }, props.liveText) : null,
          h(
            'div',
            { className: 'sn-scene', ref: sceneRef },
            h(
              'svg',
              {
                className: 'sn-edges',
                width: layout.bounds.w,
                height: layout.bounds.h,
                viewBox: layout.bounds.x + ' ' + layout.bounds.y + ' ' + layout.bounds.w + ' ' + layout.bounds.h,
                style: { left: layout.bounds.x, top: layout.bounds.y },
              },
              edges,
            ),
            cards,
          ),
          /* 连边时的橡皮筋线：屏幕坐标系，盖在场景之上 */
          h(
            'svg',
            { className: 'sn-linklayer', ref: linkOverlayRef },
            h('path', {
              ref: linkPathRef,
              className: 'sn-linkline',
              fill: 'none',
              stroke: 'rgba(190,128,35,.9)',
              strokeWidth: 2,
              strokeDasharray: '6 4',
              strokeLinecap: 'round',
            }),
          ),
          h(
            'div',
            { className: 'sn-legend' },
            h('div', null, h('i', { style: { borderTop: '1px solid rgba(96,74,46,.6)' } }), '从属'),
            h('div', null, h('i', { style: { borderTop: '1.5px dashed rgba(190,128,35,.8)' } }), '前置'),
            h('div', null, h('i', { style: { borderTop: '1.5px dotted rgba(32,150,130,.8)' } }), '关联'),
          ),
          h(
            'svg',
            { className: 'sn-mini', viewBox: '0 0 168 116' },
            dots,
            h('rect', {
              ref: miniRectRef,
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              fill: 'rgba(154,107,63,.10)',
              stroke: 'rgba(154,107,63,.55)',
              strokeWidth: 1,
              rx: 2,
            }),
          ),
        ),
        viewMode === 'outline'
          ? h(
              'div',
              {
                className: 'sn-outline',
                onClick: function (e) {
                  e.stopPropagation()
                },
              },
              h(
                'div',
                { className: 'sn-olinner' },
                outlineRows.map(function (row) {
                return h(
                  'div',
                  {
                    key: row.id,
                    className: 'sn-olrow',
                    'data-on': selectedId === row.id ? '1' : '0',
                    'data-lv': String(Math.min(row.level, 4)),
                    style: { paddingLeft: 6 + row.level * 16 + 'px' },
                    onClick: function () {
                      setSelectedId(row.id)
                    },
                  },
                  h('span', {
                    className: 'sn-olcaret',
                    'data-empty': row.kids ? '0' : '1',
                    'data-folded': row.folded ? '1' : '0',
                    onClick: function (e) {
                      e.stopPropagation()
                      if (row.kids) toggleFold(row.id)
                    },
                  }),
                  h('span', { className: 'sn-oltitle' }, row.title),
                  row.en ? h('span', { className: 'sn-olen' }, row.en) : null,
                  h('span', { className: 'sn-olspacer' }),
                  h('span', { className: 'sn-oldot', 'data-m': String(row.mastery), title: ['未读', '模糊', '掌握'][row.mastery] || '' }),
                )
              }),
                ),
            )
          : null,
        review
          ? (function () {
              var total = review.queue.length
              var done = review.i >= total
              var cur = done ? null : nodesById.get(review.queue[review.i]) || {}
              var field = function (label, text, mono) {
                if (!text) return null
                var html = renderMath ? renderMath(text, !!mono) : null
                return h(
                  'div',
                  { style: { marginTop: 9 } },
                  h('div', { className: 'sn-label' }, label),
                  html
                    ? h('div', { dangerouslySetInnerHTML: { __html: html } })
                    : h('div', { style: { whiteSpace: 'pre-wrap' } }, text),
                )
              }
              return h(
                'div',
                {
                  className: 'sn-review',
                  onMouseDown: function (e) {
                    if (e.target === e.currentTarget) closeReview()
                  },
                },
                h(
                  'div',
                  {
                    className: 'sn-rvcard',
                    role: 'dialog',
                    'data-open': '1',
                    'aria-modal': 'true',
                    'aria-label': '复习',
                    style: { transform: 'translate(' + rvPos.x + 'px,' + rvPos.y + 'px)' },
                  },
                  h(
                    'div',
                    { className: 'sn-rvhead', onPointerDown: startReviewDrag },
                    h('span', null, total ? (done ? '复习完成' : '复习 ' + (review.i + 1) + ' / ' + total) : '复习'),
                    review.scopeId
                      ? h(
                          'span',
                          { className: 'sn-rvscope' },
                          '只复习「' + ((nodesById.get(review.scopeId) || {}).title || '这一支') + '」',
                        )
                      : null,
                    h(
                      'span',
                      {
                        'data-rvclose': '1',
                        style: { marginLeft: 'auto', cursor: 'pointer', opacity: 0.7 },
                        onClick: closeReview,
                      },
                      'Esc 退出',
                    ),
                  ),
                  done
                    ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'sn-rvtitle' },
                          total ? '这一轮过完了' : '还没有可复习的概念',
                        ),
                        h(
                          'div',
                          { className: 'sn-rvbody' },
                          total
                            ? '掌握度已经写回文件。模糊的和没读过的会排在前头，所以下一轮会不一样。'
                            : '复习只收「写了正文」的概念：给概念卡写点定义或例子，它就会进队列。只有标题的章、主题不算。',
                        ),
                        h(
                          'div',
                          { className: 'sn-rvacts' },
                          total
                            ? (function () {
                                var weak = review.queue.filter(function (id) {
                                  return review.graded[id] === 0 || review.graded[id] === 1
                                })
                                return weak.length
                                  ? h(
                                      'button',
                                      { className: 'sn-rvbtn', 'data-main': '1', onClick: reviewAgainWeak },
                                      '再来一遍刚才模糊的 ' + weak.length + ' 个',
                                    )
                                  : null
                              })()
                            : null,
                          total ? h('button', { className: 'sn-rvbtn', 'data-main': '1', onClick: function () { startReview(review.scopeId) } }, '再来一轮') : null,
                          h('button', { className: 'sn-rvbtn', onClick: closeReview }, '回去看图'),
                        ),
                      )
                    : h(
                        'div',
                        null,
                        h('div', { className: 'sn-rvtitle' }, cur.title || ''),
                        cur.en ? h('div', { className: 'sn-rven' }, cur.en) : null,
                        review.shown
                          ? h(
                              'div',
                              { className: 'sn-rvbody' },
                              field('定义', cur.definition, false) ||
                                field('直觉', cur.intuition, false) ||
                                h('div', { style: { opacity: 0.6 } }, '这个概念还没有正文。'),
                              field('形式化', cur.formal, true),
                              field('例子', cur.examples, false),
                              field('易错点', cur.pitfalls, false),
                            )
                          : h(
                              'div',
                              { className: 'sn-rvbody', style: { opacity: 0.72 } },
                              cur.summary || '先在心里回想一遍，再翻面看正文。',
                            ),
                        h(
                          'div',
                          { className: 'sn-rvacts' },
                          review.shown
                            ? [
                                h('button', { key: 'a', className: 'sn-rvbtn', onClick: function () { gradeReview(0) } }, '没印象'),
                                h('button', { key: 'b', className: 'sn-rvbtn', onClick: function () { gradeReview(1) } }, '有点模糊'),
                                h('button', { key: 'c', className: 'sn-rvbtn', 'data-main': '1', onClick: function () { gradeReview(2) } }, '会了'),
                              ]
                            : h(
                                'button',
                                {
                                  className: 'sn-rvbtn',
                                  'data-main': '1',
                                  onClick: function () {
                                    setReview({ queue: review.queue, i: review.i, shown: true })
                                  },
                                },
                                '显示答案',
                              ),
                        ),
                      ),
                ),
              )
            })()
          : null,
        h('aside', { className: 'sn-sidebar', 'data-collapsed': collapsed ? '1' : '0' }, collapsed ? null : h('div', { className: 'sn-side' }, sideContent)),
      ),
      searchOpen
        ? h(
            'div',
            {
              className: 'sn-searchwrap',
              onMouseDown: function (event) {
                if (event.target === event.currentTarget) setSearchOpen(false)
              },
            },
            h(
              'div',
              { className: 'sn-search' },
              h('input', {
                ref: searchInputRef,
                value: searchQuery,
                placeholder: '搜索概念、定义里的词，或一个公式…',
                spellCheck: false,
                onChange: function (event) {
                  setSearchQuery(event.target.value)
                },
                onKeyDown: function (event) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setSearchCursor(function (c) {
                      return results.length ? Math.min(c + 1, results.length - 1) : 0
                    })
                  } else if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setSearchCursor(function (c) {
                      return Math.max(c - 1, 0)
                    })
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    var hit = results[searchCursor]
                    if (hit) goTo(hit.node.id)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setSearchOpen(false)
                  }
                },
              }),
              results.length
                ? h(
                    'div',
                    { className: 'sn-search-list' },
                    results.map(function (item, index) {
                      return h(
                        'div',
                        {
                          key: item.node.id,
                          className: 'sn-search-row',
                          'data-on': index === searchCursor ? '1' : '0',
                          onMouseEnter: function () {
                            setSearchCursor(index)
                          },
                          onClick: function () {
                            goTo(item.node.id)
                          },
                        },
                        h('div', { className: 'sn-search-t' }, item.title || '（未命名）'),
                        h('div', { className: 'sn-search-p' }, item.path),
                      )
                    }),
                  )
                : h(
                    'div',
                    { className: 'sn-search-empty' },
                    String(searchQuery || '').trim() ? '没有匹配的概念' : '输入概念名、定义里的词，或一个公式',
                  ),
            ),
          )
        : null,
      pendingDelete
        ? (function () {
            var victim = nodesById.get(pendingDelete.id) || {}
            var isRootNode = !victim.parent || (layout && victim.id === layout.root.id)
            return h(
              'div',
              { className: 'sn-searchwrap' },
              h(
                'div',
                { className: 'sn-dialog', role: 'dialog',
                    'data-open': '1', 'aria-modal': 'true', 'aria-label': '删除确认' },
                h('h4', null, '删除「' + (victim.title || '这个概念') + '」'),
                h(
                  'p',
                  null,
                  isRootNode
                    ? '它是这张图的根，删掉就是连整棵树一起删。'
                    : '它下面还有 ' + pendingDelete.count + ' 个子概念。一起删掉，还是只删它、把子概念上提到它的父级？',
                ),
                h(
                  'div',
                  { className: 'sn-dlg-acts' },
                  h(
                    'button',
                    {
                      className: 'sn-dbtn',
                      onClick: function () {
                        setPendingDelete(null)
                      },
                    },
                    '取消',
                  ),
                  isRootNode
                    ? null
                    : h(
                        'button',
                        {
                          className: 'sn-dbtn',
                          onClick: function () {
                            var id = pendingDelete.id
                            setPendingDelete(null)
                            doDelete(id, false)
                          },
                        },
                        '只删它，子概念上提',
                      ),
                  h(
                    'button',
                    {
                      className: 'sn-dbtn',
                      'data-danger': '1',
                      onClick: function () {
                        var id = pendingDelete.id
                        setPendingDelete(null)
                        doDelete(id, true)
                      },
                    },
                    '一起删掉',
                  ),
                ),
              ),
            )
          })()
        : null,
      settingsOpen
        ? h(
            'div',
            {
              className: 'sn-searchwrap',
              onClick: function () {
                setSettingsOpen(false)
              },
            },
            h(
              'div',
              {
                className: 'sn-dialog sn-setdlg',
                role: 'dialog',
                    'data-open': '1',
                'aria-modal': 'true',
                'aria-label': '纸与字',
                onClick: function (e) {
                  e.stopPropagation()
                },
              },
              h('h4', null, '纸与字'),
              h('div', { className: 'sn-setrow' }, h('span', { className: 'sn-setlabel' }, '纸')),
              h(
                'div',
                { className: 'sn-setopts' },
                [
                  ['cream', '米黄'],
                  ['grey', '灰白'],
                  ['green', '淡绿'],
                ].map(function (pair) {
                  return h(
                    'button',
                    {
                      key: pair[0],
                      className: 'sn-chip',
                      'data-on': appear.paper === pair[0] ? '1' : '0',
                      onClick: function () {
                        setAppear({ paper: pair[0], font: appear.font, size: appear.size, tone: appear.tone })
                      },
                    },
                    pair[1],
                  )
                }),
                h('span', { className: 'sn-sethint' }, props.theme === 'dark' ? '（夜光纸下不用选）' : ''),
              ),
              h('div', { className: 'sn-setrow' }, h('span', { className: 'sn-setlabel' }, '字')),
              h(
                'div',
                { className: 'sn-setopts' },
                [
                  ['kai', '楷体'],
                  ['song', '宋体'],
                  ['hei', '黑体'],
                ].map(function (pair) {
                  return h(
                    'button',
                    {
                      key: pair[0],
                      className: 'sn-chip',
                      'data-on': appear.font === pair[0] ? '1' : '0',
                      onClick: function () {
                        setAppear({ paper: appear.paper, font: pair[0], size: appear.size, tone: appear.tone })
                      },
                    },
                    pair[1],
                  )
                }),
              ),
              h('div', { className: 'sn-setrow' }, h('span', { className: 'sn-setlabel' }, '字号')),
              h(
                'div',
                { className: 'sn-setopts' },
                [
                  ['s', '小'],
                  ['m', '中'],
                  ['l', '大'],
                ].map(function (pair) {
                  return h(
                    'button',
                    {
                      key: pair[0],
                      className: 'sn-chip',
                      'data-on': appear.size === pair[0] ? '1' : '0',
                      onClick: function () {
                        setAppear({ paper: appear.paper, font: appear.font, size: pair[0], tone: appear.tone })
                      },
                    },
                    pair[1],
                  )
                }),
              ),
              h('div', { className: 'sn-setrow' }, h('span', { className: 'sn-setlabel' }, '深浅')),
              h(
                'div',
                { className: 'sn-setopts' },
                h('input', {
                  className: 'sn-setrange',
                  type: 'range',
                  min: -2,
                  max: 2,
                  step: 1,
                  value: appear.tone,
                  onChange: function (e) {
                    setAppear({
                      paper: appear.paper,
                      font: appear.font,
                      size: appear.size,
                      tone: Number(e.target.value),
                    })
                  },
                }),
                h('span', { className: 'sn-sethint' }, appear.tone === 0 ? '原样' : appear.tone > 0 ? '深一些' : '浅一些'),
              ),
              h(
                'div',
                { className: 'sn-dlg-acts' },
                h(
                  'button',
                  {
                    className: 'sn-dbtn',
                    onClick: function () {
                      setAppear(APPEARANCE_DEFAULT)
                    },
                  },
                  '恢复默认',
                ),
                h(
                  'button',
                  {
                    className: 'sn-dbtn',
                    'data-primary': '1',
                    onClick: function () {
                      setSettingsOpen(false)
                    },
                  },
                  '好了',
                ),
              ),
            ),
          )
        : null,
      importOpen
        ? h(
            'div',
            {
              className: 'sn-searchwrap',
              onClick: function () {
                setImportOpen(false)
              },
            },
            h(
              'div',
              {
                className: 'sn-dialog sn-impdlg',
                role: 'dialog',
                    'data-open': '1',
                'aria-modal': 'true',
                'aria-label': '怎么把 PDF 变成图',
                onClick: function (e) {
                  e.stopPropagation()
                },
              },
              h('h4', null, '怎么把 PDF 变成图'),
              h(
                'p',
                null,
                '插件自己不读 PDF：它只认 .mindmap.json。真正干活的是 DSH 里的对话——由它调本机的 OCR 和模型，把讲义拆成概念，然后直接写进这个库目录。',
              ),
              h('p', { className: 'sn-implabel' }, '① 先切回聊天（按 ⌘\\ 收起面板），把 PDF 拖进对话'),
              h('p', { className: 'sn-implabel' }, '② 把下面这句话发给它'),
              h(
                'pre',
                { className: 'sn-impcode' },
                '用析域把这份讲义做成概念图：先列章节清单给我确认，再逐章生成，最后写进库目录。',
              ),
              h('p', { className: 'sn-implabel' }, '③ 回来刷新（切走再切回面板，或按 ↻）'),
              h('p', { className: 'sn-implabel' }, '库目录'),
              h('pre', { className: 'sn-impcode sn-impdir' }, props.dir),
              h(
                'div',
                { className: 'sn-dlg-acts' },
                h(
                  'button',
                  {
                    className: 'sn-dbtn',
                    onClick: function () {
                      var text = '用析域把这份讲义做成概念图：先列章节清单给我确认，再逐章生成，最后写进库目录 ' + props.dir + '。'
                      var done = function () {
                        setCopied('已复制')
                        window.setTimeout(function () {
                          setCopied('')
                        }, 1600)
                      }
                      if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(text).then(done, function () {
                          setCopied('复制失败，请手选')
                        })
                      } else {
                        setCopied('请手动复制')
                      }
                    },
                  },
                  copied || '复制这句话',
                ),
                h(
                  'button',
                  {
                    className: 'sn-dbtn',
                    'data-primary': '1',
                    onClick: function () {
                      setImportOpen(false)
                    },
                  },
                  '知道了',
                ),
              ),
            ),
          )
        : null,
    )
  }

  return {
    MindMap: MindMap,
    buildLayout: buildLayout,
    fitFor: fitFor,
    createMathRenderer: createMathRenderer,
    sortReviewPool: sortReviewPool,
  }
}
