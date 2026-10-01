// Build identity shared by vite.config.ts and the live-update bundle script.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * Bump after changing native Android code or config by hand (android/,
 * capacitor.config.ts plugin settings) so older apps ask for a new APK
 * instead of loading web code they can't run.
 */
const NATIVE_REVISION = 2

/** The commit being built — the same on Vercel and in the APK workflow. */
export const buildId = () => process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'

/**
 * Fingerprint of the app's native side: Capacitor and its plugins, at their
 * locked versions. A web update can run inside the Android app only if its
 * fingerprint matches the installed app's.
 */
export function nativeFingerprint() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')).packages ?? {}
  const native = Object.keys(pkg.dependencies ?? {})
    .filter((d) => /^@(capacitor|capacitor-community|capawesome)\//.test(d))
    .sort()
    .map((d) => `${d}@${lock[`node_modules/${d}`]?.version ?? pkg.dependencies[d]}`)
  return createHash('sha1').update(JSON.stringify([NATIVE_REVISION, native])).digest('hex').slice(0, 12)
}
