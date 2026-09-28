# I READ BOOKS

A calm, private PDF reader for one person — PC and Android tablet.
Everything (books, highlights, notes, reading history) is stored **on the device**
in IndexedDB. There is no server and no account.

## Where it lives

- **Web app:** https://i-read-books-teal.vercel.app (installable PWA; redeploys on every push to `main`)
- **Android APK:** [Releases → latest](https://github.com/ammmarr/i-read-books/releases/tag/latest), rebuilt and signed on every push by `.github/workflows/android.yml`
- **Cloud sync:** Supabase project `lergfyeolzrudfaplurk` — schema in `supabase/schema.sql`

## Features

- **Library** — drag PDFs anywhere onto the window (or tap *Add book*). Covers,
  title and author are pulled from the PDF. Duplicate files are detected.
- **Reader** — continuous scroll, crisp high-DPI rendering, pages load on demand
  (fine for 1,000-page books). Resumes exactly where you left off.
  - Zoom: pinch, double-tap, Ctrl + scroll, Ctrl +/−, fit width / fit page.
  - Page colour: Auto / Paper / Sepia / Night (independent of the app theme).
  - Controls hide while you read; scroll up or tap to bring them back.
  - Table of contents, bookmarks, page scrubber with chapter preview, go-to-page.
  - Keeps the screen awake while reading; full-screen mode.
- **Highlights & notes** — select text, pick one of 5 colours (or press 1–5),
  add a note (auto-saved). Tap a highlight to recolour, annotate, copy or delete
  (with undo). Export all as Markdown.
- **Search** — Ctrl+F / `/`: results with context and chapter, Enter / Shift+Enter
  to step, matches highlighted on the page. Accent- and case-insensitive.
- **Insights** — reading time is tracked automatically (pauses after 90s idle).
  7D / 30D / 90D / 1Y / All: time, pages, daily average, streaks, pace,
  sessions, books finished, vs-previous-period deltas, a year heatmap,
  time-of-day rhythm, and per-book progress with time-to-finish estimates.
- **Reading list** — Currently reading, a drag-to-reorder *Up next* queue with
  estimated reading time, and Finished.
- **Daily goal** with a progress ring and a celebration when you hit it.
- Light / dark / system theme with a circular reveal transition.
- Backup & restore (highlights, notes, progress, history) as a JSON file.
- **Cloud sync (Supabase)** — sign in on each device; library, reading list, progress,
  highlights, notes, bookmarks and reading time sync; PDFs and covers live in private
  storage and download on first open. Works offline and catches up later.
- **Reading-list import** — Notion or Goodreads CSV → books without a PDF (covers and
  page counts from Open Library). Adding a matching PDF later fills the entry in.
- **PDF links** — tap a contents link to jump to the chapter (with a “Back to page N”
  pill); web links open in the browser.
- **Android app** — open PDFs from Files/Drive/WhatsApp with *Open with → I Read
  Books*, back button closes panels first, immersive full screen, screen stays on.

Press `?` in the reader for all keyboard shortcuts.

## Run it on your PC

```bash
npm install
npm run dev
```

Open http://localhost:5173. For an installed, offline copy build it and serve
the `dist/` folder (`npm run build && npm run preview`), then use the install
icon in Chrome/Edge's address bar.

## Put it on your Android tablet

The app is a Progressive Web App: once it's loaded over HTTPS it installs to the
home screen, runs full-screen and works **fully offline** — your PC isn't needed.

1. Build: `npm run build` → a static `dist/` folder (no backend).
2. Host `dist/` on any free static host over HTTPS (Netlify drop, Vercel,
   Cloudflare Pages, GitHub Pages). Only the app's code is hosted — your books
   never leave the tablet.
3. On the tablet, open the URL in Chrome → ⋮ → **Add to Home screen → Install**.

Each device keeps its own library. To move highlights between devices, use
*Settings → Export backup*, add the same PDFs on the other device, then
*Restore backup* (books are matched by the PDF's fingerprint).

## Stack

React 19 · TypeScript · Vite · Tailwind v4 (Geist design tokens in
`src/index.css`) · pdf.js · Dexie (IndexedDB) · Motion · vite-plugin-pwa.

## Cloud setup (one time)

1. Supabase → SQL Editor → run `supabase/schema.sql`.
2. Supabase → Authentication → URL Configuration → set **Site URL** to the web app URL
   (or turn off *Confirm email* under Providers → Email for a personal app).
3. `.env` holds the project URL and **publishable** key. Never put a secret /
   service_role key in this app — it would ship to every browser.

The Android signing key is `android/keystore/release.p12` (password in
`android/keystore.properties`). Keep this repo private; if it ever goes public, move
both into GitHub Actions secrets first.
