import path from 'node:path'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const corePath = path.join(ROOT, 'core', 'synapsis-core.js')
const bodyPath = path.join(ROOT, 'client-body.js')
const outPath = path.join(ROOT, 'client.js')

const core = await fs.readFile(corePath, 'utf8')
const body = await fs.readFile(bodyPath, 'utf8')

const out = `/* Synapsis · 析域 —— DSH 插件客户端（由 tools/build-plugin.mjs 生成，勿手改） */
window.__ModuleLoader__.load({
  id: 'dsh-synapsis',
  factory(require) {
    const React = require('react')
    const h = React.createElement

${core}

    const comp = createMindMap(React)

${body}

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
`

await fs.writeFile(outPath, out, 'utf8')
console.log('[build] wrote ' + outPath + ' (' + out.length + ' chars)')
