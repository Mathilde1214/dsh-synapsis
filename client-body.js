/* 运行在 __ModuleLoader__ 工厂作用域内：React / h / comp 已就绪 */
const MindMap = comp.MindMap
const hh = h

/* KaTeX 由插件自己的 Host 路由喂进来（宿主模块表里没有它），脚本到位后置位 */
function useKatexReady() {
  const [ready, setReady] = React.useState(() => !!window.katex)
  React.useEffect(() => {
    if (ready) return undefined
    const on = () => setReady(!!window.katex)
    window.addEventListener('synapsis:katex', on)
    const timer = setTimeout(() => setReady(!!window.katex), 1500)
    return () => {
      window.removeEventListener('synapsis:katex', on)
      clearTimeout(timer)
    }
  }, [ready])
  return ready
}

const ERROR_TEXT = {
  bad_json: '这个文件不是合法的 JSON，可能写坏了。',
  bad_doc: '这个文件的结构不对（缺少 nodes 数组）。',
  not_found: '文件不见了，可能在别处被删掉了。',
  conflict: '文件在别处被改过了。',
  exists: '已经有同名的图了。',
  bad_name: '文件名不合法。',
  unsupported_media: '请求格式不对。',
}

async function jget(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  if (!res.ok) {
    const code = (parsed && parsed.error) || 'HTTP ' + res.status
    throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
  }
  if (parsed && parsed.ok === false) {
    const code = parsed.error || 'unknown'
    throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
  }
  return parsed
}

function hostDark() {
  const body = document.body
  if (!body) return false
  if (body.hasAttribute('data-ds-dark-theme')) return true
  if (body.classList.contains('dark') || body.classList.contains('theme-dark')) return true
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

/* 渲染崩了不该让整块面板变白：兜住它，给一个能重新加载的出口。 */
class MapBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { err: null }
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err) {
    console.warn('[synapsis] map crashed', err)
  }

  render() {
    if (!this.state.err) return this.props.children
    return hh(
      'div',
      { style: { padding: '28px 24px', lineHeight: 1.7 } },
      hh('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, '这张图渲染失败'),
      hh('div', { style: { opacity: 0.66, fontSize: 13, whiteSpace: 'pre-wrap' } }, String(this.state.err && this.state.err.message)),
      hh(
        'button',
        {
          style: { marginTop: 12, fontSize: 13, padding: '6px 12px', cursor: 'pointer' },
          onClick: () => {
            this.setState({ err: null })
            this.props.onReload()
          },
        },
        '重新加载',
      ),
    )
  }
}

function Panel() {
  const [files, setFiles] = React.useState([])
  const [name, setName] = React.useState('')
  const [doc, setDoc] = React.useState(null)
  const [status, setStatus] = React.useState('读取图库…')
  const [error, setError] = React.useState('')
  const [conflict, setConflict] = React.useState(null)
  const [warnings, setWarnings] = React.useState([])
  const [toast, setToast] = React.useState(null)
  const [armDelete, setArmDelete] = React.useState(false)
  const [dir, setDir] = React.useState('')
  const [darkHost, setDarkHost] = React.useState(hostDark)
  const [themeMode, setThemeMode] = React.useState(() => {
    try {
      return localStorage.getItem('synapsis.theme') || 'auto'
    } catch {
      return 'auto'
    }
  })
  const theme = themeMode === 'auto' ? (darkHost ? 'dark' : 'light') : themeMode
  const toggleTheme = React.useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeMode(next)
    try {
      localStorage.setItem('synapsis.theme', next)
    } catch {}
  }, [theme])

  /* 宿主切日光/夜间时，auto 模式要跟着变 */
  React.useEffect(() => {
    const sync = () => setDarkHost(hostDark())
    const obs = new MutationObserver(sync)
    if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => obs.disconnect()
  }, [])

  /* 删除要连点两下：第一下只是「举枪」，4 秒内不点就自动放下 */
  React.useEffect(() => {
    if (!armDelete) return undefined
    const timer = setTimeout(() => setArmDelete(false), 4000)
    return () => clearTimeout(timer)
  }, [armDelete])

  const katexReady = useKatexReady()
  const renderMath = React.useMemo(
    () => (katexReady && window.katex ? comp.createMathRenderer(window.katex) : null),
    [katexReady],
  )
  const nameRef = React.useRef('')
  const timerRef = React.useRef(0)
  const docRef = React.useRef(null)
  const mtimeRef = React.useRef(null)
  /* rev：每次编辑自增；savedRev：已经写进文件的那一版。
     保存成功时只在自己拿到的 rev 仍是最新时才敢清脏标记——
     否则「A 在保存途中又改出 B」会被 A 的成功回调误判成「全都是干净的」。 */
  const revRef = React.useRef(0)
  const savedRevRef = React.useRef(0)
  const queueRef = React.useRef(Promise.resolve())
  const savingRef = React.useRef(null)
  /* 上次打开的是哪张图：下次进面板直接回到它，而不是列表里最旧的一张 */
  const lastRef = React.useRef(readLast())

  function readLast() {
    try {
      return localStorage.getItem('synapsis.last') || ''
    } catch {
      return ''
    }
  }

  nameRef.current = name
  docRef.current = doc

  const save = React.useCallback(async (opts) => {
    const options = opts || {}
    clearTimeout(timerRef.current)
    const target = nameRef.current
    if (!target) return true

    /* 同一个面板的保存排成一条队：上一次没回来就等它，避免两次写盘互相踩 */
    const run = async () => {
      /* 循环里每一轮都重新读 rev / doc：如果这一轮写的是 A，期间用户改成了 B，
         写成功之后 savedRev 只到 A，于是再写一轮 B，直到磁盘追上当前编辑。 */
      for (let guard = 0; guard < 8; guard += 1) {
        const current = docRef.current
        if (!current) return true
        const rev = revRef.current
        if (!options.force && rev === savedRevRef.current) return true
        const body = JSON.stringify({ name: target, data: current, baseMtime: mtimeRef.current })
        let res
        try {
          res = await fetch('/synapsis-api/save', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            keepalive: !!options.keepalive,
          })
        } catch (err) {
          const why = err && err.message ? err.message : String(err)
          setStatus('保存失败：' + why)
          setToast({ text: '保存失败：' + why, kind: 'retry' })
          return false
        }
        const payload = await res.json().catch(() => null)
        if (res.status === 409 || res.status === 410 || res.status === 428) {
          const code = payload && payload.error
          setConflict({
            mtime: payload && payload.mtime,
            name: target,
            gone: code === 'gone',
            issues: (payload && payload.issues) || null,
          })
          setStatus(code === 'gone' ? '文件在别处被删掉了' : '文件已被外部修改')
          return false
        }
        if (!res.ok || (payload && payload.ok === false)) {
          const code = (payload && payload.error) || 'HTTP ' + res.status
          const issues = payload && payload.issues
          const why = issues && issues.length ? ERROR_TEXT.bad_doc + '（' + issues.join('、') + '）' : ERROR_TEXT[code] || code
          setStatus('保存失败：' + why)
          setToast({ text: '保存失败：' + why, kind: 'retry' })
          return false
        }
        if (payload && typeof payload.mtime === 'number') mtimeRef.current = payload.mtime
        savedRevRef.current = rev
        setConflict(null)
        setToast((prev) => (prev && prev.kind === 'retry' ? null : prev))
        if (revRef.current === rev) {
          /* 这一轮写完之后没有新编辑：只有这时才敢说「已保存」 */
          setStatus('已保存')
          return true
        }
      }
      /* 一直有新编辑在打断：告诉他还在写，下一次防抖会接着写 */
      setStatus('还在保存…')
      return true
    }

    const prev = queueRef.current
    const next = prev.then(run, run)
    queueRef.current = next.catch(() => {})
    savingRef.current = next
    return next
  }, [])

  const flush = React.useCallback(async () => {
    clearTimeout(timerRef.current)
    if (savingRef.current) await savingRef.current.catch(() => {})
    return save()
  }, [save])

  const openNamed = React.useCallback(
    async (pick) => {
      /* 切图前先把还没落盘的改动写完；写不成就别切，免得「切换」变成丢数据 */
      const clean = await flush()
      if (!clean) {
        setStatus('有改动没保存成功，先别切图')
        return
      }
      setStatus('读取中…')
      setError('')
      try {
        const list = await jget('/synapsis-api/list')
        const items = (list && list.items) || []
        setFiles(items)
        setDir((list && list.dir) || '')
        /* 优先按调用方指定 → 当前 → 上次打开 → 最近修改；其中任何一个已经不在库里就顺延 */
        const wanted = [pick, nameRef.current, lastRef.current, items[0] && items[0].name]
        const next = wanted.find((cand) => cand && items.some((item) => item.name === cand)) || ''
        if (next && items.some((item) => item.name === next)) {
          const loaded = await jget('/synapsis-api/load?name=' + encodeURIComponent(next))
          setName(next)
          nameRef.current = next
          setDoc(loaded.data)
          docRef.current = loaded.data
          mtimeRef.current = typeof loaded.mtime === 'number' ? loaded.mtime : null
          lastRef.current = next
          try {
            localStorage.setItem('synapsis.last', next)
          } catch {
            /* 隐私模式下 localStorage 可能不可写，忽略 */
          }
          /* 换了一份文件：rev 归零，之前的在途保存与新文件无关 */
          revRef.current = 0
          savedRevRef.current = 0
          setConflict(null)
          setWarnings((loaded && loaded.warnings) || [])
          setStatus(
            loaded && loaded.warnings && loaded.warnings.length
              ? '已修复 ' + loaded.warnings.length + ' 处结构问题'
              : '',
          )
        } else {
          setName('')
          nameRef.current = ''
          setDoc(null)
          docRef.current = null
          mtimeRef.current = null
          revRef.current = 0
          savedRevRef.current = 0
          setWarnings([])
          setStatus('')
        }
      } catch (err) {
        const code = err && err.code
        if (code === 'bad_json' || code === 'bad_doc') {
          setError((ERROR_TEXT[code] || '') + (pick ? '（' + pick + '）' : ''))
        } else {
          setError(err && err.message ? err.message : String(err))
        }
        setStatus('')
      }
    },
    [flush],
  )

  React.useEffect(() => {
    openNamed('')
  }, [openNamed])

  /* 「放弃我的改动，读磁盘上的那份」——不能走 openNamed，因为它会先 flush：
     冲突状态下 flush 一定失败，于是「重新加载」被自己的保存挡住。 */
  const reloadFromDisk = React.useCallback(async () => {
    const target = nameRef.current
    setStatus('重新读取…')
    clearTimeout(timerRef.current)
    try {
      await queueRef.current.catch(() => {})
    } catch {}
    /* 让在途/排队的保存失效：rev 追平之后它们不会再把旧内容写回去 */
    revRef.current += 1
    savedRevRef.current = revRef.current
    if (!target) {
      await openNamed('')
      return
    }
    try {
      const loaded = await jget('/synapsis-api/load?name=' + encodeURIComponent(target))
      setDoc(loaded.data)
      docRef.current = loaded.data
      mtimeRef.current = typeof loaded.mtime === 'number' ? loaded.mtime : null
      setWarnings((loaded && loaded.warnings) || [])
      setConflict(null)
      setStatus('已重新读取')
    } catch (err) {
      setConflict(null)
      setStatus('重新读取失败：' + (err && err.message ? err.message : String(err)))
      if (err && err.code === 'not_found') await openNamed('')
    }
  }, [openNamed])

  /* 窗口获得焦点时：刷新列表，并检查当前文件是不是在别处被改过 */
  React.useEffect(() => {
    const onFocus = () => {
      if (!docRef.current) return
      jget('/synapsis-api/list')
        .then((list) => {
          const items = (list && list.items) || []
          setFiles(items)
          const mine = items.find((item) => item.name === nameRef.current)
          if (mine && mtimeRef.current && mine.mtime > mtimeRef.current + 1.5) {
            setConflict({ mtime: mine.mtime, name: mine.name })
          }
        })
        .catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const onChange = React.useCallback(
    (next) => {
      setDoc(next)
      docRef.current = next
      revRef.current += 1
      /* 根节点改名会同步文档 title：下拉里那一行也得跟着变，
         否则画布上写着新名字、选择器还停在旧名字 */
      const current = nameRef.current
      if (current) {
        setFiles((prev) =>
          prev.map((file) =>
            file.name === current ? { ...file, title: next.title || file.title, nodes: next.nodes.length } : file,
          ),
        )
      }
      setStatus('保存中…')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        save()
      }, 600)
    },
    [save],
  )

  /* 关面板前把还在防抖里的那次保存推出去，否则最后 600ms 的改动会丢 */
  React.useEffect(
    () => () => {
      clearTimeout(timerRef.current)
      save({ keepalive: true, force: revRef.current !== savedRevRef.current })
    },
    [save],
  )

  /* 新建一张空白图：根节点就叫「未命名图」，进去按 F2 改 */
  const newMap = React.useCallback(async () => {
    const clean = await flush()
    if (!clean) {
      setStatus('有改动没保存成功，先别新建')
      return
    }
    setStatus('新建中…')
    try {
      const res = await fetch('/synapsis-api/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '未命名图' }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || (payload && payload.ok === false)) {
        const code = (payload && payload.error) || 'HTTP ' + res.status
        throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
      }
      await openNamed(payload.name)
      setStatus('已新建：按 Tab 加概念，F2 改根节点名字')
    } catch (err) {
      setStatus('新建失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [flush, openNamed])

  const removeMap = React.useCallback(async () => {
    const target = nameRef.current
    if (!target) return
    setArmDelete(false)
    setStatus('保存后删除…')
    /* 先把还没落盘的那一次写下去，再删：否则删掉的是旧版本，撤销回来也缺最后一次编辑。
       保存不成功就不删，别让「删除」顺手吃掉改动。 */
    const clean = await flush()
    if (!clean) {
      setStatus('有改动没保存成功，先没删')
      return
    }
    try {
      const res = await fetch('/synapsis-api/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: target }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        const code = (payload && payload.error) || 'HTTP ' + res.status
        throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
      }
      setName('')
      nameRef.current = ''
      setDoc(null)
      docRef.current = null
      mtimeRef.current = null
      revRef.current = 0
      savedRevRef.current = 0
      await openNamed('')
      setStatus('已删除')
      /* 六秒内可以捡回来：.trash 里那份还在，撤销只是把它挪回库目录 */
      setToast({ text: '已删除《' + (target.replace(/\.mindmap\.json$/, '') || '这张图') + '》', name: target })
    } catch (err) {
      /* 删除失败：改动仍然算没保存，保留脏状态与重试入口 */
      setStatus('删除失败：' + (err && err.message ? err.message : String(err)))
      setToast({ text: '删除失败：' + (err && err.message ? err.message : String(err)), kind: 'retry' })
    }
  }, [flush, openNamed])

  const undoDelete = React.useCallback(async () => {
    const pending = toast
    if (!pending || !pending.name) return
    setToast(null)
    try {
      const res = await fetch('/synapsis-api/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: pending.name }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || (payload && payload.ok === false)) {
        const code = (payload && payload.error) || 'HTTP ' + res.status
        throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
      }
      await openNamed(payload.name)
      setStatus('已恢复')
    } catch (err) {
      setStatus('恢复失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [toast, openNamed])

  /* 撤销提示自己消失；报错提示留着，等用户重试或重新加载 */
  React.useEffect(() => {
    if (!toast || toast.kind === 'retry') return undefined
    const id = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(id)
  }, [toast])

  /* 空态里的「放一张示例图」 */
  const reseedSample = React.useCallback(async () => {
    try {
      const res = await fetch('/synapsis-api/sample', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || (payload && payload.ok === false)) {
        const code = (payload && payload.error) || 'HTTP ' + res.status
        throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
      }
      await openNamed(payload.name)
      setStatus('示例图已放回库目录')
    } catch (err) {
      setStatus('放示例失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [openNamed])

  /* 每份图记住自己停在哪一层：换回来的时候直接回到那一层（hook 必须放在早退之前） */
  const initialFocus = React.useMemo(() => {
    try {
      return localStorage.getItem('synapsis.view.' + name) || ''
    } catch {
      return ''
    }
  }, [name])
  const onFocusChange = React.useCallback(
    (id) => {
      try {
        if (name) localStorage.setItem('synapsis.view.' + name, id || '')
      } catch {}
    },
    [name],
  )

  /* 删除撤销 / 保存失败重试：挂在最外层，空态和报错页也要能看见 */
  const toastBar = toast
    ? hh(
        'div',
        {
          role: 'status',
          style: {
            position: 'absolute',
            left: '50%',
            bottom: 26,
            transform: 'translateX(-50%)',
            zIndex: 31,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            background: 'rgba(47,42,36,.92)',
            color: '#f6f1e6',
            boxShadow: '0 10px 26px rgba(0,0,0,.3)',
          },
        },
        hh('span', null, toast.text),
        hh(
          'button',
          {
            style: { fontSize: 12, padding: '3px 10px', cursor: 'pointer' },
            onClick: toast.kind === 'retry' ? () => save({ force: true }) : undoDelete,
          },
          toast.kind === 'retry' ? '重试' : '撤销',
        ),
      )
    : null

  if (error) {
    return hh(
      'div',
      { style: { position: 'relative', height: '100%' } },
      hh(
        'div',
        { style: { padding: '28px 24px', lineHeight: 1.7 } },
        hh('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, '这张图读不出来'),
        hh('div', { style: { opacity: 0.7, fontSize: 13 } }, error),
        hh(
          'div',
          { style: { opacity: 0.6, fontSize: 12.5, marginTop: 6 } },
          '文件本身可能坏了，也可能只是权限问题。其它图还在，换一张就行。',
        ),
        /* 坏图别把整页堵死：这里也放一个图库选择器 */
        files.length
          ? hh(
              'div',
              { style: { marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              hh('span', { style: { fontSize: 12.5, opacity: 0.7 } }, '换一张：'),
              hh(
                'select',
                {
                  className: 'sn-libsel',
                  defaultValue: '',
                  onChange: (event) => {
                    if (event.target.value) openNamed(event.target.value)
                  },
                },
                hh('option', { value: '' }, '选一张健康的图…'),
                files.map((file) =>
                  hh(
                    'option',
                    { key: file.name, value: file.name },
                    (file.broken ? '⚠ ' : '') + file.title + (file.broken ? '（损坏）' : ''),
                  ),
                ),
              ),
            )
          : null,
        hh(
          'div',
          { style: { marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' } },
          hh(
            'button',
            { style: { fontSize: 13, padding: '6px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
            '重试',
          ),
          hh(
            'button',
            { style: { fontSize: 13, padding: '6px 12px', cursor: 'pointer' }, onClick: newMap },
            '新建一张空白图',
          ),
        ),
      ),
      toastBar,
    )
  }

  if (!doc) {
    return hh(
      'div',
      { style: { position: 'relative', height: '100%' } },
      hh(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          flexDirection: 'column',
          gap: 10,
          fontSize: 13.5,
          opacity: 0.75,
        },
      },
      hh('div', { style: { fontSize: 22, letterSpacing: '0.2em' } }, '析域'),
      hh('div', null, status || '这个目录里还没有图。'),
      dir
        ? hh(
            'div',
            { style: { maxWidth: 620, textAlign: 'center', opacity: 0.8, lineHeight: 1.7 } },
            '库目录：',
            hh(
              'code',
              {
                style: {
                  fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
                  fontSize: 12,
                  userSelect: 'all',
                  overflowWrap: 'anywhere',
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(120,100,70,.12)',
                },
              },
              dir,
            ),
            hh('br'),
            '把生成好的 ',
            hh('code', null, '*.mindmap.json'),
            ' 放进这个目录，再点「重新读取」即可；也可以在插件配置里改 dataDir，或设环境变量 ',
            hh('code', null, 'SYNAPSIS_DATA'),
            '。',
          )
        : null,
      hh(
        'div',
        { style: { display: 'flex', gap: 10, alignItems: 'center' } },
        hh(
          'button',
          { style: { fontSize: 13, padding: '6px 14px', cursor: 'pointer' }, onClick: newMap },
          '新建一张空白图',
        ),
        hh(
          'button',
          { style: { fontSize: 12.5, padding: '5px 12px', cursor: 'pointer' }, onClick: reseedSample },
          '放一张示例图',
        ),
        hh(
          'button',
          { style: { fontSize: 12.5, padding: '5px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
          '重新读取',
        ),
      ),
      ),
      toastBar,
    )
  }

  const titleCount = {}
  files.forEach((file) => {
    titleCount[file.title] = (titleCount[file.title] || 0) + 1
  })

  const leading = hh(
    React.Fragment,
    null,
    hh('button', { className: 'sn-chip', title: '新建一张空白图', onClick: newMap, style: { opacity: 0.8 } }, '+ 新建'),
    hh(
      'select',
      {
        className: 'sn-libsel',
        value: name,
        onChange: (event) => openNamed(event.target.value),
        title: '切换图',
      },
      files.map((file) =>
        hh(
          'option',
          { key: file.name, value: file.name },
          titleCount[file.title] > 1 ? file.title + ' · ' + file.name.replace(/\.mindmap\.json$/, '') : file.title,
        ),
      ),
    ),
    hh(
      'button',
      {
        className: 'sn-iconbtn',
        title: '从磁盘重新读取',
        onClick: () => openNamed(name),
        style: { width: 22, height: 22, fontSize: 13 },
      },
      '↻',
    ),
    hh(
      'button',
      {
        className: 'sn-chip',
        title: armDelete ? '再点一次就真的删了（会挪进库目录的 .trash）' : '删除这份图',
        onClick: () => (armDelete ? removeMap() : setArmDelete(true)),
        style: armDelete ? { color: '#b0413a', borderColor: 'rgba(176,65,58,.6)' } : { opacity: 0.7 },
      },
      armDelete ? '确认删除「' + (doc.title || name) + '」' : '删除',
    ),
  )

  const banner = conflict
    ? hh(
        'div',
        {
          style: {
            position: 'absolute',
            left: '50%',
            top: 54,
            transform: 'translateX(-50%)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            background: 'rgba(176,65,58,.94)',
            color: '#fff8f2',
            boxShadow: '0 8px 24px rgba(0,0,0,.28)',
          },
        },
        hh('span', null, conflict.gone ? '这份图在别处被删掉了' : '这个文件在别处被改过了'),
        hh(
          'button',
          {
            style: { fontSize: 12, padding: '3px 10px', cursor: 'pointer' },
            onClick: reloadFromDisk,
          },
          '重新加载（放弃我的改动）',
        ),
        conflict.gone
          ? null
          : hh(
              'button',
              {
                style: { fontSize: 12, padding: '3px 10px', cursor: 'pointer' },
                onClick: () => {
                  mtimeRef.current = conflict.mtime
                  setConflict(null)
                  save({ force: true })
                },
              },
              '用我这版覆盖',
            ),
      )
    : null

  const statusText = [status, warnings.length ? '已修复 ' + warnings.length + ' 处' : ''].filter(Boolean).join(' · ')

  return hh(
    'div',
    { style: { position: 'relative', height: '100%', width: '100%', flex: '1 1 auto', minWidth: 0 } },
    hh(
      MapBoundary,
      { onReload: () => openNamed(name) },
      hh(MindMap, {
        key: name,
        data: doc,
        leading,
        dir,
        theme,
        onToggleTheme: toggleTheme,
        initialFocusId: initialFocus,
        onFocusChange,
        renderMath,
        statusText,
        onChange,
      }),
    ),
    banner,
    toastBar,
  )
}
