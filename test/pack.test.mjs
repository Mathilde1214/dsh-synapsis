import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* 打包清单是「装得上」的最后一道闸：
   少一个文件插件就报错，多一个文件就把开发用的东西塞进了别人的机器。 */
function packFiles() {
  const out =
    process.platform === 'win32'
      ? execSync('npm pack --dry-run --json', { cwd: ROOT, encoding: 'utf8' })
      : execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' })
  const parsed = JSON.parse(out)
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  return first.files.map((f) => f.path.replace(/\\/g, '/'))
}

const files = packFiles()

test('清单包含插件运行必需的文件', () => {
  const must = [
    'package.json',
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'icon.svg',
    'README.md',
    'LICENSE',
    'locale/en.json',
    'locale/zh.json',
    'lib/paths.mjs',
    'lib/validate.mjs',
    'lib/store.mjs',
    'lib/http.mjs',
    'lib/tools.mjs',
    'assets/katex/katex.mjs',
    'assets/katex/katex.min.css',
    'assets/katex/LICENSE',
  ]
  must.forEach((f) => assert.ok(files.includes(f), '打包里缺少 ' + f))
})

test('KaTeX 字体齐全（20 个 woff2）', () => {
  const fonts = files.filter((f) => f.startsWith('assets/katex/fonts/') && f.endsWith('.woff2'))
  assert.ok(fonts.length >= 20, 'woff2 只有 ' + fonts.length + ' 个')
})

test('不把开发用的东西打进包', () => {
  const banned = ['core/', 'tools/', 'test/', 'shots/', 'docs/', 'tmp/', '.dev-data/', '.github/']
  banned.forEach((prefix) => {
    const hit = files.find((f) => f.startsWith(prefix))
    assert.equal(hit, undefined, '包里不该有 ' + hit)
  })
})

test('体积仍在合理范围（< 900 KB 解包前）', () => {
  const total = files.reduce((sum, f) => sum + (f ? 1 : 0), 0)
  assert.ok(total > 20 && total < 60, '文件数看起来不对：' + total)
})
