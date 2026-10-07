"""API rules for SCRUM-32 supported venue layouts."""

from db import db
from models import Account, RoomLayout, Venue
from permissions import VENUES_EDIT, VENUES_VIEW, can


def login(client, username="venue1"):
    response = client.post(
        "/api/login",
        json={"username": username, "password": "Passw0rd!"},
    )
    assert response.status_code == 200


def create_venue(client, name="SCRUM-32 API Venue"):
    response = client.post(
        "/api/venues",
        json={"name": name, "location": "Block D Level 1", "max_capacity": 80},
    )
    assert response.status_code == 201
    return response.get_json()


def save_layouts(client, venue_id, layouts):
    return client.patch(f"/api/venues/{venue_id}/layouts", json={"layouts": layouts})


# @story: SCRUM-32
# @ac: 1, 4
def test_venue_staff_can_save_multiple_layouts_and_read_them_back(client):
    login(client)
    venue = create_venue(client)

    response = save_layouts(client, venue["id"], ["Classroom", "Theatre"])

    assert response.status_code == 200
    assert response.get_json()["layouts"] == ["Classroom", "Theatre"]
    reopened = client.get(f"/api/venues/{venue['id']}")
    assert reopened.get_json()["layouts"] == ["Classroom", "Theatre"]


# @story: SCRUM-32
# @ac: 1, 2, 4, 5
def test_saving_an_empty_set_clears_the_last_layout(client):
    login(client)
    venue = create_venue(client)
    assert save_layouts(client, venue["id"], ["Banquet"]).status_code == 200

    response = save_layouts(client, venue["id"], [])

    assert response.status_code == 200
    assert response.get_json()["layouts"] == []
    assert client.get(f"/api/venues/{venue['id']}").get_json()["layouts"] == []


# @story: SCRUM-32
# @ac: 2
def test_removing_one_layout_does_not_change_another_venue(app, client):
    login(client)
    first = create_venue(client, "SCRUM-32 First Venue")
    second = create_venue(client, "SCRUM-32 Second Venue")
    assert save_layouts(client, first["id"], ["Classroom", "Theatre"]).status_code == 200
    assert save_layouts(client, second["id"], ["Theatre"]).status_code == 200

    response = save_layouts(client, first["id"], ["Classroom"])

    assert response.status_code == 200
    assert client.get(f"/api/venues/{first['id']}").get_json()["layouts"] == ["Classroom"]
    assert client.get(f"/api/venues/{second['id']}").get_json()["layouts"] == ["Theatre"]
    assert [row.name for row in db.session.query(RoomLayout).order_by(RoomLayout.id)] == [
        "Classroom",
        "Theatre",
        "Boardroom",
        "Banquet",
        "Exhibition",
    ]


# @story: SCRUM-32
# @ac: 3
def test_unrecognised_layout_refuses_atomically(client):
    login(client)
    venue = create_venue(client)
    assert save_layouts(client, venue["id"], ["Classroom"]).status_code == 200

    response = save_layouts(client, venue["id"], ["Classroom", "Theatre", "Unsupported Test Layout"])

    assert response.status_code == 400
    assert response.get_json()["message"] == "Choose each layout from the list."
    assert client.get(f"/api/venues/{venue['id']}").get_json()["layouts"] == ["Classroom"]


# @story: SCRUM-32
# @ac: 3
def test_duplicate_layout_refuses_atomically(client):
    login(client)
    venue = create_venue(client)
    assert save_layouts(client, venue["id"], ["Classroom"]).status_code == 200

    response = save_layouts(client, venue["id"], ["Classroom", "Theatre", "Theatre"])

    assert response.status_code == 400
    assert response.get_json()["message"] == "A layout cannot be selected more than once."
    assert client.get(f"/api/venues/{venue['id']}").get_json()["layouts"] == ["Classroom"]


# @story: SCRUM-32
# @ac: 3
def test_layouts_must_be_sent_as_a_list(client):
    login(client)
    venue = create_venue(client)

    response = save_layouts(client, venue["id"], "Classroom")

    assert response.status_code == 400
    assert response.get_json()["message"] == "Choose layouts as a list."
    assert client.get(f"/api/venues/{venue['id']}").get_json()["layouts"] == []


# @story: SCRUM-32
# @ac: 3
def test_non_text_layout_value_is_refused_atomically(client):
    login(client)
    venue = create_venue(client)
    assert save_layouts(client, venue["id"], ["Classroom"]).status_code == 200

    response = save_layouts(client, venue["id"], ["Classroom", 1])

    assert response.status_code == 400
    assert response.get_json()["message"] == "Choose each layout from the list."
    assert client.get(f"/api/venues/{venue['id']}").get_json()["layouts"] == ["Classroom"]


# @story: SCRUM-32
# @ac: 6
def test_only_venue_staff_can_change_layouts(client):
    login(client, "coord1")
    venue = create_venue  # avoid creating through a refused role

    response = client.patch("/api/venues/1/layouts", json={"layouts": ["Classroom"]})

    assert response.status_code == 403
    assert response.get_json()["message"] == "You do not have permission to perform this action."


# @story: SCRUM-32
# @ac: 1
def test_room_layout_repr_names_the_shared_option(app):
    layout = db.session.query(RoomLayout).filter_by(name="Classroom").one()

    assert repr(layout) == "<RoomLayout Classroom>"


# @story: SCRUM-32
# @ac: 6
def test_multi_role_account_can_change_layouts_and_view_options(app, client):
    account = db.session.query(Account).filter_by(username="multi1").one()
    assert can(account, VENUES_EDIT) is True
    assert can(account, VENUES_VIEW) is True
    login(client, "multi1")
    venue = create_venue(client, "SCRUM-32 Multi Venue")

    response = save_layouts(client, venue["id"], ["Classroom"])

    assert response.status_code == 200
    assert client.get("/api/venue-options").get_json()["layouts"] == [
        "Classroom",
        "Theatre",
        "Boardroom",
        "Banquet",
        "Exhibition",
    ]


# @story: SCRUM-32
# @ac: 4, 5
def test_layout_options_are_shared_and_empty_venues_have_no_layouts(client):
    login(client, "coord1")

    options = client.get("/api/venue-options")
    empty = client.get("/api/venues/1")

    assert options.status_code == 200
    assert options.get_json()["layouts"] == [
        "Classroom",
        "Theatre",
        "Boardroom",
        "Banquet",
        "Exhibition",
    ]
    assert empty.get_json()["layouts"] == []


# @story: SCRUM-32
# @ac: 6
def test_unknown_venue_layout_save_is_not_created(client):
    login(client)

    response = save_layouts(client, 99999, ["Classroom"])

    assert response.status_code == 404
    assert response.get_json()["message"] == "Venue not found."
