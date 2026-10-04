import pytest

from masters.models import Cadre, District
from testing.factories import DriverFactory, MTOFactory, PTOFactory, PumpFactory, UnitFactory, master

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


# --- deleting -------------------------------------------------------------------------------------------------------


def test_pto_deletes_a_value_nobody_uses(api):
    api.force_login(PTOFactory())
    created = api.post("/api/masters/cadres/", {"name": "Traffic"}).json()

    response = api.delete(f"/api/masters/cadres/{created['id']}/")

    assert response.status_code == 204
    assert "Traffic" not in [item["name"] for item in api.get("/api/masters/cadres/").json()]


def test_a_value_in_use_is_not_deleted_and_the_pto_is_told_what_uses_it(api):
    unit = UnitFactory(district=master(District, "Prakasam"))
    DriverFactory(unit=unit, district=unit.district)
    DriverFactory(unit=unit, district=unit.district)
    PumpFactory(unit=unit, district=unit.district)
    api.force_login(PTOFactory())

    response = api.delete(f"/api/masters/districts/{unit.district_id}/")

    assert response.status_code == 400
    assert response.json() == {
        "detail": "Prakasam is used by 2 people, 1 MTO office and 1 pump, so it can't be deleted. "
        "Switch it off instead."
    }
    assert District.objects.filter(pk=unit.district_id).exists()


def test_only_the_pto_deletes(api):
    cadre = Cadre.objects.create(name="Traffic")
    for maker in (MTOFactory, DriverFactory):
        api.force_login(maker())
        assert api.delete(f"/api/masters/cadres/{cadre.id}/").status_code == 403
    assert Cadre.objects.filter(pk=cadre.pk).exists()
