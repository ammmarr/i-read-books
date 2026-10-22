/**
 * Keeps a text selection from running away while it's dragged — the same
 * guard pdf.js's own viewer uses (TextLayerBuilder), here for touch as well as
 * the mouse. A PDF's text is loose pieces with gaps between the lines; without
 * this, a finger sliding over a gap stretches the selection to the end of the
 * page, and the page scrolls after it.
 *
 * While a text layer holds the selection it's marked `selecting`, which
 * spreads its endOfContent over the whole layer (see textlayer.css), so a gap
 * lands on that instead of on the page below. On older Chromium the
 * endOfContent is also moved right after the edge being dragged.
 */

const layers = new Map<HTMLElement, HTMLElement>()
let listening: AbortController | null = null

/** Watch this text layer (with its endOfContent); returns the undo. */
export function guardSelection(layer: HTMLElement, end: HTMLElement) {
  layers.set(layer, end)
  const ac = new AbortController()
  layer.addEventListener('mousedown', () => layer.classList.add('selecting'), { signal: ac.signal })
  listen()
  return () => {
    ac.abort()
    layers.delete(layer)
    if (!layers.size) {
      listening?.abort()
      listening = null
    }
  }
}

function reset(end: HTMLElement, layer: HTMLElement) {
  layer.append(end)
  end.style.width = ''
  end.style.height = ''
  end.style.userSelect = ''
  layer.classList.remove('selecting')
}

function listen() {
  if (listening) return
  listening = new AbortController()
  const { signal } = listening
  let down = false
  document.addEventListener('pointerdown', () => (down = true), { signal })
  document.addEventListener(
    'pointerup',
    () => {
      down = false
      layers.forEach(reset)
    },
    { signal },
  )
  window.addEventListener(
    'blur',
    () => {
      down = false
      layers.forEach(reset)
    },
    { signal },
  )
  document.addEventListener('keyup', () => !down && layers.forEach(reset), { signal })

  let modern: boolean | undefined
  let prev: Range | null = null
  document.addEventListener(
    'selectionchange',
    () => {
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0) {
        layers.forEach(reset)
        return
      }
      const active = new Set<HTMLElement>()
      for (let i = 0; i < sel.rangeCount; i++) {
        const range = sel.getRangeAt(i)
        for (const layer of layers.keys()) if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer)
      }
      for (const [layer, end] of layers) {
        if (active.has(layer)) layer.classList.add('selecting')
        else reset(end, layer)
      }

      // Firefox and Chromium 148+ keep the selection steady on their own.
      if (modern === undefined) {
        const first = layers.keys().next().value
        modern = !!first && getComputedStyle(first).getPropertyValue('-moz-user-select') === 'none'
        if (!modern) {
          const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[] } }
          const v = nav.userAgentData ? nav.userAgentData.brands.find((b) => b.brand === 'Chromium')?.version : /\bChrome\/(\d+)\b/.exec(navigator.userAgent)?.[1]
          modern = !!v && parseInt(v, 10) >= 148
        }
      }
      if (modern) return

      // Older Chromium: put endOfContent right after the edge being dragged,
      // so a gap can only select up to there.
      const range = sel.getRangeAt(0)
      const startMoving = !!prev && (range.compareBoundaryPoints(Range.END_TO_END, prev) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prev) === 0)
      let anchor: Node | null = startMoving ? range.startContainer : range.endContainer
      if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode
      if (!startMoving && range.endOffset === 0 && anchor) {
        do {
          while (anchor && !anchor.previousSibling) anchor = anchor.parentNode
          anchor = anchor?.previousSibling ?? null
        } while (anchor && !anchor.childNodes.length)
      }
      const el = anchor as HTMLElement | null
      const layer = el?.parentElement?.closest<HTMLElement>('.textLayer')
      const end = layer ? layers.get(layer) : undefined
      if (el && layer && end) {
        end.style.width = layer.style.width
        end.style.height = layer.style.height
        end.style.userSelect = 'text'
        el.parentElement!.insertBefore(end, startMoving ? el : el.nextSibling)
      }
      prev = range.cloneRange()
    },
    { signal },
  )
}
