import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import './lib/install'
import { startSync } from './lib/sync'
import { initNative, isNative } from './lib/native'
import { enrichFromOpenLibrary } from './lib/readingList'
import { initUpdates } from './lib/update'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The boot screen (index.html) draws the logo while the app starts: fade it
// out once the app is up — but not before the line has finished drawing.
const boot = document.getElementById('boot')
if (boot) {
  setTimeout(() => {
    boot.classList.add('out')
    setTimeout(() => boot.remove(), 600)
  }, Math.max(150, 1500 - performance.now()))
}

startSync()
// Fill in covers for reading-list books added while offline.
setTimeout(() => void enrichFromOpenLibrary(), 3000)

if (isNative) void initNative()
initUpdates()
