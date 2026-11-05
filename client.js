/* Synapsis · 析域 —— DSH 插件客户端（由 tools/build-plugin.mjs 生成，勿手改） */
window.__ModuleLoader__.load({
  id: 'dsh-synapsis',
  factory(require) {
    const React = require('react')
    const h = React.createElement

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
    for (i = 0; i < nodes.length; i++) {
      var item = nodes[i]
      var node = byId.get(item.id)
      var parent = item.parent ? byId.get(item.parent) : null
      if (parent && parent !== node) parent.children.push(node)
      else if (!root) root = node
    }
    if (forced) root = forced
    if (!root) return null

    var order = []
    var walk = function (n, depth) {
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
      var geometric = i === 0 ? 0 : radius[i - 1] + RING * Math.pow(INV, i - 1)
      var needed = counts[i] ? (counts[i] * w * 1.18) / (2 * Math.PI) : 0
      radius[i] = Math.max(geometric, needed)
    }

    root.x = 0
    root.y = 0
    var place = function (n, a0, a1) {
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
    '.sn-root{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:0;overflow:hidden;',
    'background:var(--dsw-alias-bg-base,#f4efe3);color:var(--dsw-alias-label-primary,#2f2a24);',
    "font-family:'KaiTi','STKaiti','Kaiti SC','Songti SC',serif;}",
    '.sn-topbar{position:relative;z-index:6;display:flex;align-items:center;gap:10px;flex:none;height:42px;padding:0 12px;',
    'border-bottom:1px solid var(--dsw-alias-border-l1,rgba(90,75,55,.18));',
    'background:var(--dsw-alias-bg-layer-1,rgba(255,253,246,.9));}',
    '.sn-crumbs{display:flex;align-items:center;gap:2px;min-width:0;overflow:hidden;flex:1;}',
    '.sn-leading{display:flex;align-items:center;gap:6px;flex:none;max-width:40%;}',
    '.sn-libsel{font:inherit;font-size:12.5px;max-width:180px;padding:3px 6px;border-radius:6px;',
    'border:1px solid rgba(120,100,70,.28);background:transparent;color:inherit;cursor:pointer;}',
    '.sn-libsel:focus{outline:none;border-color:rgba(120,88,52,.6);}',
    '.sn-libsel option{background:var(--dsw-alias-bg-layer-2,#fbf7ec);color:var(--dsw-alias-label-primary,#2f2a24);}',
    '.sn-crumb{font:inherit;font-size:13px;line-height:1;padding:5px 7px;border-radius:6px;border:0;background:transparent;',
    'color:var(--dsw-alias-label-secondary,#7a6a56);cursor:pointer;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis;}',
    '.sn-crumb[data-on="1"]{color:var(--dsw-alias-label-primary,#2f2a24);font-weight:700;}',
    '.sn-sep{color:var(--dsw-alias-label-tertiary,#a2957f);font-size:11px;flex:none;}',
    '.sn-status{font-size:11px;color:var(--dsw-alias-label-tertiary,#a2957f);white-space:nowrap;flex:none;}',
    '.sn-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;',
    'border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary,#7a6a56);cursor:pointer;flex:none;}',
    '.sn-body{position:relative;display:flex;flex:1;min-height:0;}',
    '.sn-canvas{position:relative;flex:1;min-width:0;overflow:hidden;cursor:grab;touch-action:none;',
    'background-image:radial-gradient(circle at 1px 1px, rgba(120,100,70,.16) 1px, transparent 0);background-size:26px 26px;}',
    '.sn-canvas[data-dragging="1"]{cursor:grabbing;}',
    '.sn-canvas:before{content:"";position:absolute;inset:0;pointer-events:none;',
    'background:radial-gradient(120% 90% at 50% 45%, transparent 42%, rgba(96,78,52,.10) 100%);}',
    '.sn-scene{position:absolute;left:0;top:0;transform-origin:0 0;}',
    '.sn-scene[data-moving="1"]{will-change:transform;}',
    '.sn-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none;}',
    '.sn-linklayer{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;overflow:visible;}',
    '.sn-root[data-linking="1"] .sn-card{transition:box-shadow .12s ease;}',
    '.sn-root[data-linking="1"] .sn-card:hover{box-shadow:0 0 0 2px rgba(190,128,35,.75);}',
    '.sn-card{position:absolute;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;justify-content:center;gap:2px;overflow:hidden;',
    'background:#fffdf6;color:#2f2a24;border:1px solid rgba(86,68,45,.24);',
    'box-shadow:0 1px 0 rgba(255,255,255,.7) inset, 0 2px 6px rgba(70,55,35,.10);',
    'transition:box-shadow .16s ease, background-color .16s ease, border-color .16s ease;}',
    '.sn-card[data-sel="1"]{border-color:#9a6b3f;box-shadow:0 0 0 2px rgba(154,107,63,.24), 0 4px 14px rgba(70,55,35,.18);}',
    '.sn-card[data-focus="1"]{background:#fffaf0;border-color:rgba(120,88,52,.5);}',
    '.sn-card[data-dim="1"]{opacity:.55;}',
    '.sn-card[data-dot="1"]{border-radius:50%;background:#bfad90;border-color:rgba(86,68,45,.28);}',
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
    'border-left:1px solid var(--dsw-alias-border-l1,rgba(90,75,55,.18));background:var(--dsw-alias-bg-layer-1,#fbf7ec);overflow:hidden;}',
    '.sn-sidebar[data-collapsed="1"]{width:0;border-left:0;}',
    '.sn-side{display:flex;flex-direction:column;min-height:0;height:100%;overflow-y:auto;padding:16px 16px 40px;}',
    '.sn-side-head{display:flex;align-items:flex-start;gap:8px;}',
    '.sn-side-title{font-size:21px;font-weight:700;line-height:1.25;flex:1;min-width:0;}',
    '.sn-side-en{font-size:12px;font-style:italic;opacity:.55;margin-top:2px;}',
    '.sn-field{margin-top:14px;}',
    '.sn-label{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#a2957f);',
    'margin-bottom:4px;display:flex;align-items:center;gap:6px;}',
    '.sn-label:after{content:"";flex:1;height:1px;background:rgba(120,100,70,.16);}',
    '.sn-text{font-size:13.5px;line-height:1.72;white-space:pre-wrap;word-break:break-word;}',
    '.sn-math{font-family:ui-serif,Georgia,"Times New Roman",serif;font-size:14px;line-height:1.7;',
    'background:rgba(120,100,70,.07);border-radius:6px;padding:6px 9px;white-space:pre-wrap;word-break:break-word;}',
    '.sn-rel{display:flex;flex-wrap:wrap;gap:5px;}',
    '.sn-chip{display:inline-flex;align-items:center;gap:4px;font:inherit;font-size:12px;line-height:1;padding:4px 8px;',
    'border-radius:999px;cursor:pointer;border:1px solid rgba(120,100,70,.26);background:#fffdf6;color:#4a4034;',
    'max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.sn-chip[data-t="prereq"]{border-color:rgba(178,120,32,.45);color:#8a5a10;background:rgba(214,163,74,.12);}',
    '.sn-chip[data-t="related"]{border-color:rgba(32,138,120,.4);color:#10695b;background:rgba(52,168,148,.12);}',
    '.sn-chip[data-t="contrast"]{border-color:rgba(180,60,96,.4);color:#8c2145;background:rgba(200,70,110,.10);}',
    '.sn-mut{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#a2957f);}',
    '.sn-note{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;font:inherit;font-size:13px;line-height:1.6;',
    'padding:8px 9px;border-radius:8px;border:1px dashed rgba(120,100,70,.34);background:rgba(255,253,246,.75);color:inherit;}',
    '.sn-note:focus{outline:none;border-color:rgba(120,88,52,.6);background:#fffdf6;}',
    '.sn-mastery{display:flex;gap:6px;}',
    '.sn-mbtn{flex:1;font:inherit;font-size:12px;padding:6px 0;border-radius:7px;cursor:pointer;',
    'border:1px solid rgba(120,100,70,.24);background:transparent;color:var(--dsw-alias-label-secondary,#7a6a56);}',
    '.sn-mbtn[data-on="1"]{background:rgba(120,88,52,.14);border-color:rgba(120,88,52,.5);color:#3a2f22;font-weight:700;}',
    '.sn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:100%;',
    'color:var(--dsw-alias-label-tertiary,#a2957f);font-size:13px;}',
    '.sn-mini{position:absolute;right:12px;bottom:12px;z-index:4;width:168px;height:116px;border-radius:8px;',
    'background:rgba(255,253,246,.86);border:1px solid rgba(120,100,70,.24);box-shadow:0 2px 10px rgba(70,55,35,.12);overflow:hidden;pointer-events:none;}',
    '.sn-legend{position:absolute;left:12px;bottom:12px;z-index:4;display:flex;flex-direction:column;gap:3px;',
    'font-size:11px;color:var(--dsw-alias-label-tertiary,#a2957f);pointer-events:none;}',
    '.sn-legend i{display:inline-block;width:16px;height:0;margin-right:6px;vertical-align:middle;}',
    '.sn-pathlist{list-style:none;margin:10px 0 0;padding:0;}',
    '.sn-pathstep{display:flex;gap:8px;align-items:flex-start;padding:7px 8px;border-radius:7px;cursor:pointer;}',
    '.sn-pathstep[data-on="1"]{background:rgba(154,107,63,.14);}',
    '.sn-pathnum{flex:none;width:20px;height:20px;border-radius:50%;border:1px solid rgba(154,107,63,.5);color:#9a6b3f;',
    'font-size:11px;display:flex;align-items:center;justify-content:center;margin-top:2px;}',
    '.sn-pathstep[data-last="1"] .sn-pathnum{background:#9a6b3f;color:#fff;border-color:#9a6b3f;}',
    '.sn-pathtxt{display:flex;flex-direction:column;gap:2px;min-width:0;}',
    '.sn-pathtitle{font-size:13.5px;color:var(--dsw-alias-label-primary,#2f2a24);}',
    '.sn-pathsum{font-size:11.5px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a7a63);}',
    '.sn-pathsub{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a7a63);margin-top:4px;}',
    '.sn-card[data-path="1"]{box-shadow:0 0 0 2px rgba(154,107,63,.42),0 10px 20px -16px rgba(60,40,20,.7);}',
    '.sn-root[data-theme="dark"] .sn-pathtitle{color:#efe7d8;}',
    '.sn-root[data-theme="dark"] .sn-pathsum,.sn-root[data-theme="dark"] .sn-pathsub{color:#a89a84;}',
    '.sn-root[data-theme="dark"] .sn-pathnum{color:#e8c184;border-color:rgba(232,193,132,.5);}',
    '.sn-root[data-theme="dark"] .sn-pathstep[data-on="1"]{background:rgba(232,193,132,.16);}',
    '.sn-emptyfield{margin:.1em 0 .5em;padding:.5em .6em;border:1px dashed rgba(150,120,80,.35);border-radius:7px;color:rgba(90,72,48,.65);font-size:12.5px;line-height:1.5;}',
    '.sn-hint{position:absolute;left:12px;top:10px;z-index:4;font-size:11px;color:var(--dsw-alias-label-tertiary,#a2957f);',
    'background:rgba(255,253,246,.7);padding:3px 8px;border-radius:999px;pointer-events:none;}',
    '.sn-src{margin-top:8px;border-left:2px solid rgba(154,107,63,.45);padding-left:9px;font-size:12.5px;line-height:1.65;opacity:.82;}',
    '.sn-src-meta{font-size:11px;letter-spacing:.06em;opacity:.7;margin-bottom:3px;}',
    '.sn-live{position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:5;font-size:12px;',
    'background:rgba(255,253,246,.92);border:1px solid rgba(120,100,70,.24);border-radius:999px;padding:5px 12px;pointer-events:none;}',
    /* 搜索 */
    '.sn-searchbtn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 8px;border-radius:6px;flex:none;',
    'border:1px solid rgba(120,100,70,.24);background:transparent;color:var(--dsw-alias-label-secondary,#7a6a56);font:inherit;font-size:12px;cursor:pointer;}',
    '.sn-searchbtn kbd{font:inherit;font-size:10.5px;opacity:.62;}',
    '.sn-searchwrap{position:absolute;inset:0;z-index:30;display:flex;justify-content:center;align-items:flex-start;',
    'padding:56px 16px 16px;background:rgba(30,24,18,.22);}',
    '.sn-search{width:100%;max-width:560px;border-radius:12px;overflow:hidden;',
    'border:1px solid rgba(120,100,70,.3);background:var(--dsw-alias-bg-layer-2,#fbf7ec);box-shadow:0 12px 40px rgba(60,45,28,.28);}',
    '.sn-search input{display:block;width:100%;border:0;outline:0;background:transparent;color:inherit;',
    'font:inherit;font-size:15px;padding:13px 15px;}',
    '.sn-search-list{max-height:44vh;overflow:auto;border-top:1px solid rgba(120,100,70,.18);}',
    '.sn-search-row{display:flex;flex-direction:column;gap:1px;padding:8px 15px;cursor:pointer;}',
    '.sn-search-row[data-on="1"]{background:rgba(154,107,63,.14);}',
    '.sn-search-t{font-size:13.5px;line-height:1.35;}',
    '.sn-search-p{font-size:11px;opacity:.58;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sn-search-empty{padding:13px 15px;font-size:12.5px;opacity:.55;}',
    /* 编辑 */
    '.sn-title-input{flex:1;min-width:0;font:inherit;font-size:21px;font-weight:700;line-height:1.25;padding:1px 6px;',
    'border-radius:5px;border:1px solid rgba(154,107,63,.5);background:rgba(255,255,255,.35);color:inherit;outline:none;}',
    '.sn-dialog{width:100%;max-width:420px;border-radius:12px;padding:18px 20px 16px;',
    'border:1px solid rgba(120,100,70,.3);background:var(--dsw-alias-bg-layer-2,#fbf7ec);box-shadow:0 12px 40px rgba(60,45,28,.28);}',
    '.sn-dialog h4{margin:0 0 6px;font-size:15px;font-weight:700;}',
    '.sn-dialog p{margin:0 0 14px;font-size:12.5px;line-height:1.7;opacity:.72;}',
    '.sn-dlg-acts{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;}',
    '.sn-dbtn{font:inherit;font-size:12.5px;padding:6px 11px;border-radius:7px;cursor:pointer;',
    'border:1px solid rgba(120,100,70,.3);background:transparent;color:inherit;}',
    '.sn-dbtn[data-danger="1"]{border-color:rgba(186,64,104,.55);color:#b03a5b;}',
    /* dark */
    /* 悬停效果只在真有指针的设备上生效（触屏上 :hover 会「粘住」） */
    '@media (hover: hover){',
      '.sn-crumb:hover{background:rgba(120,100,70,.1);color:var(--dsw-alias-label-primary,#2f2a24);}',
      '.sn-iconbtn:hover{background:rgba(120,100,70,.12);color:var(--dsw-alias-label-primary,#2f2a24);}',
      '.sn-card:hover{border-color:rgba(86,68,45,.42);box-shadow:0 3px 12px rgba(70,55,35,.18);}',
      '.sn-chip:hover{border-color:rgba(120,88,52,.55);}',
      '.sn-pathstep:hover{background:rgba(154,107,63,.08);}',
      '.sn-root[data-theme="dark"] .sn-pathstep:hover{background:rgba(232,193,132,.1);}',
      '.sn-searchbtn:hover{background:rgba(120,100,70,.1);color:var(--dsw-alias-label-primary,#2f2a24);}',
      '.sn-dbtn:hover{background:rgba(120,100,70,.12);}',
      '.sn-dbtn[data-danger="1"]:hover{background:rgba(186,64,104,.14);}',
    '}',

    /* 键盘焦点必须看得见（鼠标点击不触发，避免满屏描边） */
    '.sn-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#9a6b3f);outline-offset:2px;}',
    '.sn-root .sn-card:focus-visible{outline-offset:3px;}',

    /* 系统开了「减弱动态效果」就关掉推镜与过渡 */
    '@media (prefers-reduced-motion: reduce){',
    '.sn-root *{transition:none!important;animation:none!important;}',
    '}',
    'body[data-ds-dark-theme] .sn-root,.sn-root[data-theme="dark"]{background:#1c1a17;color:#e8e1d4;}',
    'body[data-ds-dark-theme] .sn-topbar,.sn-root[data-theme="dark"] .sn-topbar{background:rgba(28,26,23,.92);border-color:rgba(200,180,150,.16);}',
    'body[data-ds-dark-theme] .sn-canvas,.sn-root[data-theme="dark"] .sn-canvas{background-image:radial-gradient(circle at 1px 1px, rgba(210,190,160,.14) 1px, transparent 0);}',
    'body[data-ds-dark-theme] .sn-card,.sn-root[data-theme="dark"] .sn-card{background:#2a2621;color:#efe7d8;border-color:rgba(210,190,160,.22);box-shadow:0 2px 8px rgba(0,0,0,.35);}',
    'body[data-ds-dark-theme] .sn-card[data-focus="1"],.sn-root[data-theme="dark"] .sn-card[data-focus="1"]{background:#332d26;border-color:rgba(210,175,120,.5);}',
    'body[data-ds-dark-theme] .sn-card[data-dot="1"],.sn-root[data-theme="dark"] .sn-card[data-dot="1"]{background:#6d6152;}',
    'body[data-ds-dark-theme] .sn-sidebar,.sn-root[data-theme="dark"] .sn-sidebar{background:#201d19;border-color:rgba(200,180,150,.16);}',
    'body[data-ds-dark-theme] .sn-chip,.sn-root[data-theme="dark"] .sn-chip{background:#2a2621;color:#ddd3c2;border-color:rgba(210,190,160,.24);}',
    'body[data-ds-dark-theme] .sn-note,.sn-root[data-theme="dark"] .sn-note{background:rgba(42,38,33,.8);border-color:rgba(210,190,160,.3);}',
    'body[data-ds-dark-theme] .sn-mini,.sn-root[data-theme="dark"] .sn-mini{background:rgba(32,29,25,.9);border-color:rgba(200,180,150,.22);}',
    'body[data-ds-dark-theme] .sn-hint,.sn-root[data-theme="dark"] .sn-hint{background:rgba(32,29,25,.8);}',
    'body[data-ds-dark-theme] .sn-live,.sn-root[data-theme="dark"] .sn-live{background:rgba(32,29,25,.95);border-color:rgba(200,180,150,.24);}',
    'body[data-ds-dark-theme] .sn-search,.sn-root[data-theme="dark"] .sn-search{background:#252119;border-color:rgba(200,180,150,.24);}',
    'body[data-ds-dark-theme] .sn-search-list,.sn-root[data-theme="dark"] .sn-search-list{border-color:rgba(200,180,150,.18);}',
    'body[data-ds-dark-theme] .sn-search-row[data-on="1"],.sn-root[data-theme="dark"] .sn-search-row[data-on="1"]{background:rgba(201,155,98,.2);}',
    'body[data-ds-dark-theme] .sn-dialog,.sn-root[data-theme="dark"] .sn-dialog{background:#252119;border-color:rgba(200,180,150,.24);}',
    'body[data-ds-dark-theme] .sn-title-input,.sn-root[data-theme="dark"] .sn-title-input{background:rgba(255,255,255,.06);border-color:rgba(201,155,98,.55);}',
    /* 学习路径：夜里也要一眼看见（金边 + 外发光），无关的卡片和线退到很暗 */
    'body[data-ds-dark-theme] .sn-root:not([data-theme="light"]) .sn-card[data-path="1"],.sn-root[data-theme="dark"] .sn-card[data-path="1"]{border-color:rgba(240,200,130,.95);background:#3a3128;color:#fdf6e8;box-shadow:0 0 0 2px rgba(240,200,130,.9),0 0 26px rgba(240,200,130,.34);}',
    'body[data-ds-dark-theme] .sn-root:not([data-theme="light"]) .sn-card[data-dim="1"],.sn-root[data-theme="dark"] .sn-card[data-dim="1"]{opacity:.3;}',
    /* 日光纸：宿主是暗色时也能强行回到纸色（特异性高于上面的 dark 规则） */
    'body[data-ds-dark-theme] .sn-root[data-theme="light"]{background:#f4efe3;color:#2f2a24;}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-topbar{background:rgba(251,247,236,.92);border-color:rgba(120,100,70,.18);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-canvas{background-image:radial-gradient(circle at 1px 1px, rgba(120,100,70,.16) 1px, transparent 0);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-card{background:#fffdf6;color:#2f2a24;border-color:rgba(86,68,45,.24);box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 2px 6px rgba(70,55,35,.10);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-card[data-focus="1"]{background:#fffaf0;border-color:rgba(120,88,52,.5);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-card[data-dot="1"]{background:#bfad90;border-color:rgba(86,68,45,.28);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-sidebar{background:#fbf7ec;border-color:rgba(120,100,70,.18);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-chip{background:#fffdf6;color:#5c4d3c;border-color:rgba(86,68,45,.28);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-note{background:rgba(255,255,255,.62);border-color:rgba(86,68,45,.26);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-mini{background:rgba(251,247,236,.9);border-color:rgba(86,68,45,.22);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-hint{background:rgba(251,247,236,.8);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-live{background:rgba(251,247,236,.95);border-color:rgba(120,100,70,.24);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-search{background:#fffdf7;border-color:rgba(86,68,45,.3);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-search-list{border-color:rgba(86,68,45,.2);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-search-row[data-on="1"]{background:rgba(214,163,74,.18);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-dialog{background:#fffdf7;border-color:rgba(86,68,45,.3);}',
    'body[data-ds-dark-theme] .sn-root[data-theme="light"] .sn-title-input{background:rgba(0,0,0,.04);border-color:rgba(154,107,63,.55);}',
  ].join('')

  /* ---------------------------------------------------------------- */
  /* small pieces                                                      */
  /* ---------------------------------------------------------------- */

  function Field(props) {
    if (!props.text) return null
    var html = props.render ? props.render(props.text, !!props.mono) : null
    var cls = props.mono ? 'sn-math' : 'sn-text'
    return h(
      'div',
      { className: 'sn-field' },
      h('div', { className: 'sn-label' }, props.label),
      html
        ? h('div', { className: cls, dangerouslySetInnerHTML: { __html: html } })
        : h('div', { className: cls }, props.text),
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

    /* Shift 拖拽连边：linking 只用来切提示文案，橡皮筋线走命令式更新 */
    var linkState = useState(null)
    var linking = linkState[0]
    var setLinking = linkState[1]
    var linkFromRef = useRef('')
    var linkPathRef = useRef(null)
    var linkOverlayRef = useRef(null)
    var historyRef = useRef([])
    var lastLabelRef = useRef('')

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
      if (el && rect && layout) {
        var b = layout.bounds
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
    }, [layout])

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
        var t = fitFor(layout, next || layout.root.id, el.clientWidth || 1, el.clientHeight || 1)
        camRef.current = {
          x: (el.clientWidth || 1) / 2 - t.cx * t.k,
          y: (el.clientHeight || 1) / 2 - t.cy * t.k,
          k: t.k,
        }
        applyCamera()
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
      if (!el || el.clientWidth < 640 || el.clientHeight < 380) return
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
        if (!initDoneRef.current && el.clientWidth >= 640 && el.clientHeight >= 380 && layout) {
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

    useEffect(function () {
      var onKey = function (event) {
        var key = String(event.key || '').toLowerCase()
        if ((event.metaKey || event.ctrlKey) && key === 'k') {
          event.preventDefault()
          setSearchQuery('')
          setSearchCursor(0)
          setSearchOpen(true)
          return
        }
        if ((event.metaKey || event.ctrlKey) && key === 'z') {
          event.preventDefault()
          undo()
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
          if (selectedId) setSelectedId('')
          return
        }
        var tag = event.target && event.target.tagName ? String(event.target.tagName).toUpperCase() : ''
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return
        if (!selectedId || !editable) return
        if (event.key === 'Tab') {
          event.preventDefault()
          addChild(selectedId)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          addSibling(selectedId)
        } else if (event.key === 'F2') {
          event.preventDefault()
          var cur = nodesById.get(selectedId)
          if (cur) setEditing({ id: cur.id, draft: cur.title || '' })
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          var kids = childCount(selectedId)
          if (kids > 0) {
            event.preventDefault()
            setPendingDelete({ id: selectedId, count: kids })
          } else {
            event.preventDefault()
            doDelete(selectedId, true)
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return function () {
        window.removeEventListener('keydown', onKey)
      }
    }, [addChild, addSibling, childCount, doDelete, editable, editing, nodesById, pendingDelete, searchOpen, selectedId, undo])

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
        var seen = {}
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
        var indeg = {}
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
      var prevMap = {}
      var q = [from]
      var seen2 = {}
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
      var next = {
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
      }
      props.onChange(next)
    }, [data, editable, props, pushHistory])

    /* ---------------- 编辑：加节点 / 改名 / 删节点 ---------------- */

    /* 撤销栈：只留下「提交之前」的样子；label 用来合并连续同类操作（比如一直敲笔记） */
    var pushHistory = useCallback(function (label) {
      if (!editable || !data) return
      var stack = historyRef.current
      var snap = { nodes: data.nodes, edges: data.edges || [], label: label || 'edit' }
      var merge = stack.length && label && label.indexOf(':') > 0 && stack[stack.length - 1].label === label
      if (merge) stack[stack.length - 1] = snap
      else {
        stack.push(snap)
        if (stack.length > 80) stack.shift()
      }
      lastLabelRef.current = snap.label
    }, [data, editable])

    var commitData = useCallback(function (nextNodes, nextEdges, label) {
      if (!editable || !data) return
      if (label !== 'undo') pushHistory(label || 'edit')
      props.onChange({
        version: data.version,
        id: data.id,
        title: data.title,
        subtitle: data.subtitle,
        updated: new Date().toISOString(),
        nodes: nextNodes,
        edges: nextEdges || data.edges || [],
      })
    }, [data, editable, props, pushHistory])

    var undo = useCallback(function () {
      var stack = historyRef.current
      if (!stack.length) return
      var snap = stack.pop()
      commitData(snap.nodes, snap.edges, 'undo')
    }, [commitData])

    var childCount = useCallback(function (id) {
      var n = 0
      for (var i = 0; i < (data ? data.nodes.length : 0); i++) if (data.nodes[i].parent === id) n++
      return n
    }, [data])

    var commitRename = useCallback(function (id, title) {
      var t = String(title == null ? '' : title).trim()
      if (!t) return
      updateNode(id, { title: t }, 'title:' + id)
    }, [updateNode])

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
      while (stack.length) {
        var cur = stack.pop()
        for (var i = 0; i < data.nodes.length; i++) {
          if (data.nodes[i].parent === cur) {
            out.push(data.nodes[i].id)
            stack.push(data.nodes[i].id)
          }
        }
      }
      return out
    }, [data])

    /* cascade=true：连同子树一起删；false：只删这个点，子概念上提到它的父级 */
    var doDelete = useCallback(function (id, cascade) {
      var victim = nodesById.get(id)
      if (!victim || !layout) return
      var gone = cascade ? [id].concat(collectDescendants(id)) : [id]
      var goneSet = {}
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

    useEffect(function () {
      if (!linking) return
      var onMove = function (event) {
        drawLink(event.clientX, event.clientY)
      }
      var onUp = function (event) {
        var fromId = linkFromRef.current
        linkFromRef.current = ''
        setLinking(null)
        var node = document.elementFromPoint(event.clientX, event.clientY)
        var card = node && node.closest ? node.closest('.sn-card') : null
        var toId = card ? card.getAttribute('data-id') : ''
        if (toId && toId !== fromId) linkEdge(fromId, toId)
      }
      var onCancel = function () {
        linkFromRef.current = ''
        setLinking(null)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      return function () {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
    }, [drawLink, linkEdge, linking])

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
              onPointerDown: function (id) {
                return function (event) {
                  if (!event.shiftKey || !editable) return
                  event.stopPropagation()
                  event.preventDefault()
                  beginLink(id, event)
                }
              }(node.id),
              onClick: function (id) {
                return function (event) {
                  event.stopPropagation()
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
          edges.push(
            h('path', {
              key: 'r-' + edge.from + '-' + edge.to,
              d: pathBetween(a, b),
              fill: 'none',
              stroke: color + (active ? '0.9)' : onPath ? '0.88)' : '0.28)'),
              strokeWidth: active || onPath ? 2.4 : 1.4,
              strokeDasharray: edge.type === 'contrast' ? '7 4' : '5 4',
              strokeLinecap: 'round',
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
      blocks.push(h(Field, { key: 'd', label: '定义', text: selected.definition, render: renderMath }))
      blocks.push(h(Field, { key: 'f', label: '形式化', text: selected.formal, mono: true, render: renderMath }))
      blocks.push(h(Field, { key: 'i', label: '直觉', text: selected.intuition, render: renderMath }))
      blocks.push(h(Field, { key: 'e', label: '例子', text: selected.examples, render: renderMath }))
      blocks.push(h(Field, { key: 'p', label: '易错点', text: selected.pitfalls, render: renderMath }))
      if (!selected.definition && !selected.formal && !selected.intuition && !selected.examples && !selected.pitfalls) {
        blocks.push(
          h(
            'div',
            { key: 'empty', className: 'sn-emptyfield' },
            selected.children && selected.children.length
              ? '这一层是分支，没有正文。往下点一个子概念看细节。'
              : '这个概念还没有正文。按 F2 改名，或按 Tab 在它下面加子概念。',
          ),
        )
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

    if (!layout) {
      return h('div', { className: 'sn-root', 'data-theme': props.theme }, h('style', null, CSS), h('div', { className: 'sn-empty' }, props.emptyText || '还没有内容'))
    }

    return h(
      'div',
      { className: 'sn-root', 'data-theme': props.theme, 'data-linking': linking ? '1' : '0' },
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
            onClick: openSearch,
            title: '搜索概念（Ctrl/⌘ + K）',
          },
          h('span', null, '搜索'),
          h('kbd', null, '⌘K'),
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
            },
          },
          h(
          'div',
          { className: 'sn-hint' },
          linking
            ? '拖到另一个概念上松开：连一条关系（同向再连一次换类型，第三次取消）'
            : editable
              ? '滚轮缩放 · 拖拽平移 · 双击进入 · Tab 新建 · F2 改名 · Del 删除 · Shift 拖拽连边 · ⌘Z 撤销'
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
        ? h(
            'div',
            { className: 'sn-searchwrap' },
            h(
              'div',
              { className: 'sn-dialog' },
              h('h4', null, '删除「' + ((nodesById.get(pendingDelete.id) || {}).title || '这个概念') + '」'),
              h('p', null, '它下面还有 ' + pendingDelete.count + ' 个子概念。一起删掉，还是只删它、把子概念上提到它的父级？'),
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
                h(
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
        : null,
    )
  }

  return { MindMap: MindMap, buildLayout: buildLayout, fitFor: fitFor, createMathRenderer: createMathRenderer }
}


    const comp = createMindMap(React)

/* 运行在 __ModuleLoader__ 工厂作用域内：React / h / comp 已就绪 */
const MindMap = comp.MindMap
const hh = h

/* KaTeX 由插件自己的 Host 路由喂进来（宿主模块表里没有它），脚本到位后置位 */
function useKatexReady() {
  const [ready, setReady] = React.useState(() => !!window.katex)
  React.useEffect(() => {
    if (ready) return undefined
    const on = () => setReady(!!window.katex)
    window.addEventListener('synapsis:katex', on)
    const timer = setTimeout(() => setReady(!!window.katex), 1500)
    return () => {
      window.removeEventListener('synapsis:katex', on)
      clearTimeout(timer)
    }
  }, [ready])
  return ready
}

async function jget(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  if (!res.ok) throw new Error((parsed && parsed.error) || 'HTTP ' + res.status)
  return parsed
}

function hostDark() {
  const body = document.body
  if (!body) return false
  if (body.hasAttribute('data-ds-dark-theme')) return true
  if (body.classList.contains('dark') || body.classList.contains('theme-dark')) return true
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

function Panel() {
  const [files, setFiles] = React.useState([])
  const [name, setName] = React.useState('')
  const [doc, setDoc] = React.useState(null)
  const [status, setStatus] = React.useState('读取图库…')
  const [error, setError] = React.useState('')
  const [armDelete, setArmDelete] = React.useState(false)
  const [darkHost, setDarkHost] = React.useState(hostDark)
  const [themeMode, setThemeMode] = React.useState(() => {
    try {
      return localStorage.getItem('synapsis.theme') || 'auto'
    } catch {
      return 'auto'
    }
  })
  const theme = themeMode === 'auto' ? (darkHost ? 'dark' : 'light') : themeMode
  const toggleTheme = React.useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    try {
      localStorage.setItem('synapsis.theme', next)
    } catch {}
  }, [theme])

  /* 宿主切日光/夜间时，auto 模式要跟着变 */
  React.useEffect(() => {
    const sync = () => setDarkHost(hostDark())
    const obs = new MutationObserver(sync)
    if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => obs.disconnect()
  }, [])

  /* 删除要连点两下：第一下只是「举枪」，4 秒内不点就自动放下 */
  React.useEffect(() => {
    if (!armDelete) return undefined
    const timer = setTimeout(() => setArmDelete(false), 4000)
    return () => clearTimeout(timer)
  }, [armDelete])
  const katexReady = useKatexReady()
  const renderMath = React.useMemo(
    () => (katexReady && window.katex ? comp.createMathRenderer(window.katex) : null),
    [katexReady],
  )
  const nameRef = React.useRef('')
  const timerRef = React.useRef(0)
  const docRef = React.useRef(null)

  nameRef.current = name
  docRef.current = doc

  const openNamed = React.useCallback(async (pick) => {
    setStatus('读取中…')
    setError('')
    try {
      const list = await jget('/synapsis-api/list')
      const items = (list && list.items) || []
      setFiles(items)
      const next = pick || nameRef.current || (items[0] && items[0].name) || ''
      if (next && items.some((item) => item.name === next)) {
        const loaded = await jget('/synapsis-api/load?name=' + encodeURIComponent(next))
        setName(next)
        setDoc(loaded)
      } else {
        setName('')
        setDoc(null)
      }
      setStatus('')
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
      setStatus('')
    }
  }, [])

  React.useEffect(() => {
    openNamed('')
  }, [openNamed])

  React.useEffect(() => {
    const onFocus = () => {
      if (!docRef.current) return
      jget('/synapsis-api/list').then((list) => {
        if (list && list.items) setFiles(list.items)
      }).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const save = React.useCallback(async () => {
    const current = docRef.current
    const target = nameRef.current
    if (!current || !target) return
    try {
      await fetch('/synapsis-api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: target, data: current }),
      })
      setStatus('已保存')
    } catch (err) {
      setStatus('保存失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [])

  const onChange = React.useCallback(
    (next) => {
      setDoc(next)
      docRef.current = next
      setStatus('保存中…')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(save, 600)
    },
    [save],
  )

  React.useEffect(() => () => clearTimeout(timerRef.current), [])

  const removeMap = React.useCallback(async () => {
    const target = nameRef.current
    if (!target) return
    setArmDelete(false)
    setStatus('删除中…')
    try {
      const res = await fetch('/synapsis-api/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: target }),
      })
      if (!res.ok) {
        const text = await res.text()
        let parsed = null
        try {
          parsed = JSON.parse(text)
        } catch {}
        throw new Error((parsed && parsed.error) || 'HTTP ' + res.status)
      }
      setName('')
      setDoc(null)
      docRef.current = null
      await openNamed('')
      setStatus('已删除')
    } catch (err) {
      setStatus('删除失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [openNamed])

  /* 每份图记住自己停在哪一层：换回来的时候直接回到那一层（hook 必须放在早退之前） */
  const initialFocus = React.useMemo(() => {
    try {
      return localStorage.getItem('synapsis.view.' + name) || ''
    } catch {
      return ''
    }
  }, [name])
  const onFocusChange = React.useCallback(
    (id) => {
      try {
        if (name) localStorage.setItem('synapsis.view.' + name, id || '')
      } catch {}
    },
    [name],
  )

  if (error) {
    return hh(
      'div',
      { style: { padding: '28px 24px', font: 'inherit', lineHeight: 1.7 } },
      hh('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, '读不到图库'),
      hh('div', { style: { opacity: 0.7, fontSize: 13 } }, error),
      hh(
        'button',
        { style: { marginTop: 12, font: 'inherit', fontSize: 13, padding: '6px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
        '重试',
      ),
    )
  }

  if (!doc) {
    return hh(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexDirection: 'column',
          gap: 10,
          fontSize: 13.5,
          opacity: 0.75,
        },
      },
      hh('div', { style: { fontSize: 22, letterSpacing: '0.2em' } }, '析域'),
      hh('div', null, status || '还没有图。用 Synapsis 网站把讲义生成出来，这里会自动出现。'),
      hh(
        'button',
        { style: { font: 'inherit', fontSize: 12.5, padding: '5px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
        '重新读取',
      ),
    )
  }

  const titleCount = {}
  files.forEach((file) => {
    titleCount[file.title] = (titleCount[file.title] || 0) + 1
  })

  const leading = hh(
    React.Fragment,
    null,
    hh(
      'select',
      {
        className: 'sn-libsel',
        value: name,
        onChange: (event) => openNamed(event.target.value),
        title: '切换图',
      },
      files.map((file) =>
        hh(
          'option',
          { key: file.name, value: file.name },
          titleCount[file.title] > 1 ? file.title + ' · ' + file.name.replace(/\.mindmap\.json$/, '') : file.title,
        ),
      ),
    ),
    hh(
      'button',
      {
        className: 'sn-iconbtn',
        title: '从磁盘重新读取',
        onClick: () => openNamed(name),
        style: { width: 22, height: 22, fontSize: 13 },
      },
      '↻',
    ),
    hh(
      'button',
      {
        className: 'sn-chip',
        title: armDelete ? '再点一次就真的删了（会挪进库目录的 .trash）' : '删除这份图',
        onClick: () => (armDelete ? removeMap() : setArmDelete(true)),
        style: armDelete ? { color: '#b0413a', borderColor: 'rgba(176,65,58,.6)' } : { opacity: 0.7 },
      },
      armDelete ? '确认删除「' + (doc.title || name) + '」' : '删除',
    ),
  )

  return hh(MindMap, {
    key: name,
    data: doc,
    leading,
    theme,
    onToggleTheme: toggleTheme,
    initialFocusId: initialFocus,
    onFocusChange,
    renderMath,
    statusText: status,
    onChange,
  })
}


    function PanelIcon(props) {
      const size = (props && props.size) || 20
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
      },
        h('circle', { cx: 12, cy: 12, r: 3.2 }),
        h('circle', { cx: 12, cy: 2.6, r: 1.5, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 12, cy: 21.4, r: 1.5, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 2.6, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 21.4, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M12 5.8v3.2M12 15v3.2M5.8 12h3.2M15 12h3.2' }),
      )
    }

    function PanelHost() {
      return h('div', { style: { width: '100%', height: '100%', display: 'flex', minHeight: 0 } }, h(Panel))
    }

    return {
      name: 'dsh-synapsis',
      inject: ['slots'],
      apply(ctx) {
        /* 公式资源：插件自带 KaTeX，从自己的路由加载，卸载时一起摘掉 */
        ctx.effect(() => {
          const head = document.head
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = '/synapsis-api/katex/katex.min.css'
          link.setAttribute('data-synapsis-katex', '1')
          head.appendChild(link)
          const announce = () => window.dispatchEvent(new Event('synapsis:katex'))
          let script = null
          if (window.katex) {
            announce()
          } else {
            script = document.createElement('script')
            script.src = '/synapsis-api/katex/katex.min.js'
            script.async = true
            script.setAttribute('data-synapsis-katex', '1')
            script.addEventListener('load', announce)
            head.appendChild(script)
          }
          return () => {
            link.remove()
            if (script) script.remove()
          }
        })
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'dsh-synapsis', order: 30, label: '析域' }, PanelIcon),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'dsh-synapsis' }, PanelHost),
        )
      },
    }
  },
})
