import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { statusBadgeClass } from '../../app/format'
import { listOpenEvents } from './api'

// SCRUM-27: confirmed events with registration only; never internal notes.
export default function RegistrationPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    listOpenEvents()
      .then((data) => setRows(data))
      .catch((error) => setBanner(error.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="registration-title">
          Registration
        </h1>
      </div>

      {banner && (
        <p role="alert" className="banner-error" data-testid="registration-banner">
          {banner}
        </p>
      )}

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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`registration-row-${row.id}`}>
                    <td>
                      <Link to={`/requests/${row.id}`}>{row.name}</Link>
                    </td>
                    <td data-testid={`registration-status-${row.id}`}>
                      <span className={statusBadgeClass(row.status)}>{row.status}</span>
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
