import BookingNewPage from './BookingNewPage'

export const routes = [
  { path: '/requests/:requestId/bookings/new', element: <BookingNewPage />, permission: 'bookings.edit' },
]
