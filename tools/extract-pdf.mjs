/* 从 PDF 抽正文，输出「按页分组」的纯文本：pages/<n>.txt + all.json */
import fs from 'node:fs'
import path from 'node:path'

const src = process.argv[2]
const outDir = process.argv[3] || 'tmp/pdf'
const maxPages = Number(process.argv[4] || 0)

const pdfjs = await import('file:///E:/dsh工作空间/杂物/创造？！/synapsis/web/vendor/pdf.min.mjs')
pdfjs.GlobalWorkerOptions.workerSrc = 'file:///E:/dsh工作空间/杂物/创造？！/synapsis/web/vendor/pdf.worker.min.mjs'

fs.mkdirSync(outDir, { recursive: true })
const data = new Uint8Array(fs.readFileSync(src))
const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise
const total = maxPages ? Math.min(maxPages, doc.numPages) : doc.numPages
console.log('pages:', doc.numPages, 'extracting:', total)

const pages = []
let chars = 0
for (let i = 1; i <= total; i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  const items = content.items
  let lastY = null
  let buf = ''
  for (const it of items) {
    const y = it.transform ? it.transform[5] : 0
    if (lastY !== null && Math.abs(y - lastY) > 2) buf += '\n'
    buf += it.str
    lastY = y
  }
  const text = buf.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  chars += text.length
  pages.push({ page: i, text })
  if (i % 20 === 0) console.log('  page', i, 'chars', chars)
}
fs.writeFileSync(path.join(outDir, 'all.json'), JSON.stringify(pages))
fs.writeFileSync(path.join(outDir, 'all.txt'), pages.map((p) => `\n===== 第 ${p.page} 页 =====\n${p.text}`).join('\n'))
console.log('done. chars =', chars, 'avg/page =', Math.round(chars / total))
