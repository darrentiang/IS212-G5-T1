# @story: INFRA
# @ac: 1
def test_health_returns_200(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"
