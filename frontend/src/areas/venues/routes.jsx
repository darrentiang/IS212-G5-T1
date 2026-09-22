import VenuesPage from './VenuesPage'
import VenueNewPage from './VenueNewPage'
import VenueDetailPage from './VenueDetailPage'

export const routes = [
  { path: '/venues', element: <VenuesPage />, permission: 'venues.view', nav: 'Venues' },
  { path: '/venues/new', element: <VenueNewPage />, permission: 'venues.edit' },
  { path: '/venues/:id', element: <VenueDetailPage />, permission: 'venues.view' },
]
