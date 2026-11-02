"""Independent SCRUM-47 cases, one per test-case row; own name prefix, no demo edits.

python scrum47.py N [--snapshot|--clear]. Snapshots are read-only.
The rows name fixed dates (event 15-11-2026, application date 26-10-2026); the
spec pins the application clock to that day, so the dates hold whenever it runs.
A Held hold expires on 01-11-2026 with its warning already recorded, so the
request-wide SCRUM-85 expiry hook leaves it alone.
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (AccessibilityFeature, Account, ChangeRequest, EquipmentType, EventChange, EventRequest, Facility,
                    Notification, Reservation, RoomLayout, Venue, VenueBookingRequest, VenueHold)

ARRANGEMENTS = (VenueBookingRequest, VenueHold, Reservation, EventChange, ChangeRequest, Notification)
SET_UP_AT = datetime(2026, 10, 25, 9, 0)


def records(model, rows):
    return [{c.name: getattr(row, c.name) for c in model.__table__.columns} for row in rows]


def run(number):
    prefix = f'SCRUM-47 TC{number:02} '
    with create_app().app_context():
        events = (db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix))
                  .order_by(EventRequest.id).all())
        ids = [e.id for e in events]
        if '--snapshot' in sys.argv:
            result = {'events': records(EventRequest, events)}
            for row in result['events']:
                event = next(e for e in events if e.id == row['id'])
                row['layout'] = event.layout.name if event.layout else None
                row['facilities'] = [f.name for f in event.facilities]
                row['accessibility_features'] = [f.name for f in event.accessibility_features]
            for model in ARRANGEMENTS:
                rows = db.session.query(model).filter(model.event_request_id.in_(ids)).order_by(model.id).all()
                result[model.__tablename__] = records(model, rows)
            types = db.session.query(EquipmentType).filter(EquipmentType.name.startswith(prefix))
            result['equipment_types'] = records(EquipmentType, types.order_by(EquipmentType.id).all())
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

        def named(model, names):
            with db.session.no_autoflush:  # the event being built is not in the session yet
                return [db.session.query(model).filter_by(name=n).one() for n in names]

        def event(label, status='Planning', coordinator='coord1', **fields):
            values = dict(date='2026-11-15', start_time='10:00', end_time='12:00', attendance=40,
                          purpose='Original purpose', description='Original description',
                          equipment_requirements='2 projectors', registration_needs='Original registration needs')
            values.update(fields)
            layout = values.pop('layout', None)
            facilities = values.pop('facilities', ())
            features = values.pop('features', ())
            e = EventRequest(name=prefix + label, status=status, created_by=accounts['org1'],
                             assigned_coordinator=accounts[coordinator] if coordinator else None,
                             submitted_at=None if status == 'Draft' else SET_UP_AT, **values)
            e.layout = named(RoomLayout, [layout])[0] if layout else None
            e.facilities = named(Facility, facilities)
            e.accessibility_features = named(AccessibilityFeature, features)
            if status == 'Completed':
                e.completed_at, e.completed_by = SET_UP_AT, accounts['coord1']
            if status == 'Cancelled':
                e.cancelled_at, e.cancelled_by, e.cancel_reason = SET_UP_AT, accounts['coord1'], 'Original cancellation reason'
            if status == 'Rejected':
                e.decision, e.decision_reason = 'Rejected', 'Original rejection reason'
                e.decided_at, e.decided_by = SET_UP_AT, accounts['coord1']
            db.session.add(e)
            db.session.flush()
            return e

        def venue(label):
            v = Venue(name=prefix + label, location='SCRUM-47 fixture', max_capacity=100, is_active=True,
                      setup_time=0, turnaround_time=0)
            db.session.add(v)
            db.session.flush()
            return v

        def booking(e, label, status='Approved', raised_by='coord1'):
            b = VenueBookingRequest(event_request=e, venue=venue(label), status=status, date=e.date,
                                    start_time=e.start_time, end_time=e.end_time, attendance=e.attendance,
                                    raised_by=accounts[raised_by], raised_at=SET_UP_AT)
            if status == 'Approved':
                b.decision, b.decided_by, b.decided_at = 'Approved', accounts['venue1'], SET_UP_AT
            db.session.add(b)

        def hold(e, label, status='Held'):
            h = VenueHold(event_request=e, venue=venue(label), status=status, expires_at=datetime(2026, 11, 1, 12, 0),
                          placed_by=accounts['coord1'], placed_at=SET_UP_AT, warning_sent_at=SET_UP_AT)
            if status == 'Released':
                h.released_at = SET_UP_AT
            if status == 'Expired':
                h.expires_at = h.expired_at = datetime(2026, 10, 25, 12, 0)
            db.session.add(h)

        def reservation(e, equipment, quantity):
            db.session.add(Reservation(event_request_id=e.id, equipment_type_id=equipment.id, quantity=quantity,
                                       date=e.date, start_time=e.start_time, end_time=e.end_time, status='Reserved'))

        def projectors():
            t = EquipmentType(name=prefix + 'Projector', total_units=10, description='Fixture projector',
                              location='Fixture store')
            db.session.add(t)
            db.session.flush()
            return t

        if number in (1, 9):
            main = event('Event')
            booking(main, 'Venue A')
            reservation(main, projectors(), 2)
        elif number in (2, 8, 17):
            event('Event')
        elif number == 3:
            main = event('Event', layout='Theatre', facilities=['Projector'], features=['Step-free access'])
            reservation(main, projectors(), 2)
        elif number == 4:
            event('Submitted Event', 'Submitted', attendance=30)
            event('Approved Event', 'Approved', attendance=30)
        elif number in (5, 6, 7):
            t = projectors()
            for stage in ('Safety Check', 'Confirmed'):
                e = event(f'{stage} Event', stage)
                booking(e, f'{stage} Venue')
                reservation(e, t, 2)
        elif number in (10, 11):
            hold(event('Event'), 'Venue A')
        elif number == 12:
            hold(event('Released Hold Event'), 'Released Venue', 'Released')
            hold(event('Expired Hold Event'), 'Expired Venue', 'Expired')
            booking(event('Booking Event'), 'Venue A')
        elif number == 13:
            main = event('Event')
            other = event('Other Event', coordinator='coord2')
            booking(main, 'Venue A')
            booking(main, 'Venue B', 'Requested')
            hold(main, 'Venue C')
            booking(other, 'Other Venue')
            t = projectors()
            reservation(main, t, 2)
            reservation(other, t, 3)
        elif number == 14:
            booking(event('Event'), 'Venue A')
        elif number == 15:
            event('Submitted Event', 'Submitted')
            event('Planning Event')
        elif number == 16:
            event('Completed Event', 'Completed')
            cancelled = event('Cancelled Event', 'Cancelled')
            hold(cancelled, 'Cancelled Venue', 'Released')
            event('Rejected Event', 'Rejected')
            event('Draft Event', 'Draft', coordinator=None)
        db.session.commit()
        rows = (db.session.query(EventRequest).filter(EventRequest.name.startswith(prefix))
                .order_by(EventRequest.id).all())
        print(json.dumps({'events': [{'id': e.id, 'name': e.name, 'status': e.status} for e in rows]}))


if __name__ == '__main__':
    n = int(sys.argv[1])
    if not 1 <= n <= 17:
        raise SystemExit('Case number must be 1..17')
    run(n)
