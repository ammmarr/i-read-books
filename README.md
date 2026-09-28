# I READ BOOKS

A calm, private PDF reader for one person — PC and Android tablet.
Everything (books, highlights, notes, reading history) is stored **on the device**
in IndexedDB. There is no server and no account.

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
