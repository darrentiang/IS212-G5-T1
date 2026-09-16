"""The single SQLAlchemy instance shared by the application and the tests.

Kept in its own module so that models, the app factory and the seed script can
all import it without importing each other (ADR-001).
"""

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
