# @tc: TC-INFRA-02
# @test: test_ping_returns_pong
# @story: INFRA
# @ac: 1
# @type: Happy
# @scenario: Ping endpoint returns pong message
# @preconditions: Flask app is created
# @steps: 1. Send GET /api/ping
# @test_data: none
# @expected: HTTP 200, body contains "message": "pong"
def test_ping_returns_pong(client):
    resp = client.get("/api/ping")
    assert resp.status_code == 200
    assert resp.get_json() == {"message": "pong"}
