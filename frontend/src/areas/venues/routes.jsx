import VenuesPage from './VenuesPage'
import VenueNewPage from './VenueNewPage'
import VenueDetailPage from './VenueDetailPage'
import VenueAvailabilityPage from './VenueAvailabilityPage'
import VenueSearchPage from './VenueSearchPage'

export const routes = [
  { path: '/venues', element: <VenuesPage />, permission: 'venues.view', nav: 'Venues' },
  { path: '/venues/new', element: <VenueNewPage />, permission: 'venues.edit' },
  { path: '/venues/:id', element: <VenueDetailPage />, permission: 'venues.view' },
  { path: '/venues/:id/availability', element: <VenueAvailabilityPage />, permission: 'venues.view' },
  { path: '/requests/:id/venues/search', element: <VenueSearchPage />, permission: 'venues.search' },
]
