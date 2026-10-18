"""SCRUM-81: API rules, metadata, preservation and authoritative guards."""
from datetime import datetime, timezone

import pytest
from sqlalchemy import update

from areas.equipment import review
from db import db
from factories import account, make_event, make_equipment_requirement, make_booking, make_venue
from models import EquipmentRequirement, EquipmentType, EventRequest, Reservation, Role
from errors import ApiRefusal


def login(client, username='tech1'):
    with client.session_transaction() as session:
        session['account_id'] = account(username).id


@pytest.fixture
def staged(client):
    event = make_event(name='Review equipment event', status='Planning', date='2026-12-15',
                       start_time='10:00', end_time='12:00', assigned_coordinator=account('coord1'))
    equipment = db.session.query(EquipmentType).filter_by(name='Projector').one()
    other_type = db.session.query(EquipmentType).filter_by(name='Microphones').one()
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2, technical_requirements='HDMI')
    other = make_equipment_requirement(event=event, equipment=other_type, quantity=4)
    login(client)
    return event, row, other


def path(event, row, action='decision'):
    return f'/api/requests/{event.id}/equipment/{row.id}/{action}'


def reserve(event, row, status='Reserved', quantity=1):
    reservation = Reservation(event_request=event, equipment_type_id=row.equipment_type_id,
        quantity=quantity, date=event.date, start_time=event.start_time, end_time=event.end_time, status=status)
    db.session.add(reservation); db.session.commit()
    return reservation


def snapshot(event):
    db.session.expire_all()
    return {
        'event': (event.status, event.date, event.start_time, event.end_time),
        'requirements': [r.to_dict() for r in db.session.query(EquipmentRequirement).order_by(EquipmentRequirement.id)],
        'stock': [(t.id, t.total_units) for t in db.session.query(EquipmentType).order_by(EquipmentType.id)],
        'reservations': [(r.id, r.status, r.quantity, r.date, r.start_time, r.end_time) for r in db.session.query(Reservation).order_by(Reservation.id)],
    }


# @story: SCRUM-81
# @ac: 1, 2, 3, 5, 6
@pytest.mark.parametrize('stage', ['Approved', 'Planning'])
def test_review_corrections_clear_reason_and_preserve_other_records(client, staged, stage):
    event, row, other = staged
    event.status = stage; db.session.commit()
    # A reservation for another event must not lock this requirement.
    another = make_event(name='Other review event', status='Planning', date=event.date,
                         start_time=event.start_time, end_time=event.end_time)
    reserve(another, row)
    baseline = snapshot(event)
    before = datetime.now(timezone.utc).replace(tzinfo=None)
    for decision, reason in [('Approved', 'ignored'), ('Declined', ' HDMI unavailable '), ('Approved', '')]:
        reply = client.patch(path(event, row), json={'decision': decision, 'reason': reason,
            'quantity': 99, 'status': 'Cancelled', 'decided_by_id': account('org1').id, 'arrangement_note': 'injected'})
        assert reply.status_code == 200
        data = reply.json
        assert data['status'] == decision and data['decline_reason'] == ('HDMI unavailable' if decision == 'Declined' else None)
        assert data['decided_by'] == 'tech1'
        assert before <= datetime.fromisoformat(data['decided_at']) <= datetime.now(timezone.utc).replace(tzinfo=None)
        assert data['quantity'] == 2 and data['technical_requirements'] == 'HDMI' and data['arrangement_note'] == ''
        assert data['has_unreleased_reservation'] is False
    # Repeat of a valid decision is harmless and still records a successful decision.
    assert client.patch(path(event, row), json={'decision': 'Approved'}).status_code == 200
    login(client, 'coord1')
    context = client.get(f'/api/requests/{event.id}/equipment').json
    assert context['requirements'][0]['status'] == 'Approved'
    assert context['requirements'][0]['decided_by'] == 'tech1'
    actual = snapshot(event)
    assert actual['event'] == baseline['event'] and actual['stock'] == baseline['stock']
    assert actual['reservations'] == baseline['reservations'] and other.status == 'Requested'
    assert row.quantity == 2


# @story: SCRUM-81
# @ac: 3, 7
@pytest.mark.parametrize('reason', [None, '', '   ', '\n\t', 1, False, [], {}])
@pytest.mark.parametrize('status', ['Requested', 'Approved'])
def test_blank_or_nontext_decline_refused_on_initial_and_corrected_decision(client, staged, reason, status):
    event, row, _ = staged
    row.status = status; db.session.commit()
    before = snapshot(event)
    response = client.patch(path(event, row), json={'decision': 'Declined', 'reason': reason})
    assert response.status_code == 400 and 'reason' in response.json['message']
    assert snapshot(event) == before


# @story: SCRUM-81
# @ac: 2, 7
@pytest.mark.parametrize('body', [None, [], 'text', 1, {}, {'decision': None}, {'decision': False},
                                {'decision': []}, {'decision': 'Requested'}, {'decision': 'approve'}])
def test_invalid_decisions_do_not_mutate(client, staged, body):
    event, row, _ = staged
    before = snapshot(event)
    response = client.patch(path(event, row), json=body)
    assert response.status_code == 400 and response.json['message']
    assert snapshot(event) == before


# @story: SCRUM-81
# @ac: 4, 5, 6
@pytest.mark.parametrize('status', EquipmentRequirement.STATUSES)
@pytest.mark.parametrize('stage', ['Approved', 'Planning'])
def test_notes_preserve_decision_metadata_even_when_reserved(client, staged, status, stage):
    event, row, _ = staged
    event.status = stage; row.status = status
    row.decline_reason = 'No wireless' if status == 'Declined' else None
    row.decided_by = account('tech1'); row.decided_at = datetime(2026, 10, 1)
    db.session.commit()
    reserve(event, row)
    before = snapshot(event)
    for note in [' Collection in Store A ', 'Updated note', '']:
        response = client.patch(path(event, row, 'note'), json={'arrangement_note': note, 'decision': 'Declined', 'quantity': 100})
        assert response.status_code == 200
        assert response.json['arrangement_note'] == note.strip()
        assert response.json['status'] == status and response.json['has_unreleased_reservation'] is True
    after = snapshot(event)
    assert after == before  # final blank note matches original; everything else stayed intact


# @story: SCRUM-81
# @ac: 4, 7
@pytest.mark.parametrize('body', [None, [], 'text', {}, {'arrangement_note': None}, {'arrangement_note': False}, {'arrangement_note': 2}])
def test_invalid_notes_refused_without_changes(client, staged, body):
    event, row, _ = staged
    before = snapshot(event)
    response = client.patch(path(event, row, 'note'), json=body)
    assert response.status_code == 400 and 'text' in response.json['message']
    assert snapshot(event) == before


# @story: SCRUM-81
# @ac: 2, 6, 7
@pytest.mark.parametrize('quantity', [1, 2])
def test_any_unreleased_reservation_locks_decisions_but_not_notes(client, staged, quantity):
    event, row, _ = staged
    row.status = 'Approved'; db.session.commit()
    reserve(event, row, quantity=quantity)
    before = snapshot(event)
    response = client.patch(path(event, row), json={'decision': 'Declined', 'reason': 'Unavailable'})
    assert response.status_code == 409 and 'reservation' in response.json['message']
    assert snapshot(event) == before


# @story: SCRUM-81
# @ac: 2, 3, 6
def test_released_history_and_other_type_reservations_do_not_block(client, staged):
    event, row, other = staged
    row.status = 'Declined'; row.decline_reason = 'Unavailable'; db.session.commit()
    old = reserve(event, row, status='Released')
    reserve(event, other)
    response = client.patch(path(event, row), json={'decision': 'Approved'})
    assert response.status_code == 200 and response.json['decline_reason'] is None
    assert old.status == 'Released' and db.session.query(Reservation).count() == 2


# @story: SCRUM-81
# @ac: 2, 4, 7
@pytest.mark.parametrize('status', [s for s in EventRequest.STATUSES if s not in ('Approved', 'Planning')])
@pytest.mark.parametrize('action', ['decision', 'note'])
def test_other_event_stages_are_read_only(client, staged, status, action):
    event, row, _ = staged
    event.status = status; db.session.commit()
    before = snapshot(event)
    response = client.patch(path(event, row, action), json={'decision': 'Approved', 'arrangement_note': 'changed'})
    assert response.status_code == (403 if status == 'Draft' else 409)
    assert response.json['message'] and snapshot(event) == before


# @story: SCRUM-81
# @ac: 2, 4, 7
@pytest.mark.parametrize('username', ['org1', 'coord1', 'coord2', 'venue1', 'safety1', 'att1', 'multi1', None])
def test_unauthorised_and_anonymous_cannot_decide_or_note(client, staged, username):
    event, row, _ = staged
    if username:
        login(client, username)
    else:
        with client.session_transaction() as session:
            session.clear()
    before = snapshot(event)
    for action in ['decision', 'note']:
        reply = client.patch(path(event, row, action), json={'decision': 'Approved', 'arrangement_note': 'changed'})
        assert reply.status_code == (403 if username else 401) and reply.json['message']
    assert snapshot(event) == before
    with pytest.raises(ApiRefusal) as error:
        review.decide(account('coord1'), event.id, row.id, {'decision': 'Approved'})
    assert error.value.status == 403


# @story: SCRUM-81
# @ac: 2, 7
@pytest.mark.parametrize('which', ['event', 'huge_event', 'row', 'huge_row', 'wrong_event'])
def test_missing_or_mismatched_identifiers_refused(client, staged, which):
    event, row, _ = staged
    event_id, row_id = event.id, row.id
    if which == 'event': event_id = 999999
    if which == 'huge_event': event_id = 2**100
    if which == 'row': row_id = 999999
    if which == 'huge_row': row_id = 2**100
    if which == 'wrong_event':
        other = make_event(name='Wrong event', status='Planning', date=event.date, start_time='10:00', end_time='12:00')
        event_id = other.id
    reply = client.patch(f'/api/requests/{event_id}/equipment/{row_id}/decision', json={'decision': 'Approved'})
    assert reply.status_code == 404


# @story: SCRUM-81
# @ac: 2, 4, 7
@pytest.mark.parametrize('action', ['decision', 'note'])
def test_conditional_write_rechecks_stage_at_write_time(client, staged, monkeypatch, action):
    event, row, _ = staged
    original = review._write
    before = row.to_dict()
    def changed(target, values, **kwargs):
        # Another committed event-stage transition between initial validation and write.
        db.session.execute(update(EventRequest).where(EventRequest.id == event.id).values(status='Safety Check'))
        db.session.commit()
        return original(target, values, **kwargs)
    monkeypatch.setattr(review, '_write', changed)
    response = client.patch(path(event, row, action), json={'decision': 'Approved', 'arrangement_note': 'changed'})
    assert response.status_code == 409 and 'Reload' in response.json['message']
    assert row.to_dict() == before and event.status == 'Safety Check'


# @story: SCRUM-81
# @ac: 2, 7
def test_conditional_decision_rechecks_new_reservation(client, staged, monkeypatch):
    event, row, _ = staged
    original = review._write
    def newly_reserved(target, values, **kwargs):
        reserve(event, row)
        return original(target, values, **kwargs)
    monkeypatch.setattr(review, '_write', newly_reserved)
    reply = client.patch(path(event, row), json={'decision': 'Approved'})
    assert reply.status_code == 409 and row.status == 'Requested' and row.decided_at is None
    assert db.session.query(Reservation).count() == 1


# @story: SCRUM-81
# @ac: 1, 5, 7
def test_scoped_context_and_multirole_technical_permission(client, staged):
    event, row, _ = staged
    venue_a = make_venue(name='Review venue A')
    venue_b = make_venue(name='Review venue B')
    venue_c = make_venue(name='Review venue C')
    make_booking(event=event, venue=venue_a, status='Approved')
    make_booking(event=event, venue=venue_b, status='Approved')
    make_booking(event=event, venue=venue_c, status='Cancelled')
    context = client.get(f'/api/requests/{event.id}/equipment').json
    assert [b['venue_name'] for b in context['approved_venue_bookings']] == ['Review venue A', 'Review venue B']
    assert context['date'] == '2026-12-15' and context['start_time'] == '10:00' and context['end_time'] == '12:00'
    assert 'description' not in context and 'coordinator_notes' not in context
    login(client, 'coord2')
    assert client.get(f'/api/requests/{event.id}/equipment').status_code == 403
    multi = account('multi1')
    multi.roles.append(db.session.query(Role).filter_by(name='Technical Support Staff').one()); db.session.commit()
    login(client, 'multi1')
    response = client.patch(path(event, row), json={'decision': 'Approved'})
    assert response.status_code == 200 and response.json['decided_by'] == 'multi1'
