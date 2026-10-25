import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../app/auth'
import { STATUS, formatDate, formatDateTime, formatTime } from '../../app/format'
import { useReveal } from '../../app/reveal'
import { editEvent, getEditOptions } from './api'

// SCRUM-47: the assigned Event Coordinator edits an event after submission and
// sees its record of significant changes. Which change is allowed in which
// stage, and the hold rule, are the API's (state-model.md, SCRUM-47); a refusal
// stays in the form with its message and the entries kept.

const EDITABLE = [
  STATUS.REQUEST.SUBMITTED,
  STATUS.REQUEST.APPROVED,
  STATUS.REQUEST.PLANNING,
  STATUS.REQUEST.SAFETY_CHECK,
  STATUS.REQUEST.CONFIRMED,
]

// Same order, labels and inputs as the Draft edit form (ui-guidelines.md §7).
const FIELDS_BEFORE_CHOICES = [
  { name: 'name', label: 'Event name', type: 'text' },
  { name: 'purpose', label: 'Purpose', type: 'text' },
  { name: 'description', label: 'Description', type: 'textarea' },
  { name: 'date', label: 'Date', type: 'date' },
  { name: 'start_time', label: 'Start time', type: 'time' },
  { name: 'end_time', label: 'End time', type: 'time' },
  { name: 'attendance', label: 'Expected attendance', type: 'number' },
]
const FIELDS_AFTER_CHOICES = [
  { name: 'equipment_requirements', label: 'Equipment requirements', type: 'textarea' },
  { name: 'registration_needs', label: 'Registration needs', type: 'textarea' },
]
const FIELDS = [...FIELDS_BEFORE_CHOICES, ...FIELDS_AFTER_CHOICES]
const SHORT = new Set(['date', 'start_time', 'end_time', 'attendance'])

// The change record names a field as the event page does.
const LABELS = {
  date: 'Date',
  start_time: 'Start time',
  end_time: 'End time',
  attendance: 'Expected attendance',
  equipment_requirements: 'Equipment requirements',
  layout: 'Room layout',
  facilities: 'Facilities',
  accessibility_features: 'Accessibility features',
}
const FORMATS = { date: formatDate, start_time: formatTime, end_time: formatTime }

const shown = (field, value) => (value == null ? 'None' : FORMATS[field] ? FORMATS[field](value) : value)
const key = (name) => name.replaceAll('_', '-')
const kebab = (value) => value.toLowerCase().replaceAll(' ', '-')
const toggle = (values, value) =>
  values.includes(value) ? values.filter((item) => item !== value) : [...values, value]

// A submitted event has every field filled; only the layout may be none.
const valuesFrom = (event) => ({
  ...Object.fromEntries(FIELDS.map((field) => [field.name, event[field.name]])),
  layout: event.layout ?? '',
  facilities: event.facilities,
  accessibility_features: event.accessibility_features,
})

export default function EventEditSection({ event, onEdited, activeAction, onActionChange }) {
  return <EventEdit key={event.id} event={event} onEdited={onEdited} activeAction={activeAction} onActionChange={onActionChange} />
}

function EventEdit({ event, onEdited, activeAction, onActionChange }) {
  const auth = useAuth()
  const [localOpen, setLocalOpen] = useState(false)
  const open = onActionChange ? activeAction === 'event-edit' : localOpen
  const setOpen = onActionChange ? (value) => onActionChange(value ? 'event-edit' : null) : setLocalOpen
  const [values, setValues] = useState(null)
  const [options, setOptions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const generation = useRef(0)
  const form = useReveal(open && Boolean(values), '[data-testid="request-detail-event-edit-name-input"]')
  useEffect(() => () => { generation.current += 1 }, [])

  const assigned = event.assigned_coordinator === auth?.account?.username
  const allowed = Boolean(auth?.can?.('requests.edit_event')) && assigned && EDITABLE.includes(event.status)

  async function start() {
    const token = generation.current
    setBusy(true)
    setError(null)
    try {
      const lists = options ?? (await getEditOptions())
      if (token !== generation.current) return
      setOptions(lists)
      setValues(valuesFrom(event))
      setOpen(true)
    } catch (failure) {
      if (token !== generation.current) return
      setError(failure.message)
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    const token = generation.current
    setBusy(true)
    setError(null)
    try {
      const updated = await editEvent(event.id, { ...values, layout: values.layout || null })
      if (token !== generation.current) return
      setOpen(false)
      onEdited(updated)
    } catch (failure) {
      if (token !== generation.current) return
      setError(failure.message)
    } finally {
      if (token === generation.current) setBusy(false)
    }
  }

  const set = (name, value) => setValues((prev) => ({ ...prev, [name]: value }))

  const renderField = (field) => {
    const Control = field.type === 'textarea' ? 'textarea' : 'input'
    return (
      <div key={field.name} className={SHORT.has(field.name) ? undefined : 'md:col-span-3'}>
        <label htmlFor={`request-detail-event-edit-${field.name}`} className="label">{field.label}</label>
        <Control id={`request-detail-event-edit-${field.name}`} className="input"
          type={field.type === 'textarea' ? undefined : field.type}
          value={values[field.name]} disabled={busy} onChange={(e) => set(field.name, e.target.value)}
          data-testid={`request-detail-event-edit-${key(field.name)}-input`} />
      </div>
    )
  }

  const renderCheckboxes = (name) =>
    options[name].map((option) => (
      <label key={option} className="flex items-center gap-2 py-1">
        <input type="checkbox" checked={values[name].includes(option)} disabled={busy}
          onChange={() => set(name, toggle(values[name], option))}
          data-testid={`request-detail-event-edit-${key(name)}-${kebab(option)}-input`} />
        {option}
      </label>
    ))

  const record = assigned ? event.change_record : undefined
  if (!allowed && !record) return null
  return (
    <section className="space-y-3" aria-label="Edit event">
      {allowed && !open && (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={busy}
            data-testid="request-detail-event-edit-button" onClick={start}>Edit event</button>
        </div>
      )}
      {allowed && !open && error && <p role="alert" data-testid="request-detail-event-edit-error">{error}</p>}
      {allowed && open && values && (
        <form ref={form} onSubmit={submit} noValidate className="card form-card space-y-4"
          data-testid="request-detail-event-edit-form">
          <h2 className="section-title">Edit event</h2>
          <div className="grid gap-4 md:grid-cols-3">{FIELDS_BEFORE_CHOICES.map(renderField)}</div>
          <fieldset className="space-y-4">
            <legend className="section-title">Venue requirements</legend>
            <div>
              <label htmlFor="request-detail-event-edit-layout" className="label">Room layout</label>
              <select id="request-detail-event-edit-layout" className="input" value={values.layout} disabled={busy}
                onChange={(e) => set('layout', e.target.value)} data-testid="request-detail-event-edit-layout-input">
                <option value="">None</option>
                {options.layouts.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <fieldset>
              <legend className="label">Facilities</legend>
              {renderCheckboxes('facilities')}
            </fieldset>
          </fieldset>
          <fieldset className="space-y-4">
            <legend className="section-title">Accessibility needs</legend>
            <fieldset>
              <legend className="label">Accessibility features</legend>
              {renderCheckboxes('accessibility_features')}
            </fieldset>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-3">{FIELDS_AFTER_CHOICES.map(renderField)}</div>
          {error && <p role="alert" data-testid="request-detail-event-edit-error">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" disabled={busy}
              data-testid="request-detail-event-edit-cancel-button"
              onClick={() => { setOpen(false); setError(null) }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}
              data-testid="request-detail-event-edit-confirm-button">Save</button>
          </div>
        </form>
      )}
      {record && (
        <div className="space-y-2" data-testid="request-detail-change-record">
          <h2 className="section-title">Change record</h2>
          {record.length === 0 ? (
            <p data-testid="request-detail-change-record-empty">No significant changes recorded.</p>
          ) : (
            <ul className="space-y-1">
              {record.map((entry) => (
                <li key={entry.id} data-testid="request-detail-change-record-entry" data-field={entry.field}>
                  {LABELS[entry.field]}: {shown(entry.field, entry.old_value)} → {shown(entry.field, entry.new_value)}, by {entry.changed_by} at {formatDateTime(entry.changed_at)} UTC
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
