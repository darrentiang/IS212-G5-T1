import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Banner from '../../app/Banner'
import { STATUS, formatDate, statusBadgeClass } from '../../app/format'
import { listAssignments, reassignRequest } from './api'

// SCRUM-88: the Event Coordinator Lead's view of every active event and who holds it,
// filtered by coordinator and by status, with each coordinator's count of active events.
// Opening an event shows its request page, where the Lead is offered no action.
// SCRUM-44: each assigned row also has a coordinator to choose and a Reassign button;
// an event nobody holds is assigned from the Unassigned queue, so its row has neither.
const ACTIVE = [
  STATUS.REQUEST.SUBMITTED,
  STATUS.REQUEST.APPROVED,
  STATUS.REQUEST.PLANNING,
  STATUS.REQUEST.SAFETY_CHECK,
  STATUS.REQUEST.CONFIRMED,
]

export default function AssignmentsPage() {
  const [events, setEvents] = useState([])
  const [coordinators, setCoordinators] = useState([])
  const [coordinator, setCoordinator] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  // A list that cannot be read (hides the list), and the outcome of a Reassign (does not).
  const [banner, setBanner] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  // The coordinator picked for each row, and the message under an empty pick.
  const [chosen, setChosen] = useState({})
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    listAssignments({ coordinator, status })
      .then((data) => {
        if (active) {
          setEvents(data.events)
          setCoordinators(data.coordinators)
          setBanner(null)
        }
      })
      .catch((error) => {
        if (active) setBanner(error.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [coordinator, status, reloadKey])

  const choose = (id, value) => {
    setChosen((current) => ({ ...current, [id]: value }))
    setErrors((current) => ({ ...current, [id]: null }))
  }

  const handleReassign = async (row) => {
    setActionError(null)
    setSuccess(null)
    // The page checks only that a coordinator is picked; every other rule is the
    // API's and shows in the banner (ui-guidelines.md §5).
    const picked = chosen[row.id] ?? ''
    if (picked === '') {
      setErrors((current) => ({ ...current, [row.id]: 'Choose an Event Coordinator.' }))
      return
    }

    setSubmitting(true)
    try {
      const updated = await reassignRequest(row.id, Number(picked))
      choose(row.id, '')
      setSuccess(`${row.name} reassigned to ${updated.assigned_coordinator}.`)
    } catch (error) {
      setActionError(error.message)
    } finally {
      setSubmitting(false)
      // Whatever the outcome, show the list and the counts as they now stand.
      setReloadKey((key) => key + 1)
    }
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="assignments-title">
          All assignments
        </h1>
      </div>

      <Banner
        page="assignments"
        error={banner || actionError}
        success={success}
        onDismiss={() => {
          setBanner(null)
          setActionError(null)
          setSuccess(null)
        }}
      />

      <section className="card" data-testid="assignments-workloads" aria-labelledby="assignments-workloads-heading">
        <h2 id="assignments-workloads-heading" className="section-title">
          Active events per coordinator
        </h2>
        <ul className="flex flex-wrap gap-4">
          {coordinators.map((row) => (
            <li key={row.username} data-testid={`assignments-workload-${row.username}`}>
              {row.username}: <strong>{row.active_events}</strong>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap gap-4">
        <div>
          <label htmlFor="assignments-coordinator-filter" className="label">
            Coordinator
          </label>
          <select
            id="assignments-coordinator-filter"
            className="input"
            value={coordinator}
            onChange={(event) => setCoordinator(event.target.value)}
            data-testid="assignments-coordinator-filter"
          >
            <option value="">All coordinators</option>
            {coordinators.map((row) => (
              <option key={row.username} value={row.username}>
                {row.username}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="assignments-status-filter" className="label">
            Status
          </label>
          <select
            id="assignments-status-filter"
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            data-testid="assignments-status-filter"
          >
            <option value="">All statuses</option>
            {ACTIVE.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading || banner ? null : events.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="assignments-empty">
            No active events match.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Assigned coordinator</th>
                  <th>Reassign to</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id} data-testid={`assignments-row-${row.id}`}>
                    <td data-testid={`assignments-name-${row.id}`}>
                      <Link to={`/requests/${row.id}`}>{row.name}</Link>
                    </td>
                    <td data-testid={`assignments-date-${row.id}`}>{formatDate(row.date)}</td>
                    <td>
                      <span className={statusBadgeClass(row.status)} data-testid={`assignments-status-${row.id}`}>
                        {row.status}
                      </span>
                    </td>
                    <td data-testid={`assignments-coordinator-${row.id}`}>
                      {row.assigned_coordinator ?? 'Unassigned'}
                    </td>
                    <td>
                      {row.assigned_coordinator && (
                        <div className="flex flex-wrap items-start gap-2">
                          <div>
                            <label htmlFor={`assignments-reassign-input-${row.id}`} className="sr-only">
                              New Event Coordinator for {row.name}
                            </label>
                            <select
                              id={`assignments-reassign-input-${row.id}`}
                              className="input"
                              value={chosen[row.id] ?? ''}
                              onChange={(event) => choose(row.id, event.target.value)}
                              data-testid={`assignments-reassign-input-${row.id}`}
                            >
                              <option value="">Choose a coordinator</option>
                              {coordinators.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.username}
                                </option>
                              ))}
                            </select>
                            {errors[row.id] && (
                              <p className="field-error" data-testid={`assignments-reassign-error-${row.id}`}>
                                {errors[row.id]}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleReassign(row)}
                            className="btn btn-primary"
                            data-testid={`assignments-reassign-button-${row.id}`}
                          >
                            Reassign
                          </button>
                        </div>
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
