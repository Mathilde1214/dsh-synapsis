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
  const dirtyRef = React.useRef(false)
  const savingRef = React.useRef(null)

  nameRef.current = name
  docRef.current = doc

  const save = React.useCallback(async (opts) => {
    const current = docRef.current
    const target = nameRef.current
    const options = opts || {}
    clearTimeout(timerRef.current)
    if (!current || !target) return true
    if (!dirtyRef.current && !options.force) return true
    if (savingRef.current) await savingRef.current.catch(() => {})
    const body = JSON.stringify({ name: target, data: current, baseMtime: mtimeRef.current })
    const sending = (async () => {
      try {
        const res = await fetch('/synapsis-api/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          keepalive: !!options.keepalive,
        })
        const payload = await res.json().catch(() => null)
        if (res.status === 409) {
          setConflict({ mtime: payload && payload.mtime, name: target })
          setStatus('文件已被外部修改')
          return false
        }
        if (!res.ok || (payload && payload.ok === false)) {
          const code = (payload && payload.error) || 'HTTP ' + res.status
          throw Object.assign(new Error(ERROR_TEXT[code] || code), { code })
        }
        dirtyRef.current = false
        setConflict(null)
        if (payload && typeof payload.mtime === 'number') {
          mtimeRef.current = payload.mtime
        }
        setStatus('已保存')
        return true
      } catch (err) {
        setStatus('保存失败：' + (err && err.message ? err.message : String(err)))
        return false
      } finally {
        savingRef.current = null
      }
    })()
    savingRef.current = sending
    return sending
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
        const next = pick || nameRef.current || (items[0] && items[0].name) || ''
        if (next && items.some((item) => item.name === next)) {
          const loaded = await jget('/synapsis-api/load?name=' + encodeURIComponent(next))
          setName(next)
          nameRef.current = next
          setDoc(loaded.data)
          docRef.current = loaded.data
          mtimeRef.current = typeof loaded.mtime === 'number' ? loaded.mtime : null
          dirtyRef.current = false
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
          dirtyRef.current = false
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
      dirtyRef.current = true
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
      save({ keepalive: true, force: dirtyRef.current })
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
    setStatus('删除中…')
    try {
      /* 先等正在写的保存落地，再删 —— 否则删完可能又被防抖里的 save 写回去 */
      clearTimeout(timerRef.current)
      if (savingRef.current) await savingRef.current.catch(() => {})
      dirtyRef.current = false
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
      await openNamed('')
      setStatus('已删除')
    } catch (err) {
      setStatus('删除失败：' + (err && err.message ? err.message : String(err)))
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

  if (error) {
    return hh(
      'div',
      { style: { padding: '28px 24px', lineHeight: 1.7 } },
      hh('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, '读不到图库'),
      hh('div', { style: { opacity: 0.7, fontSize: 13 } }, error),
      hh(
        'button',
        { style: { marginTop: 12, fontSize: 13, padding: '6px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
        '重试',
      ),
    )
  }

  if (!doc) {
    return hh(
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
        { style: { display: 'flex', gap: 10 } },
        hh(
          'button',
          { style: { fontSize: 13, padding: '6px 14px', cursor: 'pointer' }, onClick: newMap },
          '新建一张空白图',
        ),
        hh(
          'button',
          { style: { fontSize: 12.5, padding: '5px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
          '重新读取',
        ),
      ),
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
        hh('span', null, '这个文件在别处被改过了'),
        hh(
          'button',
          {
            style: { fontSize: 12, padding: '3px 10px', cursor: 'pointer' },
            onClick: () => openNamed(conflict.name),
          },
          '重新加载',
        ),
        hh(
          'button',
          {
            style: { fontSize: 12, padding: '3px 10px', cursor: 'pointer' },
            onClick: () => {
              mtimeRef.current = conflict.mtime
              setConflict(null)
              dirtyRef.current = true
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
  )
}
