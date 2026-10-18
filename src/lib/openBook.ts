import type { NavigateFunction } from 'react-router'
import type { OpenAt } from '../reader/Reader'

/** Open a book at `page` and read on from there ("Continue from page N" — it becomes your spot). */
export function continueFrom(navigate: NavigateFunction, bookId: string, page: number) {
  const at: OpenAt = { page, top: 0, move: true }
  navigate(`/read/${bookId}`, { state: { openAt: at } })
}
