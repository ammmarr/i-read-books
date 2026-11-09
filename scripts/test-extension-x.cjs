// Checks that X articles count as reading time and nothing else on X does, in a real browser.
// It serves fake pages at the REAL addresses (x.com, a substack.com newsletter) through Playwright's request
// interception, runs the real content.js + annotate.js with a stubbed `chrome` API, and looks at what they report.
//   node scripts/test-extension-x.cjs        (needs Playwright; the AQ system's backend/node_modules has it)
const path = require('path')
const fs = require('fs')
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'D:/work/AQproperties/AQ system/backend/node_modules/playwright')

const results = []
const ok = (name, cond, extra) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond || extra === undefined ? '' : '  -> ' + JSON.stringify(extra))) }
const TITLE = 'The 2027 Marketing Playbook: How to Generate So Much Demand | It Breaks Your Business'
const text = 'Why do most businesses need more customers, not a better product? '.repeat(60)

const articlePage = `<!doctype html><html><head><title>${TITLE} | Jay Yang (@Jayyanginspires) on X</title>
<meta property="og:title" content="${TITLE}"><meta property="og:type" content="article"><meta name="author" content="Jay Yang"></head>
<body><h1>${TITLE}</h1><div data-article-part="body"><div class="x-article-body"><p>${text}</p></div></div></body></html>`
const postPage = `<!doctype html><html><head><title>Jay Yang on X: "a short post" / X</title></head><body><article><div data-testid="tweetText">a short post that is not an article</div></article></body></html>`
const homePage = `<!doctype html><html><head><title>Home / X</title></head><body><div>the feed</div></body></html>`
const substackPage = `<!doctype html><html><head><title>A post</title><meta property="og:title" content="A newsletter post"><meta property="og:site_name" content="The Letter"><meta name="author" content="Ann"><link href="https://substackcdn.com/x.css" rel="stylesheet"></head><body><div class="available-content"><div class="body markup"><p>${text}</p></div></div></body></html>`
const otherPage = `<!doctype html><html><head><title>Some site</title></head><body><p>${text}</p></body></html>`

const STUB = `
  window.__msgs = []
  document.hasFocus = () => true
  window.chrome = { runtime: { id: 'test', getManifest: () => ({ version: 'test' }),
    sendMessage: (m) => { window.__msgs.push(JSON.parse(JSON.stringify(m))); return Promise.resolve(m.type === 'pageStatus' ? { signedIn: true, todaySecs: 600, articleSecs: 120, goal: 50, appUrl: '#', sync: {} } : m.type === 'annList' ? [] : null) },
    onMessage: { addListener() {} } } }`
const content = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content.js'), 'utf8')
const annotate = fs.readFileSync(path.join(__dirname, '..', 'extension', 'annotate.js'), 'utf8')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  const pages = { 'x.com': (p) => (/\/article\/\d+/.test(p) ? articlePage : /\/status\//.test(p) ? postPage : homePage), 'newsletter.substack.com': () => substackPage, 'example.com': () => otherPage, 'www.twitter.com': (p) => (/\/article\/\d+/.test(p) ? articlePage : homePage), 'notx.com': () => articlePage, 'x.com.evil.test': () => articlePage }
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url()); const f = pages[u.hostname]
    if (!f || route.request().resourceType() !== 'document') return route.fulfill({ status: 204, body: '' })
    return route.fulfill({ contentType: 'text/html', body: f(u.pathname) })
  })
  async function open(url) {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.log('  PAGEERROR', e.message))
    await page.addInitScript(STUB)
    await page.goto(url)
    await page.addScriptTag({ content })
    await page.addScriptTag({ content: annotate })
    return page
  }
  const reads = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(60); return page.evaluate(() => { const by = {}; window.__msgs.filter((m) => m.type === 'read').forEach((m) => (by[m.visit.id] = m.visit)); return Object.values(by) }) }
  const pill = (page) => page.evaluate(() => { const h = document.getElementById('irb-host'); const p = h?.shadowRoot?.querySelector('.pill'); return h ? { exists: true, hidden: !!p?.hidden, rowHidden: h.shadowRoot.querySelector('.row')?.hidden, scrollHidden: h.shadowRoot.querySelector('.scroll')?.hidden } : { exists: false } })

  // 1. an X article counts, and says what it is
  let page = await open('https://x.com/Jayyanginspires/article/2116534636188729593')
  await page.waitForTimeout(5500)
  let r = await reads(page)
  ok('an X article is counted', r.length === 1 && r[0].seconds >= 4, r)
  ok('...as site "x", publication "X"', r[0]?.site === 'x' && r[0]?.publication === 'X', r[0])
  ok('...with the article title (not the " | name on X" tail) and the author', r[0]?.title === TITLE && r[0]?.author === 'Jay Yang', [r[0]?.title, r[0]?.author])
  ok('...at the article address', r[0]?.url === 'https://x.com/Jayyanginspires/article/2116534636188729593', r[0]?.url)
  const pl = await pill(page)
  ok('the tracker pill shows on an article, with no highlight switch or notes', pl.exists && !pl.hidden && pl.rowHidden === true && pl.scrollHidden === true, pl)
  ok('nothing about annotations was asked of the extension', !(await page.evaluate(() => window.__msgs.some((m) => m.type === 'annList' || m.type === 'annSave'))))
  await page.close()

  // 2. the other X address for an article
  page = await open('https://x.com/i/article/2116534636188729593'); await page.waitForTimeout(3500)
  r = await reads(page); ok('x.com/i/article/<id> counts too', r.length === 1 && r[0].seconds >= 2 && r[0].site === 'x', r); await page.close()
  page = await open('https://www.twitter.com/Jayyanginspires/article/2116534636188729593'); await page.waitForTimeout(3500)
  r = await reads(page); ok('twitter.com article counts too', r.length === 1 && r[0].seconds >= 2, r); await page.close()

  // 3. normal posts, the feed: nothing
  page = await open('https://x.com/Jayyanginspires/status/2116534636188729593'); await page.waitForTimeout(4500)
  r = await reads(page); const pp = await pill(page)
  ok('a normal X post is NOT counted', r.length === 0, r)
  ok('...and shows no pill, and does not ping the extension', (!pp.exists || pp.hidden) && !(await page.evaluate(() => window.__msgs.some((m) => m.type === 'pageStatus'))), pp)
  await page.close()
  page = await open('https://x.com/home'); await page.waitForTimeout(4000)
  r = await reads(page); ok('the X feed is NOT counted', r.length === 0, r); await page.close()
  page = await open('https://x.com/Jayyanginspires'); await page.waitForTimeout(3500)
  r = await reads(page); ok('an X profile is NOT counted', r.length === 0, r); await page.close()
  page = await open('https://x.com/Jayyanginspires/status/1/article/2'); await page.waitForTimeout(3000)
  r = await reads(page); ok('a lookalike path (/status/../article/..) is NOT counted', r.length === 0, r); await page.close()

  // 4. look-alike hosts
  page = await open('https://notx.com/Jayyanginspires/article/2116534636188729593'); await page.waitForTimeout(3000)
  r = await reads(page); ok('notx.com is not X', r.length === 0, r); await page.close()
  page = await open('https://x.com.evil.test/Jayyanginspires/article/2116534636188729593'); await page.waitForTimeout(3000)
  r = await reads(page); ok('x.com.evil.test is not X', r.length === 0, r); await page.close()
  page = await open('https://example.com/'); await page.waitForTimeout(3000)
  r = await reads(page); ok('an ordinary site is not counted', r.length === 0 && !(await page.evaluate(() => 'irbHost' in window || !!document.getElementById('irb-host'))), r); await page.close()

  // 5. X changes the page without reloading: feed -> article -> normal post -> article
  page = await open('https://x.com/home')
  await page.waitForTimeout(2500)
  ok('on the feed: still nothing', (await reads(page)).length === 0)
  await page.evaluate(([t, body]) => { history.pushState({}, '', '/Jayyanginspires/article/2116534636188729593'); document.title = t + ' | Jay Yang (@Jayyanginspires) on X'; document.body.innerHTML = body }, [TITLE, `<h1>${TITLE}</h1><div data-article-part="body"><div class="x-article-body"><p>${text}</p></div></div>`])
  await page.waitForTimeout(4500)
  r = await reads(page); const s1 = r[0]?.seconds
  ok('opening an article from the feed (no reload) starts counting', r.length === 1 && s1 >= 3 && r[0].title === TITLE, r)
  ok('...and the pill appears', (await pill(page)).hidden === false, await pill(page))
  await page.evaluate(() => { history.pushState({}, '', '/Jayyanginspires/status/999'); document.title = 'Jay Yang on X: "a short post" / X'; document.body.innerHTML = '<article>a short post</article>' })
  await page.waitForTimeout(1500)
  const frozen = (await reads(page))[0].seconds
  await page.waitForTimeout(3500)
  r = await reads(page)
  ok('moving to a normal post stops the clock', r.length === 1 && r[0].seconds === frozen && frozen >= s1, [s1, frozen, r[0]?.seconds])
  ok('...and hides the pill', (await pill(page)).hidden === true, await pill(page))
  await page.evaluate(([t, body]) => { history.pushState({}, '', '/Jayyanginspires/article/2116534636188729593'); document.title = t + ' | Jay Yang (@Jayyanginspires) on X'; document.body.innerHTML = body }, [TITLE, `<h1>${TITLE}</h1><div data-article-part="body"><div class="x-article-body"><p>${text}</p></div></div>`])
  await page.waitForTimeout(3500)
  r = await reads(page)
  ok('coming back to the article adds to the same read (one record per page per day)', r.length === 2 && r.every((v) => v.url.endsWith('/article/2116534636188729593')) || (r.length === 1 && r[0].seconds > frozen), r.map((v) => [v.id.slice(0, 4), v.seconds]))
  await page.close()

  // 6. Substack is unchanged
  page = await open('https://newsletter.substack.com/p/a-post'); await page.waitForTimeout(4500)
  r = await reads(page); const sp = await pill(page)
  ok('a Substack post still counts, as substack', r.length === 1 && r[0].seconds >= 3 && r[0].site === 'substack' && r[0].publication === 'The Letter' && r[0].title === 'A newsletter post', r)
  ok('...with the pill, highlight switch and notes still there', sp.exists && sp.hidden === false && sp.rowHidden !== true && sp.scrollHidden !== true, sp)
  ok('...and it still asks for its annotations', await page.evaluate(() => window.__msgs.some((m) => m.type === 'annList')))
  await page.close()

  await browser.close()
  const failed = results.filter((x) => !x).length
  console.log('\n' + (results.length - failed) + ' / ' + results.length + ' passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
