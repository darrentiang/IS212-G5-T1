import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Banner from '../../app/Banner'
import { STATUS, formatDate, statusBadgeClass } from '../../app/format'
import { listAssignments } from './api'

// SCRUM-88: the Event Coordinator Lead's read-only view of every active event and who
// holds it, filtered by coordinator and by status, with each coordinator's count of
// active events. Opening an event shows its request page, where the Lead is offered
// no action.
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
  const [banner, setBanner] = useState(null)

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
  }, [coordinator, status])

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="assignments-title">
          All assignments
        </h1>
      </div>

      <Banner page="assignments" error={banner} onDismiss={() => setBanner(null)} />

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
