import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

/** True inside the Android app (Capacitor), false in the browser / installed PWA. */
export const isNative = Capacitor.isNativePlatform()

/** Status/navigation bar icons follow the app theme. */
export function setSystemBarsDark(dark: boolean) {
  if (!isNative) return
  SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {})
}

/** Immersive reading: hide Android's status and navigation bars. */
export async function setImmersive(on: boolean) {
  if (!isNative) return
  await (on ? SystemBars.hide() : SystemBars.show()).catch(() => {})
}

export async function keepScreenOn(on: boolean) {
  if (!isNative) return false
  const { KeepAwake } = await import('@capacitor-community/keep-awake')
  await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {})
  return true
}

/** Saves a text file via the Android share sheet (Drive, Files, email…). */
export async function shareTextFile(name: string, text: string, title: string) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
  await Share.share({ title, files: [uri] })
}

/**
 * Android integration: hardware back closes the top-most panel before
 * navigating, and PDFs opened from other apps ("Open with I read")
 * are handed to the importer.
 */
export async function initNative() {
  if (!isNative) return
  const { App } = await import('@capacitor/app')

  App.addListener('backButton', () => {
    const overlay =
      document.querySelector('[role="dialog"], [role="menu"], [role="toolbar"]') || document.querySelector('input[placeholder="Search in book"]')
    if (overlay) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    const hash = window.location.hash
    if (hash && hash !== '#/' && hash !== '#') window.history.back()
    else App.minimizeApp()
  })

  const openUrl = async (url?: string) => {
    if (!url || !/^(content|file):/i.test(url)) return
    try {
      const res = await fetch(Capacitor.convertFileSrc(url))
      const blob = await res.blob()
      let name = decodeURIComponent(url.split('/').pop() ?? 'Book').replace(/[?#].*$/, '')
      if (!/\.pdf$/i.test(name)) name += '.pdf'
      const file = new File([blob], name, { type: 'application/pdf' })
      window.dispatchEvent(new CustomEvent('irb-open-file', { detail: file }))
    } catch (e) {
      console.warn('could not open shared file', e)
    }
  }
  App.addListener('appUrlOpen', ({ url }) => void openUrl(url))
  const launch = await App.getLaunchUrl().catch(() => undefined)
  if (launch?.url) setTimeout(() => void openUrl(launch.url), 600)
}
