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

startSync()
// Fill in covers for reading-list books added while offline.
setTimeout(() => void enrichFromOpenLibrary(), 3000)

if (isNative) void initNative()
initUpdates()
