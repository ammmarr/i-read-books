// I read — the sites it reads on.
//
// ONE description per site. Everything else asks it: content.js (the reading clock: which pages count, what text
// is on screen, what to call the read) and annotate.js (the pill, "Still reading?", notes and highlights, which
// find the post's text and name it). A site gets ALL the features, the same on every site, from just this:
//
//   define({
//     id: 'x',                     // saved with every read (irb_web_reads.site)
//     name: 'X',                   // how it's called in the panel
//     hosts: ['x.com', 'twitter.com'],   // subdomains match too (www., mobile.); or match: (location, document) => boolean
//     pages: /^\/[^/]+\/article\/\d+/,   // optional: only these paths count (default: every page that has the text below)
//     body: ['.x-article-body'],   // CSS selectors for the text of ONE post or article, most exact first
//     publication: 'X',            // optional: a name, or (document, location) => name   (default: og:site_name, else the host)
//     title: (doc, loc) => '…',    // optional (default: og:title, else the tab title)
//     author: (doc, loc) => '…',   // optional (default: <meta name="author">)
//   })
//
// Nothing else to change: manifest.json already lets the extension run on every https page, and these descriptions
// decide where it does anything. Later definitions win, so a site can be overridden by defining it again.
;(() => {
  const entries = []
  const meta = (doc, sel) => doc.querySelector(sel)?.getAttribute('content')?.trim() || undefined
  const hostIs = (host, h) => host === h || host.endsWith('.' + h)

  function define(def) {
    if (!def || !def.id || !def.name || !Array.isArray(def.body) || !def.body.length || !(def.match || def.hosts?.length)) {
      throw new Error('I read: a site needs id, name, body (selectors) and hosts (or match)')
    }
    const match = def.match || ((loc) => def.hosts.some((h) => hostIs(loc.hostname, h)))
    const counting = (loc = location) => (def.pages ? def.pages.test(loc.pathname) : true)
    const site = {
      id: def.id,
      name: def.name,
      /** The body selectors, for styles that need them. */
      selectors: def.body.slice(),
      matches: (loc = location, doc = document) => !!match(loc, doc),
      /** Whether reading counts on this page right now (X: only on an article; it changes address without reloading). */
      counting,
      /** The text of the post on screen, or null (not a counted page, or it hasn't arrived yet). */
      body(doc = document, loc = location) {
        if (!counting(loc)) return null
        for (const s of def.body) {
          const el = doc.querySelector(s)
          if (el) return el
        }
        return null
      },
      /** What to call this page: { site, url, title, publication, author }. */
      describe(doc = document, loc = location) {
        const url = loc.origin + loc.pathname
        const title = def.title?.(doc, loc) || meta(doc, 'meta[property="og:title"]') || doc.title || url
        const pub = typeof def.publication === 'function' ? def.publication(doc, loc) : def.publication || meta(doc, 'meta[property="og:site_name"]') || loc.hostname
        const author = def.author?.(doc, loc) || meta(doc, 'meta[name="author"]')
        return { site: def.id, url, title: title.slice(0, 300), publication: pub?.slice(0, 120), author: author?.slice(0, 120) }
      },
    }
    entries.unshift(site)
    return site
  }

  /** The site this page belongs to, or null (then the extension does nothing here). */
  const current = (loc = location, doc = document) => entries.find((s) => s.matches(loc, doc)) ?? null

  globalThis.__irbSites = { define, current, all: () => entries.slice() }

  // ── The sites ────────────────────────────────────────────────────────────────

  // Substack: substack.com and every newsletter on its own domain (they all load from substackcdn.com).
  define({
    id: 'substack',
    name: 'Substack',
    match: (loc, doc) =>
      loc.hostname === 'substack.com' ||
      loc.hostname.endsWith('.substack.com') ||
      !!doc.querySelector('link[href*="substackcdn.com"], script[src*="substackcdn.com"], img[src*="substackcdn.com"]'),
    body: ['.available-content .body.markup', '.body.markup', '.available-content', 'article .post-content'],
    publication: (doc, loc) => meta(doc, 'meta[property="og:site_name"]') || (loc.hostname.endsWith('.substack.com') ? loc.hostname.split('.')[0] : loc.hostname === 'substack.com' ? 'Substack' : loc.hostname),
  })

  // X: only long ARTICLES (x.com/<name>/article/<id>, or x.com/i/article/<id>), never the feed, profiles or normal posts (/status/).
  // The text sits in .x-article-body inside [data-article-part="body"], which holds it twice over, so it is only the fallback;
  // older layouts used the twitterArticle* test ids. The tab title is "<title> | <Name> (@handle) on X" and X keeps it up to
  // date when the page changes without a reload (its og: tags can be left over from the page before), so it comes first.
  const X_TAIL = /\s*\|\s*([^|]*?)\s*\(@[^)]+\)\s*on X\s*$/
  define({
    id: 'x',
    name: 'X',
    hosts: ['x.com', 'twitter.com'],
    pages: /^\/(?:i|[A-Za-z0-9_]{1,15})\/article\/\d+/,
    body: ['.x-article-body', '[data-article-part="body"]', '[data-testid="twitterArticleRichTextView"]', '[data-testid="twitterArticleReadView"]'],
    publication: 'X',
    title: (doc) => (X_TAIL.test(doc.title) ? doc.title.replace(X_TAIL, '').trim() : undefined) || meta(doc, 'meta[property="og:title"]') || doc.querySelector('h1')?.textContent?.trim(),
    author: (doc) => doc.title.match(X_TAIL)?.[1],
  })
})()
