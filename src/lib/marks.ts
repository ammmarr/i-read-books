import type { Book, Highlight, HighlightColor, WebAnnotation } from '../db/db'

/** A highlight, from a book or from the web, as Insights counts it. */
export interface Mark {
  id: string
  text: string
  note?: string
  color?: HighlightColor
  at: number
  /** Book id, or "web:" + publication. */
  from: string
  title: string
  kind: 'Book' | 'Web'
  page?: number
}

/** Book highlights and the ones you made on the web, as one list. */
export function marksOf(highlights: Highlight[], web: WebAnnotation[], books: Book[]): Mark[] {
  const byId = new Map(books.map((b) => [b.id, b]))
  const out: Mark[] = []
  for (const h of highlights) {
    const b = byId.get(h.bookId)
    if (!b) continue
    out.push({ id: h.id, text: h.text, note: h.note, color: h.color, at: h.createdAt, from: b.id, title: b.title, kind: 'Book', page: h.page })
  }
  for (const a of web) {
    if (a.kind !== 'highlight' || !a.text) continue
    let pub = a.publication?.trim()
    if (!pub) {
      try {
        pub = new URL(a.url).hostname.replace(/^www\./, '')
      } catch {
        pub = 'The web'
      }
    }
    out.push({ id: a.id, text: a.text, note: a.note, color: a.color, at: a.createdAt, from: `web:${pub}`, title: pub, kind: 'Web' })
  }
  return out
}
