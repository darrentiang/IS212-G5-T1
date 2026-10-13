import { useState } from 'react'
import { formatDate, formatDateTime, formatTime } from '../../app/format'

// SCRUM-89: what the Safety Officer reviews on an event in Safety Check, the
// decisions already made on it, and the one form that approves or rejects it
// (docs/design/ui-guidelines.md §7). An Event Coordinator sees the decisions
// only; the API sends the rest to a Safety Officer.

// The seven areas a note can be written against, in the API's own order.
const AREA_LABELS = {
  attendance: 'Attendance',
  capacity_and_layout: 'Capacity and layout',
  emergency_access: 'Emergency access',
  accessibility: 'Accessibility',
  equipment_placement: 'Equipment placement',
  crowd_movement: 'Crowd movement',
  venue_restrictions: 'Venue restrictions',
}

const list = (values) => (values.length > 0 ? values.join(', ') : 'None')
const kebab = (value) => value.replaceAll('_', '-')

function Decisions({ decisions }) {
  return (
    <section className="space-y-3" data-testid="request-detail-safety-decisions">
      <h2 className="section-title">Safety decisions</h2>
      <ul className="space-y-3">
        {decisions.map((decision) => (
          <li key={decision.id} className="space-y-1" data-testid={`request-detail-safety-decision-${decision.id}`}>
            <p>
              <strong data-testid={`request-detail-safety-decision-${decision.id}-decision`}>
                {decision.decision}
              </strong>{' '}
              by {decision.decided_by} on {formatDateTime(decision.decided_at)}
            </p>
            {decision.reason && (
              <p className="whitespace-pre-wrap" data-testid={`request-detail-safety-decision-${decision.id}-reason`}>
                Reason: {decision.reason}
              </p>
            )}
            {Object.entries(decision.notes).map(([area, note]) => (
              <p
                key={area}
                className="whitespace-pre-wrap"
                data-testid={`request-detail-safety-decision-${decision.id}-note-${kebab(area)}`}
              >
                {AREA_LABELS[area] ?? area}: {note}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function SafetyCheckSection({ decisions, safetyCheck, canDecide, submitting, onApprove, onReject }) {
  const [notes, setNotes] = useState({})
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)

  const setNote = (area, value) => setNotes((prev) => ({ ...prev, [area]: value }))

  const handleReject = () => {
    if (reason.trim() === '') {
      setReasonError('Reason is required.')
      return
    }
    setReasonError(null)
    onReject(reason, notes)
  }

  return (
    <>
      {safetyCheck && (
        <section className="space-y-6" data-testid="request-detail-safety-check">
          <div className="card space-y-6">
            <h2 className="section-title">Safety check</h2>

            <dl className="detail-list">
              <div>
                <dt>Sent for safety check</dt>
                <dd data-testid="request-detail-safety-sent-at">
                  {safetyCheck.sent_at ? formatDateTime(safetyCheck.sent_at) : 'Not recorded'}
                </dd>
              </div>
            </dl>

            <div className="space-y-3">
              <h3 className="section-title">Approved venue bookings</h3>
              {safetyCheck.venue_bookings.length === 0 ? (
                <p className="empty-state" data-testid="request-detail-safety-bookings-empty">
                  No Approved venue booking.
                </p>
              ) : (
                <ul className="space-y-4">
                  {safetyCheck.venue_bookings.map((booking) => (
                    <li key={booking.id} data-testid={`request-detail-safety-booking-${booking.id}`}>
                      <dl className="detail-list">
                        <div>
                          <dt>Venue</dt>
                          <dd data-testid={`request-detail-safety-booking-${booking.id}-venue`}>
                            {booking.venue.name}, {booking.venue.location}
                          </dd>
                        </div>
                        <div>
                          <dt>Period</dt>
                          <dd data-testid={`request-detail-safety-booking-${booking.id}-period`}>
                            {formatDate(booking.date)}, {formatTime(booking.start_time)}–{formatTime(booking.end_time)}
                          </dd>
                        </div>
                        <div>
                          <dt>Maximum capacity</dt>
                          <dd data-testid={`request-detail-safety-booking-${booking.id}-capacity`}>
                            {booking.venue.max_capacity}
                          </dd>
                        </div>
                        <div>
                          <dt>Supported layouts</dt>
                          <dd data-testid={`request-detail-safety-booking-${booking.id}-layouts`}>
                            {list(booking.venue.layouts)}
                          </dd>
                        </div>
                        <div>
                          <dt>Facilities</dt>
                          <dd data-testid={`request-detail-safety-booking-${booking.id}-facilities`}>
                            {list(booking.venue.facilities)}
                          </dd>
                        </div>
                        <div>
                          <dt>Accessibility features</dt>
                          <dd data-testid={`request-detail-safety-booking-${booking.id}-accessibility`}>
                            {list(booking.venue.accessibility_features)}
                          </dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="section-title">Approved equipment requirements</h3>
              {safetyCheck.equipment_requirements.length === 0 ? (
                <p className="empty-state" data-testid="request-detail-safety-equipment-empty">
                  None.
                </p>
              ) : (
                <ul className="space-y-1" data-testid="request-detail-safety-equipment">
                  {safetyCheck.equipment_requirements.map((item) => (
                    <li key={item.id}>
                      {item.equipment_type}, {item.quantity}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {decisions && decisions.length > 0 && <Decisions decisions={decisions} />}

      {safetyCheck && canDecide && (
        <form
          noValidate
          className="card form-card space-y-4"
          data-testid="request-detail-safety-form"
        >
          <h2 className="section-title">Decide</h2>
          <p className="field-hint">A note for each area is optional.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {safetyCheck.note_areas.map((area) => (
              <div key={area}>
                <label htmlFor={`request-detail-safety-note-${kebab(area)}`} className="label">
                  {AREA_LABELS[area] ?? area}
                </label>
                <textarea
                  id={`request-detail-safety-note-${kebab(area)}`}
                  className="input"
                  value={notes[area] ?? ''}
                  onChange={(event) => setNote(area, event.target.value)}
                  data-testid={`request-detail-safety-note-${kebab(area)}`}
                />
              </div>
            ))}
          </div>
          <div>
            <label htmlFor="request-detail-safety-reason" className="label">
              Reason (required to reject)
            </label>
            <textarea
              id="request-detail-safety-reason"
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid="request-detail-safety-reason-input"
            />
            {reasonError && (
              <p className="field-error" data-testid="request-detail-safety-reason-error">
                {reasonError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={handleReject}
              className="btn btn-secondary"
              data-testid="request-detail-safety-reject-button"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onApprove(notes)}
              className="btn btn-primary"
              data-testid="request-detail-safety-approve-button"
            >
              Approve
            </button>
          </div>
        </form>
      )}
    </>
  )
}
