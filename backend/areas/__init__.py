"""The eight backend areas, in the order create_app registers them.

The areas are the same eight as the front end; which area a story belongs to is
decided by the table in docs/design/frontend.md §2, which is the rule for both
halves. Adding an area is one folder and one entry in BLUEPRINTS.

Models are not split this way: they stay in backend/models.py, because
SQLAlchemy relationships cross areas and one file avoids circular imports.
Areas separate route and service code.
"""

from areas.auth.routes import bp as auth_bp
from areas.requests.routes import bp as requests_bp
from areas.venues.routes import bp as venues_bp
from areas.bookings.routes import bp as bookings_bp
from areas.equipment.routes import bp as equipment_bp
from areas.registration.routes import bp as registration_bp
from areas.changes.routes import bp as changes_bp
from areas.notifications.routes import bp as notifications_bp

BLUEPRINTS = [
    auth_bp,
    requests_bp,
    venues_bp,
    bookings_bp,
    equipment_bp,
    registration_bp,
    changes_bp,
    notifications_bp,
]
