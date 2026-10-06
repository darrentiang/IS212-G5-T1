"""Database models for the ConnectSphere API.

SCRUM-26: accounts and roles. SCRUM-27: event requests for role-based
read access. SCRUM-28: event request creation and submission. SCRUM-31:
venues with their facilities and accessibility features. SCRUM-40: venue
blocks. No permission logic here — see backend/permissions.py.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from db import db

# Bumped by any story that changes the shape of the database. app.py refuses to
# start when the stored version differs; seed.py --reset rebuilds the database.
# SCRUM-28 added event request columns; SCRUM-31 added venues and the two
# fixed lists they choose from. SCRUM-29 added the approve/reject decision.
# SCRUM-40 added venue blocks.
SCHEMA_VERSION = 6


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
        "venue_requirements",
        "accessibility_needs",
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
    venue_requirements = db.Column(db.Text)
    accessibility_needs = db.Column(db.Text)
    equipment_requirements = db.Column(db.Text)
    registration_needs = db.Column(db.Text)

    registration_enabled = db.Column(db.Boolean, nullable=False, default=False)
    coordinator_notes = db.Column(db.Text, nullable=True)
    submitted_at = db.Column(db.DateTime, nullable=True)

    decision = db.Column(db.String(32), nullable=True)
    decision_reason = db.Column(db.Text, nullable=True)
    decided_at = db.Column(db.DateTime, nullable=True)
    decided_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=True)

    created_by = db.relationship("Account", foreign_keys=[created_by_id], backref="event_requests")
    decided_by = db.relationship("Account", foreign_keys=[decided_by_id])

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


class Venue(db.Model):
    """A venue Venue Staff maintain (SCRUM-31).

    Name, location and maximum capacity are required; the operating hours and
    the two lists are optional. Editing is SCRUM-75, retiring SCRUM-76 and
    room layouts SCRUM-32, so nothing here supports them yet.
    """

    __tablename__ = "venues"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    location = db.Column(db.String(255), nullable=False)
    max_capacity = db.Column(db.Integer, nullable=False)
    opening_time = db.Column(db.Time, nullable=True)
    closing_time = db.Column(db.Time, nullable=True)

    facilities = db.relationship("Facility", secondary=venue_facilities, backref="venues")
    accessibility_features = db.relationship(
        "AccessibilityFeature",
        secondary=venue_accessibility_features,
        backref="venues",
    )

    def __repr__(self):
        return f"<Venue {self.id} {self.name}>"


class VenueBlock(db.Model):
    """A period Venue Staff have blocked a venue for an operational reason (SCRUM-40).

    starts_at and ends_at are naive local date-times, the same convention as an
    event request's date and times; created_at is UTC, like submitted_at. The
    API keeps calling them "start" and "end". Ending or removing a block is
    SCRUM-79, so nothing here changes one.
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


class SchemaMeta(db.Model):
    """One row, holding the schema version the database was seeded at."""

    __tablename__ = "schema_meta"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.Integer, nullable=False)

    def __repr__(self):
        return f"<SchemaMeta v{self.version}>"
