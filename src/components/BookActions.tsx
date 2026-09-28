import { useNavigate } from 'react-router'
import { BookCheck, BookOpen, FilePlus, Info, ListPlus, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react'
import { useImporter } from './Importer'
import type { Book } from '../db/db'
import { deleteBook, restoreBook, setStatus } from '../db/books'
import { Menu, type MenuItem } from './ui/Menu'
import { useToast } from './ui/Toast'

export function useBookActions() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const { attach } = useImporter()

  const remove = async (book: Book) => {
    const snap = await deleteBook(book.id)
    if (!snap) return
    toast({
      message: 'Book removed',
      description: book.title,
      action: {
        label: 'Undo',
        onClick: () => restoreBook(snap).then(() => toast({ message: 'Restored', description: book.title, duration: 2000 })),
      },
    })
  }

  const items = (book: Book, { details = true } = {}): MenuItem[] => [
    book.pageCount > 0
      ? { label: book.status === 'finished' ? 'Read again' : 'Open', icon: <BookOpen />, onSelect: () => navigate(`/read/${book.id}`) }
      : { label: 'Add PDF…', icon: <FilePlus />, onSelect: () => attach(book.id) },
    ...(details ? [{ label: 'Details & highlights', icon: <Info />, onSelect: () => navigate(`/book/${book.id}`) }] : []),
    {
      separator: true,
      label: 'Currently reading',
      icon: <RotateCcw />,
      checked: book.status === 'reading',
      onSelect: () => setStatus(book.id, 'reading'),
    },
    { label: 'Up next', icon: <ListPlus />, checked: book.status === 'queued', onSelect: () => setStatus(book.id, 'queued') },
    {
      label: 'Finished',
      icon: <BookCheck />,
      checked: book.status === 'finished',
      onSelect: async () => {
        await setStatus(book.id, 'finished')
        toast({ message: 'Marked as finished', description: book.title })
      },
    },
    { separator: true, label: 'Remove from library', icon: <Trash2 />, danger: true, onSelect: () => remove(book) },
  ]

  return { items, remove }
}

export function BookMenu({ book, className = '', details }: { book: Book; className?: string; details?: boolean }) {
  const { items } = useBookActions()
  return (
    <Menu
      items={items(book, { details })}
      trigger={(p) => (
        <button
          {...p}
          aria-label={`Actions for ${book.title}`}
          className={`grid size-8 place-items-center rounded-full text-mute transition-colors hover:bg-hairline-soft hover:text-ink ${className}`}
        >
          <MoreHorizontal className="size-4" />
        </button>
      )}
    />
  )
}
