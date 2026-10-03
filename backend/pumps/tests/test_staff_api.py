import pytest
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Role, User, UserStatus
from masters.models import Cadre, Designation, District
from testing.factories import (
    DriverFactory,
    MTOFactory,
    PumpStaffFactory,
    UnitFactory,
    UserFactory,
    police_pump,
    tieup_pump,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


def staff_payload(pump, **overrides):
    payload = {
        "username": "Krishna.Fuels1",
        "full_name": "K. Suresh",
        "pump": pump.id,
        "password": "Bunk-pass-2026",
    }
    payload.update(overrides)
    return payload


def test_mto_creates_pump_staff_for_a_tie_up_bunk_with_only_the_required_fields(mto_api, mto):
    bunk = tieup_pump(mto.unit)

    response = mto_api.post("/api/pump-staff/", staff_payload(bunk))

    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "krishna.fuels1"
    assert body["full_name"] == "K. Suresh"
    assert body["pump"] == bunk.id
    assert body["pump_name"] == bunk.name
    assert body["status"] == "ACTIVE"
    assert body["status_label"] == "Active"
    assert body["emp_id"] is None
    assert body["designation"] is None
    assert body["district"] is None
    assert body["cadre"] is None
    assert body["current_vehicles"] == []
    assert "password" not in body
    staff = User.objects.get(pk=body["id"])
    assert staff.role == Role.PUMP_OPERATOR
    assert staff.unit == mto.unit
    assert staff.pump == bunk
    assert staff.emp_id is None
    assert staff.must_change_password is True
    assert staff.check_password("Bunk-pass-2026")


def test_pump_staff_can_be_created_for_a_police_pump(mto_api, mto):
    pump = police_pump(mto.unit)
    response = mto_api.post("/api/pump-staff/", staff_payload(pump))
    assert response.status_code == 201
    assert response.json()["pump_name"] == pump.name


def test_new_staff_can_log_in_and_the_session_shows_their_pump(mto_api, mto):
    bunk = tieup_pump(mto.unit)
    mto_api.post("/api/pump-staff/", staff_payload(bunk))

    client = APIClient()
    login = client.post("/api/auth/login/", {"username": "KRISHNA.fuels1", "password": "Bunk-pass-2026"})

    assert login.status_code == 200
    user = login.json()["user"]
    assert user["role"] == "PUMP_OPERATOR"
    assert user["must_change_password"] is True
    assert user["pump"] == bunk.id
    assert user["pump_name"] == bunk.name
    assert user["pump_kind"] == "TIE_UP"


def test_optional_details_can_be_given(mto_api, mto):
    response = mto_api.post(
        "/api/pump-staff/",
        staff_payload(
            tieup_pump(mto.unit),
            emp_id=" ap9001 ",
            designation=Designation.objects.get(name="Police Constable").id,
            district=District.objects.get(name="Sri Potti Sriramulu Nellore").id,
            cadre=Cadre.objects.get(name="Civil").id,
            mobile="9876543210",
        ),
    )
    assert response.status_code == 201
    body = response.json()
    assert body["emp_id"] == "AP9001"
    assert body["mobile"] == "9876543210"
    assert body["designation"] is not None


def test_blank_emp_ids_are_stored_as_null_so_several_staff_can_have_none(mto_api, mto):
    bunk = tieup_pump(mto.unit)
    first = mto_api.post("/api/pump-staff/", staff_payload(bunk, username="staff1", emp_id=""))
    second = mto_api.post("/api/pump-staff/", staff_payload(bunk, username="staff2", emp_id=None))
    third = mto_api.post("/api/pump-staff/", staff_payload(bunk, username="staff3", emp_id="   "))
    assert [first.status_code, second.status_code, third.status_code] == [201, 201, 201]
    assert User.objects.filter(role=Role.PUMP_OPERATOR, emp_id__isnull=True).count() == 3


def test_an_emp_id_already_registered_is_refused(mto_api, mto):
    DriverFactory(emp_id="AP7777")
    response = mto_api.post("/api/pump-staff/", staff_payload(tieup_pump(mto.unit), emp_id="ap7777"))
    assert response.status_code == 400
    assert response.json()["emp_id"] == ["This Emp ID is already registered."]


@pytest.mark.parametrize("missing", ["username", "full_name", "pump", "password"])
def test_username_name_pump_and_password_are_required(mto_api, mto, missing):
    payload = staff_payload(tieup_pump(mto.unit))
    del payload[missing]
    response = mto_api.post("/api/pump-staff/", payload)
    assert response.status_code == 400
    assert missing in response.json()


def test_a_taken_login_id_is_refused_whatever_its_case(mto_api, mto):
    UserFactory(username="taken.id")
    response = mto_api.post("/api/pump-staff/", staff_payload(tieup_pump(mto.unit), username="  TAKEN.ID "))
    assert response.status_code == 400
    assert response.json()["username"] == ["This login ID is already taken."]


def test_staff_for_another_units_pump_is_refused(mto_api):
    foreign = tieup_pump(UnitFactory())
    response = mto_api.post("/api/pump-staff/", staff_payload(foreign))
    assert response.status_code == 400
    assert "pump" in response.json()
    assert User.objects.filter(role=Role.PUMP_OPERATOR).count() == 0


def test_a_weak_password_is_refused(mto_api, mto):
    response = mto_api.post("/api/pump-staff/", staff_payload(tieup_pump(mto.unit), password="12345678"))
    assert response.status_code == 400
    assert "password" in response.json()


def test_client_cannot_set_role_unit_or_status(mto_api, mto):
    other = UnitFactory()
    response = mto_api.post(
        "/api/pump-staff/",
        staff_payload(tieup_pump(mto.unit), role="MTO", unit=other.id, status="TERMINATED"),
    )
    assert response.status_code == 201
    staff = User.objects.get(pk=response.json()["id"])
    assert (staff.role, staff.unit, staff.status) == (Role.PUMP_OPERATOR, mto.unit, UserStatus.ACTIVE)


def test_list_shows_only_pump_staff_of_the_mtos_unit(mto_api, mto):
    mine = PumpStaffFactory(unit=mto.unit, pump=tieup_pump(mto.unit))
    PumpStaffFactory()  # another unit
    DriverFactory(unit=mto.unit)  # not pump staff
    ids = [row["id"] for row in mto_api.get("/api/pump-staff/").json()]
    assert ids == [mine.id]


def test_listing_does_not_query_per_staff_member(mto_api, mto):
    bunk = tieup_pump(mto.unit)
    PumpStaffFactory(unit=mto.unit, pump=bunk)
    with CaptureQueriesContext(connection) as one:
        mto_api.get("/api/pump-staff/")
    for _ in range(3):
        PumpStaffFactory(unit=mto.unit, pump=bunk)
    with CaptureQueriesContext(connection) as four:
        response = mto_api.get("/api/pump-staff/")
    assert len(response.json()) == 4
    assert len(four) == len(one)


def test_another_units_staff_is_not_found(mto_api):
    foreign = PumpStaffFactory()
    assert mto_api.get(f"/api/pump-staff/{foreign.id}/").status_code == 404
    assert mto_api.post(f"/api/pump-staff/{foreign.id}/pause/").status_code == 404


def test_patch_updates_name_and_moves_the_staff_to_another_pump_of_the_unit(mto_api, mto):
    first, second = tieup_pump(mto.unit), police_pump(mto.unit)
    staff = PumpStaffFactory(unit=mto.unit, pump=first)

    response = mto_api.patch(f"/api/pump-staff/{staff.id}/", {"full_name": "New Name", "pump": second.id})

    assert response.status_code == 200
    staff.refresh_from_db()
    assert (staff.full_name, staff.pump) == ("New Name", second)
    assert response.json()["pump_name"] == second.name


def test_patch_cannot_move_staff_to_another_units_pump(mto_api, mto):
    staff = PumpStaffFactory(unit=mto.unit, pump=tieup_pump(mto.unit))
    foreign = tieup_pump(UnitFactory())
    response = mto_api.patch(f"/api/pump-staff/{staff.id}/", {"pump": foreign.id})
    assert response.status_code == 400
    assert "pump" in response.json()


def test_the_login_id_cannot_be_changed_later(mto_api, mto):
    staff = PumpStaffFactory(unit=mto.unit, pump=tieup_pump(mto.unit), username="fixed.id")
    response = mto_api.patch(f"/api/pump-staff/{staff.id}/", {"username": "other.id", "full_name": "Same Person"})
    assert response.status_code == 200
    staff.refresh_from_db()
    assert staff.username == "fixed.id"
    assert response.json()["username"] == "fixed.id"


def test_pause_resume_and_terminate_work_as_for_other_people(mto_api, mto):
    staff = PumpStaffFactory(unit=mto.unit, pump=tieup_pump(mto.unit), username="shiftstaff")

    paused = mto_api.post(f"/api/pump-staff/{staff.id}/pause/")
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"
    staff.refresh_from_db()
    assert staff.is_active is False

    assert mto_api.post(f"/api/pump-staff/{staff.id}/resume/").json()["status"] == "ACTIVE"
    assert mto_api.post(f"/api/pump-staff/{staff.id}/terminate/").json()["status"] == "TERMINATED"
    assert mto_api.post(f"/api/pump-staff/{staff.id}/pause/").status_code == 400


def test_reset_password_sets_a_new_one_and_forces_a_change(mto_api, mto):
    staff = PumpStaffFactory(unit=mto.unit, pump=tieup_pump(mto.unit))
    response = mto_api.post(f"/api/pump-staff/{staff.id}/reset-password/", {"password": "Fresh-pass-2027"})
    assert response.status_code == 204
    staff.refresh_from_db()
    assert staff.check_password("Fresh-pass-2027")
    assert staff.must_change_password is True


def test_only_an_mto_can_manage_pump_staff(api, mto):
    bunk = tieup_pump(mto.unit)
    staff = PumpStaffFactory(unit=mto.unit, pump=bunk)
    api.force_login(staff)
    assert api.get("/api/pump-staff/").status_code == 403
    assert api.post("/api/pump-staff/", staff_payload(bunk)).status_code == 403


def test_a_pump_operator_needs_a_pump_in_the_database():
    with pytest.raises(IntegrityError), transaction.atomic():
        UserFactory(role=Role.PUMP_OPERATOR, pump=None, emp_id=None)


def test_other_roles_do_not_need_a_pump():
    assert DriverFactory().pump is None
    assert PumpStaffFactory().pump is not None
