import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileUp } from 'lucide-react'
import { useNavigate } from 'react-router'
import { DuplicateBookError, importPdf } from '../db/books'
import { importReadingList, readListCsv } from '../lib/readingList'
import { useToast } from './ui/Toast'

interface Ctx {
  /** Opens the system file picker (PDFs, or a reading-list CSV). */
  pick: () => void
  /** Pick a PDF for a specific reading-list entry. */
  attach: (bookId: string) => void
  importFiles: (files: File[], opts?: { attachTo?: string }) => Promise<void>
  busy: boolean
}

const ImportCtx = createContext<Ctx | null>(null)

export function useImporter() {
  const c = useContext(ImportCtx)
  if (!c) throw new Error('useImporter outside ImportProvider')
  return c
}

const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
const isCsv = (f: File) => f.type === 'text/csv' || /\.csv$/i.test(f.name)

export function ImportProvider({ children }: { children: ReactNode }) {
  const { toast, dismiss } = useToast()
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const attachTarget = useRef<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const importList = useCallback(
    async (f: File) => {
      try {
        const items = readListCsv(await f.text())
        const { added, skipped } = await importReadingList(items)
        toast({
          tone: added ? 'success' : 'info',
          message: added ? `${added} ${added === 1 ? 'book' : 'books'} added to your reading list` : 'Nothing new in that list',
          description: added
            ? `${skipped ? `${skipped} already here. ` : ''}Add a PDF to any of them whenever you’re ready.`
            : 'Every title is already in your library.',
          action: added ? { label: 'View list', onClick: () => navigate('/list') } : undefined,
          duration: 7000,
        })
      } catch (e) {
        toast({ tone: 'error', message: 'Couldn’t read that CSV', description: (e as Error).message })
      }
    },
    [toast, navigate],
  )

  const importFiles = useCallback(
    async (files: File[], { attachTo }: { attachTo?: string } = {}) => {
      for (const f of files.filter(isCsv)) await importList(f)
      const pdfs = files.filter(isPdf)
      if (!pdfs.length) {
        if (files.length && !files.some(isCsv))
          toast({ tone: 'error', message: 'Only PDF files can be added', description: 'Or a reading-list CSV (Notion, Goodreads).' })
        return
      }
      setBusy(true)
      const tid = 'import'
      let added = 0
      let attached = 0
      let lastId = ''
      for (const [i, f] of pdfs.entries()) {
        toast({
          id: tid,
          tone: 'info',
          duration: Infinity,
          message: pdfs.length > 1 ? `Adding ${i + 1} of ${pdfs.length}…` : 'Adding to your library…',
          description: f.name,
        })
        try {
          const r = await importPdf(f, { attachTo: i === 0 ? attachTo : undefined })
          if (r.attached) attached++
          else added++
          lastId = r.book.id
        } catch (e) {
          if (e instanceof DuplicateBookError) {
            const id = e.book.id
            toast({ tone: 'info', message: 'Already in your library', description: e.book.title, action: { label: 'Open', onClick: () => navigate(`/read/${id}`) } })
          } else {
            console.error(e)
            toast({ tone: 'error', message: `Couldn't open ${f.name}`, description: 'The file may be damaged or password-protected.' })
          }
        }
      }
      setBusy(false)
      const total = added + attached
      if (total) {
        const id = lastId
        toast({
          id: tid,
          tone: 'success',
          message: total > 1 ? `${total} books ready` : attached ? 'PDF added to your list book' : 'Book added',
          description: attached && !added ? 'It kept its place on your reading list.' : attached ? `${attached} matched books on your reading list.` : 'Find it under Up next.',
          action: total === 1 ? { label: 'Read now', onClick: () => navigate(`/read/${id}`) } : undefined,
        })
      } else {
        // Every file was a duplicate or failed — those already got their own toast.
        dismiss(tid)
      }
    },
    [toast, dismiss, navigate, importList],
  )

  // PDFs opened from other Android apps.
  useEffect(() => {
    const onOpen = (e: Event) => void importFiles([(e as CustomEvent<File>).detail])
    window.addEventListener('irb-open-file', onOpen)
    return () => window.removeEventListener('irb-open-file', onOpen)
  }, [importFiles])

  // Drag & drop anywhere in the window.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types?.includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDragging(true)
    }
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDragging(false)
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      importFiles([...(e.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [importFiles])

  const pick = useCallback(() => {
    attachTarget.current = undefined
    if (input.current) {
      input.current.accept = 'application/pdf,.pdf,text/csv,.csv'
      input.current.multiple = true
      input.current.click()
    }
  }, [])
  const attach = useCallback((bookId: string) => {
    attachTarget.current = bookId
    if (input.current) {
      input.current.accept = 'application/pdf,.pdf'
      input.current.multiple = false
      input.current.click()
    }
  }, [])

  return (
    <ImportCtx.Provider value={{ pick, attach, importFiles, busy }}>
      {children}
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,text/csv,.csv"
        multiple
        hidden
        onChange={(e) => {
          importFiles([...(e.target.files ?? [])], { attachTo: attachTarget.current })
          attachTarget.current = undefined
          e.target.value = ''
        }}
      />
      <AnimatePresence>
        {dragging && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[120] grid place-items-center bg-canvas/80 p-6 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ scale: 0.94, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="flex h-full max-h-[420px] w-full max-w-[640px] flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-link/60 bg-canvas-elevated/70"
            >
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                className="grid size-14 place-items-center rounded-full bg-link-soft text-link"
              >
                <FileUp className="size-6" />
              </motion.div>
              <div className="text-center">
                <p className="text-heading-md text-ink">Drop to add to your library</p>
                <p className="mt-1 text-body-md text-mute">PDF books, or a reading-list CSV</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ImportCtx.Provider>
  )
}
