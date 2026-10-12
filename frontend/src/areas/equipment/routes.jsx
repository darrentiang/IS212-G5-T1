import EquipmentPage from './EquipmentPage'

export const routes = [
  {
    path: '/equipment',
    element: <EquipmentPage />,
    permission: 'equipment.view',
    nav: 'Equipment',
  },
]
