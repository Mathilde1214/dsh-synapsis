# Synapsis

English · [中文](README.md)

A concept-map plugin for [DeepSeek Harness](https://github.com/deepseek-ai) desktop (technically a DSH web-platform plugin, so it also runs under `dsh web`).

It spreads the concepts of a book into a map you can walk into. Scroll forward and a sub-branch grows into a map of its own; scroll back and it folds into the layer above. Each concept is a card: definition, formal statement, intuition, examples, pitfalls, plus what it needs first and what it leads to.

## Screenshots

![Overview: every chapter of a textbook](https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/docs/screenshots/overview.png)

*The overview layer. Ten chapters around the root, with topic dots further out.*

![Concept card in night paper](https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/docs/screenshots/concept-dark.png)

*Select a concept and the card opens on the right. Formulas are typeset with KaTeX; dark mode becomes "night paper".*

![Editing a field in place](https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/docs/screenshots/field-edit.png)

*Double-click any field to edit it. The formal field shows the LaTeX source with a live preview underneath.*

![Learning path](https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/docs/screenshots/learning-path.png)

*"What do I need before this?" — the hard prerequisites in order, gold-ringed, everything else dimmed.*

![Search](https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/docs/screenshots/search.png)

*⌘K searches titles, English names, body text and notes.*

![Relation edge selected](https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/docs/screenshots/edge.png)

*Click a relation line to select it; a small toolbar appears for changing its type or deleting it.*

## Using it

Click "析域" in the sidebar and the panel takes over the main area.

**Scroll to go in.** The wheel zooms around the cursor, and each layer is pinned to a readable size. Push further and you enter the nearest child, which becomes the new root. Zoom back by half and you return one layer up. No new window, and no blurry scaling.

**Every layer looks like its own map.** Changing focus re-lays out the graph as a full circle around the new root, so any sub-branch opens as a complete map rather than a wedge of its parent.

**Cards thin out with distance.** The focused card is full (title, summary, definition), children show title and summary, further out only a title, and beyond that a dot.

**The side panel** has five body fields, the source citation, prerequisites, what it leads to, a mastery marker and a personal note. Empty fields show "click here to write"; double-click starts editing, and the formal field gives you the LaTeX source with a live preview.

**Four kinds of line.** Solid for hierarchy, amber dashes for prerequisites, teal dots for related, rose double lines for contrast.

**Breadcrumbs and a minimap** tell you where you are and how big the whole map is.

**Search** looks at titles, English names, body text and notes. Enter jumps there: the concept centres itself and becomes the new root.

**Editing in place**: `Tab` adds a child, `Enter` adds a sibling, `F2` renames, `Delete` removes. Deleting a node with children asks whether to take the subtree or lift the children up. Changes are written back after 0.6s; switching maps, creating one, or deleting one flushes whatever is pending first, and a failed save blocks the switch instead of losing the edit. Before overwriting, the previous version goes into `.history/` — not a single `.bak`.

**Linking**: hold `Shift` and drag from one card to another to create a `prereq` edge. Dragging the same pair again turns it into `related`, then `contrast`, then removes it. Dragging the other way round flips the direction and resets it to `prereq`. Parent and child never get a relation edge — the tree already says that.

**Editing an edge**: click the line to select it. It lights up and a toolbar appears with "A → B" and the three types. Changing the type or deleting writes immediately, and `⌘Z` undoes it. `Delete` removes the line, `Esc` or a click on empty space deselects. Hierarchy lines can't be selected; the tree decides those.

**Learning path**: select a concept and click "学习路径" to get its hard prerequisites in order on the right — a topological order when there are no cycles. "A → B" gives the shortest chain from any starting concept. The camera pulls back so the whole chain fits, with the cards on it ringed in gold.

**Two papers**: light is cream paper, dark is night paper, both with a paper grain. The button in the top bar switches in place and remembers your choice; on first install it follows the host's light or dark theme. "设置" lets you pick the paper (cream / grey / pale green), the typeface (system / Kai / Song / Hei — system is the default because Kai is missing on many Linux boxes), the text size, and a tone slider that lightens or darkens the whole sheet.

**Switching and deleting maps**: the library dropdown sits at the far left of the top bar. Switching reloads and re-frames the map. Delete needs two clicks — the first arms it, four seconds without a second click disarms it. Deleted files aren't destroyed; they move into `.trash/` inside the library folder.

**History and recycle bin**: "历史" in the top bar lists this map's versions (one per save, plus a checkpoint every five minutes) and the recycle bin. "回到这一版" restores a version — your current content is snapshotted first, so you can come back. "放回来" pulls a deleted map out of the bin; if the name is taken it gets a `-2` instead of overwriting anything.

**Starting from nothing**: "+ 新建" next to the dropdown creates an empty map with a single root node. Press `Tab` to add concepts. Use it when you'd rather build the map by hand than generate it.

**Drag a card to re-parent it**: drag one card onto another and it moves under it. Dropping into its own descendants is refused, since that would cut the tree in two. Dragging empty space still pans.

**Export**: the top bar's "导出" gives you five choices. **PNG and SVG each come in "current layer" and "whole map"** — the layer is the branch you're looking at, the whole map starts from the root and fits all two hundred concepts into one file (a much bigger file). Pick SVG when you need detail: it stays sharp at any zoom. **Markdown exports the whole tree** as an indented outline, which suits pasting into a notes app.

**Outline view**: "大纲" swaps the canvas for a tree of the whole map, starting at its root regardless of where the canvas is focused. Click a row to select it (the side panel follows), double-click to jump the canvas there. The triangle folds a branch; the dot on the right is its mastery. With two hundred concepts this beats zooming around.

**Review**: "复习" picks a batch of concepts — title first, recall it, then flip to the definition, formal statement, examples and pitfalls, and grade yourself "没印象 / 有点模糊 / 会了". The grade schedules the next look: **missed comes back tomorrow, fuzzy in three days, known doubles the last interval (7 days minimum, 120 maximum)**. Due cards lead the queue and the header says how many are due. "明天再问" pushes a card to tomorrow without grading it. Fifteen per round, and only concepts that actually have body text are eligible. Select a chapter and use "复习这一支" in the sidebar to review just that branch; when a round ends you can replay only the ones you fumbled. Drag the card by its top strip if it covers the map.

### Keyboard

| Key | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | Search |
| Double-click a card | Enter that layer (it becomes the new root) |
| Double-click a side-panel field | Edit that field |
| `Tab` / `Enter` | Add child / add sibling |
| `F2` | Rename |
| `Delete` | Delete node (asks if it has children) or the selected edge |
| Drag a card | Re-parent it |
| `Shift` + drag | Create a relation edge |
| `⌘Z` / `Ctrl+Z` | Undo (consecutive typing collapses into one step) |
| `Esc` | Close search, editing, the delete prompt, the selected edge, the export menu — in that order |

## Install

The repository root is the plugin package: `package.json` carries `dsh.bundle.patch`, and `engines.dsh` declares the supported DSH range. Install, then reload the host page (`Ctrl/Cmd+R` on the desktop app).

**Desktop prerequisites** (this is where most people get stuck):

1. Launch the desktop app once so it initialises its profile;
2. Quit it completely (closing the window is not enough);
3. Use the CLI that ships with the app: `<install dir>/resources/runtime/cli/bin/dsh` (on Windows, `dsh.cmd`). A globally installed `dsh` from npm cannot modify the desktop profile.

Or skip the shell entirely and install from the app's "Plugins" page.

**From npm (recommended)**

```sh
dsh plugin --profile desktop add dsh-synapsis
```

**Updating**: `dsh plugin --profile desktop add dsh-synapsis@<version>`, or `remove` then `add`. Nothing is pinned, so you always get the latest. Updates only replace the code under `node_modules` — the maps in your library directory are never touched.

**From GitHub (alternative, no build step)**

```sh
dsh plugin --profile desktop add github:Mathilde1214/dsh-synapsis#<commit>
```

Pin the commit: without it, whatever the upstream pushes later gets silently swapped in when you reinstall. Pick a hash from the [commit list](https://github.com/Mathilde1214/dsh-synapsis/commits/main).

Everything is plain JavaScript and `client.js` is committed alongside the source, so there's no `prepare` script and nothing to approve in pnpm's `allowBuilds`.

**From a tarball (offline, air-gapped)**

```sh
pnpm pack            # run in the repository root; produces dsh-synapsis-<version>.tgz
dsh plugin --profile desktop add ./dsh-synapsis-<version>.tgz
```

**From a local directory (when you're changing the code)**

```sh
dsh plugin --profile desktop add /absolute/path/to/this/repo
```

You can also do it from the panel: `plugin_manager: install_bundle` with the directory's absolute path as target.

**Uninstall**

```sh
dsh plugin --profile desktop remove dsh-synapsis
```

**Compatibility**: `engines.dsh` is `>=0.2.0 <0.3.0`. DSH checks it both when installing and when starting a profile, and refuses with an explanation if it doesn't match. The panel uses the `slots`, `webServer`, `connection`, `tools` and `systemPrompt` extension points; once DSH 0.3 is out this range will be widened after testing, so you never have to edit it yourself.

**From the plugin index**: the repo ships `plugin-market/index.json` in DSH's custom-index format. Enable Custom plugin indexes under "Plugins → Experimental plugins" first, then add this URL under "Plugins → Discover → Add index source":

```
https://raw.githubusercontent.com/Mathilde1214/dsh-synapsis/main/plugin-market/index.json
```

## Security model

The plugin has no port of its own. It serves `/synapsis-api/*` on `127.0.0.1` through DSH's own web server, and every write (`/save`, `/create`, `/delete`) first goes through DSH's connection check: requests that don't come from the DSH page are rejected (`401`), the body must be `content-type: application/json` (otherwise `415`), and it's capped at 8 MB.

`/synapsis-api/katex/*` stays public — it's just static typesetting assets.

So: never expose the DSH port with `--host 0.0.0.0` or a port forward to the LAN. If you need remote access, put an authenticated reverse proxy in front of it.

## Upgrading won't touch your maps

Maps live in the library folder; the plugin lives in the DSH profile. `dsh plugin add`, `plugin_manager install_bundle`, and uninstall-then-reinstall all only replace the code copy under the profile. The library folder is never involved.

There are two safety nets as well: before every real overwrite the previous version is kept as `.history/<map name>/latest.json`, plus a timestamped checkpoint at most every five minutes (40 kept); deleting a map moves it into `.trash/` rather than removing it.

Concurrent edits do not clobber each other either: a save carries the version you were looking at, and only succeeds if that is still what is on disk. If someone else got there first you get a conflict banner offering "reload and drop my changes" or "overwrite with mine".

So upgrading is just installing the new version. Your maps stay where they are.

## Where the data lives

The first available location wins:

| Priority | Location | Notes |
| --- | --- | --- |
| 1 | `SYNAPSIS_DATA` environment variable | An absolute path; used as-is |
| 2 | `dataDir` in the plugin config | Set it in `cordis.patch.yml`; survives upgrades |
| 3 | `<home>/Synapsis` | Default. `C:\Users\<you>\Synapsis` on Windows, `/Users/<you>/Synapsis` on macOS, `/home/<you>/Synapsis` on Linux |

Setting `SYNAPSIS_DATA` for the desktop app has a gotcha: on macOS/Linux the app reads your login shell environment (`~/.zprofile`, `~/.zshrc`), so quit it completely and start it again; on Windows add a user environment variable and restart the app. If you'd rather not deal with that, set `dataDir` in the plugin config instead.

The empty state prints the folder in use, so you can select and copy it instead of guessing. It's created on first use. On a first install, when the folder holds no maps at all, a five-node sample ("示例 · 从这里开始") is dropped in — it only explains the controls, and deleting it won't bring it back. Each map in that folder is a `*.mindmap.json`:

```json
{
  "version": 1,
  "title": "Discrete Mathematics (6th ed.)",
  "nodes": [
    { "id": "ch3-subset", "title": "Subset", "parent": "ch3",
      "summary": "…",
      "definition": "…",
      "formal": "B \\subseteq A \\iff \\forall x(x \\in B \\to x \\in A)",
      "intuition": "…", "examples": "…", "pitfalls": "…",
      "source": { "page": 71, "snippet": "quoted line from the book" },
      "mastery": 0, "note": "" }
  ],
  "edges": [ { "from": "ch1-proposition", "to": "ch1-connect-conj", "type": "prereq" } ]
}
```

`parent` is the hierarchical home (the tree); `edges` are cross-branch relations (the net), with `type` being `prereq`, `related` or `contrast`. Backlinks aren't stored — they're computed on open. Layout isn't stored either; it follows from the focus and the node count.

## Formulas

KaTeX ships with the plugin (`assets/katex/`, fonts included) and is served by the host half at `/synapsis-api/katex/*`. No network, and no dependency on packages the host happens to provide. `$$…$$`, `$…$`, `\(…\)` and `\[…\]` are all recognised; a `formal` value with no delimiters is rendered as a formula too.

## Layout

```
package.json            bundle manifest: dsh.bundle.patch / engines.dsh / dsh.client / files
index.js                host half: reads config, builds the store, registers routes / tools / prompt
lib/paths.mjs           filename whitelist and library-folder resolution
lib/validate.mjs        document normalisation (duplicate ids, cycles, dangling edges…) with warnings
lib/store.mjs           library I/O: list, read, snapshots, atomic save, trash, first-run sample
lib/http.mjs            the /synapsis-api/* router: auth, JSON checks, error codes
lib/tools.mjs           the three model-facing tools (list / read / write) plus the prompt section
client-body.js          panel source (switching, dirty tracking and flushing, conflict banner, error boundary)
client.js               build output: core + client-body, this is what gets installed
core/synapsis-core.js   rendering core (layout, camera, LOD, linking, undo, outline, review), bundled into client.js
assets/katex/           bundled KaTeX js/css/fonts (including KaTeX's MIT licence)
locale/{zh,en}.json     plugin metadata
cordis.patch.yml        the patch fragment that mounts it into DSH
plugin-market/          plugin index (format 1) for the Discover page
test/                   node:test unit tests (paths, store, validation, review order, routes, pack manifest)
tools/build-plugin.mjs  build: core + client-body → client.js
tools/dev-server.mjs    local dev server; reuses the real handler, not shipped in the npm package
tools/dev-panel/        harness page that runs the real client.js in a browser
tools/ocr*.mjs|ps1, extract-images.mjs, merge-chapters.mjs    offline textbook → concept-map pipeline
```

`client.js` is generated — don't edit it by hand. Change `core/synapsis-core.js` or `client-body.js`, then:

```sh
npm run build     # node tools/build-plugin.mjs
npm test          # node --test "test/**/*.test.mjs"
npm run dev       # node tools/dev-server.mjs, then open http://127.0.0.1:7788/
```

`npm run dev` uses `.dev-data/` inside the repo, so it never touches your own library; point `SYNAPSIS_DATA` elsewhere if you want a different folder.

The plugin has zero runtime dependencies (only `@deepseek-ai/schemastery` as a peer, provided by the host), so you don't need `npm install` first: there is no `package-lock.json` and `npm ci` will fail — `npm test` and `npm run build` just need Node 22+.

`files` lists only what's needed at runtime, so `core/`, `tools/` and `test/` stay out of the npm package; what lands on someone else's machine is the output alone.

## Known limits

- The panel occupies the host's main panel, so it and the conversation view are mutually exclusive — you switch back and forth. On the desktop app the port is random and the login ticket never reaches a normal browser, so "two tabs, one watching the map while the other chats" only works with `dsh web`.
- Relation edges only surface near the focus; otherwise a few hundred nodes turn into yarn. To see a particular relation, go into its chapter first.
- Review schedules by due date plus mastery; it is not a full SM-2 model with difficulty factors, and a round still caps at fifteen cards.
- The outline view is read-only; edits still happen on the canvas.
- The UI is Chinese only for now.
- UI copy is Chinese only (`locale/en.json` holds plugin metadata only).
- Interface copy is Chinese only (`locale/en.json` holds plugin metadata, not UI strings).

## From a textbook to a map

**Ask for it in the conversation** (recommended): the panel's "导入" button gives you a sentence you can send plus the library path. Drop the PDF into the conversation, send that sentence, and the model in DSH drives four tools:

| Tool | What it does |
| --- | --- |
| `synapsis_list_maps` | lists the maps already in the library (title, node count, modified time, file name) |
| `synapsis_read_map` | reads a map: an outline with each node's definition by default, full JSON with `detail:"full"` |
| `synapsis_write_map` | writes a **new** map (validated server-side for structure and length, atomic, never overwrites an existing name) |
| `synapsis_update_map` | **Partially** update an existing map: send only the nodes and fields you want to change (with `versionToken`); relations, notes and mastery you did not send stay as they are. Returns a change summary and a fresh token |

The plugin also contributes a system-prompt section: what Synapsis is, where the library is, what a `.mindmap.json` looks like, the suggested "root → chapter → topic → concept" shape, and that `formal` takes LaTeX. So the model doesn't need you to explain the format — it can propose a chapter list, wait for your OK, then generate chapter by chapter. Nothing pops up automatically; hit refresh in the panel when it is done.

**Or run the offline pipeline** in this repo (for scans):

```
PDF → extract-images.mjs   (pull the full-page JPEGs out)
    → ocr.ps1              (Windows OCR, page by page)
    → ocr-join.mjs         (strip spaces, insert page markers)
    → split by chapter → ask a model for one chapter JSON at a time
    → merge-chapters.mjs   (merge into a single *.mindmap.json)
```

Drop the result into the library folder and it shows up in the panel. This works for scans, at the cost of OCR mangling symbols (∧ becomes A, r becomes 厂). Formulas have to be rewritten from domain knowledge, which is why every concept keeps `source.page` and a quoted snippet so you can check it against the book.
