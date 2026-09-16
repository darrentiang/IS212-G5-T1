"""Database models for the ConnectSphere API.

Only the accounts and roles needed by every story live here. Venues, events and
equipment are added by the stories that need them; each such story bumps
SCHEMA_VERSION so that a stale development database refuses to start.

No permission logic lives here: the role -> feature matrix is SCRUM-27 and
ADR-002. These models only record which roles an account holds.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from db import db

# Bumped by any story that changes the shape of the database. app.py refuses to
# start when the stored version differs; seed.py --reset rebuilds the database.
SCHEMA_VERSION = 1


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
    # The client organisation an Event Organiser belongs to; plain text, and
    # None for internal staff accounts.
    organisation = db.Column(db.String(128), nullable=True)

    roles = db.relationship("Role", secondary=account_roles, backref="accounts")

    def set_password(self, password):
        """Store the hash of password. The plain value is never persisted."""
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        """True when password matches the stored hash."""
        return check_password_hash(self.password_hash, password)

    def has_role(self, name):
        """True when this account holds the role called name."""
        return any(role.name == name for role in self.roles)

    @property
    def role_names(self):
        """The account's role names, sorted, for a stable API surface."""
        return sorted(role.name for role in self.roles)

    def __repr__(self):
        return f"<Account {self.username}>"


class SchemaMeta(db.Model):
    """One row, holding the schema version the database was seeded at."""

    __tablename__ = "schema_meta"

    id = db.Column(db.Integer, primary_key=True)
    version = db.Column(db.Integer, nullable=False)

    def __repr__(self):
        return f"<SchemaMeta v{self.version}>"
