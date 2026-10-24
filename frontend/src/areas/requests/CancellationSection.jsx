import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../app/auth'
import { formatDateTime } from '../../app/format'
import { useReveal } from '../../app/reveal'
import { cancelRequest } from './api'

const STAGES = ['Submitted', 'Approved', 'Planning', 'Safety Check', 'Confirmed']

export default function CancellationSection({ event, onCancelled, activeAction, onActionChange }) {
  return <CancellationAction key={event.id} event={event} onCancelled={onCancelled} activeAction={activeAction} onActionChange={onActionChange} />
}

function CancellationAction({ event, onCancelled, activeAction, onActionChange }) {
  const auth = useAuth()
  const [localOpen, setLocalOpen] = useState(false)
  const open = onActionChange ? activeAction === 'event-cancel' : localOpen
  const setOpen = onActionChange ? (value) => onActionChange(value ? 'event-cancel' : null) : setLocalOpen
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const generation = useRef(0)
  const form = useReveal(open, '[data-testid="request-detail-cancel-reason-input"]')
  useEffect(() => () => { generation.current += 1 }, [])
  const allowed = Boolean(auth?.can?.('requests.cancel')) &&
    event.assigned_coordinator === auth.account?.username && STAGES.includes(event.status)
  async function submit(e) {
    e.preventDefault()
    const token = generation.current
    setBusy(true)
    setError(null)
    try {
      const updated = await cancelRequest(event.id, reason)
      if (token !== generation.current) return
      setOpen(false)
      onCancelled(updated)
    } catch (failure) {
      if (token !== generation.current) return
      setError(failure.message)
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }
  if (!allowed && !event.cancellation) return null
  return (
    <section className="space-y-3" aria-label="Event cancellation">
      {event.cancellation && <div data-testid="request-detail-cancellation-details" className="space-y-2">
        <p>Cancelled by {event.cancellation.cancelled_by} at {formatDateTime(event.cancellation.cancelled_at)} UTC</p>
        <p data-testid="request-detail-cancellation-reason">{event.cancellation.reason}</p>
      </div>}
      {allowed && !open && <button type="button" className="btn btn-secondary"
        data-testid="request-detail-cancel-button" onClick={() => { setError(null); setOpen(true) }}>Cancel event</button>}
      {allowed && open && <form ref={form} onSubmit={submit} noValidate className="space-y-3"
        data-testid="request-detail-cancel-form">
        <p>Cancel this event and release its venue and equipment commitments? This cannot be undone.</p>
        <label className="block">Cancellation reason *
          <textarea data-testid="request-detail-cancel-reason-input" className="input mt-2 w-full"
            aria-required="true" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
        </label>
        {error && <p role="alert" data-testid="request-detail-cancel-error">{error}</p>}
        <div className="flex gap-3">
          <button type="button" className="btn btn-secondary" disabled={busy} data-testid="request-detail-cancel-dismiss-button"
            onClick={() => { setOpen(false); setReason(''); setError(null) }}>Keep event</button>
          <button type="submit" className="btn btn-danger" disabled={busy}
            data-testid="request-detail-cancel-confirm-button">Confirm cancellation</button>
        </div>
      </form>}
    </section>
  )
}
