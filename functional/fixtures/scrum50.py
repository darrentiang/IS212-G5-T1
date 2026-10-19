"""SCRUM-50 test-owned preconditions for the rows that open the check from a
recorded requirement (TC-SCRUM-50-08 to 10), following SCRUM-48 and SCRUM-81's
fixture convention.

Only this story's TC08, TC09 and TC10 namespaces are staged or cleared (the
other SCRUM-50 rows are loaded by `seed.py --extra fixtures/scrum50.json`), on
the functional runner DB. Reservations are inserted directly: SCRUM-51, which
reserves equipment, is not built, and there is no product shortcut for it.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EquipmentRequirement, EquipmentType, EventRequest, Reservation

# row: (date, total units, requested, units another event reserves, units the event itself reserved)
ROWS = {
    8: ('2027-02-20', 10, 2, 0, 0),
    9: ('2027-02-21', 10, 8, 5, 0),
    10: ('2027-02-22', 5, 4, 0, 4),
}
START, END = '10:00', '12:00'


def event(accounts, name, date):
    return EventRequest(
        name=name, status='Planning', date=date, start_time=START, end_time=END, attendance=40,
        purpose='Availability check test', description='Functional fixture',
        equipment_requirements='Projector', registration_needs='None',
        created_by=accounts['org1'], assigned_coordinator=accounts['coord1'],
    )


def clear():
    ids = [row.id for row in db.session.query(EventRequest).filter(
        db.or_(*[EventRequest.name.like(f'SCRUM-50 TC{n:02} %') for n in ROWS]))]
    for model in (Reservation, EquipmentRequirement):
        db.session.query(model).filter(model.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
    for n in ROWS:
        db.session.query(EquipmentType).filter(
            EquipmentType.name == f'SCRUM-50 TC{n:02} Requirement Projector'
        ).delete(synchronize_session=False)
    db.session.commit()


def seed():
    app = create_app()
    with app.app_context():
        clear()
        if '--clear' in sys.argv:
            return
        accounts = {a.username: a for a in db.session.query(Account).all()}
        for n, (date, total, requested, others, own) in ROWS.items():
            prefix = f'SCRUM-50 TC{n:02}'
            mine = event(accounts, f'{prefix} Requirement event', date)
            kind = EquipmentType(name=f'{prefix} Requirement Projector', total_units=total,
                                 description='Availability fixture', location='Test store')
            db.session.add_all([mine, kind])
            db.session.add(EquipmentRequirement(event_request=mine, equipment_type=kind, quantity=requested,
                                                technical_requirements='', status='Requested'))
            if others:
                holder = event(accounts, f'{prefix} Other event', date)
                db.session.add(holder)
                db.session.add(Reservation(event_request=holder, equipment_type=kind, quantity=others,
                                           date=date, start_time=START, end_time=END, status='Reserved'))
            if own:
                db.session.add(Reservation(event_request=mine, equipment_type=kind, quantity=own,
                                           date=date, start_time=START, end_time=END, status='Reserved'))
        db.session.commit()
        print('SCRUM-50 requirement fixtures loaded')


if __name__ == '__main__':
    seed()
