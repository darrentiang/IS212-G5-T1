import { request } from '../../app/http'

// GET /api/notifications   (SCRUM-58)
// 200: [ { id, event_request_id, event_request_name, message, created_at, read } ]
//      event_request_id, event_request_name: null unless this account may open
//      that event's own page (AC6) — never revealed otherwise
// 403: { message }
export const listNotifications = () => request('GET', '/api/notifications')

// GET /api/notifications/unread-count   (SCRUM-58)
// 200: { unread_count }
// 403: { message }
export const getUnreadCount = () => request('GET', '/api/notifications/unread-count')

// POST /api/notifications/:id/read   (SCRUM-58)
// 200: the notification, now read (a no-op if it already was)
// 403/404: { message }   404 for anyone but its own recipient
export const markNotificationRead = (id) => request('POST', `/api/notifications/${id}/read`)

// POST /api/notifications/mark-all-read   (SCRUM-58)
// 200: { unread_count }   always 0
// 403: { message }
export const markAllNotificationsRead = () => request('POST', '/api/notifications/mark-all-read')
