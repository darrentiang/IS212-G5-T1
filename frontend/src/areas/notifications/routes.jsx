import NotificationsPage from './NotificationsPage'

export const routes = [
  { path: '/notifications', element: <NotificationsPage />, permission: 'notifications.view', nav: 'Notifications' },
]
