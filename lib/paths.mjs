import path from 'node:path'
import os from 'node:os'

/* 图文件名白名单：只允许 .mindmap.json，且不允许路径分隔与控制字符。
   Windows 的保留设备名（CON / NUL / COM1 …）也一并拒绝——否则在某些机器上
   连创建都会失败。 */
export const NAME_RE = /^[^\u0000-\u001f\\/:*?"<>|]+\.mindmap\.json$/
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function safeName(raw) {
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (!name || name.length > 180) return null
  if (name.includes('..')) return null
  if (!NAME_RE.test(name)) return null
  const stem = name.replace(/\.mindmap\.json$/i, '').trim()
  if (!stem || RESERVED.test(stem)) return null
  return name
}

/* 图库目录，按优先级取第一个：
     1. SYNAPSIS_DATA 环境变量
     2. 插件 Config 的 dataDir（在 cordis.patch.yml 里改，升级不丢）
     3. <主目录>/Synapsis
   不做任何「旧路径探测」：路径必须由用户显式给出，别人的机器上不存在 E: 盘。 */
export function resolveHome(options = {}) {
  const env = options.env
  /* env 既可以是 process.env，也可以直接是一个路径字符串（测试与调用方都方便） */
  const fromEnv = (typeof env === 'string' ? env : String((env || process.env).SYNAPSIS_DATA || '')).trim()
  if (fromEnv) return path.resolve(fromEnv)
  const fromConfig = String(options.configDir || '').trim()
  if (fromConfig) return path.resolve(fromConfig)
  return path.join(options.homedir || os.homedir(), 'Synapsis')
}
