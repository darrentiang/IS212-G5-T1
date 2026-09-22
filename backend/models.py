"""Database models for the ConnectSphere API.

SCRUM-26: accounts and roles. SCRUM-27: event requests for role-based
read access. SCRUM-31: venues with their facilities and accessibility
features. No permission logic here — see backend/permissions.py.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from db import db

# Bumped when the shape of the database changes (SCRUM-31 added venues and
# the two fixed lists they choose from).
SCHEMA_VERSION = 3


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
    """Minimal event request for access-control reads (SCRUM-27).

    Create/edit/submit are SCRUM-28/29/30; this story only reads.
    """

    __tablename__ = "event_requests"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    purpose = db.Column(db.String(255), nullable=True)
    status = db.Column(db.String(32), nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey("accounts.id"), nullable=False)
    registration_enabled = db.Column(db.Boolean, nullable=False, default=False)
    coordinator_notes = db.Column(db.Text, nullable=True)

    created_by = db.relationship("Account", backref="event_requests")

    def __repr__(self):
        return f"<EventRequest {self.id} {self.name} {self.status}>"


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


class SchemaMeta(db.Model):
    """One row, holding the schema version the database was seeded at."""

    __tablename__ = "schema_meta"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.Integer, nullable=False)

    def __repr__(self):
        return f"<SchemaMeta v{self.version}>"
