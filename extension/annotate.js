// I read — on a Substack post: a small tracker (this article's time, today's
// goal) that opens on hover with your notes and highlights, and I read's own
// highlighting. Substack has its own pop-up when you select text; press
// Alt+Shift+H (⌥⇧H on a Mac) and I read's takes over until you press it again.
// Highlights find their way back to the text by the quote and a little of
// what's around it, and sync to I read (background.js → irb_web_annotations).
// It also shows the reading clock's "Still reading?" and "Reading time paused".
;(() => {
  if (!globalThis.__irbSubstack || window.top !== window) return
  /** The reading clock (content.js): "Still reading?" and paused. */
  const R = globalThis.__irbReading

  const COLORS = [
    { key: 'yellow', swatch: '#fcd34d', mark: 'rgba(253, 224, 71, 0.55)', label: 'Yellow' },
    { key: 'green', swatch: '#6ee7a0', mark: 'rgba(134, 239, 172, 0.6)', label: 'Green' },
    { key: 'blue', swatch: '#7cb8ff', mark: 'rgba(147, 197, 253, 0.6)', label: 'Blue' },
    { key: 'pink', swatch: '#f99ac8', mark: 'rgba(249, 168, 212, 0.6)', label: 'Pink' },
    { key: 'purple', swatch: '#b9a4fb', mark: 'rgba(196, 181, 253, 0.65)', label: 'Purple' },
  ]
  const colorOf = (k) => COLORS.find((c) => c.key === k) ?? COLORS[0]
  const send = (msg) => {
    try {
      return chrome.runtime.sendMessage(msg).catch(() => null)
    } catch {
      return Promise.resolve(null) // the extension was reloaded: this page's script is orphaned
    }
  }
  const here = () => location.origin + location.pathname
  /** The post's text (Substack puts it in .body.markup). */
  const bodyEl = () => document.querySelector('.available-content .body.markup, .body.markup, .available-content, article .post-content')
  const meta = (sel) => document.querySelector(sel)?.getAttribute('content')?.trim() || undefined
  const uuid = () => crypto.randomUUID()

  // ── Marks in the page ─────────────────────────────────────────────────────
  const style = document.createElement('style')
  style.textContent = `
    mark.irb-hl { background: var(--irb-c); color: inherit; border-radius: 2px; padding: 0 1px; margin: 0 -1px; cursor: pointer;
      -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: box-shadow .2s ease; }
    mark.irb-hl[data-irb-note] { text-decoration: underline dotted; text-decoration-color: color-mix(in srgb, currentColor 45%, transparent); text-underline-offset: 3px; }
    mark.irb-hl.irb-flash { box-shadow: 0 0 0 3px rgba(0, 112, 243, .45); }
    html.irb-mode .body.markup ::selection, html.irb-mode .available-content ::selection { background: rgba(255, 103, 25, .28); }
  `
  document.head.append(style)

  /** Text nodes of the post, and its text with spaces squeezed, mapped back to them. */
  function index(root) {
    const nodes = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('script, style, noscript, #irb-host') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    })
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n)
    let text = ''
    const at = [] // for each char of `text`: [node index, offset]
    let space = true
    nodes.forEach((n, ni) => {
      const d = n.data
      for (let o = 0; o < d.length; o++) {
        if (/\s/.test(d[o])) {
          if (space) continue
          space = true
          text += ' '
        } else {
          space = false
          text += d[o]
        }
        at.push([ni, o])
      }
    })
    return { nodes, text, at }
  }
  const squeeze = (s) => s.replace(/\s+/g, ' ').trim()

  /** Where a DOM point falls in the squeezed text. */
  function pos(ix, node, offset) {
    // An element boundary: use the text that starts there.
    if (node.nodeType !== Node.TEXT_NODE) {
      const after = node.childNodes[offset]
      const w = document.createTreeWalker(after ?? node, NodeFilter.SHOW_TEXT)
      const first = after ? (after.nodeType === Node.TEXT_NODE ? after : w.nextNode()) : null
      if (!first) return ix.text.length
      node = first
      offset = 0
    }
    const ni = ix.nodes.indexOf(node)
    if (ni < 0) return -1
    let lo = 0, hi = ix.at.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const [n, o] = ix.at[mid]
      if (n < ni || (n === ni && o < offset)) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** The selection as a quote, with a little context either side. */
  function quoteOf(range, root) {
    const ix = index(root)
    const s = pos(ix, range.startContainer, range.startOffset)
    const e = pos(ix, range.endContainer, range.endOffset)
    if (s < 0 || e <= s) return null
    let a = s, b = e
    while (a < b && ix.text[a] === ' ') a++
    while (b > a && ix.text[b - 1] === ' ') b--
    const text = ix.text.slice(a, b)
    if (!text) return null
    return { text, prefix: ix.text.slice(Math.max(0, a - 40), a), suffix: ix.text.slice(b, b + 40) }
  }

  /** Find a saved quote in the page again (the best match for its context). */
  function rangeOf(a, root) {
    const ix = index(root)
    const q = squeeze(a.text ?? '')
    if (!q) return null
    let best = -1, bestScore = -1
    for (let i = ix.text.indexOf(q); i >= 0; i = ix.text.indexOf(q, i + 1)) {
      let score = 0
      const before = ix.text.slice(0, i), after = ix.text.slice(i + q.length)
      const p = a.prefix ?? '', s = a.suffix ?? ''
      while (score < p.length && before[before.length - 1 - score] === p[p.length - 1 - score]) score++
      let k = 0
      while (k < s.length && after[k] === s[k]) k++
      score += k
      if (score > bestScore) (best = i), (bestScore = score)
    }
    if (best < 0) return null
    const [sn, so] = ix.at[best]
    const [en, eo] = ix.at[best + q.length - 1]
    const r = document.createRange()
    r.setStart(ix.nodes[sn], so)
    r.setEnd(ix.nodes[en], eo + 1)
    return r
  }

  /** Wrap a range's text in <mark>s (one per text piece). */
  function wrap(range, a) {
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentNode : range.commonAncestorContainer
    const pieces = []
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!range.intersectsNode(n)) continue
      const s = n === range.startContainer ? range.startOffset : 0
      const e = n === range.endContainer ? range.endOffset : n.length
      if (e > s && n.data.slice(s, e).trim()) pieces.push({ n, s, e })
    }
    const marks = []
    for (const { n, s, e } of pieces) {
      let node = n
      if (s > 0) node = node.splitText(s)
      if (e - s < node.length) node.splitText(e - s)
      const m = document.createElement('mark')
      m.className = 'irb-hl'
      m.dataset.irbId = a.id
      paint(m, a)
      node.parentNode.insertBefore(m, node)
      m.append(node)
      marks.push(m)
    }
    return marks
  }
  function paint(m, a) {
    m.style.setProperty('--irb-c', colorOf(a.color).mark)
    if (a.note?.trim()) m.dataset.irbNote = '1'
    else delete m.dataset.irbNote
    m.title = a.note?.trim() ? a.note.trim() : ''
  }
  function unwrap(id) {
    for (const m of document.querySelectorAll(`mark.irb-hl[data-irb-id="${id}"]`)) {
      const p = m.parentNode
      while (m.firstChild) p.insertBefore(m.firstChild, m)
      m.remove()
      p.normalize()
    }
  }
  const marksOf = (id) => [...document.querySelectorAll(`mark.irb-hl[data-irb-id="${id}"]`)]

  // ── State ────────────────────────────────────────────────────────────────
  let url = here()
  let anns = [] // this page's highlights and notes
  let mode = false // I read's highlighting instead of Substack's
  let status = { todaySecs: 0, articleSecs: 0, goal: 30, signedIn: true, appUrl: '' }

  const describe = () => ({
    url: here(),
    title: (meta('meta[property="og:title"]') || document.title || here()).slice(0, 300),
    publication: meta('meta[property="og:site_name"]'),
  })
  const highlights = () => anns.filter((a) => a.kind === 'highlight').sort((x, y) => x.createdAt - y.createdAt)
  const noteAnn = () => anns.find((a) => a.kind === 'note')

  async function save(a) {
    const saved = await send({ type: 'annSave', annotation: a })
    const i = anns.findIndex((x) => x.id === a.id)
    const next = saved ?? { ...a, updatedAt: Date.now() }
    if (a.deleted) anns = anns.filter((x) => x.id !== a.id)
    else if (i >= 0) anns[i] = next
    else anns.push(next)
    renderPanel()
    return next
  }

  function applyAll() {
    const root = bodyEl()
    if (!root) return
    for (const a of highlights()) {
      if (marksOf(a.id).length) continue
      const r = rangeOf(a, root)
      a.missing = !r
      if (r) wrap(r, a)
    }
    renderPanel()
  }

  async function load() {
    url = here()
    const list = await send({ type: 'annList', url })
    anns = Array.isArray(list) ? list : []
    // The post's text can arrive a moment after the page (Substack's own reader): try a few times.
    for (let i = 0; i < 10 && !bodyEl(); i++) await new Promise((r) => setTimeout(r, 500))
    applyAll()
    refreshStatus()
  }

  async function refreshStatus() {
    // The pill only on a post (not Substack's home feed, inbox, settings…); "Still reading?" anywhere.
    pill.hidden = !bodyEl()
    if (pill.hidden) panel.classList.remove('open')
    const s = await send({ type: 'pageStatus', url: here() })
    if (s) status = s
    renderPill()
  }

  // ── The UI (its own shadow root, so Substack's styles can't touch it) ──────
  const host = document.createElement('div')
  host.id = 'irb-host'
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; inset: auto 0 0 auto;'
  document.documentElement.append(host)
  const ui = host.attachShadow({ mode: 'open' })
  ui.innerHTML = `
  <style>
    :host { --bg:#fff; --ink:#171717; --body:#404040; --mute:#737373; --faint:#a3a3a3; --line:#ebebeb; --soft:#f5f5f5; --link:#0070f3; --sub:#ff6719; --ok:#0a9960; --err:#dc2626;
      font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--ink); }
    @media (prefers-color-scheme: dark) { :host { --bg:#141414; --ink:#ededed; --body:#c7c7c7; --mute:#8f8f8f; --faint:#6b6b6b; --line:#262626; --soft:#1c1c1c; --link:#3291ff; } }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
    .pill { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px 0 6px;
      border-radius: 999px; background: #111; color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(255,255,255,.06) inset; cursor: default; transition: transform .2s ease; }
    .pill:hover { transform: translateY(-1px); }
    .ring { width: 26px; height: 26px; }
    .pill .t { font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -.2px; }
    .pill .s { color: #a3a3a3; font-size: 12px; }
    .mode { display: none; align-items: center; gap: 5px; margin-left: 2px; padding: 2px 8px 2px 6px; border-radius: 999px; background: rgba(255,103,25,.18); color: #ffb48a; font-size: 11.5px; font-weight: 500; }
    .mode i { width: 7px; height: 7px; border-radius: 999px; background: var(--sub); }
    .on .mode { display: inline-flex; }
    .nosync { display: none; margin-left: 2px; padding: 2px 8px; border-radius: 999px; background: rgba(245,158,11,.2); color: #fbbf24; font-size: 11.5px; font-weight: 500; }
    .signedout .nosync { display: inline-flex; }
    .signin { margin-left: auto; height: 26px; padding: 0 10px; border-radius: 6px; background: #d97706; color: #fff; font-size: 12px; font-weight: 500; }
    .signin:hover { background: #b45309; }
    .panel { position: fixed; right: 18px; bottom: 66px; width: 330px; max-height: min(560px, calc(100vh - 100px)); display: flex; flex-direction: column;
      background: var(--bg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,.18);
      opacity: 0; transform: translateY(8px) scale(.98); transform-origin: bottom right; pointer-events: none; transition: opacity .16s ease, transform .2s cubic-bezier(.16,1,.3,1); }
    .panel.open { opacity: 1; transform: none; pointer-events: auto; }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 14px 10px; }
    .brand { font-weight: 600; letter-spacing: -.2px; }
    .eyebrow { font: 600 10.5px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--mute); }
    .stats { padding: 0 14px 12px; }
    .big { font-size: 26px; font-weight: 600; letter-spacing: -1px; line-height: 1; }
    .muted { color: var(--mute); }
    .bar { height: 5px; border-radius: 999px; background: var(--soft); overflow: hidden; margin-top: 8px; }
    .bar > b { display: block; height: 100%; width: 0; background: var(--sub); border-radius: 999px; transition: width .4s ease; }
    .bar.done > b { background: var(--ok); }
    .row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--line); }
    .row .grow { flex: 1; min-width: 0; }
    kbd { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 1px 5px; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; color: var(--body); background: var(--soft); }
    .switch { position: relative; width: 34px; height: 20px; border-radius: 999px; background: var(--line); transition: background .2s; flex: none; }
    .switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .2s cubic-bezier(.16,1,.3,1); }
    .switch[aria-checked="true"] { background: var(--sub); }
    .switch[aria-checked="true"]::after { transform: translateX(14px); }
    .scroll { overflow-y: auto; border-top: 1px solid var(--line); }
    .sec { padding: 12px 14px; }
    .sec + .sec { border-top: 1px solid var(--line); }
    textarea { width: 100%; min-height: 78px; resize: vertical; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--ink); font: inherit; outline: none; }
    textarea:focus { border-color: var(--link); box-shadow: 0 0 0 3px rgba(0,112,243,.15); }
    .saved { font-size: 11.5px; color: var(--faint); margin-top: 4px; min-height: 16px; }
    ul { list-style: none; margin: 8px 0 0; padding: 0; }
    li.h { display: flex; gap: 10px; padding: 7px 6px; margin: 0 -6px; border-radius: 6px; cursor: pointer; }
    li.h:hover { background: var(--soft); }
    li.h .c { width: 3px; border-radius: 3px; flex: none; }
    li.h .q { flex: 1; min-width: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; color: var(--ink); }
    li.h .n { display: block; margin-top: 3px; color: var(--mute); font-size: 12px; }
    li.h .x { opacity: 0; color: var(--faint); width: 22px; height: 22px; border-radius: 999px; flex: none; }
    li.h:hover .x { opacity: 1; }
    li.h .x:hover { color: var(--err); background: rgba(220,38,38,.08); }
    .gone { font-size: 11px; color: var(--faint); }
    .empty { color: var(--mute); margin-top: 6px; }
    .foot { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-top: 1px solid var(--line); font-size: 12px; }
    .foot a { color: var(--link); text-decoration: none; font-weight: 500; }
    .foot a:hover { text-decoration: underline; }
    .foot .sync { margin-left: auto; text-align: right; }
    .foot .sync.warn { color: #b45309; }
    .tools { position: fixed; display: none; align-items: center; gap: 2px; height: 40px; padding: 0 6px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 8px 28px rgba(0,0,0,.16); }
    .tools.show { display: flex; }
    .sw { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; }
    .sw:hover { background: var(--soft); }
    .sw i { width: 16px; height: 16px; border-radius: 999px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
    .sw.sel i { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink); }
    .sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
    .ib { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 999px; color: var(--body); }
    .ib:hover { background: var(--soft); color: var(--ink); }
    .ib.danger:hover { color: var(--err); background: rgba(220,38,38,.08); }
    .pop { position: fixed; display: none; width: 300px; padding: 8px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 12px 36px rgba(0,0,0,.18); }
    .pop.show { display: block; }
    .pop .line { display: flex; align-items: center; gap: 2px; }
    .pop textarea { min-height: 64px; margin-top: 8px; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 12px); opacity: 0; padding: 10px 14px; border-radius: 10px; background: #111; color: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); transition: opacity .2s ease, transform .25s cubic-bezier(.16,1,.3,1); pointer-events: none; white-space: nowrap; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    .still { position: fixed; left: 50%; top: 76px; width: min(400px, calc(100vw - 32px)); display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 16px;
      border-radius: 12px; background: var(--bg); border: 1px solid var(--line); box-shadow: 0 18px 48px rgba(0,0,0,.18);
      opacity: 0; transform: translate(-50%, -12px) scale(.97); pointer-events: none; transition: opacity .18s ease, transform .3s cubic-bezier(.16,1,.3,1); }
    .still.show { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
    .still .ic { color: var(--link); flex: none; }
    .still.paused .ic { color: var(--faint); }
    .still .grow { flex: 1; min-width: 0; }
    .still .st { font-weight: 600; }
    .still .sd { font-size: 12px; color: var(--mute); }
    .btn { height: 30px; padding: 0 12px; border-radius: 6px; background: var(--ink); color: var(--bg); font-size: 12.5px; font-weight: 500; white-space: nowrap; flex: none; }
    .btn:hover { opacity: .88; }
    .btn.outline { background: none; color: var(--ink); box-shadow: inset 0 0 0 1px var(--line); }
    .btn.outline:hover { opacity: 1; background: var(--soft); }
    .still .x { width: 28px; height: 28px; border-radius: 999px; color: var(--faint); flex: none; font-size: 16px; }
    .still .x:hover { background: var(--soft); color: var(--ink); }
    .pill.asking .s { color: #7cb8ff; }
    .pill.paused .ring { opacity: .45; }
    .state { margin-top: 10px; padding: 7px 10px; border-radius: 8px; background: var(--soft); color: var(--body); font-size: 12px; }
    [hidden] { display: none !important; }
    svg { display: block; }
  </style>
  <div class="still" role="alertdialog" aria-live="assertive" data-k="still">
    <svg class="ic" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg>
    <div class="grow"><div class="st" data-k="stilltitle">Still reading?</div><div class="sd" data-k="stilltext"></div></div>
    <button class="btn" data-k="stillbtn">I’m here</button>
    <button class="x" data-k="stillx" aria-label="Dismiss">×</button>
  </div>
  <div class="pill" part="pill" tabindex="0" aria-label="I read on this page">
    <svg class="ring" viewBox="0 0 26 26"><circle cx="13" cy="13" r="10.5" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="3"/><circle class="arc" cx="13" cy="13" r="10.5" fill="none" stroke="#ff6719" stroke-width="3" stroke-linecap="round" transform="rotate(-90 13 13)" stroke-dasharray="0 66"/></svg>
    <span class="t">0 min</span><span class="s">this article</span>
    <span class="mode"><i></i>Highlighting</span>
    <span class="nosync" title="Not signed in: this time isn’t reaching I read">Not syncing</span>
  </div>
  <div class="panel" role="dialog" aria-label="I read on this page">
    <div class="head">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>
      <span class="brand">I read</span><button class="signin" data-k="signed" hidden>Sign in to sync</button>
    </div>
    <div class="stats">
      <div class="eyebrow">This article</div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-top:6px"><span class="big" data-k="article">0</span><span class="muted">min read</span></div>
      <div style="display:flex;justify-content:space-between;margin-top:12px" class="muted"><span>Substack today</span><span data-k="today">0 of 30 min</span></div>
      <div class="bar" data-k="todaybar"><b></b></div>
      <div class="state" data-k="state" hidden></div>
    </div>
    <div class="row">
      <div class="grow"><div>Highlight with I read</div><div class="muted" style="font-size:12px">instead of Substack’s pop-up · <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>H</kbd></div></div>
      <button class="switch" role="switch" aria-checked="false" aria-label="Highlight with I read" data-k="switch"></button>
    </div>
    <div class="scroll">
      <div class="sec">
        <div class="eyebrow">Notes</div>
        <textarea data-k="notes" placeholder="Your thoughts on this article…" style="margin-top:8px"></textarea>
        <div class="saved" data-k="saved"></div>
      </div>
      <div class="sec">
        <div class="eyebrow" data-k="hlcount">Highlights</div>
        <ul data-k="list"></ul>
      </div>
    </div>
    <div class="foot"><a data-k="open" href="#" target="_blank" rel="noopener">Open I read</a><span class="muted sync" data-k="sync"></span></div>
  </div>
  <div class="tools" role="toolbar" aria-label="Highlight with I read" data-k="tools"></div>
  <div class="pop" role="dialog" aria-label="Highlight" data-k="pop">
    <div class="line" data-k="popline"></div>
    <textarea data-k="popnote" placeholder="Add a note…"></textarea>
  </div>
  <div class="toast" data-k="toast"></div>`
  const $ = (k) => ui.querySelector(`[data-k="${k}"]`)
  const pill = ui.querySelector('.pill')
  const panel = ui.querySelector('.panel')

  const mins = (s) => Math.floor(s / 60)
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60_000)
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
  }
  function renderPill() {
    const goal = status.goal || 0
    const frac = goal ? Math.min(1, status.todaySecs / (goal * 60)) : 0
    const { asking, away } = R?.state() ?? {}
    const paused = !!away && !away.back
    ui.querySelector('.arc').setAttribute('stroke-dasharray', `${(frac * 66).toFixed(1)} 66`)
    ui.querySelector('.arc').setAttribute('stroke', goal && status.todaySecs >= goal * 60 ? '#22c55e' : '#ff6719')
    pill.querySelector('.t').textContent = `${mins(status.articleSecs)} min`
    pill.querySelector('.s').textContent = paused ? 'paused' : asking != null ? 'still reading?' : 'this article'
    pill.classList.toggle('paused', paused)
    pill.classList.toggle('asking', !paused && asking != null)
    $('state').hidden = !paused
    $('state').textContent = 'Reading time paused. It runs again when you scroll or move the mouse.'
    pill.classList.toggle('on', mode)
    $('article').textContent = String(mins(status.articleSecs))
    $('today').textContent = goal ? `${mins(status.todaySecs)} of ${goal} min` : `${mins(status.todaySecs)} min`
    $('todaybar').firstElementChild.style.width = `${frac * 100}%`
    $('todaybar').classList.toggle('done', !!goal && status.todaySecs >= goal * 60)
    // Signed out, it still counts here but nothing reaches I read: say so where you look.
    $('signed').hidden = status.signedIn
    pill.classList.toggle('signedout', !status.signedIn)
    // Whether this has really reached I read (not just counted here).
    const sy = status.sync ?? {}
    const sync = $('sync')
    sync.classList.toggle('warn', !status.signedIn || !!sy.error)
    sync.textContent = !status.signedIn
      ? 'Not signed in, so not in I read yet'
      : sy.error
        ? sy.error
        : sy.waiting
          ? 'Waiting to sync to I read…'
          : sy.lastSyncAt
            ? `In I read · synced ${ago(sy.lastSyncAt)}`
            : 'Not synced to I read yet'
    $('open').href = status.appUrl || '#'
    $('switch').setAttribute('aria-checked', String(mode))
  }

  function renderPanel() {
    const list = $('list')
    const hs = highlights()
    $('hlcount').textContent = hs.length ? `Highlights · ${hs.length}` : 'Highlights'
    list.replaceChildren(
      ...(hs.length
        ? hs.map((a) => {
            const li = document.createElement('li')
            li.className = 'h'
            const c = document.createElement('span')
            c.className = 'c'
            c.style.background = colorOf(a.color).swatch
            const q = document.createElement('span')
            q.className = 'q'
            q.textContent = `“${a.text}”`
            if (a.note?.trim()) {
              const n = document.createElement('span')
              n.className = 'n'
              n.textContent = a.note.trim()
              q.append(n)
            }
            if (a.missing) {
              const g = document.createElement('span')
              g.className = 'gone'
              g.textContent = ' · not found on the page now'
              q.append(g)
            }
            const x = document.createElement('button')
            x.className = 'x'
            x.setAttribute('aria-label', 'Remove highlight')
            x.textContent = '×'
            x.addEventListener('click', (e) => {
              e.stopPropagation()
              remove(a)
            })
            li.append(c, q, x)
            li.addEventListener('click', () => {
              const m = marksOf(a.id)[0]
              if (!m) return
              m.scrollIntoView({ behavior: 'smooth', block: 'center' })
              marksOf(a.id).forEach((el) => el.classList.add('irb-flash'))
              setTimeout(() => marksOf(a.id).forEach((el) => el.classList.remove('irb-flash')), 1400)
            })
            return li
          })
        : [Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Press Alt+Shift+H, then select text to highlight it.' })]),
    )
    const notes = $('notes')
    if (ui.activeElement !== notes) notes.value = noteAnn()?.note ?? ''
  }

  // Open on hover; stay open while you're in it (or typing).
  let closeT
  const open = () => {
    clearTimeout(closeT)
    panel.classList.add('open')
    refreshStatus()
  }
  const closeSoon = () => {
    clearTimeout(closeT)
    closeT = setTimeout(() => {
      if (ui.activeElement && panel.contains(ui.activeElement)) return
      panel.classList.remove('open')
    }, 350)
  }
  for (const el of [pill, panel]) {
    el.addEventListener('mouseenter', open)
    el.addEventListener('mouseleave', closeSoon)
  }
  pill.addEventListener('click', () => (panel.classList.contains('open') ? panel.classList.remove('open') : open()))
  $('notes').addEventListener('blur', closeSoon)
  $('switch').addEventListener('click', () => setMode(!mode))
  $('signed').addEventListener('click', () => send({ type: 'openSignIn' }))

  // Notes autosave.
  let noteT
  $('notes').addEventListener('input', () => {
    $('saved').textContent = 'Saving…'
    clearTimeout(noteT)
    noteT = setTimeout(async () => {
      const text = $('notes').value
      const existing = noteAnn()
      await save({ ...(existing ?? { id: uuid(), kind: 'note', createdAt: Date.now() }), ...describe(), note: text })
      $('saved').textContent = 'Saved'
    }, 600)
  })

  // ── "Still reading?" and "Reading time paused" (content.js keeps the clock) ──
  const dur = (s) => {
    const m = Math.round(s / 60)
    if (m < 1) return 'under a minute'
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60)
    return m % 60 ? `${h} hr ${m % 60} min` : `${h} hr`
  }
  function renderStill() {
    renderPill()
    const { asking, away } = R?.state() ?? {}
    const card = $('still')
    card.classList.toggle('show', asking != null || !!away)
    card.classList.toggle('paused', !!away)
    if (asking == null && !away) return
    card.setAttribute('aria-label', away ? 'Reading time paused' : 'Still reading?')
    $('stilltitle').textContent = !away ? 'Still reading?' : away.back ? 'Welcome back' : 'Reading time paused'
    $('stilltext').textContent = !away
      ? `Your reading time pauses in ${asking} s.`
      : away.off > 0
        ? `${dur(away.off)} while you were away ${away.off < 90 ? 'wasn’t' : 'weren’t'} counted.`
        : away.back
          ? 'Your reading time is running again.'
          : 'It runs again when you’re back.'
    const btn = $('stillbtn')
    btn.hidden = !!away && !(away.off > 0)
    btn.textContent = away ? 'I was reading' : 'I’m here'
    btn.classList.toggle('outline', !!away)
    $('stillx').hidden = !away?.back
  }
  $('stillbtn').addEventListener('click', () => (R?.state().away ? R.countAway() : R?.stillHere()))
  $('stillx').addEventListener('click', () => R?.dismiss())
  R?.subscribe(renderStill)

  // ── I read's highlighting (instead of Substack's pop-up) ──────────────────
  let toastT
  function toast(text) {
    const t = $('toast')
    t.textContent = text
    t.classList.add('show')
    clearTimeout(toastT)
    toastT = setTimeout(() => t.classList.remove('show'), 2200)
  }
  function setMode(on) {
    mode = on
    document.documentElement.classList.toggle('irb-mode', on)
    renderPill()
    if (!on) hideTools()
    toast(on ? 'I read highlighting is on — select text to highlight' : 'I read highlighting is off')
  }
  addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyH') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setMode(!mode)
      }
    },
    true,
  )

  const ours = (e) => e.composedPath().includes(host)
  const inBody = (node) => {
    const b = bodyEl()
    const el = node && (node.nodeType === Node.TEXT_NODE ? node.parentNode : node)
    return !!b && !!el && b.contains(el)
  }
  const selection = () => {
    const s = getSelection()
    return s && !s.isCollapsed && s.rangeCount && inBody(s.anchorNode) && inBody(s.focusNode) ? s : null
  }

  // While it's on, Substack's own selection pop-up never hears about the selection.
  for (const type of ['mouseup', 'pointerup', 'touchend']) {
    addEventListener(
      type,
      (e) => {
        if (!mode || ours(e) || !inBody(e.target)) return
        e.stopImmediatePropagation()
        if (type === 'mouseup' || type === 'touchend') setTimeout(showTools, 0)
      },
      true,
    )
  }
  addEventListener(
    'selectionchange',
    (e) => {
      if (mode && selection()) e.stopImmediatePropagation()
    },
    true,
  )

  function placeNear(el, rect, w, h) {
    const x = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8))
    let y = rect.top - h - 10
    if (y < 8) y = rect.bottom + 10
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }

  function swatch(c, selected, onPick) {
    const b = document.createElement('button')
    b.className = `sw${selected ? ' sel' : ''}`
    b.setAttribute('aria-label', `${c.label}`)
    b.title = c.label
    b.innerHTML = `<i style="background:${c.swatch}"></i>`
    b.addEventListener('pointerdown', (e) => e.preventDefault())
    b.addEventListener('click', onPick)
    return b
  }

  function showTools() {
    const s = selection()
    if (!s) return hideTools()
    const range = s.getRangeAt(0)
    const tools = $('tools')
    const sep = document.createElement('span')
    sep.className = 'sep'
    const note = document.createElement('button')
    note.className = 'ib'
    note.title = 'Highlight with a note'
    note.setAttribute('aria-label', 'Highlight with a note')
    note.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/></svg>'
    note.addEventListener('pointerdown', (e) => e.preventDefault())
    note.addEventListener('click', async () => {
      const a = await highlight(range, 'yellow')
      if (a) openPop(a, true)
    })
    tools.replaceChildren(...COLORS.map((c) => swatch(c, false, () => highlight(range, c.key))), sep, note)
    tools.classList.add('show')
    placeNear(tools, range.getBoundingClientRect(), tools.offsetWidth || 230, 40)
  }
  function hideTools() {
    $('tools').classList.remove('show')
  }

  async function highlight(range, color) {
    const root = bodyEl()
    const q = root && quoteOf(range, root)
    hideTools()
    if (!q) return null
    const a = { id: uuid(), kind: 'highlight', ...describe(), ...q, color, createdAt: Date.now() }
    wrap(range, a)
    getSelection()?.removeAllRanges()
    return save(a)
  }

  async function remove(a) {
    unwrap(a.id)
    hidePop()
    await save({ ...a, deleted: true })
    toast('Highlight removed')
  }

  // ── A highlight's card: colour, note, remove ──────────────────────────────
  let popFor = null
  let popT
  function openPop(a, focusNote = false) {
    popFor = a.id
    const pop = $('pop')
    const line = $('popline')
    const del = document.createElement('button')
    del.className = 'ib danger'
    del.style.marginLeft = 'auto'
    del.title = 'Remove highlight'
    del.setAttribute('aria-label', 'Remove highlight')
    del.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>'
    del.addEventListener('click', () => remove(anns.find((x) => x.id === popFor) ?? a))
    line.replaceChildren(
      ...COLORS.map((c) =>
        swatch(c, c.key === a.color, async () => {
          const cur = anns.find((x) => x.id === popFor) ?? a
          const next = { ...cur, color: c.key }
          marksOf(cur.id).forEach((m) => paint(m, next))
          openPop(await save(next))
        }),
      ),
      del,
    )
    const ta = $('popnote')
    ta.value = a.note ?? ''
    pop.classList.add('show')
    const m = marksOf(a.id)[0]
    placeNear(pop, m ? m.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, bottom: innerHeight / 2 }, 300, pop.offsetHeight || 120)
    if (focusNote) setTimeout(() => ta.focus(), 0)
  }
  function hidePop() {
    $('pop').classList.remove('show')
    popFor = null
  }
  $('popnote').addEventListener('input', () => {
    clearTimeout(popT)
    const id = popFor
    popT = setTimeout(async () => {
      const cur = anns.find((x) => x.id === id)
      if (!cur) return
      const next = { ...cur, note: $('popnote').value }
      marksOf(id).forEach((m) => paint(m, next))
      await save(next)
    }, 500)
  })

  // Clicking a highlight opens its card; clicking elsewhere closes cards and the toolbar.
  addEventListener(
    'click',
    (e) => {
      if (ours(e)) return
      const m = e.target instanceof Element ? e.target.closest('mark.irb-hl') : null
      if (m && getSelection()?.isCollapsed !== false) {
        const a = anns.find((x) => x.id === m.dataset.irbId)
        if (a) {
          e.preventDefault()
          e.stopImmediatePropagation()
          openPop(a)
          return
        }
      }
      hidePop()
      if (!selection()) hideTools()
    },
    true,
  )
  addEventListener('scroll', () => (hideTools(), hidePop()), { passive: true })
  addEventListener('keydown', (e) => e.key === 'Escape' && (hideTools(), hidePop()))

  // ── Go ─────────────────────────────────────────────────────────────────────
  load()
  setInterval(refreshStatus, 15_000)
  // Substack's own reader changes post without reloading: start over for the new one.
  setInterval(() => {
    if (here() === url) return
    for (const a of highlights()) unwrap(a.id)
    anns = []
    hideTools()
    hidePop()
    load()
  }, 1000)
})()
