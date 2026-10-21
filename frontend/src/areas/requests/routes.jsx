import RequestsPage from './RequestsPage'
import RequestDetailPage from './RequestDetailPage'
import RequestNewPage from './RequestNewPage'
import UnassignedQueuePage from './UnassignedQueuePage'
import AssignmentsPage from './AssignmentsPage'

export const routes = [
  // SCRUM-86: first, so the Event Coordinator Lead lands on the queue.
  {
    path: '/assignments/queue',
    element: <UnassignedQueuePage />,
    permission: 'assignments.manage',
    nav: 'Unassigned queue',
  },
  // SCRUM-88: every active event and who holds it, read-only.
  {
    path: '/assignments',
    element: <AssignmentsPage />,
    permission: 'assignments.view',
    nav: 'All assignments',
  },
  { path: '/requests', element: <RequestsPage />, permission: 'requests.view', nav: 'Requests' },
  { path: '/requests/new', element: <RequestNewPage />, permission: 'requests.edit' },
  { path: '/requests/:id', element: <RequestDetailPage />, permission: 'requests.view' },
]
