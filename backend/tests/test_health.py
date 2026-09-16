# @tc: TC-INFRA-01
# @test: test_health_returns_200
# @story: INFRA
# @ac: 1
# @type: Happy
# @scenario: Health endpoint returns 200 with status ok
# @preconditions: Flask app is created
# @steps: 1. Send GET /api/health
# @test_data: none
# @expected: HTTP 200, body contains "status": "ok"
def test_health_returns_200(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"
