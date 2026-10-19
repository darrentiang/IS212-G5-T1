import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import Banner from '../../app/Banner'
import { formatDate, formatDateTime } from '../../app/format'
import { assignRequest, listAssignableCoordinators, listAssignmentQueue } from './api'

// SCRUM-86: the Event Coordinator Lead's queue of newly submitted requests, oldest
// first, each with a coordinator to choose and an Assign button. Assigning leaves
// the request Submitted and takes it out of the queue.
export default function UnassignedQueuePage() {
  const [rows, setRows] = useState([])
  const [coordinators, setCoordinators] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(null)
  // The coordinator picked for each queued request, and the message under an empty pick.
  const [chosen, setChosen] = useState({})
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([listAssignmentQueue(), listAssignableCoordinators()])
      .then(([queue, accounts]) => {
        if (active) {
          setRows(queue)
          setCoordinators(accounts)
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
  }, [])

  const choose = (id, value) => {
    setChosen((current) => ({ ...current, [id]: value }))
    setErrors((current) => ({ ...current, [id]: null }))
  }

  const handleAssign = async (row) => {
    setBanner(null)
    setSuccessBanner(null)
    // The page checks only that a coordinator is picked; every other rule is the
    // API's and shows in the banner (ui-guidelines.md §5).
    const picked = chosen[row.id] ?? ''
    if (picked === '') {
      setErrors((current) => ({ ...current, [row.id]: 'Choose an Event Coordinator.' }))
      return
    }

    setSubmitting(true)
    try {
      const updated = await assignRequest(row.id, Number(picked))
      setRows((current) => current.filter((item) => item.id !== row.id))
      setSuccessBanner(`${row.name} assigned to ${updated.assigned_coordinator}`)
    } catch (error) {
      setBanner(error.message)
      // The refusal may mean someone else assigned it first: show the queue as it stands.
      try {
        setRows(await listAssignmentQueue())
      } catch (reloadError) {
        setBanner(reloadError.message)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="assignment-queue-title">
          Unassigned queue
        </h1>
      </div>

      <Banner
        page="assignment-queue"
        error={banner}
        success={successBanner}
        onDismiss={() => {
          setBanner(null)
          setSuccessBanner(null)
        }}
      />

      {loading ? null : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="assignment-queue-empty">
            No requests are waiting to be assigned.
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
                  <th>Date</th>
                  <th>Expected attendance</th>
                  <th>Event Organiser</th>
                  <th>Submitted</th>
                  <th>Assign to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`assignment-queue-row-${row.id}`}>
                    <td data-testid={`assignment-queue-name-${row.id}`}>
                      <Link to={`/requests/${row.id}`}>{row.name}</Link>
                    </td>
                    <td data-testid={`assignment-queue-purpose-${row.id}`}>{row.purpose}</td>
                    <td data-testid={`assignment-queue-date-${row.id}`}>{formatDate(row.date)}</td>
                    <td data-testid={`assignment-queue-attendance-${row.id}`}>{row.attendance}</td>
                    <td data-testid={`assignment-queue-organiser-${row.id}`}>{row.created_by}</td>
                    <td data-testid={`assignment-queue-submitted-${row.id}`}>
                      {row.submitted_at ? formatDateTime(row.submitted_at) : ''}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-start gap-2">
                        <div>
                          <label htmlFor={`assignment-queue-coordinator-${row.id}`} className="sr-only">
                            Event Coordinator for {row.name}
                          </label>
                          <select
                            id={`assignment-queue-coordinator-${row.id}`}
                            className="input"
                            value={chosen[row.id] ?? ''}
                            onChange={(event) => choose(row.id, event.target.value)}
                            data-testid={`assignment-queue-coordinator-input-${row.id}`}
                          >
                            <option value="">Choose a coordinator</option>
                            {coordinators.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.username}
                              </option>
                            ))}
                          </select>
                          {errors[row.id] && (
                            <p className="field-error" data-testid={`assignment-queue-coordinator-error-${row.id}`}>
                              {errors[row.id]}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleAssign(row)}
                          className="btn btn-primary"
                          data-testid={`assignment-queue-assign-button-${row.id}`}
                        >
                          Assign
                        </button>
                      </div>
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
