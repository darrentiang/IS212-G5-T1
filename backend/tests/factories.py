"""Small builders for the data a backend test depends on.

New tests build the records they depend on here and pass the values that
matter explicitly, so a reader sees them in the test (AGENTS.md §4,
docs/test-cases/AUTOMATION.md). From the seed a test relies only on reference
data (roles, facilities, accessibility features, layouts, equipment types) and
the seeded accounts it logs in as.

Every helper runs inside the pytest ``app`` fixture's app context.
"""

from db import db
from models import AccessibilityFeature, Account, EventRequest, Facility, RoomLayout


def account(username):
    return db.session.query(Account).filter_by(username=username).one()


def make_event(
    *,
    name,
    status,
    date,
    start_time,
    end_time,
    owner="org1",
    attendance=50,
    layout=None,
    facilities=(),
    features=(),
    **fields,
):
    """Store one event request and return the row.

    layout, facilities and features are names from the seeded fixed lists.
    Any other EventRequest column (purpose, submitted_at, ...) goes in fields.
    """
    event = EventRequest(
        name=name,
        status=status,
        date=date,
        start_time=start_time,
        end_time=end_time,
        attendance=attendance,
        created_by=account(owner),
        layout=_named(RoomLayout, layout) if layout else None,
        facilities=[_named(Facility, item) for item in facilities],
        accessibility_features=[_named(AccessibilityFeature, item) for item in features],
        **fields,
    )
    db.session.add(event)
    db.session.commit()
    return event


def _named(model, name):
    return db.session.query(model).filter_by(name=name).one()
