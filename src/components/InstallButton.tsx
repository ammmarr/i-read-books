import { AnimatePresence, motion } from 'motion/react'
import { MonitorDown } from 'lucide-react'
import { isStandalone, useInstallPrompt } from '../lib/install'
import { useMediaQuery } from '../lib/hooks'
import { useToast } from './ui/Toast'

/**
 * "Install app" in the header on computers: installs I read as its own
 * window with a Start-menu/taskbar entry, offline, and "Open with" for PDFs.
 * Only shown while the browser is actually offering installation.
 */
export function InstallButton() {
  const { available, install } = useInstallPrompt()
  const desktop = useMediaQuery('(min-width: 768px) and (pointer: fine)')
  const { toast } = useToast()
  const show = available && desktop && !isStandalone()

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="install"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          whileTap={{ scale: 0.96 }}
          onClick={async () => {
            const ok = await install()
            if (ok)
              toast({
                message: 'I read is installed',
                description: 'Open it from the Start menu or taskbar — and right-click any PDF → Open with → I read.',
                duration: 8000,
              })
          }}
          title="Install I read as an app on this computer"
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-canvas-elevated px-3 text-[13px] font-medium text-ink transition-colors hover:bg-hairline-soft"
        >
          <MonitorDown className="size-4 text-body" />
          Install app
        </motion.button>
      )}
    </AnimatePresence>
  )
}
