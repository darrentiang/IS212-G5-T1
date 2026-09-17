# @story: SCRUM-26
# @ac: 2
def test_login_with_correct_credentials_returns_the_account(client):
    resp = client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["username"] == "org1"
    assert body["roles"] == ["Event Organiser"]
    assert "password" not in body
    assert "password_hash" not in body
    assert "user_id" not in body


# @story: SCRUM-26
# @ac: 1, 2, 7
def test_login_returns_every_role_the_account_holds(client):
    resp = client.post("/api/login", json={"username": "multi1", "password": "Passw0rd!"})

    assert resp.status_code == 200
    assert set(resp.get_json()["roles"]) == {"Event Coordinator", "Venue Staff"}


# @story: SCRUM-26
# @ac: 3
def test_login_with_wrong_password_is_refused(client):
    resp = client.post("/api/login", json={"username": "org1", "password": "Wr0ngPass!"})

    assert resp.status_code == 401
    body = resp.get_json()
    assert body["message"] == "Invalid username or password"
    assert "username" not in body
    assert "roles" not in body


# @story: SCRUM-26
# @ac: 3, 4
def test_unknown_username_is_refused_with_the_same_message_as_a_wrong_password(client):
    unknown = client.post("/api/login", json={"username": "nosuchuser", "password": "Passw0rd!"})
    wrong = client.post("/api/login", json={"username": "org1", "password": "Wr0ngPass!"})

    assert unknown.status_code == 401
    assert wrong.status_code == 401
    assert unknown.get_json()["message"] == wrong.get_json()["message"]
    assert unknown.get_json()["message"] == "Invalid username or password"


# @story: SCRUM-26
# @ac: 2
def test_me_returns_the_logged_in_account(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})

    resp = client.get("/api/me")

    assert resp.status_code == 200
    assert resp.get_json()["username"] == "org1"
    assert resp.get_json()["roles"] == ["Event Organiser"]


# @story: SCRUM-26
# @ac: 5
def test_me_is_refused_without_a_session(client):
    resp = client.get("/api/me")

    assert resp.status_code == 401
    assert "message" in resp.get_json()


# @story: SCRUM-26
# @ac: 6
def test_logout_ends_the_session(client):
    client.post("/api/login", json={"username": "org1", "password": "Passw0rd!"})

    out = client.post("/api/logout")
    after = client.get("/api/me")

    assert out.status_code == 204
    assert after.status_code == 401
