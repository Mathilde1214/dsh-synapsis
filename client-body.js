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

async function jget(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {}
  if (!res.ok) throw new Error((parsed && parsed.error) || 'HTTP ' + res.status)
  return parsed
}

function hostDark() {
  const body = document.body
  if (!body) return false
  if (body.hasAttribute('data-ds-dark-theme')) return true
  if (body.classList.contains('dark') || body.classList.contains('theme-dark')) return true
  return document.documentElement.getAttribute('data-theme') === 'dark'
}

function Panel() {
  const [files, setFiles] = React.useState([])
  const [name, setName] = React.useState('')
  const [doc, setDoc] = React.useState(null)
  const [status, setStatus] = React.useState('读取图库…')
  const [error, setError] = React.useState('')
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

  nameRef.current = name
  docRef.current = doc

  const openNamed = React.useCallback(async (pick) => {
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
        setDoc(loaded)
      } else {
        setName('')
        setDoc(null)
      }
      setStatus('')
    } catch (err) {
      setError(err && err.message ? err.message : String(err))
      setStatus('')
    }
  }, [])

  React.useEffect(() => {
    openNamed('')
  }, [openNamed])

  React.useEffect(() => {
    const onFocus = () => {
      if (!docRef.current) return
      jget('/synapsis-api/list').then((list) => {
        if (list && list.items) setFiles(list.items)
      }).catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const save = React.useCallback(async () => {
    const current = docRef.current
    const target = nameRef.current
    if (!current || !target) return
    try {
      const res = await fetch('/synapsis-api/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: target, data: current }),
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const payload = await res.json().catch(() => null)
      if (payload && payload.ok === false) throw new Error(payload.error || '被拒绝')
      setStatus('已保存')
    } catch (err) {
      setStatus('保存失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [])

  const onChange = React.useCallback(
    (next) => {
      setDoc(next)
      docRef.current = next
      setStatus('保存中…')
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(save, 600)
    },
    [save],
  )

  /* 关面板 / 切图前把还在防抖里的那次保存推出去，否则最后 600ms 的改动会丢 */
  React.useEffect(
    () => () => {
      clearTimeout(timerRef.current)
      save()
    },
    [save],
  )

  /* 新建一张空白图：根节点就叫「未命名图」，进去按 F2 改 */
  const newMap = React.useCallback(async () => {
    setStatus('新建中…')
    try {
      const res = await fetch('/synapsis-api/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '未命名图' }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || (payload && payload.ok === false)) throw new Error((payload && payload.error) || 'HTTP ' + res.status)
      await openNamed(payload.name)
      setStatus('已新建：按 Tab 加概念，F2 改根节点名字')
    } catch (err) {
      setStatus('新建失败：' + (err && err.message ? err.message : String(err)))
    }
  }, [openNamed])

  const removeMap = React.useCallback(async () => {    const target = nameRef.current
    if (!target) return
    setArmDelete(false)
    setStatus('删除中…')
    try {
      const res = await fetch('/synapsis-api/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: target }),
      })
      if (!res.ok) {
        const text = await res.text()
        let parsed = null
        try {
          parsed = JSON.parse(text)
        } catch {}
        throw new Error((parsed && parsed.error) || 'HTTP ' + res.status)
      }
      setName('')
      setDoc(null)
      docRef.current = null
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
      { style: { padding: '28px 24px', font: 'inherit', lineHeight: 1.7 } },
      hh('div', { style: { fontSize: 15, fontWeight: 700, marginBottom: 6 } }, '读不到图库'),
      hh('div', { style: { opacity: 0.7, fontSize: 13 } }, error),
      hh(
        'button',
        { style: { marginTop: 12, font: 'inherit', fontSize: 13, padding: '6px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
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
            ' 放进这个目录，再点「重新读取」即可；也可以设环境变量 ',
            hh('code', null, 'SYNAPSIS_DATA'),
            ' 换到别处。',
          )
        : null,
      hh(
        'div',
        { style: { display: 'flex', gap: 10 } },
        hh(
          'button',
          { style: { font: 'inherit', fontSize: 13, padding: '6px 14px', cursor: 'pointer' }, onClick: newMap },
          '新建一张空白图',
        ),
        hh(
          'button',
          { style: { font: 'inherit', fontSize: 12.5, padding: '5px 12px', cursor: 'pointer' }, onClick: () => openNamed('') },
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
    hh(
      'button',
      {
        className: 'sn-chip',
        title: '新建一张空白图',
        onClick: newMap,
        style: { opacity: 0.8 },
      },
      '+ 新建',
    ),
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

  return hh(MindMap, {
    key: name,
    data: doc,
    leading,
    theme,
    onToggleTheme: toggleTheme,
    initialFocusId: initialFocus,
    onFocusChange,
    renderMath,
    statusText: status,
    onChange,
  })
}
