"""SCRUM-52 test-owned preconditions: Stage Speakers and the events reserving it.

Usage: python scrum52.py N [--clear]

Every row uses Stage Speakers, an equipment type of this spec's own (8 units,
Equipment Store B), never the seeded Speakers, which SCRUM-51's spec reserves in
the same database. Staging row N first clears everything this file owns, then
stages that row's preconditions: Stage Speakers with the row's units out of
service, and the row's events (description "SCRUM-52 functional fixture"),
their Approved requirements and Reserved reservations, inserted directly as
scrum55.py inserts its records. Events reach Confirmed by being staged so.
It prints the ids the spec needs as JSON. --clear removes the type, its events,
requirements, reservations, withdrawal history and the notifications about them.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import (Account, EquipmentRequirement, EquipmentServiceChange, EquipmentType, EventRequest,
                    Notification, Reservation)

TYPE = 'Stage Speakers'
MARK = 'SCRUM-52 functional fixture'

# name: (status, coordinator, date, start, end, reserved units, or None for an
# Approved requirement with nothing reserved)
EVENTS = {
    'Stage Show': ('Confirmed', 'coord1', '2026-12-05', '10:00', '12:00', 5),
    'Late Panel': ('Planning', 'coord2', '2026-12-05', '11:00', '13:00', 2),
    'Morning Talk': ('Planning', 'coord1', '2026-12-06', '09:00', '11:00', 7),
    'Small Meetup': ('Planning', 'coord2', '2026-12-07', '14:00', '15:00', 2),
    'Extra Talk': ('Planning', 'coord2', '2026-12-05', '10:00', '12:00', None),
}
TWO = ['Stage Show', 'Late Panel']
FOUR = TWO + ['Morning Talk', 'Small Meetup']
# row: (units out of service, events)
ROWS = {1: (0, TWO), 2: (0, []), 3: (0, []), 4: (0, []), 5: (0, FOUR), 6: (0, FOUR),
        7: (1, TWO + ['Extra Talk']), 8: (2, []), 9: (1, TWO), 10: (1, [])}


def clear():
    events = [row.id for row in db.session.query(EventRequest).filter_by(description=MARK)]
    types = [row.id for row in db.session.query(EquipmentType).filter_by(name=TYPE)]
    db.session.query(Notification).filter(
        Notification.event_request_id.in_(events)
        | Notification.message.like(f'Equipment withdrawn from service: {TYPE}.%')
    ).delete(synchronize_session=False)
    for model in (Reservation, EquipmentRequirement):
        db.session.query(model).filter(model.event_request_id.in_(events)).delete(synchronize_session=False)
    db.session.query(EquipmentServiceChange).filter(
        EquipmentServiceChange.equipment_type_id.in_(types)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(events)).delete(synchronize_session=False)
    db.session.query(EquipmentType).filter(EquipmentType.id.in_(types)).delete(synchronize_session=False)
    db.session.commit()


def stage(n):
    out, names = ROWS[n]
    accounts = {a.username: a for a in db.session.query(Account).all()}
    speakers = EquipmentType(name=TYPE, description='Stage speaker cabinet', location='Equipment Store B',
                             total_units=8, out_of_service_units=out)
    db.session.add(speakers)
    if out:
        db.session.add(EquipmentServiceChange(equipment_type=speakers, action='Withdrawn', quantity=out,
                                              reason='Cone damaged', changed_by=accounts['tech1'],
                                              changed_at=datetime.now(timezone.utc)))
    events, reservations, requirements = {}, {}, {}
    for name in names:
        status, coordinator, day, start, end, units = EVENTS[name]
        event = EventRequest(name=name, status=status, date=day, start_time=start, end_time=end, attendance=40,
                             purpose='Withdrawal test', description=MARK, created_by=accounts['org1'],
                             assigned_coordinator=accounts[coordinator])
        requirement = EquipmentRequirement(event_request=event, equipment_type=speakers, quantity=units or 1,
                                           status='Approved')
        db.session.add_all([event, requirement])
        if units:
            reservation = Reservation(event_request=event, equipment_type=speakers, quantity=units, date=day,
                                      start_time=start, end_time=end, status='Reserved')
            db.session.add(reservation)
        db.session.flush()
        events[name] = event.id
        requirements[name] = requirement.id
        if units:
            reservations[name] = reservation.id
    db.session.commit()
    return {'type': speakers.id, 'events': events, 'requirements': requirements, 'reservations': reservations}


if __name__ == '__main__':
    number = int(sys.argv[1])
    if number not in ROWS:
        raise SystemExit('Row number must be 1..10')
    with create_app().app_context():
        clear()
        if '--clear' not in sys.argv:
            print(json.dumps(stage(number)))
