# Synapsis / 析域

把一本讲义，铺成一张能走进去的概念图。

一个内核，两个壳：

| 壳 | 谁生成 | 数据 |
| --- | --- | --- |
| **网站**（`web/` + `server/`） | 你自己的模型（OpenAI 兼容接口，默认 DeepSeek） | 直接写进图库目录 |
| **DSH 插件**（`plugin/`） | 我（DSH 里的助手） | 读同一个图库目录 |

两边共用同一套渲染内核 `core/synapsis-core.js` 和同一种文件格式 `*.mindmap.json`，
所以网站里生成的图，在 DSH 插件刷新后就能看见，反之亦然。

## 跑起来

### 方式一：本机直接跑（最快）

```powershell
cd "E:\dsh工作空间\杂物\创造？！\synapsis"
node server/serve.mjs
# 打开 http://127.0.0.1:7788
```

图库默认是 `E:\dsh工作空间\析域`，可用环境变量改：

```powershell
$env:SYNAPSIS_DATA="D:\我的图库"; node server/serve.mjs
```

### 方式二：Docker

```powershell
docker compose up --build -d
# 打开 http://127.0.0.1:7788
```

`docker-compose.yml` 把 `E:/dsh工作空间/析域` 挂到容器里的 `/data`，
端口只绑 `127.0.0.1`，局域网里其他机器看不到（朋友要看图，导出 `.mindmap.json` 发给他们）。

## 第一次使用

1. 点左下角 **设置**，填接口地址、模型名、API Key。默认是 DeepSeek：
   - 接口地址 `https://api.deepseek.com/v1`
   - 模型 `deepseek-chat`
   - Key 存在浏览器 localStorage，**只从本机转到本机服务，不经过任何第三方**
2. 把 PDF 讲义拖进框里（扫描件不行，需要文字层），或者直接粘贴讲义正文。
3. 看一眼自动切出来的章节，点「开始长图」。
4. 概念会一圈一圈从中心长出来；中途可以「停止」，已生成的会存下。
5. 点任意概念 → 右侧看定义／形式化／直觉／例子／易错点／原文出处；
   双击概念 → 以它为主根推近，成为一个新导图；缩小或点面包屑 → 退回上一层。

## 没有 API Key 也想看看效果

```powershell
node tools/mock-llm.mjs                       # 终端 A：假模型，端口 7800
node server/serve.mjs                         # 终端 B
# 浏览器打开 http://127.0.0.1:7788/?demo=1
```

它会用一段假的离散数学讲义跑完整条链路（切章 → 流式生成 → 落盘）。
这条路必须用**本机 node** 跑 `serve.mjs`：容器里的 `127.0.0.1:7800` 指向容器自己，够不到假模型。

## 文件格式

```jsonc
{
  "version": 1,
  "title": "离散数学",
  "nodes": [
    {
      "id": "powerset",          // 全局唯一，任何子图引用的都是同一个节点
      "title": "幂集",
      "en": "Power set",
      "parent": "subset",        // 树上的位置；null 表示根
      "summary": "所有子集组成的集合",
      "definition": "...",
      "formal": "P(A) = \\{X \\mid X \\subseteq A\\}",
      "intuition": "...",
      "examples": "...",
      "pitfalls": "...",
      "source": { "page": 5, "snippet": "原文原句" },
      "mastery": 0,              // 0 不懂 / 1 模糊 / 2 掌握
      "note": "我的笔记"
    }
  ],
  "edges": [
    { "from": "subset", "to": "powerset", "kind": "prereq" }  // prereq | related | contrast
  ]
}
```

写文件时文件里存的边字段名是 `type`（`{"from","to","type"}`），
模型输出时用 `kind` 区分「边」和「节点」两种行，合并时统一成 `type`。

## 目录

```
core/synapsis-core.js   渲染内核（布局、相机、侧栏、小地图），无模块语法，两个壳都能吃
web/                    网站（index.html / app.js / style.css / vendor: react, katex, pdfjs）
server/serve.mjs        静态服务 + /api/llm 代理 + /api/library 读写
plugin/                 DSH 插件（Host 路由 + 打包后的 client.js）
tools/build-plugin.mjs  把内核 + 面板拼成 plugin/client.js
tools/mock-llm.mjs      假模型，离线验收用
tools/shot.mjs          headless Edge 截图（CDP），开发时肉眼验收用
tools/extract-images.mjs  从扫描版 PDF 里按字节抠出整页 JPEG
tools/ocr.ps1           Windows.Media.Ocr 逐页识别（纯 ASCII 脚本，路径走参数）
tools/ocr-join.mjs      合并 OCR 结果、去汉字间空格、插入「===== 第 N 页 =====」标记
tools/merge-chapters.mjs  把各章 JSON 缝成一张图，写进库目录
plugin/assets/katex/    插件自带的 KaTeX（js/css/fonts），走 Host 路由 /synapsis-api/katex/*
web/dev-panel.html      联调页：在浏览器里直接跑真插件面板（伪造 __ModuleLoader__ 与 ctx）
```

## 快捷键（两个壳一样）

| 按键 | 作用 |
| --- | --- |
| 滚轮 | 以光标为锚缩放；放大到一层放不下时自动「进」到最近的分支，缩小则退回上一层 |
| 拖拽空白处 | 平移画布 |
| 单击节点 | 选中，右侧看概念卡 |
| 双击节点 | 以它为主根重排，把它放大成新的中心 |
| `Ctrl/⌘ + K` | 搜索全部概念（标题、摘要、正文、笔记） |
| `Tab` | 给选中节点加一个子概念 |
| `Enter` | 加一个同级概念 |
| `F2` / 双击侧栏标题 | 改名 |
| `Delete` | 删概念（有子概念时会问：一起删，还是把子概念上提） |
| `Esc` | 关搜索 / 取消改名 / 取消选中 |

编辑在两个壳里都能用（网站和插件用的是同一份内核）；改完 0.6 秒自动存回 `.mindmap.json`，
写之前会把上一版备份成 `.mindmap.json.bak`。

## 学习路径

选中概念 → 侧栏「学习路径」：

- **到它为止**：沿 `prereq` 边取前置闭包，做拓扑排序，给出"从最底层走到它"的顺序（有环时把能排的排在前，并注明）。
- **A → B**：在 `prereq` 边上 BFS，给出从任意起点到它的最短必经链；不连通时直说"没有一条前置链连着"。

打开时画布会铺开整张图、把链上卡片框进视野并描金边，其余边让路，关掉就回到原来的聚焦视图。
`recommend`（软前置）也参与排序，但只作为顺序参考。

## 公式

网站的 KaTeX 从 `web/vendor/katex/` 加载；插件的 KaTeX 从插件自己的 Host 路由加载
（`/synapsis-api/katex/*`），所以插件不依赖网站是否在跑，也不需要宿主提供任何包。
两个壳共用内核里的同一个 `createMathRenderer(katex)`：`$$…$$`、`$…$`、`\(…\)`、`\[…\]`
都是公式，`formal` 字段整段无定界符时也按公式渲染；没有公式时返回 `null`，正文照旧当纯文本。

## 扫描版讲义怎么进图

那本《离散数学（第六版）》是纯扫描件（每页一张整页图，没有文字层），走的是离线管线，
不经过网站和模型 API，产出直接落进库目录，网站和 DSH 插件都能打开：

```powershell
node tools/extract-images.mjs "<讲义.pdf>" tmp/pages        # 273 张整页图
powershell -File tools/ocr.ps1 -Dir tmp/pages -Out tmp/text # 约 140 秒
node tools/ocr-join.mjs                                    # tmp/book.txt
# 按章切片到 tmp/ch/*.txt 后，让 agent 逐章产出 tmp/chapters/chNN.json
node tools/merge-chapters.mjs                              # 落进库目录，201 个节点
```

OCR 对公式基本无解（联结词、上下标、希腊字母会碎），所以流水线里概念正文由 agent
按教材原义重写，只有 `source.snippet` 保留 OCR 原文，页码来自页标记，可回查。

## 缩放为什么不会糊

`transform: scale()` 放大的若是已栅格化的位图就会糊。内核的做法是：
场景层**不加** `will-change`（加了就会把整棵树提升成合成层，缩放时只拉伸位图），
只在手势进行中的 160ms 内挂 `data-moving="1"` 打开 `will-change`，手一停就摘掉；
文字始终以矢量重新排版，所以放到多大都是清晰的。

另外滚轮不是无限放大：每一层都按「设计字号」钉住（`fit.k * 1.8` 为上限），
再往上滚就**走进最近的子分支**（焦点换根、布局重排成以它为中心的新图），
缩小到 `fit.k * 0.5` 就退回上一层。这样既满足"点开子分支＝在原图上缩放进去"，
又保证任何时刻卡片都停在可读的尺寸上。

## 已知取舍

- 扫描版 PDF 需要先走上面的 OCR 管线；网站里直接拖入扫描件会得到空文本。
- 长讲义按章切块逐章生成，章与章之间的跨章引用暂时靠模型自己发现；缝合优化在计划里。
- 示意图、图片字段先留空，v1 不做。
- 公式靠 KaTeX（网站已内置，含字体）；DSH 插件里暂以纯文本显示公式，待接入同一个 KaTeX。
- 容器里的 `web/`、`core/` 是构建快照，改了源码要 `docker compose up -d --build` 才生效。
