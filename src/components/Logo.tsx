import lineArt from '../assets/logo-lineart.png'

/**
 * The mark: a reader behind an open book, drawn in a single line. Rendered as
 * a mask so the lines take the current text colour — ink on light, light on dark.
 */
export function Logo({ className = '', title }: { className?: string; title?: string }) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`inline-block aspect-[388/510] bg-current ${className}`}
      style={{
        WebkitMaskImage: `url(${lineArt})`,
        maskImage: `url(${lineArt})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  )
}
