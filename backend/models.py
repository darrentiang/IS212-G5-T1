"""Database models for the ConnectSphere API.

SCRUM-26: accounts and roles. SCRUM-27: event requests for role-based
read access. SCRUM-28: event request creation and submission. SCRUM-31:
venues with their facilities, accessibility features and layouts. SCRUM-40: venue
blocks. SCRUM-36: venue booking requests, and a venue's is_active flag
(retiring one is SCRUM-76; this story only needed somewhere to check).
SCRUM-42: an event request's required layout, facilities and accessibility
features, chosen from the same fixed lists as a venue's. SCRUM-37: a venue
booking request's approve/reject decision. SCRUM-43: an event request's
assigned Event Coordinator and the date it was assigned. SCRUM-58: one
notification addressed to one account.
No permission logic here — see backend/permissions.py.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from db import db

# Bumped by any story that changes the shape of the database. app.py refuses to
# start when the stored version differs; seed.py --reset rebuilds the database.
# SCRUM-28 added event request columns; SCRUM-31 added venues and the two
# fixed lists they choose from. SCRUM-29 added the approve/reject decision.
# SCRUM-40 added venue blocks. SCRUM-36 added venue booking requests and
# Venue.is_active and SCRUM-32 added room layouts. SCRUM-42 added an event
# request's required layout, facilities and accessibility features, and dropped
# the free-text venue_requirements and accessibility_needs they replace.
# SCRUM-80 added setup_time and turnaround_time to Venue. SCRUM-42 and SCRUM-80
# each raised the version to 9 on their own branch; the merged schema differs
# from both, so it is 10. SCRUM-37 added a venue booking request's own
# approve/reject decision (decision, decision_reason, decided_at,
# decided_by), so 11. SCRUM-43 added an event request's assigned Event
# Coordinator and assignment date, so 12. SCRUM-78 added a rejected venue
# booking request's suggested venue and period, so 13. SCRUM-58 added the
# Notification table, so 14.
SCHEMA_VERSION = 14


account_roles = db.Table(
    "account_roles",
    db.Column("account_id", db.Integer, db.ForeignKey("accounts.id"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("roles.id"), primary_key=True),
)


class Role(db.Model):
    """One of the five role names in docs/design/permissions.md."""

    __tablename__ = "roles"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)

    def __repr__(self):
        return f"<Role {self.name}>"


class Account(db.Model):
    """A seeded user account. An account may hold several roles (Q-06, D-09)."""

    __tablename__ = "accounts"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(64), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    organisation = db.Column(db.String(128), nullable=True)

    roles = db.relationship("Role", secondary=account_roles, backref="accounts")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def has_role(self, name):
        return any(role.name == name for role in self.roles)

    @property
    def role_names(self):
        return sorted(role.name for role in self.roles)

    def __repr__(self):
        return f"<Account {self.username}>"


class EventRequest(db.Model):
    """An Event Organiser's request (docs/design/state-model.md, 'Event request').

    SCRUM-27 added read-only access with role rules (own only / all except
    Draft, internal notes gating). SCRUM-28 added creation and the
    Draft -> Submitted transition. SCRUM-29 added approve/reject.
    SCRUM-42 added the optional required layout, facilities and accessibility
    features, stored as links to the venue lists; never required to submit.
    They replace the brief's free-text "venue requirements" and "accessibility
    needs" (PO decision): the brief's venue requirements are what the Venue
    Catalogue records as layouts and facilities, its accessibility needs what
    it records as accessibility features.
    Later stories add columns and transitions in their own pull requests.
    """

    __tablename__ = "event_requests"

    STATUSES = ("Draft", "Submitted", "Approved", "Rejected", "Planning", "Confirmed", "Completed", "Cancelled")

    # The fields an Event Organiser must record; all required to submit
    # (state-model.md AC1). Column names match the API's snake_case field
    # names (docs/design/frontend.md §6 contract comments).
    REQUIRED_FIELDS = (
        "name",
        "purpose",
        "description",
        "date",
        "start_time",
        "end_time",
        "attendance",
        "equipment_requirements",
        "registration_needs",
    )

    id = db.Column(db.Integer, primary_key=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="Draft")

    name = db.Column(db.String(200))
    purpose = db.Column(db.String(500))
    description = db.Column(db.Text)
    date = db.Column(db.String(10))  # ISO yyyy-mm-dd
    start_time = db.Column(db.String(5))  # HH:MM
    end_time = db.Column(db.String(5))  # HH:MM
    attendance = db.Column(db.Integer)
    equipment_requirements = db.Column(db.Text)
    registration_needs = db.Column(db.Text)

    registration_enabled = db.Column(db.Boolean, nullable=False, default=False)
    coordinator_notes = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)

    decision = db.Column(db.String(32), nullable=True)
    decision_reason = db.Column(db.Text, nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)
    decided_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=True)

    # SCRUM-43: at most one assigned Event Coordinator, set when the request is
    # approved and moves to Planning (state-model.md). One column, so a second
    # coordinator cannot be recorded; reassignment is SCRUM-44.
    assigned_coordinator_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=True)
    assigned_at = db.Column(db.DateTime, nullable=True)

    # SCRUM-42: one required layout or none; any number of facilities and
    # accessibility features. Ordered as the fixed lists are.
    layout_id = db.Column(db.Integer, db.ForeignKey("room_layouts.id"), nullable=True)

    created_by = db.relationship("Account", foreign_keys=[created_by_id], backref="event_requests")
    decided_by = db.relationship("Account", foreign_keys=[decided_by_id])
    assigned_coordinator = db.relationship("Account", foreign_keys=[assigned_coordinator_id])
    layout = db.relationship("RoomLayout")
    facilities = db.relationship(
        "Facility", secondary="event_request_facilities", order_by="Facility.id"
    )
    accessibility_features = db.relationship(
        "AccessibilityFeature",
        secondary="event_request_accessibility_features",
        order_by="AccessibilityFeature.id",
    )

    def missing_fields(self):
        """Names of required fields that are unset or blank, in REQUIRED_FIELDS order."""
        missing = []
        for field in self.REQUIRED_FIELDS:
            value = getattr(self, field)
            if value is None or (isinstance(value, str) and value.strip() == ""):
                missing.append(field)
        return missing

    def to_dict(self):
        return {
            "id": self.id,
            "status": self.status,
            "created_by": self.created_by.username if self.created_by else None,
            "registration_enabled": bool(self.registration_enabled),
            "submitted_at": self.submitted_at.isoformat() if self.submitted_at else None,
            "decision": self.decision,
            "decision_reason": self.decision_reason,
            "decided_at": self.decided_at.isoformat() if self.decided_at else None,
            "decided_by": self.decided_by.username if self.decided_by else None,
            "assigned_coordinator": (
                self.assigned_coordinator.username if self.assigned_coordinator else None
            ),
            "assigned_at": self.assigned_at.isoformat() if self.assigned_at else None,
            "layout": self.layout.name if self.layout else None,
            "facilities": [row.name for row in self.facilities],
            "accessibility_features": [row.name for row in self.accessibility_features],
            **{field: getattr(self, field) for field in self.REQUIRED_FIELDS},
        }

    def __repr__(self):
        return f"<EventRequest {self.id} {self.status}>"


venue_facilities = db.Table(
    "venue_facilities",
    db.Column("venue_id", db.Integer, db.ForeignKey("venues.id"), primary_key=True),
    db.Column("facility_id", db.Integer, db.ForeignKey("facilities.id"), primary_key=True),
)


venue_accessibility_features = db.Table(
    "venue_accessibility_features",
    db.Column("venue_id", db.Integer, db.ForeignKey("venues.id"), primary_key=True),
    db.Column(
        "accessibility_feature_id",
        db.Integer,
        db.ForeignKey("accessibility_features.id"),
        primary_key=True,
    ),
)


venue_layouts = db.Table(
    "venue_layouts",
    db.Column("venue_id", db.Integer, db.ForeignKey("venues.id"), primary_key=True),
    db.Column("layout_id", db.Integer, db.ForeignKey("room_layouts.id"), primary_key=True),
)


event_request_facilities = db.Table(
    "event_request_facilities",
    db.Column("event_request_id", db.Integer, db.ForeignKey("event_requests.id"), primary_key=True),
    db.Column("facility_id", db.Integer, db.ForeignKey("facilities.id"), primary_key=True),
)


event_request_accessibility_features = db.Table(
    "event_request_accessibility_features",
    db.Column("event_request_id", db.Integer, db.ForeignKey("event_requests.id"), primary_key=True),
    db.Column(
        "accessibility_feature_id",
        db.Integer,
        db.ForeignKey("accessibility_features.id"),
        primary_key=True,
    ),
)


class Facility(db.Model):
    """One entry of the fixed facility list (team decision, 22-09-2026).

    A list, not free text, because SCRUM-34/35 filter on it and SCRUM-42
    checks a required facility.
    """

    __tablename__ = "facilities"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)

    def __repr__(self):
        return f"<Facility {self.name}>"


class AccessibilityFeature(db.Model):
    """One entry of the fixed accessibility feature list (team decision, 22-09-2026)."""

    __tablename__ = "accessibility_features"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)

    def __repr__(self):
        return f"<AccessibilityFeature {self.name}>"


class RoomLayout(db.Model):
    """One shared room layout option (SCRUM-32)."""

    __tablename__ = "room_layouts"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(64), unique=True, nullable=False)

    def __repr__(self):
        return f"<RoomLayout {self.name}>"


class Venue(db.Model):
    """A venue Venue Staff maintain (SCRUM-31).

    Name, location and maximum capacity are required; the operating hours and
    the two lists and supported room layouts are optional. Editing is SCRUM-75;
    retiring is SCRUM-76 and layout assignments are SCRUM-32. SCRUM-80 adds
    setup_time and turnaround_time in whole minutes, defaulting to 0.
    """

    __tablename__ = "venues"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    location = db.Column(db.String(255), nullable=False)
    max_capacity = db.Column(db.Integer, nullable=False)
    opening_time = db.Column(db.Time, nullable=True)
    closing_time = db.Column(db.Time, nullable=True)
    setup_time = db.Column(db.Integer, nullable=False, default=0)
    turnaround_time = db.Column(db.Integer, nullable=False, default=0)
    is_active = db.Column(db.Boolean, nullable=False, default=True)

    facilities = db.relationship("Facility", secondary=venue_facilities, backref="venues")
    accessibility_features = db.relationship(
        "AccessibilityFeature",
        secondary=venue_accessibility_features,
        backref="venues",
    )
    layouts = db.relationship("RoomLayout", secondary=venue_layouts, backref="venues")

    def __repr__(self):
        return f"<Venue {self.id} {self.name}>"


class VenueBlock(db.Model):
    """A period Venue Staff have blocked a venue for an operational reason (SCRUM-40).

    starts_at and ends_at are naive local date-times, the same convention as an
    event request's date and times; created_at is UTC, like submitted_at. The
    API keeps calling them "start" and "end". SCRUM-79 ends a block early by
    overwriting ends_at, and removes one by deleting the row; no history is
    kept (D-17).
    """

    __tablename__ = "venue_blocks"

    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=False)
    starts_at = db.Column(db.DateTime, nullable=False)
    ends_at = db.Column(db.DateTime, nullable=False)
    reason = db.Column(db.Text, nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False)

    venue = db.relationship("Venue", backref="blocks")
    created_by = db.relationship("Account")

    def __repr__(self):
        return f"<VenueBlock {self.id} venue {self.venue_id}>"


class VenueBookingRequest(db.Model):
    """An Event Coordinator's request to book a venue for an event (SCRUM-36),
    which Venue Staff approve or reject (SCRUM-37).

    date, start_time, end_time and attendance are copied from the event
    request at the moment of raising (AC3): a later change to the event does
    not move the booking request. The event's venue requirements (AC3) are its
    chosen layout and facilities (SCRUM-42); they are read through
    event_request, not copied, because today they can change only while the
    event is a Draft (SCRUM-30) and a booking needs an Approved or Planning
    event. A future story that lets an event be edited during Planning must
    decide whether a booking request keeps a snapshot of them. raised_at and
    decided_at are UTC, the same convention as an event request's
    submitted_at/decided_at. Withdrawing is a later story; nothing here
    supports it yet.
    """

    __tablename__ = "venue_booking_requests"

    STATUSES = ("Requested", "Approved", "Rejected", "Withdrawn")

    id = db.Column(db.Integer, primary_key=True)
    venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=False)
    event_request_id = db.Column(db.Integer, db.ForeignKey("event_requests.id"), nullable=False)
    status = db.Column(db.String(32), nullable=False, default="Requested")

    date = db.Column(db.String(10))  # ISO yyyy-mm-dd, copied from the event
    start_time = db.Column(db.String(5))  # HH:MM
    end_time = db.Column(db.String(5))  # HH:MM
    attendance = db.Column(db.Integer)

    raised_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=False)
    raised_at = db.Column(db.DateTime, nullable=False)

    decision = db.Column(db.String(32), nullable=True)
    decision_reason = db.Column(db.Text, nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)
    decided_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=True)

    # SCRUM-78: what Venue Staff suggest when they reject. Either part, or
    # both, or neither. A suggestion is only text for the Coordinator to read:
    # it is not a booking and holds nothing (occupancy.py never looks at it).
    suggested_venue_id = db.Column(db.Integer, db.ForeignKey("venues.id"), nullable=True)
    suggested_date = db.Column(db.String(10), nullable=True)  # ISO yyyy-mm-dd
    suggested_start_time = db.Column(db.String(5), nullable=True)  # HH:MM
    suggested_end_time = db.Column(db.String(5), nullable=True)  # HH:MM

    venue = db.relationship("Venue", foreign_keys=[venue_id], backref="booking_requests")
    suggested_venue = db.relationship("Venue", foreign_keys=[suggested_venue_id])
    event_request = db.relationship("EventRequest", backref="booking_requests")
    raised_by = db.relationship("Account", foreign_keys=[raised_by_id])
    decided_by = db.relationship("Account", foreign_keys=[decided_by_id])

    def __repr__(self):
        return f"<VenueBookingRequest {self.id} venue {self.venue_id} event {self.event_request_id} {self.status}>"


class Notification(db.Model):
    """One notification addressed to one account (SCRUM-58, docs/design/state-model.md).

    A row is added by notifications.create_notification(), which every story
    that tells someone something calls (SCRUM-44, 62, 63, 82, 85, 86, 89, 90);
    this story's own pages only read and show them. The standing rows in
    backend/seed/data.json exist so those pages have something to show.
    ``event_request_id`` is nullable:
    a notification need not be about an event request at all (a future
    story's venue or equipment notification, say), and SCRUM-58 itself never
    needs to know which.

    ``read_at`` null means unread; set means read, and when (AC4). There is
    no separate status column: read is a flag on the row, the same pattern
    as "clarification requested" on an event request (state-model.md).
    """

    __tablename__ = "notifications"

    id = db.Column(db.Integer, primary_key=True)
    recipient_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=False)
    event_request_id = db.Column(db.Integer, db.ForeignKey("event_requests.id"), nullable=True)
    message = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False)
    read_at = db.Column(db.DateTime, nullable=True)

    recipient = db.relationship("Account", foreign_keys=[recipient_id])
    event_request = db.relationship("EventRequest", foreign_keys=[event_request_id])

    def __repr__(self):
        return f"<Notification {self.id} to {self.recipient_id} read={self.read_at is not None}>"


class SchemaMeta(db.Model):
    """One row, holding the schema version the database was seeded at."""

    __tablename__ = "schema_meta"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.Integer, nullable=False)

    def __repr__(self):
        return f"<SchemaMeta v{self.version}>"
