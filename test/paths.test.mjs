import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { safeName, resolveHome, NAME_RE } from '../lib/paths.mjs'

test('safeName 放行普通的中文/ASCII 名字', () => {
  assert.equal(safeName('离散数学（第六版）.mindmap.json'), '离散数学（第六版）.mindmap.json')
  assert.equal(safeName('my-map_2.mindmap.json'), 'my-map_2.mindmap.json')
  assert.equal(safeName('  带空格.mindmap.json  '), '带空格.mindmap.json')
})

test('safeName 拒绝目录穿越、非法字符与错误后缀', () => {
  const bad = [
    '../x.mindmap.json',
    'a/b.mindmap.json',
    'a\\b.mindmap.json',
    '..mindmap.json',
    'x.json',
    'x.mindmap.json.bak',
    'a:b.mindmap.json',
    'a*b.mindmap.json',
    '',
    '   ',
  ]
  bad.forEach((name) => assert.equal(safeName(name), null, 'should reject ' + JSON.stringify(name)))
})

test('safeName 拒绝 Windows 保留名与过长名字', () => {
  assert.equal(safeName('CON.mindmap.json'), null)
  assert.equal(safeName('lpt9.mindmap.json'), null)
  assert.equal(safeName('a'.repeat(190) + '.mindmap.json'), null)
})

test('NAME_RE 与 safeName 的基本判断一致', () => {
  assert.ok(NAME_RE.test('图.mindmap.json'))
  assert.ok(!NAME_RE.test('图.json'))
})

test('resolveHome 优先级：环境变量 → 配置 → 主目录', () => {
  const homedir = path.join(path.sep, 'home', 'someone')
  assert.equal(resolveHome({ env: path.join(path.sep, 'tmp', 'a'), homedir }), path.resolve(path.join(path.sep, 'tmp', 'a')))
  assert.equal(resolveHome({ env: '', configDir: path.join(path.sep, 'tmp', 'b'), homedir }), path.resolve(path.join(path.sep, 'tmp', 'b')))
  assert.equal(resolveHome({ env: '', configDir: '', homedir }), path.join(homedir, 'Synapsis'))
})

test('resolveHome 也接受 process.env 形状的 env 对象', () => {
  const homedir = path.join(path.sep, 'home', 'me')
  const out = resolveHome({ env: { SYNAPSIS_DATA: path.join(path.sep, 'data', 'x') }, homedir })
  assert.equal(out, path.resolve(path.join(path.sep, 'data', 'x')))
})
