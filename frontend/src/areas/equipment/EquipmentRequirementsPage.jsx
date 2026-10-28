import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import Banner from '../../app/Banner'
import { useAuth } from '../../app/auth'
import { formatDateTime, formatPeriod, STATUS, statusBadgeClass, TIMING_MISMATCH, TIMING_MISMATCH_BADGE } from '../../app/format'
import { useReveal, useRevealError } from '../../app/reveal'
import { addEquipmentRequirement, checkAvailability, decideEquipmentRequirement, getEquipmentRequirements, listEquipment, removeEquipmentRequirement, releaseEquipment, reserveEquipment, updateEquipmentArrangementNote, updateEquipmentRequirement } from './api'

export default function EquipmentRequirementsPage() {
  const { id } = useParams()
  // A new route gets new form/load state; old promises are invalidated on cleanup.
  return <RequirementForm key={id} id={id} />
}

function RequirementForm({ id }) {
  const { can } = useAuth()
  const [event, setEvent] = useState(null)
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [action, setAction] = useState(null)
  const [type, setType] = useState('')
  const [quantity, setQuantity] = useState('')
  const [technical, setTechnical] = useState('')
  const [reviewText, setReviewText] = useState('')
  const [fieldError, setFieldError] = useState(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const checkSequence = useRef(0)
  // SCRUM-50: the availability check for one recorded requirement; its result
  // card is brought into view like every fresh result (ui-guidelines.md §13).
  const [check, setCheck] = useState(null)
  const resultRef = useReveal(check, null)
  const reserving = action && ['reserve', 'release'].includes(action.mode)
  const formRef = useReveal(action, reserving ? '[data-testid="equipment-requirements-reservation-cancel-button"]' : action?.mode === 'approve' ? '[data-testid="equipment-requirements-review-cancel-button"]' : action?.mode === 'remove' ? '[data-testid="equipment-requirements-cancel-button"]' : 'input, select, textarea')
  useRevealError(formRef, fieldError)
  useEffect(() => {
    const loaded = ++generation.current
    Promise.all([getEquipmentRequirements(id), listEquipment()]).then(([data, catalogue]) => {
      if (generation.current !== loaded) return
      setEvent(data)
      setTypes(catalogue)
    }).catch((failure) => {
      if (generation.current === loaded) setError(failure.message)
    }).finally(() => {
      if (generation.current === loaded) setLoading(false)
    })
    return () => { generation.current += 1 }
  }, [id])
  const canEdit = can('equipment.requirements.edit') && [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(event?.status)
  const canReview = can('equipment.requirements.review') && [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(event?.status)
  const canReserve = can('equipment.reserve') && [STATUS.REQUEST.APPROVED, STATUS.REQUEST.PLANNING].includes(event?.status)
  const reviewing = action && ['approve', 'decline', 'note'].includes(action.mode)
  const reviewAllowed = canReview && (action?.mode === 'note' || !action?.row?.has_unreleased_reservation)
  const available = types.filter((item) => !event?.requirements.some((row) => row.equipment_type_id === item.id))
  const canCheck = can('equipment.check')
  const runCheck = async (row) => {
    setError(null)
    setSuccess(null)
    setCheck(null)
    const checkedGeneration = generation.current
    const sequence = ++checkSequence.current
    const current = () => generation.current === checkedGeneration && checkSequence.current === sequence
    try {
      const data = await checkAvailability(row.equipment_type_id, { event_request_id: id, quantity: row.quantity })
      if (current()) setCheck({ rowId: row.id, data })
    } catch (failure) {
      if (current()) setError(failure.message)
    }
  }
  const open = (mode, row) => {
    setAction({ mode, row })
    setType('')
    setQuantity(row ? String(row.quantity) : '')
    setTechnical(row ? row.technical_requirements : '')
    setReviewText(mode === 'note' ? row.arrangement_note : '')
    setFieldError(null)
    setError(null)
    setSuccess(null)
  }
  const submit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (reviewing && action.mode === 'decline' && !reviewText.trim()) {
      setFieldError({ message: 'A decline reason is required.' })
      return
    }
    if (!reviewing && !reserving && action.mode !== 'remove' && (!quantity.trim() || (action.mode === 'add' && !type))) {
      setFieldError({ message: 'Equipment type and quantity are required.' })
      return
    }
    setFieldError(null)
    setBusy(true)
    const submittedGeneration = generation.current
    try {
      let saved
      if (reserving) {
        saved = action.mode === 'reserve'
          ? await reserveEquipment(id, action.row.id)
          : await releaseEquipment(id, action.row.id)
      } else if (reviewing) {
        saved = action.mode === 'note'
          ? await updateEquipmentArrangementNote(id, action.row.id, { arrangement_note: reviewText })
          : await decideEquipmentRequirement(id, action.row.id, {
            decision: action.mode === 'approve' ? STATUS.REQUIREMENT.APPROVED : STATUS.REQUIREMENT.DECLINED,
            ...(action.mode === 'decline' ? { reason: reviewText } : {}),
          })
      } else if (action.mode === 'remove') {
        await removeEquipmentRequirement(id, action.row.id)
      } else {
        const body = { quantity: quantity.trim(), technical_requirements: technical }
        saved = action.mode === 'add'
          ? await addEquipmentRequirement(id, { ...body, equipment_type_id: Number(type) })
          : await updateEquipmentRequirement(id, action.row.id, body)
      }
      if (generation.current !== submittedGeneration) return
      if (reserving) {
        setEvent((value) => ({ ...value,
          requirements: saved.requirement ? value.requirements.map((row) => row.id === saved.requirement.id ? saved.requirement : row) : value.requirements,
          reservations: [...(value.reservations || []).filter((row) => row.id !== saved.reservation.id), saved.reservation].sort((a, b) => a.id - b.id),
        }))
        checkSequence.current += 1
        setCheck(null)
        setSuccess(action.mode === 'reserve' ? 'Equipment reserved' : 'Equipment reservation released')
      } else if (reviewing) {
        setEvent((value) => ({ ...value, requirements: value.requirements.map((row) => row.id === saved.id ? saved : row) }))
        setSuccess(action.mode === 'note' ? 'Arrangement note updated' : action.mode === 'approve' ? 'Equipment requirement approved' : 'Equipment requirement declined')
      } else if (action.mode === 'remove') {
        setEvent((value) => ({ ...value, requirements: value.requirements.filter((row) => row.id !== action.row.id) }))
        setSuccess('Equipment requirement removed')
      } else {
        setEvent((value) => ({ ...value, requirements: action.mode === 'add'
          ? [...value.requirements, saved]
          : value.requirements.map((row) => row.id === saved.id ? saved : row) }))
        setSuccess(action.mode === 'add' ? 'Equipment requirement recorded' : 'Equipment requirement updated')
      }
      setAction(null)
    } catch (failure) {
      if (generation.current === submittedGeneration) setError(failure.message)
    } finally {
      if (generation.current === submittedGeneration) setBusy(false)
    }
  }
  const form = action && (reserving ? canReserve && <form noValidate ref={formRef} onSubmit={submit} className="space-y-4" data-testid="equipment-requirements-reservation-form">
    <h3 className="section-title">{action.mode === 'reserve' ? 'Reserve equipment?' : 'Release reservation?'}</h3>
    <p>{action.row.equipment_type_name} × {action.row.quantity}</p>
    <p>{action.mode === 'reserve' ? 'Reserve the full Approved requirement quantity for this event.' : 'Release these units while preserving the reservation record.'}</p>
    <div className="flex gap-2">
      <button className="btn btn-primary" disabled={busy} data-testid="equipment-requirements-reservation-save-button">{action.mode === 'reserve' ? 'Reserve' : 'Release'}</button>
      <button className="btn btn-secondary" type="button" disabled={busy} data-testid="equipment-requirements-reservation-cancel-button" onClick={() => setAction(null)}>Cancel</button>
    </div>
  </form> : reviewing ? reviewAllowed && <form noValidate ref={formRef} onSubmit={submit} className="space-y-4" data-testid="equipment-requirements-review-form">
    <h3 className="section-title">{action.mode === 'approve' ? 'Approve requirement?' : action.mode === 'decline' ? 'Decline requirement' : 'Change arrangement note'}</h3>
    <p>{action.row.equipment_type_name} × {action.row.quantity}</p>
    {action.mode === 'approve' ? <p>Approval does not reserve equipment.</p> : <div>
      <label className="label" htmlFor="review-text">{action.mode === 'decline' ? 'Decline reason *' : 'Arrangement note'}</label>
      <textarea className="input" id="review-text" value={reviewText} onChange={(e) => setReviewText(e.target.value)} data-testid={action.mode === 'decline' ? 'equipment-requirements-review-reason-input' : 'equipment-requirements-review-note-input'} />
      {fieldError && <p className="field-error" data-testid="equipment-requirements-review-reason-error">{fieldError.message}</p>}
    </div>}
    <div className="flex gap-2">
      <button className="btn btn-primary" disabled={busy} data-testid="equipment-requirements-review-save-button">{action.mode === 'approve' ? 'Approve' : action.mode === 'decline' ? 'Decline' : 'Save'}</button>
      <button className="btn btn-secondary" type="button" disabled={busy} data-testid="equipment-requirements-review-cancel-button" onClick={() => setAction(null)}>Cancel</button>
    </div>
  </form> : <form noValidate ref={formRef} onSubmit={submit} className="space-y-4" data-testid="equipment-requirements-form">
            <h3 className="section-title">{action.mode === 'remove' ? 'Remove requirement?' : action.mode === 'add' ? 'Add requirement' : 'Change requirement'}</h3>
            {action.mode === 'remove' ? <p>Remove {action.row.equipment_type_name} from this event?</p> : <>
              {action.mode === 'add' && <div>
                <label className="label" htmlFor="requirement-type">Equipment type *</label>
                <select className="input" id="requirement-type" value={type} onChange={(e) => setType(e.target.value)} data-testid="equipment-requirements-type-input">
                  <option value="">Select equipment type</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>}
              <div><label className="label" htmlFor="requirement-quantity">Quantity *</label>
                <input className="input" id="requirement-quantity" type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="equipment-requirements-quantity-input" />
                {fieldError && <p className="field-error">{fieldError.message}</p>}
              </div>
              <div><label className="label" htmlFor="requirement-technical">Technical requirements</label>
                <textarea className="input" id="requirement-technical" value={technical} onChange={(e) => setTechnical(e.target.value)} data-testid="equipment-requirements-technical-input" />
              </div>
            </>}
            <div className="flex gap-2">
              <button className="btn btn-primary" disabled={busy} data-testid={action.mode === 'remove' ? 'equipment-requirements-confirm-remove-button' : 'equipment-requirements-save-button'}>{action.mode === 'remove' ? 'Remove' : 'Save'}</button>
              <button className="btn btn-secondary" type="button" disabled={busy} data-testid="equipment-requirements-cancel-button" onClick={() => setAction(null)}>Cancel</button>
            </div>
          </form>)
  return (
    <div className="space-y-8">
      <h1 className="page-title" data-testid="equipment-requirements-title">Equipment requirements</h1>
      <Banner page="equipment-requirements" error={error} success={success} onDismiss={() => { setError(null); setSuccess(null) }} />
      {!loading && event && <>
        <section className="card space-y-4">
          <h2 className="section-title">{event.name}</h2>
          <p data-testid="equipment-requirements-timing">{formatPeriod(event.date, event.start_time, event.end_time)}</p>
          <p><span className={statusBadgeClass(event.status)} data-testid="equipment-requirements-status">{event.status}</span></p>
          {can('requests.view') && <Link className="link" to={`/requests/${id}`} data-testid="equipment-requirements-event-link">Event details</Link>}
          <h3 className="section-title">Approved venue bookings</h3>
          {event.approved_venue_bookings.length === 0 ? <p data-testid="equipment-requirements-no-venues">No Approved venue bookings.</p> : (
            <ul>{event.approved_venue_bookings.map((row) => <li key={row.id} data-testid={`equipment-requirements-venue-${row.id}`}>{row.venue_name} — {formatPeriod(row.date, row.start_time, row.end_time)}</li>)}</ul>
          )}
        </section>
        <section className="card space-y-4">
          <h2 className="section-title">Recorded requirements</h2>
          {event.requirements.length === 0 && <p data-testid="equipment-requirements-empty">No equipment requirements.</p>}
          <ul className="space-y-4">{event.requirements.map((row) => <li className="space-y-2" key={row.id} data-testid={`equipment-requirements-row-${row.id}`}>
            <p><strong data-testid={`equipment-requirements-type-${row.id}`}>{row.equipment_type_name}</strong> × <span data-testid={`equipment-requirements-quantity-${row.id}`}>{row.quantity}</span> — <span className={statusBadgeClass(row.status)} data-testid={`equipment-requirements-status-${row.id}`}>{row.status}</span></p>
            <p className="whitespace-pre-wrap" data-testid={`equipment-requirements-technical-${row.id}`}>{row.technical_requirements || 'None'}</p>
            <p className="whitespace-pre-wrap" data-testid={`equipment-requirements-decline-reason-${row.id}`}>Decline reason: {row.decline_reason || 'None'}</p>
            <p className="whitespace-pre-wrap" data-testid={`equipment-requirements-note-${row.id}`}>Arrangement note: {row.arrangement_note || 'None'}</p>
            <p data-testid={`equipment-requirements-decision-${row.id}`}>{row.decided_at ? `${row.decided_by} — ${formatDateTime(row.decided_at)}` : 'Not yet reviewed'}</p>
            {canReview && row.has_unreleased_reservation && <p data-testid={`equipment-requirements-review-locked-${row.id}`}>Review decision locked while equipment is reserved.</p>}
            {canReview && <div className="flex flex-wrap gap-2">
              {!row.has_unreleased_reservation && <>
                {row.status !== STATUS.REQUIREMENT.APPROVED && <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-approve-${row.id}`} onClick={() => open('approve', row)}>Approve</button>}
                {row.status !== STATUS.REQUIREMENT.DECLINED && <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-decline-${row.id}`} onClick={() => open('decline', row)}>Decline</button>}
              </>}
              <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-edit-note-${row.id}`} onClick={() => open('note', row)}>Change arrangement note</button>
            </div>}
            {canEdit && row.status === STATUS.REQUIREMENT.REQUESTED && <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-edit-${row.id}`} onClick={() => open('edit', row)}>Change</button>
              <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-remove-${row.id}`} onClick={() => open('remove', row)}>Remove</button>
            </div>}
            {canReserve && row.status === STATUS.REQUIREMENT.APPROVED && !row.has_unreleased_reservation && <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-reserve-${row.id}`} onClick={() => open('reserve', row)}>Reserve</button>}
            {canCheck && <div className="flex flex-wrap gap-2">
              <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-check-${row.id}`} onClick={() => runCheck(row)}>Check availability</button>
            </div>}
            {check?.rowId === row.id && <div ref={resultRef} className="card space-y-2" data-testid={`equipment-requirements-check-result-${row.id}`}>
              <p data-testid={`equipment-requirements-check-period-${row.id}`}>Checked for {formatPeriod(event.date, event.start_time, event.end_time)}</p>
              <dl className="detail-list">
                <div><dt>Total units</dt><dd data-testid={`equipment-requirements-check-total-${row.id}`}>{check.data.total_units}</dd></div>
                <div><dt>Reserved for the period</dt><dd data-testid={`equipment-requirements-check-reserved-${row.id}`}>{check.data.reserved_units}</dd></div>
                <div><dt>Out of service</dt><dd data-testid={`equipment-requirements-check-out-of-service-${row.id}`}>{check.data.out_of_service_units}</dd></div>
                <div><dt>Available</dt><dd data-testid={`equipment-requirements-check-available-${row.id}`}>{check.data.available_units}</dd></div>
              </dl>
              <p data-testid={`equipment-requirements-check-verdict-${row.id}`}>{check.data.covered
                ? `Covered: the ${check.data.requested_units} requested are available.`
                : `Short by ${check.data.short_by}: ${check.data.requested_units} requested, ${check.data.available_units} available.`}</p>
            </div>}
            {action?.mode !== 'release' && action?.row?.id === row.id && form}
          </li>)}</ul>
          {canEdit && available.length > 0 && <button className="btn btn-primary" disabled={busy} data-testid="equipment-requirements-add-button" onClick={() => open('add')}>Add requirement</button>}
          {action?.mode === 'add' && form}
        </section>
        <section className="card space-y-4">
          <h2 className="section-title">Equipment reservations</h2>
          {!(event.reservations || []).length && <p data-testid="equipment-requirements-reservations-empty">No equipment reservations.</p>}
          <ul className="space-y-4">{(event.reservations || []).map((row) => <li className="space-y-2" key={row.id} data-testid={`equipment-requirements-reservation-${row.id}`}>
            <p><strong>{row.equipment_type_name}</strong> × {row.quantity}</p>
            <p data-testid={`equipment-requirements-reservation-period-${row.id}`}>{formatPeriod(row.date, row.start_time, row.end_time)}</p>
            <p><span data-testid={`equipment-requirements-reservation-status-${row.id}`}>{row.status}</span>
              {/* SCRUM-61: the reservation's period is not the event's; derived by the API. */}
              {row.timing_mismatch && <span className={`${TIMING_MISMATCH_BADGE} ml-2`} data-testid={`equipment-requirements-reservation-timing-mismatch-${row.id}`}>{TIMING_MISMATCH}</span>}</p>
            {canReserve && row.status === STATUS.RESERVATION.RESERVED && <button className="btn btn-secondary" disabled={busy} data-testid={`equipment-requirements-release-${row.id}`} onClick={() => open('release', row)}>Release</button>}
            {action?.mode === 'release' && action.row.id === row.id && form}
          </li>)}</ul>
        </section>
      </>}
    </div>
  )
}
