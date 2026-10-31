import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { formatPeriod, STATUS, statusBadgeClass } from '../../app/format'
import { useAuth } from '../../app/auth'
import { listOpenEvents, registerForEvent } from './api'
import Banner from '../../app/Banner'

// What the Action cell says when it holds no Register button (SCRUM-54).
const STATE_WORDS = { registered: STATUS.REGISTRATION.REGISTERED, closed: 'Registration closed', full: 'Full' }

// SCRUM-27: confirmed events with registration only; never internal notes.
// SCRUM-54: an Attendee registers from here. The server says what each row
// offers (`state`), so the browser's clock never decides. A Register, success
// or refusal, reads the list again, so a place taken or a closing time passed
// meanwhile shows on the row. The generation ref drops a list reply that a
// Register has overtaken (frontend.md §7).
export default function RegistrationPage() {
  const { can } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState(null)
  const [success, setSuccess] = useState(null)
  const generation = useRef(0)

  useEffect(() => {
    const token = ++generation.current
    listOpenEvents()
      .then((data) => {
        if (token === generation.current) setRows(data)
      })
      .catch((error) => {
        if (token === generation.current) setBanner(error.message)
      })
      .finally(() => {
        if (token === generation.current) setLoading(false)
      })
    return () => {
      generation.current += 1
    }
  }, [])

  async function register(row) {
    generation.current += 1
    setBusy(true)
    setBanner(null)
    setSuccess(null)
    try {
      const event = await registerForEvent(row.id)
      // An event with no Approved venue booking names none, rather than ending in ", .".
      const details = [formatPeriod(event.date, event.start_time, event.end_time), event.venues].filter(Boolean)
      setSuccess(`Registered for ${event.name}: ${details.join(', ')}.`)
    } catch (error) {
      setBanner(error.message)
    }
    try {
      setRows(await listOpenEvents())
    } catch (error) {
      setBanner(error.message)
    } finally {
      setBusy(false)
    }
  }

  function action(row) {
    if (row.state === 'register') {
      return (
        can('registration.register') && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => register(row)}
            data-testid={`registration-register-button-${row.id}`}
          >
            Register
          </button>
        )
      )
    }
    const word = STATE_WORDS[row.state]
    return row.state === 'registered' ? <span className={statusBadgeClass(word)}>{word}</span> : word
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="registration-title">
          Registration
        </h1>
      </div>

      <Banner
        page="registration"
        error={banner}
        success={success}
        onDismiss={() => {
          setBanner(null)
          setSuccess(null)
        }}
      />

      {loading ? null : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="registration-empty">
            No events open for registration.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Purpose</th>
                  <th>Date and time</th>
                  <th>Venues</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`registration-row-${row.id}`}>
                    <td data-testid={`registration-event-${row.id}`}>
                      {/* Only an account that may open event requests gets a link to one (SCRUM-27). */}
                      {can('requests.view') ? <Link to={`/requests/${row.id}`}>{row.name}</Link> : row.name}
                    </td>
                    <td data-testid={`registration-purpose-${row.id}`}>{row.purpose}</td>
                    <td data-testid={`registration-period-${row.id}`}>
                      {formatPeriod(row.date, row.start_time, row.end_time)}
                    </td>
                    <td data-testid={`registration-venues-${row.id}`}>{row.venues}</td>
                    <td data-testid={`registration-status-${row.id}`}>
                      <span className={statusBadgeClass(row.status)}>{row.status}</span>
                    </td>
                    <td data-testid={`registration-action-${row.id}`}>{action(row)}</td>
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
