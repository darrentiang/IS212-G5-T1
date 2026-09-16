# @story: INFRA
# @ac: 1
def test_ping_returns_pong(client):
    resp = client.get("/api/ping")
    assert resp.status_code == 200
    assert resp.get_json() == {"message": "pong"}
