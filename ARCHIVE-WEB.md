# 网站分支（已归档，不再维护）

这个分支保存 Synapsis 早期的「独立网站」形态，仅作历史留档。主线（`main`）已经收窄成
**一个纯 DSH 插件**：仓库根目录即插件包。

## 这个分支里有什么

| 路径 | 用途 |
| --- | --- |
| `web/app.js` | 网站前端主逻辑：拖 PDF / 切章 / 流式生成 / 图库 |
| `web/index.html`、`web/style.css` | 网站骨架与纸色主题 |
| `web/dev-panel.html` | 插件面板的**联调页**（伪造 `__ModuleLoader__` 与 ctx），后来搬到了 main 的 `tools/dev-panel/` |
| `server/serve.mjs` | 本地小服务：静态文件 + `/api/library` 图库读写 + `/api/llm` OpenAI 兼容代理（流式） |
| `Dockerfile`、`docker-compose.yml`、`.dockerignore` | 容器化（挂载 `E:/dsh工作空间/析域`，只绑 127.0.0.1） |
| `dev/root-package.json`、`dev/root-README.md` | 当时「工作区根目录」那份 package/README 的快照 |
| `dev/synapsis-core.snapshot.js` | 归档时渲染内核的快照（内核本身仍在 main 的 `core/` 里继续演进） |

## 缺的东西

`web/vendor/`（React 18 UMD、pdf.js 4.10、KaTeX）没有进仓库——都是可以从 npm 或 CDN 重新拉取的公开产物。
归档时它们的版本是：react 18.3.1、pdfjs-dist 4.10.38、katex 0.16（字体 20 个 woff2）。

要复活网站，基本步骤：

1. 把 `web/vendor/` 那三个包按上面版本补回来；
2. `node server/serve.mjs`（默认 7788，库目录 `E:\dsh工作空间\析域`，可用 `SYNAPSIS_DATA` 覆盖）；
3. 前端把 `core/synapsis-core.js` 指向仓库里的当前版本（它现在按 `createMindMap(React)` 工厂导出，接口没变）。

## 为什么放弃这条线

网站那条线的价值是「用你自己的 key、在自己的浏览器里把讲义变成图」。实际用下来：

- 生成质量的天花板在「切章策略 + 提示词」，跟放在哪个壳里无关；
- 扫描版讲义还得先走 OCR 三步脚本，网站的「拖进去就行」并不成立；
- 真正天天要打开的是**看图和复习**，那正是 DSH 面板的形状。

所以内容生产留在 `tools/`（抠图、OCR、分章、合并），消费端收窄成插件。
