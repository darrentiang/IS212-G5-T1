"""SCRUM-48 rules and scoped API reads."""
import pytest
from sqlalchemy.exc import IntegrityError
from db import db
from factories import account, make_event, make_booking, make_venue, make_equipment_requirement
from models import EquipmentRequirement, EquipmentType, EventRequest, Reservation
from areas.equipment import requirements


def login(client, username="coord1"):
    with client.session_transaction() as session:
        session['account_id'] = account(username).id


@pytest.fixture
def setup(client, app):
    event = make_event(name="Detailed equipment event", status="Planning", date="2026-12-15",
                       start_time="10:00", end_time="12:00", assigned_coordinator=account("coord1"),
                       equipment_requirements="Organiser's original abstract needs")
    equipment = db.session.query(EquipmentType).filter_by(name="Projector").one()
    other = db.session.query(EquipmentType).filter_by(name="Microphones").one()
    login(client)
    return event, equipment, other


def path(event, row=None):
    return f"/api/requests/{event.id}/equipment" + (f"/{row.id}" if row else "")


def add(client, event, equipment, quantity="2", **extra):
    return client.post(path(event), json={"equipment_type_id": equipment.id, "quantity": quantity, **extra})


# @story: SCRUM-48
# @ac: 2, 3, 4, 6
def test_add_read_correct_clear_and_remove_persist_without_side_effects(client, setup):
    event, equipment, other = setup
    reserved = Reservation(event_request=event, equipment_type=equipment, quantity=1,
                           date=event.date, start_time=event.start_time, end_time=event.end_time)
    db.session.add(reserved); db.session.commit()
    original_total = equipment.total_units
    first = add(client, event, equipment, technical_requirements=" HDMI ")
    assert first.status_code == 201
    row = db.session.get(EquipmentRequirement, first.json['id'])
    assert row.status == 'Requested' and row.technical_requirements == 'HDMI'
    assert add(client, event, other, quantity=1).status_code == 201
    changed = client.patch(path(event, row), json={'quantity': '3.0', 'technical_requirements': ''})
    assert changed.status_code == 200 and changed.json['quantity'] == 3 and changed.json['technical_requirements'] == ''
    # Omitted optional text is retained; a supplied same type is harmless.
    assert client.patch(path(event, row), json={'quantity': '1e2', 'equipment_type_id': equipment.id}).json['quantity'] == 100
    assert client.delete(path(event, row)).status_code == 204
    body = client.get(path(event)).json
    assert len(body['requirements']) == 1 and body['requirements'][0]['equipment_type_id'] == other.id
    assert body['approved_venue_bookings'] == []
    assert add(client, event, equipment, quantity=1).status_code == 201
    db.session.expire_all()
    assert equipment.total_units == original_total and reserved.quantity == 1
    assert db.session.query(Reservation).count() == 1
    assert event.status == 'Planning' and event.equipment_requirements == "Organiser's original abstract needs"


# @story: SCRUM-48
# @ac: 2, 5
@pytest.mark.parametrize('quantity', [0, -1, 1.5, '1.00000000000000001', '', ' ', None, True, False, [], {}, 'NaN', 'Infinity', 'abc', 1e300, str(2**53)])
def test_invalid_quantities_refuse_add_and_update_atomically(client, setup, quantity):
    event, equipment, other = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2, technical_requirements='HDMI')
    assert add(client, event, other, quantity=quantity).status_code == 400
    response = client.patch(path(event, row), json={'quantity': quantity, 'technical_requirements': 'changed'})
    assert response.status_code == 400 and 'Quantity' in response.json['message']
    db.session.expire_all()
    assert row.quantity == 2 and row.technical_requirements == 'HDMI'
    assert db.session.query(EquipmentRequirement).count() == 1


# @story: SCRUM-48
# @ac: 2, 4
@pytest.mark.parametrize('quantity', [1, '1', '8.0', '1e5', str(2**53-1)])
def test_whole_quantities_accepted_despite_zero_stock(client, setup, quantity):
    event, equipment, _ = setup
    equipment.total_units = 0; db.session.commit()
    assert add(client, event, equipment, quantity=quantity).status_code == 201
    assert equipment.total_units == 0 and db.session.query(Reservation).count() == 0


# @story: SCRUM-48
# @ac: 2, 5
@pytest.mark.parametrize('body', [[], None, 1, 'text', {}, {'quantity': True}, {'quantity': 1, 'technical_requirements': None}])
def test_malformed_body_and_missing_fields(client, setup, body):
    event, _, _ = setup
    reply = client.post(path(event), json=body)
    assert reply.status_code == 400 and reply.json['message']
    assert db.session.query(EquipmentRequirement).count() == 0


# @story: SCRUM-48
# @ac: 2, 5
@pytest.mark.parametrize('type_id', [None, True, '1', [], -1, 0, 2**100, 999999])
def test_unrecognised_type(client, setup, type_id):
    event, _, _ = setup
    assert client.post(path(event), json={'quantity': 1, 'equipment_type_id': type_id}).status_code == 400


# @story: SCRUM-48
# @ac: 2, 5
@pytest.mark.parametrize('status', EquipmentRequirement.STATUSES)
def test_duplicate_type_is_refused_in_every_review_state(client, setup, status):
    event, equipment, _ = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2, status=status)
    assert add(client, event, equipment).status_code == 400
    assert row.quantity == 2 and db.session.query(EquipmentRequirement).count() == 1


# @story: SCRUM-48
# @ac: 2, 5
def test_concurrent_duplicate_rolls_back_cleanly(client, setup, monkeypatch):
    event, equipment, _ = setup
    def collision():
        raise IntegrityError('insert', {}, Exception('unique pair'))
    monkeypatch.setattr(db.session, 'commit', collision)
    reply = add(client, event, equipment)
    assert reply.status_code == 400 and 'already recorded' in reply.json['message']
    assert db.session.query(EquipmentRequirement).count() == 0


# @story: SCRUM-48
# @ac: 3, 5
@pytest.mark.parametrize('status', ['Approved', 'Declined'])
def test_reviewed_records_cannot_be_corrected_or_removed(client, setup, status):
    event, equipment, _ = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2, status=status)
    assert client.patch(path(event, row), json={'quantity': 3}).status_code == 409
    assert client.delete(path(event, row)).status_code == 409
    assert row.quantity == 2 and row.status == status


# @story: SCRUM-48
# @ac: 2, 3, 5
def test_equipment_type_immutable_and_text_validated_before_write(client, setup):
    event, equipment, other = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2)
    assert client.patch(path(event, row), json={'quantity': 3, 'equipment_type_id': other.id}).status_code == 400
    assert client.patch(path(event, row), json={'quantity': 3, 'technical_requirements': 17}).status_code == 400
    assert row.quantity == 2 and row.equipment_type_id == equipment.id


# @story: SCRUM-48
# @ac: 1, 5
@pytest.mark.parametrize('status', EventRequest.STATUSES)
def test_event_status_gate_for_all_mutations(client, setup, status):
    event, equipment, other = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2)
    event.status = status; db.session.commit()
    expected = 200 if status in requirements.EDITABLE_STATUSES else (404 if status == 'Draft' else 409)
    assert client.patch(path(event, row), json={'quantity': 3}).status_code == expected
    if expected != 200:
        assert add(client, event, other).status_code == expected
        assert client.delete(path(event, row)).status_code == expected
        assert row.quantity == 2


# @story: SCRUM-48
# @ac: 1, 5
@pytest.mark.parametrize('username', ['coord2', 'org1', 'tech1', 'venue1', 'att1', 'safety1'])
def test_all_unauthorised_roles_and_wrong_owner_cannot_mutate(client, setup, username):
    event, equipment, other = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2)
    login(client, username)
    expected = 404 if username == 'coord2' else 403
    for reply in (add(client, event, other), client.patch(path(event, row), json={'quantity': 3}), client.delete(path(event, row))):
        assert reply.status_code == expected and reply.json['message']
    assert row.quantity == 2 and db.session.query(EquipmentRequirement).count() == 1


# @story: SCRUM-48
# @ac: 1, 6
def test_technical_view_is_scoped_and_coordinators_only_see_assigned_non_drafts(client, setup):
    event, equipment, _ = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2)
    draft = make_event(name='Private draft', status='Draft', date=event.date, start_time='10:00', end_time='12:00', assigned_coordinator=account('coord1'))
    other_event = make_event(name='Other Coordinator event', status='Planning', date=event.date, start_time='10:00', end_time='12:00', assigned_coordinator=account('coord2'))
    assert [item['id'] for item in client.get('/api/equipment/requests').json if item['name'] in (event.name, draft.name, other_event.name)] == [event.id]
    assert client.get(path(other_event)).status_code == 403
    login(client, 'tech1')
    body = client.get(path(event)).json
    assert body['requirements'][0]['id'] == row.id
    assert 'equipment_requirements' not in body and 'created_by' not in body and 'purpose' not in body
    assert client.get(path(draft)).status_code == 403
    assert client.get(f'/api/requests/{event.id}').status_code == 403
    ids = [item['id'] for item in client.get('/api/equipment/requests').json]
    assert event.id in ids and other_event.id in ids and draft.id not in ids


# @story: SCRUM-48
# @ac: 6
def test_approved_venues_only_and_event_timing_unchanged(client, setup):
    event, _, _ = setup
    for name, status in [('A', 'Approved'), ('B', 'Approved'), ('C', 'Cancelled')]:
        make_booking(event=event, venue=make_venue(name=name), status=status)
    body = client.get(path(event)).json
    assert [row['venue_name'] for row in body['approved_venue_bookings']] == ['A', 'B']
    assert (body['date'], body['start_time'], body['end_time']) == ('2026-12-15', '10:00', '12:00')


# @story: SCRUM-48
# @ac: 1, 5
def test_unknown_events_items_cross_event_and_anonymous_refused(client, setup):
    event, equipment, _ = setup
    row = make_equipment_requirement(event=event, equipment=equipment, quantity=2)
    other = make_event(name='Second assigned', status='Planning', date=event.date, start_time='10:00', end_time='12:00', assigned_coordinator=account('coord1'))
    assert client.get('/api/requests/999999/equipment').status_code == 404
    assert client.get(f'/api/requests/{2**100}/equipment').status_code == 404
    assert client.post('/api/requests/999999/equipment', json={}).status_code == 404
    for endpoint in (path(other, row), f'{path(event)}/999999', f'{path(event)}/{2**100}'):
        assert client.patch(endpoint, json={'quantity': 3}).status_code == 404
        assert client.delete(endpoint).status_code == 404
    with client.session_transaction() as session: session.clear()
    assert client.get(path(event)).status_code == 401
    assert add(client, event, equipment).status_code == 401


# @story: SCRUM-48
# @ac: 1
def test_multirole_union_keeps_assigned_object_gate(client, setup):
    event, equipment, _ = setup
    login(client, 'multi1')
    assert client.get(path(event)).status_code == 403
    event.assigned_coordinator = account('multi1'); db.session.commit()
    assert add(client, event, equipment).status_code == 201
