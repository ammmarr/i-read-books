import { HashRouter, useLocation, useRoutes, type RouteObject } from 'react-router'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { AppShell } from './components/AppShell'
import { ImportProvider } from './components/Importer'
import { ToastProvider } from './components/ui/Toast'
import { useThemeSync } from './lib/theme'
import Library from './pages/Library'
import ReadingList from './pages/ReadingList'
import Stats from './pages/Stats'
import SettingsPage from './pages/Settings'
import BookDetail from './pages/BookDetail'
import Reader from './reader/Reader'

const routes: RouteObject[] = [
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Library /> },
      { path: '/list', element: <ReadingList /> },
      { path: '/stats', element: <Stats /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/book/:id', element: <BookDetail /> },
    ],
  },
  { path: '/read/:id', element: <Reader /> },
  { path: '*', element: <AppShell /> },
]

function AnimatedRoutes() {
  const location = useLocation()
  const element = useRoutes(routes, location)
  const inReader = location.pathname.startsWith('/read/')
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={inReader ? location.pathname : 'shell'}
        className="h-full"
        // Opacity only: a transform here would re-anchor fixed-position chrome mid-animation.
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
        exit={{ opacity: 0, transition: { duration: 0.14 } }}
      >
        {element}
      </motion.div>
    </AnimatePresence>
  )
}

export default function App() {
  useThemeSync()
  return (
    <MotionConfig reducedMotion="user">
      <HashRouter>
        <ToastProvider>
          <ImportProvider>
            <AnimatedRoutes />
          </ImportProvider>
        </ToastProvider>
      </HashRouter>
    </MotionConfig>
  )
}
