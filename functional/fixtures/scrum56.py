"""SCRUM-56 test-owned preconditions: the registrations the Attendees open.

Every event is named "SCRUM-56 <row's event>", created by org1 and assigned to
coord1. Venue Gala (Confirmed, 10 Dec 2026, 19:00-21:00, Approved booking for
Auditorium); Moved Fair (Planning, staged at its new date 14 Dec 2026,
10:00-12:00, still holding the Approved booking for Seminar Room 1 it had while
Confirmed); Done Show (Completed, 20 Nov 2026, 18:00-20:00, Approved booking for
Seminar Room 1); Off Night (Cancelled, 8 Dec 2026, 19:00-21:00, no booking).
att1 holds a registration for each (Withdrawn for Done Show), att56a one for
Venue Gala only, and att56b none; att56a and att56b are the Attendee accounts
the rows name, which the seed does not have. The registrations and bookings are
inserted directly. --clear removes exactly what this file stages.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EventRequest, Registration, Role, Venue, VenueBookingRequest

PREFIX = 'SCRUM-56 '
ATTENDEES = ('att56a', 'att56b')


def clear():
    ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like(f'{PREFIX}%'))]
    db.session.query(Registration).filter(Registration.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(VenueBookingRequest).filter(
        VenueBookingRequest.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
    for row in db.session.query(Account).filter(Account.username.in_(ATTENDEES)):
        row.roles = []
        db.session.delete(row)
    db.session.commit()


def seed():
    app = create_app()
    with app.app_context():
        clear()
        if '--clear' in sys.argv:
            return
        attendee = db.session.query(Role).filter_by(name='Attendee').one()
        for username in ATTENDEES:
            row = Account(username=username)
            row.set_password('Passw0rd!')
            row.roles = [attendee]
            db.session.add(row)
        db.session.flush()
        accounts = {a.username: a for a in db.session.query(Account).all()}
        venues = {v.name: v for v in db.session.query(Venue).all()}
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        def event(label, status, date, start, end, venue=None, registrations=()):
            row = EventRequest(
                name=f'{PREFIX}{label}', status=status, date=date, start_time=start, end_time=end,
                attendance=40, purpose='Registration status test', description='Functional fixture',
                equipment_requirements='None', registration_needs='None', created_by=accounts['org1'],
                assigned_coordinator=accounts['coord1'], submitted_at=now, registration_enabled=True,
                registration_capacity=40, registration_closes_at=datetime.fromisoformat(f'{date}T{start}'))
            db.session.add(row)
            db.session.flush()
            if venue:
                db.session.add(VenueBookingRequest(
                    venue=venues[venue], event_request=row, status='Approved', date=date, start_time=start,
                    end_time=end, attendance=40, raised_by=accounts['coord1'], raised_at=now,
                    decision='Approved', decided_at=now, decided_by=accounts['venue1']))
            for username, status_ in registrations:
                db.session.add(Registration(
                    event_request=row, attendee=accounts[username], status=status_, registered_at=now,
                    withdrawn_at=now if status_ == 'Withdrawn' else None))

        event('Venue Gala', 'Confirmed', '2026-12-10', '19:00', '21:00', 'Auditorium',
              [('att1', 'Registered'), ('att56a', 'Registered')])
        event('Moved Fair', 'Planning', '2026-12-14', '10:00', '12:00', 'Seminar Room 1', [('att1', 'Registered')])
        event('Done Show', 'Completed', '2026-11-20', '18:00', '20:00', 'Seminar Room 1', [('att1', 'Withdrawn')])
        event('Off Night', 'Cancelled', '2026-12-08', '19:00', '21:00', None, [('att1', 'Registered')])
        db.session.commit()
        print('SCRUM-56 fixtures loaded')


if __name__ == '__main__':
    seed()
