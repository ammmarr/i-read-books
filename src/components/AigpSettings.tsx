import { useState } from 'react'
import { Button } from './ui/Button'
import { useToast } from './ui/Toast'
import { connectAigp, disconnectAigp, syncHistoryToAigp, testAigp, useAigp } from '../lib/aigp'
import { relativeTime } from '../lib/format'

/** Settings → AIGP: paste the connection code from AIGP's Settings, Connect apps. */
export function AigpSettings() {
  const { link, status } = useAigp()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!link) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          try {
            connectAigp(code)
            setCode('')
            setError('')
            toast({ message: 'Connected to AIGP', tone: 'success' })
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not connect.')
          }
        }}
      >
        <label className="flex flex-col gap-1.5 text-body-md text-body">
          Connection code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="aigp1.…"
            autoComplete="off"
            spellCheck={false}
            className="h-10 rounded-sm border border-hairline bg-canvas px-3 font-mono text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-link/60"
          />
        </label>
        {error && <p className="text-body-md text-error">{error}</p>}
        <div>
          <Button type="submit" disabled={!code.trim()}>
            Connect
          </Button>
        </div>
        <p className="text-body-md text-mute">In AIGP open Settings → Connect apps → Connect I Read, then copy the code it shows.</p>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body-md text-body">
        Connected to <span className="font-mono text-[13px] text-ink">{link.url.replace(/^https?:\/\//, '')}</span>. Your reading, today and
        every past day, is sent to AIGP; AIGP switches Read on for each day that reaches the goal set there.
      </p>
      {status && (
        <p className={`text-body-md ${status.ok ? 'text-mute' : 'text-warning'}`}>
          {status.message} <span className="text-faint">({relativeTime(status.at)})</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              toast({ message: await testAigp(), tone: 'success' })
              const result = await syncHistoryToAigp()
              if (result) toast({ message: result.message, tone: result.ok ? 'success' : 'error' })
            } catch (err) {
              toast({ message: err instanceof Error ? err.message : 'Could not reach AIGP.', tone: 'error' })
            }
            setBusy(false)
          }}
        >
          Check &amp; sync everything
        </Button>
        <Button variant="ghost" size="sm" onClick={() => disconnectAigp()}>
          Disconnect
        </Button>
      </div>
    </div>
  )
}
