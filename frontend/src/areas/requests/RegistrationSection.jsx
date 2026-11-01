import { useEffect, useRef, useState } from 'react'
import { formatDateTime } from '../../app/format'
import { useReveal } from '../../app/reveal'
import { setRegistration } from './api'

// SCRUM-92: the event's assigned Event Coordinator sees its registration (on or
// off, capacity, closing time) and sets it while the API says they may
// (registration.can_edit: Approved, Planning, Safety Check or Confirmed). The
// API sends `registration` to the assigned coordinator (and SCRUM-57's Organiser). Every rule is the
// API's: a refusal goes to the page banner (onRefused) and the form stays open
// with the entered values; a save closes it and the page shows `Registration updated`.
// SCRUM-57: the Event Organiser who created the event gets `registration` too,
// read-only (can_edit false). While registration is on, both see how many are
// registered, the places remaining and who registered; while it is off, a sentence.

const valuesFrom = (registration) => ({
  enabled: registration.enabled ? 'on' : 'off',
  capacity: registration.capacity == null ? '' : String(registration.capacity),
  closing_date: registration.closes_at ? registration.closes_at.slice(0, 10) : '',
  closing_time: registration.closes_at ? registration.closes_at.slice(11, 16) : '',
})

export default function RegistrationSection({ event, onSaved, onRefused, activeAction, onActionChange }) {
  if (!event.registration) return null
  return (
    <Registration key={event.id} event={event} onSaved={onSaved} onRefused={onRefused}
      activeAction={activeAction} onActionChange={onActionChange} />
  )
}

function Registration({ event, onSaved, onRefused, activeAction, onActionChange }) {
  const registration = event.registration
  const [localOpen, setLocalOpen] = useState(false)
  const open = onActionChange ? activeAction === 'registration-edit' : localOpen
  const setOpen = onActionChange ? (value) => onActionChange(value ? 'registration-edit' : null) : setLocalOpen
  const [values, setValues] = useState(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const form = useReveal(open && Boolean(values), '[data-testid="request-detail-registration-enabled-input"]')
  useEffect(() => () => { generation.current += 1 }, [])

  async function submit(e) {
    e.preventDefault()
    const token = generation.current
    setBusy(true)
    try {
      const updated = await setRegistration(event.id, { ...values, enabled: values.enabled === 'on' })
      if (token !== generation.current) return
      setOpen(false)
      onSaved(updated)
    } catch (failure) {
      if (token !== generation.current) return
      onRefused(failure.message)
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }

  const set = (name, value) => setValues((prev) => ({ ...prev, [name]: value }))
  const input = (name, label, type) => (
    <div>
      <label htmlFor={`request-detail-registration-${name}`} className="label">{label}</label>
      <input id={`request-detail-registration-${name}`} className="input" type={type}
        value={values[name]} disabled={busy} onChange={(e) => set(name, e.target.value)}
        data-testid={`request-detail-registration-${name.replaceAll('_', '-')}-input`} />
    </div>
  )

  return (
    <section className="space-y-3" aria-label="Registration" data-testid="request-detail-registration">
      <h2 className="section-title">Registration</h2>
      <dl className="detail-list">
        <div>
          <dt>Registration</dt>
          <dd data-testid="request-detail-registration-enabled">{registration.enabled ? 'On' : 'Off'}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd data-testid="request-detail-registration-capacity">{registration.capacity ?? 'None'}</dd>
        </div>
        <div>
          <dt>Closes</dt>
          <dd data-testid="request-detail-registration-closes">
            {registration.closes_at ? formatDateTime(registration.closes_at) : 'None'}
          </dd>
        </div>
      </dl>
      {registration.enabled ? <Registered registration={registration} /> : (
        <p data-testid="request-detail-registration-not-on">Registration is not on for this event.</p>
      )}
      {registration.can_edit && !open && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" data-testid="request-detail-registration-edit-button"
            onClick={() => { setValues(valuesFrom(registration)); setOpen(true) }}>Edit</button>
        </div>
      )}
      {registration.can_edit && open && values && (
        <form ref={form} onSubmit={submit} noValidate className="card form-card space-y-4"
          data-testid="request-detail-registration-form">
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label htmlFor="request-detail-registration-enabled" className="label">Registration</label>
              <select id="request-detail-registration-enabled" className="input" value={values.enabled}
                disabled={busy} onChange={(e) => set('enabled', e.target.value)}
                data-testid="request-detail-registration-enabled-input">
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            {input('capacity', 'Capacity', 'number')}
            {input('closing_date', 'Closing date', 'date')}
            {input('closing_time', 'Closing time', 'time')}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" disabled={busy}
              data-testid="request-detail-registration-cancel-button" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}
              data-testid="request-detail-registration-save-button">Save</button>
          </div>
        </form>
      )}
    </section>
  )
}

function Registered({ registration }) {
  const { attendees } = registration
  return (
    <>
      <dl className="detail-list">
        <div>
          <dt>Registered</dt>
          <dd data-testid="request-detail-registration-registered">{registration.registered}</dd>
        </div>
        <div>
          <dt>Places remaining</dt>
          <dd data-testid="request-detail-registration-places-remaining">{registration.places_remaining}</dd>
        </div>
      </dl>
      <h3 className="section-title">Registered attendees</h3>
      {attendees.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="request-detail-registration-attendees-empty">
            No one has registered yet.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table" data-testid="request-detail-registration-attendees">
              <thead>
                <tr>
                  <th>Attendee</th>
                  <th>Registered at</th>
                </tr>
              </thead>
              <tbody>
                {attendees.map((row) => (
                  <tr key={row.username} data-testid={`request-detail-registration-attendee-${row.username}`}>
                    <td data-testid={`request-detail-registration-attendee-name-${row.username}`}>{row.username}</td>
                    <td data-testid={`request-detail-registration-attendee-registered-at-${row.username}`}>
                      {formatDateTime(row.registered_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
