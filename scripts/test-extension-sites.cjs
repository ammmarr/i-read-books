// Checks the I read extension on every site it knows, in a real browser, and that a NEW site needs only a few lines.
//   node scripts/test-extension-sites.cjs        (needs Playwright; the AQ system's backend/node_modules has it)
//
// It serves fake pages at the REAL addresses (x.com, a substack.com newsletter, example.org) through Playwright's
// request interception, runs the real sites.js + content.js + annotate.js with a stubbed `chrome` API (annotations are kept
// in the page's localStorage so a reload finds them again), and looks at what they report and draw.
//
// The same scenario runs on every site: the reading clock, then the pill, the highlight switch, a highlight across two
// paragraphs, a note, a reload that brings both back, and deleting the highlight. If a site needs different code to pass,
// the extension has become site-specific again.
const path = require('path')
const fs = require('fs')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'D:/work/AQproperties/AQ system/backend/node_modules/playwright')

const results = []
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))) }
const TITLE = 'The 2027 Marketing Playbook: How to Generate So Much Demand | It Breaks Your Business'
const para = (n) => `Paragraph ${n}. Why do most businesses need more customers, not a better product? `.repeat(8)
const paras = (wrap) => [1, 2, 3, 4].map((n) => wrap(para(n))).join('\n')

// X's article page, as observed on the real thing: .x-article-body (inside [data-article-part=body]) holding h3 / p (their text
// in a span) / ul / ol / figure, no data-testid, no <article>.
const articlePage = `<!doctype html><html><head><title>${TITLE} | Jay Yang (@Jayyanginspires) on X</title>
<meta property="og:title" content="STALE: the page before"><meta property="og:type" content="article"><meta name="author" content="Jay Yang"></head>
<body><h1>${TITLE}</h1><div data-article-part="body" class="mt-7"><div class="x-article-body break-words text-[16px]"><div class="contents">
<h3 class="font-article text-balance mt-7"><span>Why do most businesses need more customers?</span></h3>
${paras((t) => `<p><span>${t}</span></p>`)}
<ul><li><span>one</span></li><li><span>two</span></li></ul><figure><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></figure><ol><li><span>first</span></li></ol>
</div></div></div></body></html>`
const postPage = `<!doctype html><html><head><title>Jay Yang on X: "a short post" / X</title></head><body><article><div data-testid="tweetText">${para(1)}</div></article></body></html>`
const homePage = `<!doctype html><html><head><title>Home / X</title></head><body><div>${para(1)}</div></body></html>`
const substackPage = `<!doctype html><html><head><title>A post</title><meta property="og:title" content="A newsletter post"><meta property="og:site_name" content="The Letter"><meta name="author" content="Ann"><link href="https://substackcdn.com/x.css" rel="stylesheet"></head><body><div class="available-content"><div class="body markup">${paras((t) => `<p>${t}</p>`)}</div></div></body></html>`
const blogPost = `<!doctype html><html><head><title>Hello | Example Blog</title><meta property="og:title" content="Hello world"></head><body><nav>menu</nav><article><div class="prose">${paras((t) => `<p>${t}</p>`)}</div></article></body></html>`
const blogAbout = `<!doctype html><html><head><title>About</title></head><body><article><div class="prose">${para(1)}</div></article></body></html>`
const otherPage = `<!doctype html><html><head><title>Some site</title></head><body><p>${para(1)}</p></body></html>`

const STUB = `
  window.__msgs = []
  document.hasFocus = () => true
  const store = () => JSON.parse(localStorage.getItem('__ann') || '[]')
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }),
    sendMessage: (m) => {
      window.__msgs.push(JSON.parse(JSON.stringify(m)))
      if (m.type === 'annSave') { const saved = { ...m.annotation, updatedAt: Date.now() }; localStorage.setItem('__ann', JSON.stringify([...store().filter((a) => a.id !== saved.id), saved])); return Promise.resolve(saved) }
      if (m.type === 'annList') return Promise.resolve(store().filter((a) => a.url === m.url && !a.deleted))
      if (m.type === 'pageStatus') return Promise.resolve({ signedIn: true, todaySecs: 600, articleSecs: 120, goal: 50, appUrl: '#', sync: {} })
      return Promise.resolve(null)
    },
    onMessage: { addListener() {} } } }`
const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', f), 'utf8')
const SITES = src('sites.js'), CONTENT = src('content.js'), ANNOTATE = src('annotate.js')
// A site the extension has never heard of: this is ALL it takes to give it the clock, the pill, notes and highlights.
const NEW_SITE = `__irbSites.define({ id: 'blog', name: 'Example Blog', hosts: ['example.org'], pages: /^\\/posts\\//, body: ['article .prose'] })`

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  const pages = {
    'x.com': (p) => (/\/article\/\d+/.test(p) ? articlePage : /\/status\//.test(p) ? postPage : homePage),
    'www.twitter.com': (p) => (/\/article\/\d+/.test(p) ? articlePage : homePage),
    'newsletter.substack.com': () => substackPage,
    'example.org': (p) => (p.startsWith('/posts/') ? blogPost : blogAbout),
    'example.com': () => otherPage, 'notx.com': () => articlePage, 'x.com.evil.test': () => articlePage,
  }
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url()), f = pages[u.hostname]
    if (!f || route.request().resourceType() !== 'document') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ contentType: 'text/html', body: f(u.pathname) })
  })
  const inject = async (page, extra = '') => {
    await page.addScriptTag({ content: SITES })
    if (extra) await page.addScriptTag({ content: extra })
    await page.addScriptTag({ content: CONTENT })
    await page.addScriptTag({ content: ANNOTATE })
  }
  async function open(url, extra = '') {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  PAGEERROR', e.message))
    await page.addInitScript(STUB)
    await page.goto(url)
    await inject(page, extra)
    return page
  }
  const reads = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(60); return page.evaluate(() => { const by = {}; window.__msgs.filter((m) => m.type === 'read').forEach((m) => (by[m.visit.id] = m.visit)); return Object.values(by) }) }
  const ui = (page, fn, arg) => page.evaluate(([f, a]) => { const root = document.getElementById('irb-host')?.shadowRoot; return root ? new Function('root', 'a', 'return (' + f + ')(root, a)')(root, a) : null }, [fn.toString(), arg])
  const sent = (page, type) => page.evaluate((t) => window.__msgs.filter((m) => m.type === t), type)

  /** The same scenario on every site. */
  async function scenario(label, page, o) {
    const pl = await ui(page, (r) => ({ pillHidden: r.querySelector('.pill').hidden, row: r.querySelector('.row').hidden, scroll: r.querySelector('.scroll').hidden, site: r.querySelector('[data-k=sitename]').textContent, sw: r.querySelector('[data-k=switch]').getAttribute('aria-checked') }))
    ok(`${label}: the pill shows, with the highlight switch and notes (nothing hidden)`, pl && !pl.pillHidden && pl.row === false && pl.scroll === false, pl)
    ok(`${label}: the panel names the site ("${o.name}")`, pl?.site === o.name, pl?.site)

    await page.keyboard.press('Alt+Shift+KeyH'); await page.waitForTimeout(100)
    ok(`${label}: Alt+Shift+H turns I read's highlighting on`, (await ui(page, (r) => r.querySelector('[data-k=switch]').getAttribute('aria-checked'))) === 'true' && (await page.evaluate(() => document.documentElement.classList.contains('irb-mode'))))

    // select from inside the first paragraph to inside the second, as a person would, then let go of the mouse
    await page.evaluate((body) => {
      const b = document.querySelector(body), ps = [...b.querySelectorAll('p')], first = (el) => document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()
      const r = document.createRange(); r.setStart(first(ps[0]), 5); r.setEnd(first(ps[1]), 20)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
      ps[1].dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true }))
    }, o.body)
    await page.waitForTimeout(150)
    ok(`${label}: selecting text brings up the colour toolbar`, await ui(page, (r) => r.querySelector('[data-k=tools]').classList.contains('show')))
    await ui(page, (r) => r.querySelector('[data-k=tools] .sw').click())
    await page.waitForTimeout(250)
    const hl = (await sent(page, 'annSave')).filter((m) => m.annotation.kind === 'highlight')
    const a = hl[0]?.annotation
    ok(`${label}: a highlight across two paragraphs is saved with its quote, address, title and publication`, hl.length === 1 && a.text.includes('Paragraph 1') && a.text.includes('Paragraph 2') && a.url === o.url && a.title === o.title && a.publication === o.publication, a)
    ok(`${label}: ...and is drawn on the page`, (await page.evaluate(() => document.querySelectorAll('mark.irb-hl').length)) >= 2)
    ok(`${label}: ...and listed in the panel`, (await ui(page, (r) => r.querySelectorAll('li.h').length)) === 1)

    // a note for the article
    await ui(page, (r) => { const t = r.querySelector('[data-k=notes]'); t.value = 'My thoughts on this'; t.dispatchEvent(new Event('input', { bubbles: true })) })
    await page.waitForTimeout(1000)
    const notes = (await sent(page, 'annSave')).filter((m) => m.annotation.kind === 'note')
    ok(`${label}: a note is saved against the article`, notes.length >= 1 && notes.at(-1).annotation.note === 'My thoughts on this' && notes.at(-1).annotation.url === o.url && notes.at(-1).annotation.publication === o.publication, notes.at(-1)?.annotation)
    ok(`${label}: ...and the panel says Saved`, (await ui(page, (r) => r.querySelector('[data-k=saved]').textContent)) === 'Saved')

    // come back later: the highlight and the note are there again
    await page.reload(); await inject(page, o.extra); await page.waitForTimeout(1800)
    ok(`${label}: after a reload the highlight is drawn again`, (await page.evaluate(() => document.querySelectorAll('mark.irb-hl').length)) >= 2)
    ok(`${label}: ...and the note is back in the panel`, (await ui(page, (r) => r.querySelector('[data-k=notes]').value)) === 'My thoughts on this')

    // delete the highlight from its card
    await page.evaluate(() => document.querySelector('mark.irb-hl').click()); await page.waitForTimeout(150)
    await ui(page, (r) => r.querySelector('[data-k=popline] .ib.danger').click()); await page.waitForTimeout(250)
    const removed = (await sent(page, 'annSave')).filter((m) => m.annotation.kind === 'highlight' && m.annotation.deleted)
    ok(`${label}: deleting the highlight removes it from the page and says so`, removed.length === 1 && (await page.evaluate(() => document.querySelectorAll('mark.irb-hl').length)) === 0, removed.length)

    // (a reload starts with highlighting off, as it always did: the switch is for the moment, not remembered)
    const isOn = () => page.evaluate(() => document.documentElement.classList.contains('irb-mode'))
    ok(`${label}: after a reload highlighting starts off`, !(await isOn()))
    await page.keyboard.press('Alt+Shift+KeyH'); await page.waitForTimeout(80)
    const on = await isOn()
    await page.keyboard.press('Alt+Shift+KeyH'); await page.waitForTimeout(80)
    ok(`${label}: Alt+Shift+H switches it on, and off again`, on && !(await isOn()))
  }

  // ───────── X ─────────
  let page = await open('https://x.com/Jayyanginspires/article/2116534636188729593')
  await page.waitForTimeout(5500)
  let r = await reads(page)
  ok('X: an article is counted', r.length === 1 && r[0].seconds >= 4, r)
  ok('X: ...as site "x", publication "X", at the article address', r[0]?.site === 'x' && r[0]?.publication === 'X' && r[0]?.url === 'https://x.com/Jayyanginspires/article/2116534636188729593', r[0])
  ok('X: ...named from the tab title, not the stale og:title, with the author', r[0]?.title === TITLE && r[0]?.author === 'Jay Yang', [r[0]?.title, r[0]?.author])
  await scenario('X', page, { name: 'X', body: '.x-article-body', url: 'https://x.com/Jayyanginspires/article/2116534636188729593', title: TITLE, publication: 'X' })
  await page.evaluate(() => localStorage.clear()); await page.close()

  page = await open('https://x.com/i/article/2116534636188729593'); await page.waitForTimeout(3500)
  r = await reads(page); ok('X: x.com/i/article/<id> counts too', r.length === 1 && r[0].seconds >= 2 && r[0].site === 'x', r); await page.close()
  page = await open('https://www.twitter.com/Jayyanginspires/article/2116534636188729593'); await page.waitForTimeout(3500)
  r = await reads(page); ok('X: twitter.com articles count too', r.length === 1 && r[0].seconds >= 2, r); await page.close()

  // what is NOT an article
  for (const [name, url] of [['a normal post', 'https://x.com/Jayyanginspires/status/2116534636188729593'], ['the feed', 'https://x.com/home'], ['a profile', 'https://x.com/Jayyanginspires'], ['a look-alike path', 'https://x.com/Jayyanginspires/status/1/article/2']]) {
    page = await open(url); await page.waitForTimeout(3500)
    r = await reads(page)
    const quiet = await page.evaluate(() => !window.__msgs.some((m) => m.type === 'pageStatus' || m.type === 'annList'))
    const pill = await ui(page, (rt) => rt.querySelector('.pill').hidden)
    ok(`X: ${name} is NOT counted, shows no pill and does not ask the extension for anything`, r.length === 0 && quiet && (pill === null || pill === true), [r.length, quiet, pill])
    await page.close()
  }
  for (const [name, url] of [['notx.com', 'https://notx.com/Jayyanginspires/article/2116534636188729593'], ['x.com.evil.test', 'https://x.com.evil.test/Jayyanginspires/article/2116534636188729593'], ['an ordinary site', 'https://example.com/']]) {
    page = await open(url); await page.waitForTimeout(2500)
    ok(`${name} is not a known site: nothing counted, nothing added to the page`, (await reads(page)).length === 0 && !(await page.evaluate(() => !!document.getElementById('irb-host'))))
    await page.close()
  }

  // X changes the page without reloading: feed -> article -> normal post -> article
  page = await open('https://x.com/home'); await page.waitForTimeout(2200)
  ok('X (no reload): on the feed, still nothing', (await reads(page)).length === 0)
  const toArticle = () => page.evaluate(([t, html]) => { history.pushState({}, '', '/Jayyanginspires/article/2116534636188729593'); document.title = t + ' | Jay Yang (@Jayyanginspires) on X'; document.body.innerHTML = html }, [TITLE, `<h1>${TITLE}</h1><div class="x-article-body"><p><span>${para(1)}</span></p><p><span>${para(2)}</span></p></div>`])
  await toArticle(); await page.waitForTimeout(4500)
  r = await reads(page); const s1 = r[0]?.seconds
  ok('X (no reload): opening an article from the feed starts counting, under its own title', r.length === 1 && s1 >= 3 && r[0].title === TITLE, r)
  ok('X (no reload): ...the pill appears and the page was asked for its notes', (await ui(page, (rt) => rt.querySelector('.pill').hidden)) === false && (await sent(page, 'annList')).some((m) => m.url.endsWith('/article/2116534636188729593')))
  await page.evaluate(() => { history.pushState({}, '', '/Jayyanginspires/status/999'); document.title = 'Jay Yang on X: "a short post" / X'; document.body.innerHTML = '<article>a short post</article>' })
  await page.waitForTimeout(1500)
  const frozen = (await reads(page))[0].seconds
  await page.waitForTimeout(3500)
  r = await reads(page)
  ok('X (no reload): moving to a normal post stops the clock and hides the pill', r.length === 1 && r[0].seconds === frozen && frozen >= s1 && (await ui(page, (rt) => rt.querySelector('.pill').hidden)) === true, [s1, frozen, r[0]?.seconds])
  await toArticle(); await page.waitForTimeout(3500)
  r = await reads(page)
  ok('X (no reload): coming back to the article counts again', r.reduce((a, v) => a + v.seconds, 0) > frozen && r.every((v) => v.url.endsWith('/article/2116534636188729593')), r.map((v) => v.seconds))
  await page.close()

  // ───────── Substack: the same scenario, unchanged behaviour ─────────
  page = await open('https://newsletter.substack.com/p/a-post'); await page.waitForTimeout(4500)
  r = await reads(page)
  ok('Substack: a post counts, as substack, named from its own tags', r.length === 1 && r[0].seconds >= 3 && r[0].site === 'substack' && r[0].publication === 'The Letter' && r[0].title === 'A newsletter post' && r[0].author === 'Ann', r)
  await scenario('Substack', page, { name: 'Substack', body: '.body.markup', url: 'https://newsletter.substack.com/p/a-post', title: 'A newsletter post', publication: 'The Letter' })
  await page.evaluate(() => localStorage.clear()); await page.close()

  // ───────── a site that did not exist a minute ago: three lines of description ─────────
  page = await open('https://example.org/posts/hello', NEW_SITE); await page.waitForTimeout(4500)
  r = await reads(page)
  ok('NEW SITE: a post counts with no other code', r.length === 1 && r[0].seconds >= 3 && r[0].site === 'blog' && r[0].title === 'Hello world' && r[0].publication === 'example.org', r)
  await scenario('NEW SITE', page, { name: 'Example Blog', body: 'article .prose', url: 'https://example.org/posts/hello', title: 'Hello world', publication: 'example.org', extra: NEW_SITE })
  await page.close()
  page = await open('https://example.org/about', NEW_SITE); await page.waitForTimeout(3000)
  ok('NEW SITE: a page outside its `pages` rule is not counted and shows no pill', (await reads(page)).length === 0 && ((await ui(page, (rt) => rt.querySelector('.pill').hidden)) === true))
  await page.close()
  page = await open('https://example.org/posts/hello'); await page.waitForTimeout(2500)   // without the three lines: unknown site
  ok('NEW SITE: without its description the extension does nothing there', (await reads(page)).length === 0 && !(await page.evaluate(() => !!document.getElementById('irb-host'))))
  await page.close()

  await browser.close()
  const failed = results.filter((x) => !x).length
  console.log('\n' + (results.length - failed) + ' / ' + results.length + ' passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
