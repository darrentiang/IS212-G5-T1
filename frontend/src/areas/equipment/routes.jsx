import EquipmentRequestsPage from './EquipmentRequestsPage'
import EquipmentRequirementsPage from './EquipmentRequirementsPage'
import EquipmentPage from './EquipmentPage'

export const routes = [
  {
    path: '/equipment',
    element: <EquipmentPage />,
    permission: 'equipment.view',
    nav: 'Equipment',
  },
  { path: '/equipment-requirements', element: <EquipmentRequestsPage />, permission: 'equipment.requirements.view', nav: 'Equipment requests' },
  { path: '/requests/:id/equipment', element: <EquipmentRequirementsPage />, permission: 'equipment.requirements.view' },
]
