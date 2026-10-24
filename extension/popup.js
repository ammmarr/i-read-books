import { CONFIG } from './config.js'

const $ = (id) => document.getElementById(id)
const startOfDay = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const mins = (s) => (s < 60 ? `${Math.max(0, Math.round(s))}s` : `${Math.round(s / 60)} min`)
const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

// Opened as a page after installing: show it as a card in the middle.
if (new URLSearchParams(location.search).has('welcome')) document.body.classList.add('page')
$('open-app').href = CONFIG.appUrl

async function render() {
  const { auth, visits = {}, pending = {}, goal = 30, status = {} } = await chrome.storage.local.get(['auth', 'visits', 'pending', 'goal', 'status'])
  $('signed-out').hidden = !!auth
  $('signed-in').hidden = !auth
  $('sign-out').hidden = !auth
  $('who').textContent = auth?.email ?? ''
  if (!auth) {
    if (status.error) {
      $('sign-in-error').textContent = status.error
      $('sign-in-error').hidden = false
    }
    return
  }

  const today = Object.values(visits).filter((v) => v.start >= startOfDay()).sort((a, b) => b.end - a.end)
  const secs = today.reduce((a, v) => a + v.seconds, 0)
  const m = Math.floor(secs / 60)
  $('mins').textContent = String(m)
  $('goal').textContent = String(goal)
  $('bar-fill').style.width = `${Math.min(100, (secs / (goal * 60)) * 100)}%`
  $('bar-fill').classList.toggle('done', m >= goal)
  $('today-note').textContent = m >= goal ? 'Goal reached — nice.' : secs > 0 ? `${goal - m} min to your goal` : 'Open a Substack post and start reading.'

  const list = $('reads')
  list.replaceChildren(
    ...(today.length
      ? today.slice(0, 6).map((v) => {
          const li = document.createElement('li')
          const a = document.createElement('a')
          a.href = v.url
          a.target = '_blank'
          a.rel = 'noopener'
          const t = document.createElement('span')
          t.className = 't'
          t.textContent = v.title || v.url
          const p = document.createElement('span')
          p.className = 'p'
          p.textContent = [v.publication, v.author].filter(Boolean).join(' · ')
          a.append(t, p)
          const n = document.createElement('span')
          n.className = 'm'
          n.textContent = mins(v.seconds)
          li.append(a, n)
          return li
        })
      : [Object.assign(document.createElement('li'), { className: 'empty', textContent: 'Nothing read on Substack yet today.' })]),
  )

  const waiting = Object.keys(pending).length
  const s = $('status')
  s.classList.toggle('warn', !!status.error)
  s.textContent = status.error
    ? status.error
    : waiting
      ? `${waiting} ${waiting === 1 ? 'read' : 'reads'} waiting to sync${navigator.onLine ? '…' : ' — you’re offline, they’ll go when you’re back.'}`
      : status.lastSyncAt
        ? `In I read · synced ${ago(status.lastSyncAt)}`
        : 'Counting. Your time shows up in I read under Insights.'
}

$('sign-in').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('sign-in-btn')
  btn.disabled = true
  btn.textContent = 'Signing in…'
  $('sign-in-error').hidden = true
  const res = await chrome.runtime.sendMessage({ type: 'signIn', email: $('email').value.trim(), password: $('password').value })
  btn.disabled = false
  btn.textContent = 'Sign in'
  if (!res?.ok) {
    $('sign-in-error').textContent = res?.error === 'Invalid login credentials' ? 'That email and password don’t match an I read account.' : res?.error || 'Couldn’t sign in.'
    $('sign-in-error').hidden = false
    return
  }
  $('password').value = ''
  render()
})

$('sign-out').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'signOut' })
  render()
})

chrome.storage.onChanged.addListener(render)
render()
// Bring the cloud up to date while the popup is open.
chrome.runtime.sendMessage({ type: 'syncNow' }).catch(() => {})
