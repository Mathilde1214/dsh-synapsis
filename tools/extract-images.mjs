/* 从扫描版 PDF 里直接抠出页内的 JPEG（每个扫描页通常就是一张 DCTDecode 图）。
   不做渲染、不依赖 canvas：按字节扫描 /DCTDecode 流，落成 jpg。 */
import fs from 'node:fs'
import path from 'node:path'

const src = process.argv[2]
const outDir = process.argv[3] || 'tmp/pages'
fs.mkdirSync(outDir, { recursive: true })

const buf = fs.readFileSync(src)
const out = []
let i = 0
let n = 0
while (true) {
  const dct = buf.indexOf('/DCTDecode', i)
  if (dct < 0) break
  const s = buf.indexOf('stream', dct)
  if (s < 0) break
  let start = s + 6
  if (buf[start] === 0x0d) start++
  if (buf[start] === 0x0a) start++
  const end = buf.indexOf('endstream', start)
  if (end < 0) break
  let stop = end
  while (stop > start && (buf[stop - 1] === 0x0a || buf[stop - 1] === 0x0d)) stop--
  const bytes = buf.subarray(start, stop)
  if (bytes.length > 20000 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    n++
    const name = 'p' + String(n).padStart(3, '0') + '.jpg'
    fs.writeFileSync(path.join(outDir, name), bytes)
    out.push({ name, bytes: bytes.length, offset: start })
  }
  i = end + 9
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(out, null, 1))
console.log('extracted', out.length, 'jpegs; first', JSON.stringify(out.slice(0, 3)))
