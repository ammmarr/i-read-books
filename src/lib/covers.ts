/** Muted cloth-bound colours for typeset covers, picked deterministically per title. */
export const PAPERS = [
  { bg: '#e9e4d8', ink: '#2b2a26' },
  { bg: '#d9e2e8', ink: '#1f2a33' },
  { bg: '#2f3a36', ink: '#e8eee9' },
  { bg: '#e7d9d3', ink: '#3a2622' },
  { bg: '#232323', ink: '#ededed' },
  { bg: '#dfe5d7', ink: '#26301f' },
  { bg: '#3a3450', ink: '#ece8f7' },
  { bg: '#efe7cf', ink: '#3b3218' },
]

export function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** The cloth colour a typeset cover gets for this title (the Library's spines use it too, so they match). */
export function paperFor(title: string) {
  return PAPERS[hash(title) % PAPERS.length]
}
