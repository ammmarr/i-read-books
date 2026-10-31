// foliate-js ships plain ES modules without types: just what I read uses.
declare module 'foliate-js/view.js' {
  export interface FoliateTocItem {
    label: string
    href: string
    subitems?: FoliateTocItem[]
  }
  export interface FoliateSection {
    id: string
    size: number
    linear?: string
  }
  export interface FoliateBook {
    metadata?: { title?: unknown; author?: unknown; language?: unknown }
    toc?: FoliateTocItem[]
    sections: FoliateSection[]
    dir?: string
    rendition?: { layout?: string }
    transformTarget?: EventTarget
    getCover?: () => Promise<Blob | null> | Blob | null
  }
  export interface FoliateLocation {
    fraction: number
    location: { current: number; next: number; total: number }
    section: { current: number; total: number }
    time?: { section: number; total: number }
    tocItem?: FoliateTocItem | null
    cfi: string
    range?: Range
  }
  export interface FoliateRenderer extends HTMLElement {
    setStyles?: (css: string) => void
    next: () => Promise<void>
    prev: () => Promise<void>
    getContents: () => { doc: Document; index: number }[]
  }
  export class View extends HTMLElement {
    book: FoliateBook
    renderer: FoliateRenderer
    lastLocation: FoliateLocation | null
    open(book: FoliateBook | File | Blob): Promise<void>
    close(): void
    init(opts: { lastLocation?: string | number | null; showTextStart?: boolean }): Promise<void>
    goTo(target: string | number): Promise<unknown>
    goToFraction(fraction: number): Promise<void>
    next(): Promise<void>
    prev(): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    getSectionFractions(): number[]
  }
  export function makeBook(file: File | Blob | string): Promise<FoliateBook>
}
