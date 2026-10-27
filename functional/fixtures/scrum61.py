"""Independent SCRUM-61 cases, one per test-case row; own name prefix, no demo edits.

python scrum61.py N [--snapshot|--clear]. Snapshots are read-only.
The rows name fixed dates (events on 15-11-2026, application date 26-10-2026);
the spec pins the application clock, so the dates hold whenever it runs. A Held
hold's warning is already recorded, so the request-wide SCRUM-85 expiry hook
sends nothing before its expiry.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (Account, EquipmentType, EventChange, EventRequest, Notification, Reservation, Venue,
                    VenueBookingRequest, VenueHold)

ARRANGEMENTS = (VenueBookingRequest, VenueHold, Reservation, EventChange, Notification)
SET_UP_AT = datetime(2026, 10, 25, 9, 0)


def records(model, rows):
    return [{c.name: getattr(row, c.name) for c in model.__table__.columns} for row in rows]


def run(number):
    prefix = f'SCRUM-61 TC{number:02} '
    with create_app().app_context():
        events = (db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix))
                  .order_by(EventRequest.id).all())
        ids = [e.id for e in events]
        if '--snapshot' in sys.argv:
            result = {'events': records(EventRequest, events)}
            for model in ARRANGEMENTS:
                rows = db.session.query(model).filter(model.event_request_id.in_(ids)).order_by(model.id).all()
                result[model.__tablename__] = records(model, rows)
            for model in (Venue, EquipmentType):
                rows = db.session.query(model).filter(model.name.startswith(prefix)).order_by(model.id).all()
                result[model.__tablename__] = records(model, rows)
            print(json.dumps(result, default=str, sort_keys=True))
            return
        for model in ARRANGEMENTS:
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        for e in events:
            db.session.delete(e)
        db.session.flush()
        for model in (EquipmentType, Venue):
            for row in db.session.query(model).filter(model.name.startswith(prefix)).all():
                db.session.delete(row)
        db.session.commit()
        if '--clear' in sys.argv:
            return

        accounts = {a.username: a for a in db.session.query(Account).all()}
        main = EventRequest(name=prefix + 'Event', status='Planning', date='2026-11-15', start_time='10:00',
                            end_time='12:00', attendance=40, purpose='Flag case', description='SCRUM-61 fixture',
                            equipment_requirements='2 projectors', registration_needs='None',
                            created_by=accounts['org1'], assigned_coordinator=accounts['coord1'],
                            submitted_at=SET_UP_AT, safety_check_at=None)
        db.session.add(main)
        db.session.flush()

        def venue(label, capacity):
            v = Venue(name=prefix + label, location='SCRUM-61 fixture', max_capacity=capacity, is_active=True,
                      setup_time=0, turnaround_time=0)
            db.session.add(v)
            db.session.flush()
            return v

        def booking(label, capacity, status='Approved', **period):
            b = VenueBookingRequest(event_request=main, venue=venue(label, capacity), status=status,
                                    date=period.get('date', main.date), start_time=main.start_time,
                                    end_time=main.end_time, attendance=main.attendance,
                                    raised_by=accounts['coord1'], raised_at=SET_UP_AT)
            if status in ('Approved', 'Cancelled', 'Rejected'):
                b.decision = 'Rejected' if status == 'Rejected' else 'Approved'
                b.decided_by, b.decided_at = accounts['venue1'], SET_UP_AT
            if status == 'Cancelled':
                b.cancel_reason, b.cancelled_at, b.cancelled_by = 'Earlier cancellation', SET_UP_AT, accounts['coord1']
            db.session.add(b)

        def hold(label, capacity, status='Held', expires=datetime(2026, 11, 1, 12, 0)):
            h = VenueHold(event_request=main, venue=venue(label, capacity), status=status, expires_at=expires,
                          placed_by=accounts['coord1'], placed_at=SET_UP_AT, warning_sent_at=SET_UP_AT)
            if status == 'Released':
                h.released_at = SET_UP_AT
            if status == 'Expired':
                h.expires_at = h.expired_at = datetime(2026, 10, 25, 12, 0)
            db.session.add(h)

        def reservation(status='Reserved', date='2026-11-15'):
            t = EquipmentType(name=prefix + 'Projectors', total_units=10, description='Fixture projector',
                              location='Fixture store')
            db.session.add(t)
            db.session.flush()
            db.session.add(Reservation(event_request_id=main.id, equipment_type_id=t.id, quantity=2, date=date,
                                       start_time='10:00', end_time='12:00', status=status))

        if number in (1, 2, 3, 9, 13):
            booking('Venue A', 50)
            main.attendance = {3: 50, 9: 60}.get(number, 40)
        elif number == 4:
            booking('Venue A', 50)
            booking('Venue B', 100)
        elif number == 5:
            main.attendance = 25
            booking('Venue C', 30, 'Requested')
            hold('Venue D', 30)
        elif number == 6:
            booking('Venue A', 100)
        elif number == 7:
            main.attendance = 60
            booking('Venue A', 50, 'Requested')
            booking('Venue B', 50)
        elif number == 8:
            main.attendance, main.status, main.safety_check_at = 60, 'Safety Check', SET_UP_AT
            booking('Venue A', 50)
        elif number == 10:
            main.attendance = 60
            booking('Venue A', 50)
            booking('Venue B', 50, 'Requested')
            hold('Venue C', 50)
        elif number == 11:
            main.attendance = 60
            booking('Venue A', 50, 'Requested')
            hold('Venue B', 50, expires=datetime(2026, 11, 14, 9, 0))
        elif number == 12:
            booking('Venue A', 100)
            booking('Venue B', 100, 'Requested')
            reservation()
        elif number == 14:
            for label, status in (('Venue A', 'Rejected'), ('Venue B', 'Withdrawn'), ('Venue C', 'Cancelled')):
                booking(label, 100, status)
            hold('Venue D', 100, 'Released')
            hold('Venue E', 100, 'Expired')
            reservation('Released')
        elif number == 15:
            main.date = '2026-11-22'
            booking('Venue A', 100, date='2026-11-15')
            reservation(date='2026-11-15')
        db.session.commit()
        print(json.dumps({'events': [{'id': e.id, 'name': e.name, 'status': e.status} for e in
                                     db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix))]}))


if __name__ == '__main__':
    n = int(sys.argv[1])
    if not 1 <= n <= 15:
        raise SystemExit('Case number must be 1..15')
    run(n)
