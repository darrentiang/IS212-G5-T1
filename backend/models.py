"""Database models for the ConnectSphere API.

SCRUM-26: accounts and roles. SCRUM-27: event requests for role-based
read access. No permission logic here — see backend/permissions.py.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from db import db

# Bumped when the shape of the database changes (SCRUM-27 added event_requests).
SCHEMA_VERSION = 2


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


class SchemaMeta(db.Model):
    """One row, holding the schema version the database was seeded at."""

    __tablename__ = "schema_meta"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.Integer, nullable=False)

    def __repr__(self):
        return f"<SchemaMeta v{self.version}>"
