import pytest


@pytest.mark.django_db
def test_health_returns_ok(api):
    response = api.get("/api/health/")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
