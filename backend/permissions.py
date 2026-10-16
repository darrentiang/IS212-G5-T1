"""Role → feature matrix — SCRUM-27, SCRUM-31, SCRUM-29, SCRUM-36, SCRUM-33, SCRUM-37, SCRUM-49, SCRUM-89, SCRUM-53, SCRUM-50 (ADR-002).

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
REQUESTS_DECIDE = "requests.decide"  # SCRUM-29: approve or reject a Submitted request
VENUES_VIEW = "venues.view"
VENUES_EDIT = "venues.edit"  # SCRUM-31: maintain venue records (Venue Staff)
VENUES_SEARCH = "venues.search"  # SCRUM-33: search venues for an event (Event Coordinator)
BOOKINGS_EDIT = "bookings.edit"  # SCRUM-36: raise a venue booking request (Event Coordinator)
BOOKINGS_DECIDE = "bookings.decide"  # SCRUM-37: approve or reject one (Venue Staff)
SAFETY_SEND = "safety.send"  # SCRUM-53: send a Planning event for safety check (Event Coordinator)
SAFETY_DECIDE = "safety.decide"  # SCRUM-89: approve or reject an event in Safety Check (Safety Officer)
EQUIPMENT_VIEW = "equipment.view"
EQUIPMENT_CHECK = "equipment.check"  # SCRUM-50: check availability for a period (Technical Support Staff)
EQUIPMENT_REQUIREMENTS_VIEW = "equipment.requirements.view"
EQUIPMENT_REQUIREMENTS_EDIT = "equipment.requirements.edit"
EQUIPMENT_EDIT = "equipment.edit"  # SCRUM-49: change an equipment type's total units
REGISTRATION_VIEW = "registration.view"
INTERNAL_NOTES_VIEW = "internal_notes.view"
NOTIFICATIONS_VIEW = "notifications.view"

ALL_FEATURES = frozenset(
    {
        REQUESTS_VIEW,
        REQUESTS_EDIT,
        REQUESTS_DECIDE,
        VENUES_VIEW,
        VENUES_EDIT,
        VENUES_SEARCH,
        BOOKINGS_EDIT,
        BOOKINGS_DECIDE,
        SAFETY_SEND,
        SAFETY_DECIDE,
        EQUIPMENT_VIEW,
        EQUIPMENT_CHECK,
        EQUIPMENT_REQUIREMENTS_VIEW,
        EQUIPMENT_REQUIREMENTS_EDIT,
        EQUIPMENT_EDIT,
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
        REQUESTS_DECIDE,
        VENUES_VIEW,
        VENUES_SEARCH,
        BOOKINGS_EDIT,
        SAFETY_SEND,  # SCRUM-53: only the assigned coordinator, enforced in the service
        EQUIPMENT_REQUIREMENTS_VIEW,
        EQUIPMENT_REQUIREMENTS_EDIT,
        EQUIPMENT_VIEW,  # SCRUM-49 AC1: view the inventory and its totals
        REGISTRATION_VIEW,
        INTERNAL_NOTES_VIEW,
        NOTIFICATIONS_VIEW,
    },
    "Venue Staff": {
        VENUES_VIEW,
        VENUES_EDIT,
        BOOKINGS_DECIDE,
        # Cannot view or edit event requests (permissions.md).
        NOTIFICATIONS_VIEW,
    },
    "Technical Support Staff": {
        EQUIPMENT_REQUIREMENTS_VIEW,
        EQUIPMENT_VIEW,
        EQUIPMENT_CHECK,  # SCRUM-50 AC9: check availability for a period
        EQUIPMENT_EDIT,  # SCRUM-49 AC2/AC7: change a type's total units
        NOTIFICATIONS_VIEW,
    },
    "Safety Officer": {
        REQUESTS_VIEW,  # events in Safety Check only (service filter)
        SAFETY_DECIDE,
        NOTIFICATIONS_VIEW,
        # Cannot edit an event or its arrangements (SCRUM-89 AC10).
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
    """Flask decorator for routes (ADR-002, frontend.md §6).

    Not logged in → 401 (client sends the user to /login).
    Logged in without the feature → 403 (page shows the refusal banner).
    """

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            account = getattr(g, "account", None)
            if account is None:
                raise ApiRefusal(401, "Not logged in")
            if not can(account, feature):
                raise ApiRefusal(403, "You do not have permission to perform this action.")
            return view(*args, **kwargs)

        return wrapper

    return decorator
