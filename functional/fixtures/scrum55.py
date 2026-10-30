"""SCRUM-55 test-owned preconditions: the events and registrations the Attendee opens.

Every event is named "SCRUM-55 TCnn ..." and every registration belongs to att1
(or to att2, the second Attendee account TC-SCRUM-55-07 and 09 need, which the
seed does not have). --clear removes exactly what this file stages. Nothing in
the app can register an Attendee yet (SCRUM-54), so the registrations are
inserted directly, as SCRUM-50 does for reservations.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from app import create_app
from db import db
from models import Account, EventRequest, Registration, Role

PREFIX = 'SCRUM-55 TC'
DAY = '2027-12-20'  # every event starts at 10:00 on this day


def clear():
    ids = [row.id for row in db.session.query(EventRequest).filter(EventRequest.name.like(f'{PREFIX}%'))]
    db.session.query(Registration).filter(Registration.event_request_id.in_(ids)).delete(synchronize_session=False)
    db.session.query(EventRequest).filter(EventRequest.id.in_(ids)).delete(synchronize_session=False)
    db.session.query(Account).filter(Account.username == 'att2').delete(synchronize_session=False)
    db.session.commit()


def seed():
    app = create_app()
    with app.app_context():
        clear()
        if '--clear' in sys.argv:
            return
        accounts = {a.username: a for a in db.session.query(Account).all()}
        second = Account(username='att2')
        second.set_password('Passw0rd!')
        second.roles = [db.session.query(Role).filter_by(name='Attendee').one()]
        db.session.add(second)
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        def registered(label, status='Confirmed'):
            event = EventRequest(
                name=f'{PREFIX}{label}', status=status, date=DAY, start_time='10:00', end_time='12:00', attendance=40,
                purpose='Registration test', description='Functional fixture', equipment_requirements='None',
                registration_needs='None', registration_enabled=True, created_by=accounts['org1'],
                assigned_coordinator=accounts['coord1'])
            db.session.add(event)
            db.session.flush()
            db.session.add(Registration(event_request=event, attendee=accounts['att1'], status='Registered',
                                        registered_at=now))

        registered('01 Withdraw Gala')
        registered('02 Withdraw Gala')
        registered('03 Start Gala')
        registered('04 Started Gala')
        registered('05 Twice Gala')
        registered('06 Cancelled Gala', status='Cancelled')
        registered('09 Open Gala')
        registered('10 Open Gala')
        db.session.commit()
        print('SCRUM-55 fixtures loaded')


if __name__ == '__main__':
    seed()
