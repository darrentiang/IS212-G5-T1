import { useEffect, useState } from 'react'
import { formatPeriod, statusBadgeClass } from '../../app/format'
import Banner from '../../app/Banner'
import { listMyRegistrations, withdrawRegistration } from './api'

// SCRUM-55: an Attendee's own registrations and the Withdraw button
// (ui-guidelines.md §7). The server says which registration may be withdrawn
// (`can_withdraw`), so the browser's clock never decides. A refusal shows its
// message in the banner and the list is read again, so a registration
// withdrawn in another tab shows as Withdrawn.
// SCRUM-56: the Venue column follows the server's `venue_state`, decided by the
// event's status, so an Approved booking alone never shows a venue. A
// Confirmed or Completed event with no Approved booking shows a dash.
function venueText(row) {
  if (row.venue_state === 'confirmed') return row.venues || '—'
  if (row.venue_state === 'not_confirmed') return 'Venue not yet confirmed'
  return '—'
}

export default function MyRegistrationsPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  useEffect(() => {
    listMyRegistrations()
      .then(setRows)
      .catch((failure) => setError(failure.message))
      .finally(() => setLoading(false))
  }, [])

  async function withdraw(row) {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await withdrawRegistration(row.id)
      setSuccess(`Withdrawn from ${row.event_name}.`)
    } catch (failure) {
      setError(failure.message)
    }
    try {
      setRows(await listMyRegistrations())
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="registrations-title">
          My registrations
        </h1>
      </div>

      <Banner
        page="registrations"
        error={error}
        success={success}
        onDismiss={() => {
          setError(null)
          setSuccess(null)
        }}
      />

      {loading ? null : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="registrations-empty">
            You have no registrations.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date and time</th>
                  <th>Venue</th>
                  <th>Event status</th>
                  <th>Registration</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`registrations-row-${row.id}`}>
                    <td data-testid={`registrations-event-${row.id}`}>{row.event_name}</td>
                    <td data-testid={`registrations-period-${row.id}`}>
                      {formatPeriod(row.date, row.start_time, row.end_time)}
                    </td>
                    <td data-testid={`registrations-venue-${row.id}`}>{venueText(row)}</td>
                    <td data-testid={`registrations-event-status-${row.id}`}>
                      <span className={statusBadgeClass(row.event_status)}>{row.event_status}</span>
                    </td>
                    <td data-testid={`registrations-status-${row.id}`}>
                      <span className={statusBadgeClass(row.status)}>{row.status}</span>
                    </td>
                    <td>
                      {row.can_withdraw && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={busy}
                          onClick={() => withdraw(row)}
                          data-testid={`registrations-withdraw-button-${row.id}`}
                        >
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
