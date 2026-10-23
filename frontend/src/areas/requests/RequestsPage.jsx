import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../../app/auth'
import { statusBadgeClass } from '../../app/format'
import { listRequests } from './api'
import Banner from '../../app/Banner'

// SCRUM-27: list only what the API returns for this account.
// SCRUM-28: the New request button for an account that may submit one.
// SCRUM-30: the success banner carried from RequestDetailPage's navigate() after deleting a draft.
export default function RequestsPage() {
  const { can } = useAuth()
  const location = useLocation()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(location.state?.banner ?? null)

  useEffect(() => {
    listRequests()
      .then((data) => setRows(data))
      .catch((error) => {
        setBanner(error.message)
        setSuccessBanner(null)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="requests-title">
          Requests
        </h1>
        {can('requests.edit') && (
          <Link
            to="/requests/new"
            className="btn btn-primary"
            data-testid="requests-new-button"
          >
            New request
          </Link>
        )}
      </div>

      <Banner
        page="requests"
        error={banner}
        success={successBanner}
        onDismiss={() => {
          setBanner(null)
          setSuccessBanner(null)
        }}
      />

      {loading ? null : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="requests-empty">
            No requests yet.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Created by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`requests-row-${row.id}`}>
                    <td>
                      <Link to={`/requests/${row.id}`}>{row.name}</Link>
                    </td>
                    <td data-testid={`requests-status-${row.id}`}>
                      <span className={statusBadgeClass(row.status)}>{row.status}</span>
                      {row.clarification_requested && (
                        <span className="ml-2 text-sm" data-testid={`requests-clarification-flag-${row.id}`}>
                          Clarification requested
                        </span>
                      )}
                    </td>
                    <td>{row.created_by}</td>
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
