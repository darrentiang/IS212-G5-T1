import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../app/auth'
import { formatDateTime, STATUS } from '../../app/format'
import { useReveal } from '../../app/reveal'
import { completeRequest } from './api'

// The server owns the end-time check: browser clocks cannot grant permission.
// Confirm is explicit because Completed cannot be reopened by this workflow.
export default function CompletionSection({ event, onCompleted }) {
  return <CompletionAction key={event.id} event={event} onCompleted={onCompleted} />
}

function CompletionAction({ event, onCompleted }) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const generation = useRef(0)
  const form = useReveal(open, '[data-testid="request-detail-complete-cancel-button"]')
  useEffect(() => {
    return () => { generation.current += 1 }
  }, [])
  const allowed = Boolean(auth?.can?.('requests.complete')) &&
    event.assigned_coordinator === auth.account?.username && event.status === STATUS.REQUEST.CONFIRMED
  async function submit(e) {
    e.preventDefault()
    const token = generation.current
    setBusy(true)
    setError(null)
    try {
      const updated = await completeRequest(event.id)
      if (token !== generation.current) return
      setOpen(false)
      onCompleted(updated)
    } catch (failure) {
      if (token !== generation.current) return
      setError(failure.message)
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }
  if (!allowed && !event.completion) return null
  return (
    <section className="space-y-3" aria-label="Event completion">
      {event.completion && (
        <p data-testid="request-detail-completion-details">
          Completed by {event.completion.completed_by} at {formatDateTime(event.completion.completed_at)} UTC
        </p>
      )}
      {allowed && !open && (
        <button type="button" className="btn-secondary" data-testid="request-detail-complete-button"
          onClick={() => { setError(null); setOpen(true) }}>Mark as Completed</button>
      )}
      {allowed && open && (
        <form ref={form} onSubmit={submit} className="space-y-3" data-testid="request-detail-complete-form">
          <p>Mark this event as Completed? This cannot be undone.</p>
          {error && <p role="alert" data-testid="request-detail-complete-error">{error}</p>}
          <div className="flex gap-3">
            <button type="button" className="btn-secondary" disabled={busy}
              data-testid="request-detail-complete-cancel-button" onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}
              data-testid="request-detail-complete-confirm-button">Confirm completion</button>
          </div>
        </form>
      )}
    </section>
  )
}
