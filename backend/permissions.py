"""Role → feature matrix — SCRUM-27 (ADR-002).

Direct transcription of docs/design/permissions.md. An account may hold
several roles (Q-06, D-09); it may do anything any of its roles allows.
Object rules ("own only", "all except Draft") are enforced in services.
"""

from functools import wraps

from flask import g

from errors import ApiRefusal

# Feature keys used on routes and in /api/login, /api/me "features".
REQUESTS_VIEW = "requests.view"
REQUESTS_EDIT = "requests.edit"
VENUES_VIEW = "venues.view"
EQUIPMENT_VIEW = "equipment.view"
REGISTRATION_VIEW = "registration.view"
INTERNAL_NOTES_VIEW = "internal_notes.view"
NOTIFICATIONS_VIEW = "notifications.view"

ALL_FEATURES = frozenset(
    {
        REQUESTS_VIEW,
        REQUESTS_EDIT,
        VENUES_VIEW,
        EQUIPMENT_VIEW,
        REGISTRATION_VIEW,
        INTERNAL_NOTES_VIEW,
        NOTIFICATIONS_VIEW,
    }
)

# permissions.md columns → features. Own-only / assigned-only stay in services.
ROLE_FEATURES = {
    "Event Organiser": {
        REQUESTS_VIEW,  # own requests only (service filter)
        REQUESTS_EDIT,  # own Draft / submit (service rule)
        NOTIFICATIONS_VIEW,
    },
    "Event Coordinator": {
        REQUESTS_VIEW,  # all except Draft (service filter)
        REQUESTS_EDIT,
        VENUES_VIEW,
        REGISTRATION_VIEW,
        INTERNAL_NOTES_VIEW,
        NOTIFICATIONS_VIEW,
    },
    "Venue Staff": {
        VENUES_VIEW,
        # Cannot view or edit event requests (permissions.md).
        NOTIFICATIONS_VIEW,
    },
    "Technical Support Staff": {
        EQUIPMENT_VIEW,
        NOTIFICATIONS_VIEW,
    },
    "Attendee": {
        REGISTRATION_VIEW,  # confirmed events with registration only
        NOTIFICATIONS_VIEW,
        # Never internal planning information.
    },
}


def can(account, feature):
    """True when any of the account's roles allows feature."""
    if account is None:
        return False
    if feature not in ALL_FEATURES:
        return False
    for role in account.roles:
        if feature in ROLE_FEATURES.get(role.name, set()):
            return True
    return False


def features_for(account):
    """Every feature key the account may use, sorted — body of login/me."""
    return sorted(feature for feature in ALL_FEATURES if can(account, feature))


def require(feature):
    """Flask decorator: refuse 403 when the session account lacks feature."""

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            account = getattr(g, "account", None)
            if not can(account, feature):
                raise ApiRefusal(403, "You do not have permission to perform this action.")
            return view(*args, **kwargs)

        return wrapper

    return decorator
