# Synapsis · 析域

一个给 [DeepSeek Harness](https://github.com/deepseek-ai) Web UI 用的**概念地图**插件。

不是把思维导图搬进聊天窗口，而是给知识一张可以走进去的地图：滚轮往前推，子分支就长成新的主分支；
缩回去，它又退回原来那一层。每个概念是一张卡片，带着定义、形式化（LaTeX）、直觉、例子、易错点，
以及它需要的前置概念和它引出的概念。

## 它长什么样

侧栏点「析域」→ 整页面板打开一张图：

- **滚动即进入**：以光标为锚缩放，每层钉在可读字号上，再往前推就走进最近的子分支（它成为新的主图根），
  缩小到一半退回上一层。不会开新窗口，也不会糊成一团像素。
- **每层都是同一张图**：布局按当前焦点重排成完整圆周，所以任何子分支展开后都像一张独立的导图。
- **卡片分层**：焦点是全卡（标题＋摘要＋定义），子级是标题＋摘要，再远只留标题，更远收成一个点。
- **侧栏概念卡**：定义 / 形式化 / 直觉 / 例子 / 易错点 / 原文出处 / 前置 / 引出 / 掌握度 / 个人笔记。
- **关系边**：从属是实线，前置是琥珀虚线，关联是青绿点线，对比是玫红双线。
- **面包屑 + 小地图**：知道自己在哪儿，也知道整张图有多大。
- **搜索（⌘K / Ctrl+K）**：输概念名、定义里的词、甚至一个公式的写法，回车就直接跳到那里——它会重新成为主图根。
- **就地编辑**：`Tab` 加子概念、`Enter` 加同级、`F2` 改名、`Delete` 删除（有子概念时会问「一起删掉」还是「把子概念上提」），
  改完 0.6 秒自动写回文件，写前把上一版留成 `.bak`。`⌘Z` / `Ctrl+Z` 撤销，连续打字会合并成一步。
- **连边**：按住 `Shift` 从一张卡拖到另一张卡，松手就建一条关系边（默认 `prereq`）。
  同一对概念再拖一次是 `related`，第三次是 `contrast`，第四次就把它删掉——一条边只有这三种类型，循环即切换。
  反向拖则把方向改过来并重置为 `prereq`；父子之间不建关系边（从属关系已经由树表达了）。
- **改边 / 删边**：直接点那条线就选中它——线会亮起来，顶部出现一条小工具条：
  「A → B」加三个类型按钮（前置 / 关联 / 对比）和「删掉这条线」。换类型或删除都会立刻落盘，也能 `⌘Z` 撤销；
  按 `Delete` 删的是这条线，`Esc` 或点空白处取消选中。从属线（父子实线）不可选，它由树结构决定。
- **学习路径**：选中一个概念，点「学习路径」，右侧按硬前置把「要学会它之前得先会的概念」排成一条有序的链
  （无环时就是拓扑序）；点「A → B」则给一条从任意起点走到它的最短必经链。打开时整张图会铺开、链上的卡片描金边，
  旁边的线全部让路，所以你看得见自己在整本书的哪一段上。
- **两套纸**：浅色是米黄纸，暗色是「夜间纸」，都带纸纹。顶栏那个「夜光纸 / 日光纸」按钮可以就地换，
  换了会记住（下一次打开还是这套纸）；第一次装好时跟着宿主的明暗走。
- **换图和删图**：顶栏最左边是图库下拉，切换即换一张图（自动重新取景）；旁边的「删除」要连点两下
  （第一下只是举枪，4 秒不点就放下），删掉的文件不会真的消失，会被挪到库目录的 `.trash/` 里。

## 安装

**仓库根目录就是插件包**：`package.json` 里带 `dsh.bundle.patch`，`engines.dsh` 声明兼容的 DSH 版本。
三种标准装法任选其一。装完刷新宿主页面（或重启 DSH），侧栏会出现「析域」图标。

**1. 从 GitHub 装（推荐，无需任何构建）**

```sh
dsh plugin --profile desktop add github:Mathilde1214/dsh-synapsis
```

本包是纯 JavaScript，`client.js` 等产物随仓库一起提交，因此不需要 `prepare` 构建，
也不会要求你为它开启 pnpm 的 `allowBuilds` 授权。

**2. 从 tarball 装（离线 / 内网）**

```sh
pnpm pack            # 在仓库根目录执行，得到 dsh-synapsis-0.11.0.tgz
dsh plugin --profile desktop add ./dsh-synapsis-0.11.0.tgz
```

**3. 在 DSH 里用面板装本地目录**

```
plugin_manager: install_bundle, target = <这个目录的绝对路径>
```

**卸载**

```sh
dsh plugin --profile desktop remove dsh-synapsis
```

**兼容性**：`engines.dsh` 是 `>=0.2.2-rc.1 <0.3.0`。DSH 在安装和启动 profile 时都会校验它，
不满足会直接拒绝并说明原因。要在更老或更新的 DSH 上跑，改这一段再装即可——
面板只用到 `slots` 与 `webServer` 两个稳定扩展点。

**从插件索引装**：仓库里带了 `plugin-market/index.json`（DSH 的**自定义插件索引**格式），
在 DSH 的「插件 → 发现 → 添加索引源」里填这个文件的 https URL，就能像应用商店一样浏览和安装：

```
https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/plugin-market/index.json
```

## 数据放哪

默认读 `E:\dsh工作空间\析域`（Windows 路径），可用环境变量 `SYNAPSIS_DATA` 覆盖。
目录里每一份图是一个 `*.mindmap.json`：

```json
{
  "version": 1,
  "title": "离散数学（第六版）",
  "nodes": [
    { "id": "ch3", "title": "集合", "parent": "root", "summary": "…",
      "definition": "…", "formal": "B \\subseteq A \\iff \\forall x(x \\in B \\to x \\in A)",
      "intuition": "…", "examples": "…", "pitfalls": "…",
      "source": { "page": 71, "snippet": "原文摘句" },
      "mastery": 0, "note": "" }
  ],
  "edges": [ { "from": "ch3-set", "to": "ch3-subset", "type": "prereq" } ]
}
```

`parent` 是分类归属（树），`edges` 是跨分支的关系（网）；`type` 可以是 `prereq` / `related` / `contrast`。
反链不存，打开时现算。布局也不持久化——它由焦点和节点数算出来。

## 公式

插件自带 KaTeX（`assets/katex/`，含字体），由 Host 半边的 `/synapsis-api/katex/*` 路由提供，
不依赖网络，也不依赖宿主提供任何包。`$$…$$`、`$…$`、`\(…\)`、`\[…\]` 都认；
`formal` 字段如果整段没有定界符，也按公式渲染。

## 目录

仓库根目录就是插件包，构建源与开发工具都在同一个仓库里：

```
package.json        bundle 清单：dsh.bundle.patch / engines.dsh / dsh.client / files
index.js            Host 半边：图库读写路由（/synapsis-api/list|load|save|delete）+ KaTeX 静态资源
client-body.js      面板组件源码（图库切换、保存防抖、KaTeX 就绪等待）
client.js           构建产物：内核 + client-body 拼成的客户端包，安装时用的就是它
core/synapsis-core.js  渲染内核（布局、相机、LOD、连边、撤销），被 build 拼进 client.js
assets/katex/       自带的 KaTeX js/css/字体
locale/{zh,en}.json 插件元信息
cordis.patch.yml    装进 DSH 的 patch 片段
plugin-market/      插件索引（format 1），供 DSH 的「发现」页读取
tools/build-plugin.mjs  构建：core + client-body → client.js
tools/dev-server.mjs    开发用本地服务（图库 API + 联调页），不进 npm 包
tools/dev-panel/        联调页：在浏览器里跑真实 client.js
tools/ocr*.mjs|ps1、extract-images.mjs、merge-chapters.mjs  讲义 → 概念图的离线流水线
```

`client.js` 是生成文件，**不要手改**：改 `core/synapsis-core.js` 或 `client-body.js`，然后

```sh
npm run build     # = node tools/build-plugin.mjs
npm run dev       # = node tools/dev-server.mjs，然后开 http://127.0.0.1:7788/
```

`files` 只列运行时需要的文件，所以 `core/`、`tools/` 不会进 npm 包——装到别人机器上的只有产物。

## 已知边界

- 面板占据宿主主面板，和聊天视图互斥，只能来回切。
- 关系边默认只显示从属边，跨分支边在焦点附近才浮现——否则几百个节点会缠成毛线。
- 交互目前是阅读向的：选中、推近、缩回、标掌握度、记笔记、改名/增删节点、Shift 连边、点线改类型或删边、⌘Z 撤销都做了；
  概念卡正文（定义 / 形式化 / 直觉 / 例子 / 易错点）还只能读不能改，拖拽改父、多选、导出也还没做。
