import MyRegistrationsPage from './MyRegistrationsPage'
import RegistrationPage from './RegistrationPage'

export const routes = [
  {
    path: '/registration',
    element: <RegistrationPage />,
    permission: 'registration.view',
    nav: 'Registration',
  },
  {
    path: '/registrations',
    element: <MyRegistrationsPage />,
    permission: 'registration.withdraw',
    nav: 'My registrations',
  },
]
