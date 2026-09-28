/** The mark: an open book with a blue ribbon bookmark. Inverts with the theme. */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} aria-hidden>
      <rect width="512" height="512" rx="112" className="fill-ink" />
      <path d="M136 150c38-14 78-14 120 8v222c-42-22-82-22-120-8z" className="fill-canvas" />
      <path d="M376 150c-38-14-78-14-120 8v222c42-22 82-22 120-8z" className="fill-canvas" opacity="0.78" />
      <rect x="300" y="118" width="34" height="96" rx="4" className="fill-link" />
      <path d="M300 214l17-14 17 14z" className="fill-ink" />
    </svg>
  )
}
