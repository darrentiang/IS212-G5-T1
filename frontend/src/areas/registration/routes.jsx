import RegistrationPage from './RegistrationPage'

export const routes = [
  {
    path: '/registration',
    element: <RegistrationPage />,
    permission: 'registration.view',
    nav: 'Registration',
  },
]
