"""SCRUM-63 per-case owned preconditions; never cleans another story's data.

Usage: python scrum63.py N [--clear]
Builds the row's own event, venues, equipment types, booking, requirement and
reservation, all named "SCRUM-63 TCnn ...", and prints their ids as JSON.
Every run first clears what an earlier run of the same case left, including
the notifications about its events. The rows' date is 15 Dec 2026, 10:00-12:00.

SCRUM-44 (reassignment) is not built yet, so TC08's "reassigned from coord1
to coord2" is staged as its effect: the event is assigned to coord2.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (Account, EquipmentRequirement, EquipmentType, EventRequest, Notification,
                    Reservation, Venue, VenueBookingRequest)

DAY = '2026-12-15'


def run(n):
    prefix = f'SCRUM-63 TC{n:02}'
    app = create_app()
    with app.app_context():
        events = db.session.query(EventRequest).filter(EventRequest.name.like(f'{prefix} %')).all()
        ids = [e.id for e in events]
        for model in (Notification, Reservation, EquipmentRequirement, VenueBookingRequest):
            db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
        for row in events:
            db.session.delete(row)
        for model in (Venue, EquipmentType):
            for row in db.session.query(model).filter(model.name.like(f'{prefix} %')).all():
                db.session.delete(row)
        db.session.commit()
        if '--clear' in sys.argv:
            return

        accounts = {a.username: a for a in db.session.query(Account).all()}
        coordinator = {8: 'coord2', 9: None}.get(n, 'coord1')
        name = f'{prefix} Annual Gala' if n == 14 else f'{prefix} Event'
        event = EventRequest(name=name, status='Approved' if n in (6, 7) else 'Planning', date=DAY,
            start_time='10:00', end_time='12:00', attendance=40, purpose='Decision notices',
            description='Owned functional fixture', created_by=accounts['org1'],
            assigned_coordinator=accounts[coordinator] if coordinator else None)
        db.session.add(event)
        out = {'event': {'name': name}}

        def venue(label):
            row = Venue(name=f'{prefix} {label}', location=f'{prefix} Block', max_capacity=200)
            db.session.add(row)
            return row

        if n in (1, 2, 3, 8, 12, 13, 14):
            venue_a = venue('Venue A')
            venue_b = venue('Venue B') if n == 2 else None
            booking = VenueBookingRequest(venue=venue_a, event_request=event, status='Requested', date=DAY,
                start_time='10:00', end_time='12:00', attendance=40, raised_by=accounts['coord1'],
                raised_at=datetime.now(timezone.utc))
            db.session.add(booking)
            db.session.flush()
            out['venue_a'] = {'id': venue_a.id, 'name': venue_a.name}
            out['booking'] = {'id': booking.id}
            if venue_b:
                out['venue_b'] = {'id': venue_b.id, 'name': venue_b.name}

        if n in (4, 5, 6, 7, 9, 10, 11):
            label = 'Microphones' if n == 5 else 'Projector'
            equipment = EquipmentType(name=f'{prefix} {label}', total_units=10, description='Decision fixture',
                                      location='Test store')
            requirement = EquipmentRequirement(event_request=event, equipment_type=equipment,
                quantity=4 if n == 5 else 2, status='Approved' if n in (6, 7) else 'Requested',
                technical_requirements='HDMI connection required' if label == 'Projector' else '')
            db.session.add_all([equipment, requirement])
            db.session.flush()
            out['equipment'] = {'id': equipment.id, 'name': equipment.name}
            out['requirement'] = {'id': requirement.id}
            if n == 7:
                reservation = Reservation(event_request_id=event.id, equipment_type_id=equipment.id, quantity=2,
                    date=DAY, start_time='10:00', end_time='12:00', status='Reserved')
                db.session.add(reservation)
                db.session.flush()
                out['reservation'] = {'id': reservation.id}

        db.session.flush()
        out['event']['id'] = event.id
        db.session.commit()
        print(json.dumps(out))


if __name__ == '__main__':
    number = int(sys.argv[1])
    if not 1 <= number <= 14:
        raise SystemExit('Case number must be 1..14')
    run(number)
