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
export function InstallButton({ compact, block }: { compact?: boolean; block?: boolean } = {}) {
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
          aria-label="Install app"
          className={`inline-flex items-center rounded-sm border border-hairline bg-canvas-elevated text-[13px] font-medium text-ink transition-colors hover:bg-hairline-soft ${compact ? 'size-9 justify-center' : `h-8 gap-1.5 px-3 ${block ? 'w-full justify-center' : ''}`}`}
        >
          <MonitorDown className="size-4 text-body" />
          {!compact && 'Install app'}
        </motion.button>
      )}
    </AnimatePresence>
  )
}
