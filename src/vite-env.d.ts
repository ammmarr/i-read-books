/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string
/** Commit this build was made from. */
declare const __APP_BUILD__: string
/** When this build was made (ms). */
declare const __BUILT_AT__: number
/** Fingerprint of the native side this build expects (see scripts/build-info.mjs). */
declare const __NATIVE_FP__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}
