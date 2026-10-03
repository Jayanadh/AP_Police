import pytest

from masters.models import District
from testing.factories import DriverFactory, MTOFactory, PTOFactory

pytestmark = pytest.mark.django_db


def test_any_logged_in_user_can_list_active_items(api):
    District.objects.filter(name="Krishna").update(is_active=False)
    api.force_login(DriverFactory())
    names = [item["name"] for item in api.get("/api/masters/districts/?active=1").json()]
    assert "Krishna" not in names
    assert "Guntur" in names


def test_pto_can_add_and_deactivate(api):
    api.force_login(PTOFactory())
    created = api.post("/api/masters/cadres/", {"name": "Traffic"})
    assert created.status_code == 201
    response = api.patch(f"/api/masters/cadres/{created.json()['id']}/", {"is_active": False})
    assert response.json()["is_active"] is False


def test_mto_cannot_edit_master_lists(api):
    api.force_login(MTOFactory())
    assert api.post("/api/masters/cadres/", {"name": "Traffic"}).status_code == 403


def test_anonymous_cannot_read_master_lists(api):
    assert api.get("/api/masters/districts/").status_code == 403
