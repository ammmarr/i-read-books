import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownToLine, LoaderCircle, RefreshCw } from 'lucide-react'
import { applyUpdate, useUpdate } from '../lib/update'
import { useToast } from './ui/Toast'

/**
 * "Update" in the header whenever a newer version of I read is ready — on the
 * website, the installed PC app and the Android app. One tap installs it.
 */
export function UpdateButton() {
  const u = useUpdate()
  const { toast } = useToast()
  const busy = u.status === 'downloading' || u.status === 'applying'
  useEffect(() => {
    if (u.status === 'error') toast({ tone: 'error', message: 'Couldn’t update', description: 'Check your connection and try again.' })
  }, [u.status, toast])

  const label =
    u.status === 'downloading'
      ? `Updating ${Math.round(u.progress * 100)}%`
      : u.status === 'applying'
        ? 'Updating…'
        : u.available === 'app'
          ? 'Update app'
          : 'Update'

  return (
    <AnimatePresence>
      {u.available && (
        <motion.button
          key="update"
          layout
          initial={{ opacity: 0, scale: 0.85, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          whileTap={busy ? undefined : { scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 520, damping: 32 }}
          disabled={busy}
          onClick={() => {
            if (u.available === 'app')
              toast({
                message: 'Downloading the new app',
                description: 'Open I-Read-Books.apk when it finishes and tap Update — your library stays as it is.',
                duration: 9000,
              })
            void applyUpdate()
          }}
          title={u.available === 'app' ? 'A new version of the app is ready to install' : 'A new version of I read is ready'}
          className="relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-full bg-link px-3 text-[13px] font-medium text-white transition-colors hover:bg-link-deep disabled:opacity-90"
        >
          {u.status === 'downloading' && (
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-white/20"
              animate={{ width: `${Math.max(6, u.progress * 100)}%` }}
              transition={{ ease: 'linear', duration: 0.2 }}
            />
          )}
          <span className="relative grid place-items-center">
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : u.available === 'app' ? (
              <ArrowDownToLine className="size-4" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </span>
          <span className="relative tabular">{label}</span>
          {!busy && (
            <span aria-hidden className="relative ml-0.5 flex size-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/70" />
              <span className="relative size-1.5 rounded-full bg-white" />
            </span>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  )
}
