import { routes as authRoutes } from '../areas/auth/routes'
import { routes as requestRoutes } from '../areas/requests/routes'
import { routes as venueRoutes } from '../areas/venues/routes'
import { routes as bookingRoutes } from '../areas/bookings/routes'
import { routes as equipmentRoutes } from '../areas/equipment/routes'
import { routes as registrationRoutes } from '../areas/registration/routes'
import { routes as changeRoutes } from '../areas/changes/routes'
import { routes as notificationRoutes } from '../areas/notifications/routes'

export const routes = [
  ...authRoutes,
  ...requestRoutes,
  ...venueRoutes,
  ...bookingRoutes,
  ...equipmentRoutes,
  ...registrationRoutes,
  ...changeRoutes,
  ...notificationRoutes,
]
