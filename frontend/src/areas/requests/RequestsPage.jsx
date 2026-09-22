import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { useAuth } from '../../app/auth'
import { listRequests } from './api'

// SCRUM-27: list only what the API returns for this account.
// SCRUM-28: the New request button for an account that may submit one.
// SCRUM-30: the success banner carried from RequestDetailPage's navigate() after deleting a draft.
export default function RequestsPage() {
  const { can } = useAuth() ?? {}
  const location = useLocation()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)
  const [successBanner, setSuccessBanner] = useState(location.state?.banner ?? null)

  useEffect(() => {
    let active = true
    listRequests()
      .then((data) => {
        if (active) setRows(data)
      })
      .catch((error) => {
        if (active) {
          setBanner(error.message)
          setSuccessBanner(null)
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-gray-900" data-testid="requests-title">
          Requests
        </h1>
        {can?.('requests.edit') && (
          <Link
            to="/requests/new"
            className="rounded bg-blue-700 px-4 py-2 text-sm font-medium text-white"
            data-testid="requests-new-button"
          >
            New request
          </Link>
        )}
      </div>

      {banner && (
        <p role="alert" className="border border-red-300 bg-red-50 text-red-800 rounded px-3 py-2 text-sm" data-testid="requests-banner">
          {banner}
        </p>
      )}
      {!banner && successBanner && (
        <p role="status" className="border border-green-300 bg-green-50 text-green-800 rounded px-3 py-2 text-sm" data-testid="requests-banner">
          {successBanner}
        </p>
      )}

      {loading ? null : rows.length === 0 ? (
        <p className="text-gray-600" data-testid="requests-empty">
          No requests yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left border-b border-gray-200">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Created by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-gray-100" data-testid={`requests-row-${row.id}`}>
                  <td className="py-2 pr-4">
                    <Link to={`/requests/${row.id}`} className="text-blue-700 hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4" data-testid={`requests-status-${row.id}`}>
                    {row.status}
                  </td>
                  <td className="py-2 pr-4">{row.created_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
