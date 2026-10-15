import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../app/auth'
import { formatDateTime } from '../../app/format'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from './api'
import Banner from '../../app/Banner'

// SCRUM-58: an account's own notifications, newest first (AC2, AC9 — several
// roles' notifications already arrive in one recipient-scoped list, so
// nothing here needs to know which role a notification was meant for).
export default function NotificationsPage() {
  const { refreshUnreadCount } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [banner, setBanner] = useState(null)

  useEffect(() => {
    listNotifications()
      .then((data) => setRows(data))
      .catch((error) => setBanner(error.message))
      .finally(() => setLoading(false))
  }, [])

  // Opening is the only thing that marks a notification read (AC4); an
  // already-read one is a no-op on the API, so clicking it again changes
  // nothing here either. Navigation (when there is an event to go to) waits
  // for that to finish, so a refusal shows here instead of silently leaving
  // the page as though it had worked.
  async function handleOpen(row, path) {
    if (row.read) {
      if (path) navigate(path)
      return
    }
    try {
      const updated = await markNotificationRead(row.id)
      setRows((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      refreshUnreadCount()
      if (path) navigate(path)
    } catch (error) {
      setBanner(error.message)
    }
  }

  async function handleMarkAllRead() {
    try {
      await markAllNotificationsRead()
      setRows((current) => current.map((item) => ({ ...item, read: true })))
      refreshUnreadCount()
    } catch (error) {
      setBanner(error.message)
    }
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title" data-testid="notifications-title">
          Notifications
        </h1>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="btn btn-secondary"
            data-testid="notifications-mark-all-button"
          >
            Mark all as read
          </button>
        )}
      </div>

      <Banner page="notifications" error={banner} onDismiss={() => setBanner(null)} />

      {loading ? null : rows.length === 0 ? (
        <div className="card">
          <p className="empty-state" data-testid="notifications-empty">
            No notifications yet.
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} data-testid={`notifications-row-${row.id}`}>
                    <td data-testid={`notifications-created-at-${row.id}`}>
                      {formatDateTime(row.created_at)}
                    </td>
                    <td data-testid={`notifications-message-${row.id}`}>{row.message}</td>
                    <td data-testid={`notifications-status-${row.id}`}>
                      <span className={row.read ? 'badge badge-neutral' : 'badge badge-info'}>
                        {row.read ? 'Read' : 'Unread'}
                      </span>
                    </td>
                    <td>
                      {row.event_request_name ? (
                        <Link
                          to={`/requests/${row.event_request_id}`}
                          onClick={(event) => {
                            event.preventDefault()
                            handleOpen(row, `/requests/${row.event_request_id}`)
                          }}
                          data-testid={`notifications-event-${row.id}`}
                        >
                          {row.event_request_name}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpen(row, null)}
                          className="btn btn-secondary"
                          data-testid={`notifications-open-button-${row.id}`}
                        >
                          Open
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
