import pytest

from accounts.models import Role, User
from masters.models import Cadre, Designation, District
from testing.factories import DriverFactory, MTOFactory, PTOFactory, UnitFactory

pytestmark = pytest.mark.django_db


def new_unit_payload(**overrides):
    payload = {
        "name": "SPSR Nellore MTO",
        "code": "nlr",
        "district": District.objects.get(name="Sri Potti Sriramulu Nellore").id,
        "address": "District Police Office, Nellore",
        "phone": "0861-2331000",
        "mto_account": {
            "username": "MTO.Nellore",
            "password": "Chair-pass-2026",
            "full_name": "K. Srinivasa Rao",
            "emp_id": "ap5001",
            "designation": Designation.objects.get(name="Reserve Inspector").id,
            "cadre": Cadre.objects.get(name="Armed Reserve").id,
            "mobile": "9876543210",
        },
    }
    payload.update(overrides)
    return payload


def test_pto_creates_office_with_its_mto_login(api):
    api.force_login(PTOFactory())
    response = api.post("/api/units/", new_unit_payload())
    assert response.status_code == 201
    body = response.json()
    assert body["code"] == "NLR"
    assert body["mto"]["username"] == "mto.nellore"
    chair = User.objects.get(username="mto.nellore")
    assert chair.role == Role.MTO
    assert chair.unit_id == body["id"]
    assert chair.emp_id == "AP5001"
    assert chair.must_change_password is True
    assert chair.check_password("Chair-pass-2026")


def test_office_code_is_unique_ignoring_case(api):
    api.force_login(PTOFactory())
    UnitFactory(code="NLR")
    response = api.post("/api/units/", new_unit_payload(code="nlr"))
    assert response.status_code == 400
    assert response.json()["code"] == ["Another MTO office already uses this code."]


def test_chair_login_id_must_be_free(api):
    api.force_login(PTOFactory())
    DriverFactory(username="mto.nellore")
    response = api.post("/api/units/", new_unit_payload())
    assert response.status_code == 400
    assert "username" in response.json()["mto_account"]


def test_weak_chair_password_is_rejected(api):
    api.force_login(PTOFactory())
    payload = new_unit_payload()
    payload["mto_account"]["password"] = "password"
    assert api.post("/api/units/", payload).status_code == 400


def test_mto_cannot_list_read_or_create_offices(api):
    """Offices carry the chair's details, which an MTO has no business reading for other offices."""
    mto = MTOFactory()
    api.force_login(mto)
    assert api.get("/api/units/").status_code == 403
    assert api.get(f"/api/units/{mto.unit_id}/").status_code == 403
    assert api.get(f"/api/units/{UnitFactory().id}/").status_code == 403
    assert api.post("/api/units/", new_unit_payload()).status_code == 403


def test_pto_lists_and_reads_offices(api):
    unit = UnitFactory()
    api.force_login(PTOFactory())
    assert api.get("/api/units/").status_code == 200
    assert api.get(f"/api/units/{unit.id}/").json()["id"] == unit.id


def test_driver_cannot_list_offices(api):
    api.force_login(DriverFactory())
    assert api.get("/api/units/").status_code == 403


def test_handover_gives_the_same_chair_login_to_a_new_holder(api):
    chair = MTOFactory(username="mto.guntur", emp_id="AP6000")
    api.force_login(PTOFactory())
    response = api.post(
        f"/api/units/{chair.unit_id}/handover/",
        {
            "full_name": "P. Lakshmi",
            "emp_id": "ap6001",
            "designation": chair.designation_id,
            "cadre": chair.cadre_id,
            "mobile": "9123456780",
            "password": "Fresh-chair-55",
        },
    )
    assert response.status_code == 200
    chair.refresh_from_db()
    assert chair.username == "mto.guntur"
    assert chair.full_name == "P. Lakshmi"
    assert chair.emp_id == "AP6001"
    assert chair.must_change_password is True
    assert chair.check_password("Fresh-chair-55")


def test_handover_without_mobile_clears_the_old_number(api):
    chair = MTOFactory(username="mto.guntur", emp_id="AP6000", mobile="9000000001")
    api.force_login(PTOFactory())
    response = api.post(
        f"/api/units/{chair.unit_id}/handover/",
        {
            "full_name": "P. Lakshmi",
            "emp_id": "ap6001",
            "designation": chair.designation_id,
            "cadre": chair.cadre_id,
            "password": "Fresh-chair-55",
        },
    )
    assert response.status_code == 200
    chair.refresh_from_db()
    assert chair.mobile == ""


def test_handover_on_office_without_chair_is_not_found(api):
    chair = MTOFactory()  # Create a chair to get valid designation/cadre IDs
    unit = UnitFactory()  # Create a unit without an MTO member
    api.force_login(PTOFactory())
    response = api.post(
        f"/api/units/{unit.id}/handover/",
        {
            "full_name": "P. Lakshmi",
            "emp_id": "ap6001",
            "designation": chair.designation_id,
            "cadre": chair.cadre_id,
            "password": "Fresh-chair-55",
        },
    )
    assert response.status_code == 404
