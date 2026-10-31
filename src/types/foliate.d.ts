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
  export interface FoliateSearchResult {
    label?: string
    subitems?: { cfi: string; excerpt: { pre: string; match: string; post: string } }[]
    progress?: number
  }
  export class View extends HTMLElement {
    book: FoliateBook
    renderer: FoliateRenderer
    lastLocation: FoliateLocation | null
    open(book: FoliateBook | File | Blob): Promise<void>
    close(): void
    addAnnotation(annotation: { value: string; [k: string]: unknown }, remove?: boolean): Promise<{ index: number; label: string } | undefined>
    deleteAnnotation(annotation: { value: string }): Promise<unknown>
    getCFI(index: number, range?: Range): string
    resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range | Element }
    search(opts: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean; index?: number }): AsyncGenerator<FoliateSearchResult | 'done'>
    clearSearch(): void
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

declare module 'foliate-js/overlayer.js' {
  type Draw = (rects: DOMRectList | DOMRect[], options?: Record<string, unknown>) => SVGElement
  export class Overlayer {
    static highlight: Draw
    static underline: Draw
    static outline: Draw
  }
}

declare module 'foliate-js/epubcfi.js' {
  /** Orders two CFIs: negative, zero or positive. */
  export function compare(a: string, b: string): number
}
