import RequestsPage from './RequestsPage'
import RequestDetailPage from './RequestDetailPage'
import RequestNewPage from './RequestNewPage'

export const routes = [
  { path: '/requests', element: <RequestsPage />, permission: 'requests.view', nav: 'Requests' },
  { path: '/requests/new', element: <RequestNewPage />, permission: 'requests.edit' },
  { path: '/requests/:id', element: <RequestDetailPage />, permission: 'requests.view' },
]
