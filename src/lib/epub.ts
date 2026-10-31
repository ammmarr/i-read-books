import type { FoliateBook } from 'foliate-js/view.js'
import type { Book } from '../db/db'

/**
 * EPUBs (reflowable e-books), read with foliate-js.
 *
 * An EPUB has no fixed pages, so I read counts it in foliate-js's own
 * "locations" of 1,500 characters — the same on every screen and device, and
 * about a page of a printed book. A book's `pageCount`, `currentPage`,
 * pages read and reading sessions all use them, so progress, "Continue from",
 * sync, Insights and AIGP work for EPUBs unchanged.
 */

export const EPUB_MIME = 'application/epub+zip'
/** Characters per location (foliate-js's unit). */
export const CHARS_PER_LOC = 1500

export const isEpubFile = (f: { name: string; type?: string }) => f.type === EPUB_MIME || /\.epub$/i.test(f.name)
export const isEpubBook = (b: Pick<Book, 'fileName'>) => /\.epub$/i.test(b.fileName ?? '')
/** A file I read can add: a PDF or an EPUB. */
export const isBookFile = (f: { name: string; type?: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || isEpubFile(f)
export const bookMime = (b: Pick<Book, 'fileName'>) => (isEpubBook(b) ? EPUB_MIME : 'application/pdf')
export const bookExt = (b: Pick<Book, 'fileName'>) => (isEpubBook(b) ? 'epub' : 'pdf')
/** What the file picker and drop zone take. */
export const BOOK_ACCEPT = 'application/pdf,.pdf,application/epub+zip,.epub'

// ── Opening safely ──────────────────────────────────────────────────────
// An EPUB is a little website, and its pages are shown in frames that share
// I read's origin (foliate-js needs that). Scripts in a book could then reach
// your sign-in and library, so every page is cleaned on the way in: no
// scripts, no event handlers, no javascript: links, no embedded frames — and a
// Content-Security-Policy that blocks scripts even if something slipped past.

const DOC_TYPES = ['application/xhtml+xml', 'text/html', 'image/svg+xml']
const CSP =
  "default-src 'none'; img-src blob: data:; media-src blob: data:; font-src blob: data:; style-src blob: data: 'unsafe-inline'; " +
  "script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'"
const DROP = 'script, iframe, frame, frameset, object, embed, applet, base, portal, noscript'
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster', 'background'])

/** One book page (XHTML, HTML or SVG) with everything that could run code taken out. */
export function sanitizeDoc(str: string, type: string): string {
  let doc = new DOMParser().parseFromString(str, type as DOMParserSupportedType)
  if (doc.querySelector('parsererror') && type !== 'text/html') doc = new DOMParser().parseFromString(str, 'text/html')
  for (const el of doc.querySelectorAll(DROP)) el.remove()
  for (const el of doc.querySelectorAll('meta[http-equiv]')) {
    if (/refresh|set-cookie/i.test(el.getAttribute('http-equiv') ?? '')) el.remove()
  }
  for (const el of doc.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase()
      if (n.startsWith('on')) el.removeAttribute(a.name)
      else if (URL_ATTRS.has(n) && /^\s*(javascript|vbscript|data:\s*text\/html)/i.test(a.value)) el.removeAttribute(a.name)
    }
  }
  if (type !== 'image/svg+xml' && doc.documentElement) {
    const ns = doc.documentElement.namespaceURI || 'http://www.w3.org/1999/xhtml'
    let head: Element | null = doc.querySelector('head')
    if (!head) {
      head = doc.createElementNS(ns, 'head')
      doc.documentElement.prepend(head)
    }
    const meta = doc.createElementNS(ns, 'meta')
    meta.setAttribute('http-equiv', 'Content-Security-Policy')
    meta.setAttribute('content', CSP)
    head.prepend(meta)
  }
  return new XMLSerializer().serializeToString(doc)
}

function onData(e: Event) {
  const d = (e as CustomEvent<{ data: unknown; type: string; name: string }>).detail
  if (!DOC_TYPES.includes(d.type)) return
  // A page that can't be cleaned isn't shown at all.
  d.data = Promise.resolve(d.data)
    .then((x) => (typeof x === 'string' ? sanitizeDoc(x, d.type) : ''))
    .catch(() => '')
}

/** Opens an EPUB for reading or for its details. Every page it shows goes through sanitizeDoc. */
export async function openEpub(blob: Blob, name = 'book.epub'): Promise<FoliateBook> {
  const { makeBook } = await import('foliate-js/view.js')
  const book = await makeBook(new File([blob], /\.epub$/i.test(name) ? name : `${name}.epub`, { type: EPUB_MIME }))
  if (!book.transformTarget) throw new Error('not-epub')
  book.transformTarget.addEventListener('data', onData)
  return book
}

// ── Details ─────────────────────────────────────────────────────────────

/** Metadata values come as plain strings or as { language: text } maps. */
export function langText(x: unknown): string {
  if (!x) return ''
  if (typeof x === 'string') return x.trim()
  if (typeof x === 'object') {
    const v = Object.values(x as Record<string, unknown>)[0]
    return typeof v === 'string' ? v.trim() : ''
  }
  return ''
}

export function contributors(x: unknown): string {
  const one = (c: unknown) => (typeof c === 'string' ? c.trim() : langText((c as { name?: unknown })?.name))
  const list = (Array.isArray(x) ? x.map(one) : [one(x)]).filter(Boolean)
  return list.join(', ')
}

/** The book's length in locations (as foliate-js counts them when reading). */
export function locationsOf(book: FoliateBook) {
  const size = book.sections.reduce((a, s) => a + (s.linear !== 'no' && s.size > 0 ? s.size : 0), 0)
  return Math.max(1, Math.ceil(size / CHARS_PER_LOC))
}

async function coverOf(book: FoliateBook, width = 420): Promise<{ blob?: Blob; tint: string } | null> {
  try {
    const img = await book.getCover?.()
    if (!img) return null
    const bmp = await createImageBitmap(img)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round((bmp.height / bmp.width) * width)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let r = 0, g = 0, b = 0, n = 0
    for (let i = 0; i < data.length; i += 4 * 37) (r += data[i]), (g += data[i + 1]), (b += data[i + 2]), n++
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0')
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.86))
    return { blob: blob ?? undefined, tint: `#${hex(r)}${hex(g)}${hex(b)}` }
  } catch {
    return null
  }
}

async function sha256(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** What "Add book" needs from an EPUB: its details, cover, length and a fingerprint (to spot duplicates). */
export async function readEpub(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const book = await openEpub(new Blob([bytes as BlobPart], { type: EPUB_MIME }), file.name)
  const [cover, fingerprint] = await Promise.all([coverOf(book), sha256(bytes)])
  return {
    bytes,
    fingerprint: `epub:${fingerprint}`,
    title: langText(book.metadata?.title),
    author: contributors(book.metadata?.author),
    pageCount: locationsOf(book),
    cover: cover?.blob,
    tint: cover?.tint ?? '#e5e5e5',
  }
}
