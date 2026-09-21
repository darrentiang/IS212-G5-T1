import RequestsPage from './RequestsPage'
import RequestDetailPage from './RequestDetailPage'

export const routes = [
  { path: '/requests', element: <RequestsPage />, permission: 'requests.view', nav: 'Requests' },
  { path: '/requests/:id', element: <RequestDetailPage />, permission: 'requests.view' },
]
