/* 合并 OCR 页文本：去掉汉字之间的空格，逐页加页码标记 */
import fs from 'node:fs'
import path from 'node:path'

const dir = process.argv[2] || 'tmp/text'
const out = process.argv[3] || 'tmp/book.txt'

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()
const parts = []
for (const f of files) {
  let t = fs.readFileSync(path.join(dir, f), 'utf8')
  t = t.replace(/([\u4e00-\u9fa5，。；：、（）【】“”‘’])\s+(?=[\u4e00-\u9fa5，。；：、（）【】“”‘’])/g, '$1')
  t = t.replace(/[ \t]{2,}/g, ' ').trim()
  const page = f.replace(/\D+/g, '')
  parts.push('\n===== 第 ' + Number(page) + ' 页 =====\n' + t)
}
fs.writeFileSync(out, parts.join('\n'), 'utf8')
const total = parts.join('').length
console.log('pages', files.length, 'chars', total, '->', out)
