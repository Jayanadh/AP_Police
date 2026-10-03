import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from accounts.models import Role, User, UserStatus
from fleet import services as fleet_services
from masters.models import Cadre, Designation, District
from testing.factories import (
    PASSWORD,
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    UnitFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


def driver_payload(**overrides):
    payload = {
        "full_name": "B. Ramesh",
        "emp_id": " ap7001 ",
        "designation": Designation.objects.get(name="Police Constable").id,
        "district": District.objects.get(name="Sri Potti Sriramulu Nellore").id,
        "cadre": Cadre.objects.get(name="Civil").id,
        "mobile": "9876543210",
        "licence_number": "AP0120200001234",
        "licence_valid_till": "2030-05-31",
        "password": "Driver-pass-2026",
    }
    payload.update(overrides)
    return payload


def link_driver(mto, driver, **vehicle_fields):
    vehicle = VehicleFactory(unit=mto.unit, **vehicle_fields)
    fleet_services.assign_person(vehicle, driver, assigned_by=mto)
    return vehicle


def test_mto_creates_a_driver_in_their_own_unit(mto_api, mto):
    response = mto_api.post("/api/drivers/", driver_payload())
    assert response.status_code == 201
    body = response.json()
    assert body["emp_id"] == "AP7001"
    assert body["username"] == "ap7001"
    assert body["status"] == "ACTIVE"
    assert body["status_label"] == "Active"
    assert body["designation_name"] == "Police Constable"
    assert body["district_name"] == "Sri Potti Sriramulu Nellore"
    assert body["cadre_name"] == "Civil"
    assert body["current_vehicles"] == []
    assert "password" not in body
    driver = User.objects.get(pk=body["id"])
    assert driver.role == Role.DRIVER
    assert driver.unit == mto.unit
    assert driver.must_change_password is True
    assert driver.check_password("Driver-pass-2026")
    assert driver.licence_valid_till.isoformat() == "2030-05-31"


def test_new_driver_can_log_in_with_the_password_the_mto_set(mto_api):
    mto_api.post("/api/drivers/", driver_payload())
    login = APIClient().post("/api/auth/login/", {"username": "AP7001", "password": "Driver-pass-2026"})
    assert login.status_code == 200
    assert login.json()["user"]["must_change_password"] is True


def test_create_ignores_a_role_unit_or_status_sent_by_the_client(mto_api, mto):
    other = UnitFactory()
    response = mto_api.post(
        "/api/drivers/", driver_payload(role="PTO", unit=other.id, status="TERMINATED", username="boss")
    )
    assert response.status_code == 201
    driver = User.objects.get(pk=response.json()["id"])
    assert (driver.role, driver.unit, driver.status, driver.username) == (
        Role.DRIVER, mto.unit, UserStatus.ACTIVE, "ap7001",
    )


def test_emp_id_differing_only_by_case_is_a_duplicate(mto_api):
    DriverFactory(emp_id="AP7001")
    response = mto_api.post("/api/drivers/", driver_payload(emp_id="ap7001"))
    assert response.status_code == 400
    assert response.json()["emp_id"] == ["This Emp ID is already registered."]


def test_emp_id_is_unique_across_offices(mto_api):
    DriverFactory(emp_id="AP7001", unit=UnitFactory())
    response = mto_api.post("/api/drivers/", driver_payload())
    assert response.status_code == 400
    assert response.json()["emp_id"] == ["This Emp ID is already registered."]


def test_create_is_refused_when_a_login_already_uses_the_emp_id_as_its_username(mto_api):
    DriverFactory(username="ap7001", emp_id="AP9999")
    response = mto_api.post("/api/drivers/", driver_payload())
    assert response.status_code == 400
    assert response.json()["emp_id"] == ["A login with this Emp ID already exists."]


@pytest.mark.parametrize("field", ["full_name", "emp_id", "designation", "district", "cadre"])
def test_the_five_common_fields_are_required(mto_api, field):
    payload = driver_payload()
    del payload[field]
    response = mto_api.post("/api/drivers/", payload)
    assert response.status_code == 400
    assert field in response.json()


@pytest.mark.parametrize("field", ["emp_id", "designation", "district", "cadre"])
def test_the_common_fields_cannot_be_null(mto_api, field):
    response = mto_api.post("/api/drivers/", driver_payload(**{field: None}))
    assert response.status_code == 400
    assert field in response.json()


def test_a_bad_mobile_number_is_rejected(mto_api):
    response = mto_api.post("/api/drivers/", driver_payload(mobile="12345"))
    assert response.status_code == 400
    assert response.json()["mobile"] == ["Enter a 10-digit mobile number."]


def test_a_weak_password_is_rejected(mto_api):
    response = mto_api.post("/api/drivers/", driver_payload(password="password"))
    assert response.status_code == 400
    assert "password" in response.json()
    assert not User.objects.filter(username="ap7001").exists()


def test_a_password_is_required_to_create(mto_api):
    payload = driver_payload()
    del payload["password"]
    response = mto_api.post("/api/drivers/", payload)
    assert response.status_code == 400
    assert response.json()["password"] == ["This field is required."]


def test_list_shows_only_this_offices_drivers(mto_api, mto):
    mine = DriverFactory(unit=mto.unit)
    DriverFactory(unit=UnitFactory())
    OfficerFactory(unit=mto.unit)
    response = mto_api.get("/api/drivers/")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [mine.id]


def test_list_can_be_filtered_by_status(mto_api, mto):
    DriverFactory(unit=mto.unit)
    paused = DriverFactory(unit=mto.unit, status=UserStatus.PAUSED)
    response = mto_api.get("/api/drivers/?status=PAUSED")
    assert [row["id"] for row in response.json()] == [paused.id]


def test_search_by_emp_id_and_by_name(mto_api, mto):
    ramesh = DriverFactory(unit=mto.unit, full_name="B. Ramesh", emp_id="AP7001")
    suresh = DriverFactory(unit=mto.unit, full_name="K. Suresh", emp_id="AP7002")
    by_emp_id = mto_api.get("/api/drivers/?search=ap7002").json()
    by_name = mto_api.get("/api/drivers/?search=rame").json()
    assert [row["id"] for row in by_emp_id] == [suresh.id]
    assert [row["id"] for row in by_name] == [ramesh.id]


def test_unassigned_lists_only_drivers_with_no_current_vehicle(mto_api, mto):
    on_a_vehicle = DriverFactory(unit=mto.unit)
    link_driver(mto, on_a_vehicle)
    freed = DriverFactory(unit=mto.unit)
    freed_vehicle = link_driver(mto, freed)
    fleet_services.end_all_for_vehicle(freed_vehicle, mto)
    never_linked = DriverFactory(unit=mto.unit)
    response = mto_api.get("/api/drivers/?unassigned=1")
    assert sorted(row["id"] for row in response.json()) == sorted([freed.id, never_linked.id])


def test_current_vehicles_lists_the_vehicles_the_driver_is_on(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    vehicle = link_driver(mto, driver)
    body = mto_api.get(f"/api/drivers/{driver.id}/").json()
    assert body["current_vehicles"] == [{"id": vehicle.id, "registration_number": vehicle.registration_number}]


def test_listing_does_not_query_per_driver(mto_api, mto):
    link_driver(mto, DriverFactory(unit=mto.unit))
    with CaptureQueriesContext(connection) as one:
        mto_api.get("/api/drivers/")
    for _ in range(3):
        link_driver(mto, DriverFactory(unit=mto.unit))
    with CaptureQueriesContext(connection) as four:
        response = mto_api.get("/api/drivers/")
    assert len(response.json()) == 4
    assert len(four) == len(one)


def test_another_offices_driver_is_not_found(mto_api):
    stranger = DriverFactory(unit=UnitFactory())
    assert mto_api.get(f"/api/drivers/{stranger.id}/").status_code == 404
    assert mto_api.patch(f"/api/drivers/{stranger.id}/", {"mobile": "9000000001"}).status_code == 404
    assert mto_api.post(f"/api/drivers/{stranger.id}/pause/").status_code == 404
    assert mto_api.post(f"/api/drivers/{stranger.id}/terminate/").status_code == 404
    reset = mto_api.post(f"/api/drivers/{stranger.id}/reset-password/", {"password": "Fresh-pass-2026"})
    assert reset.status_code == 404


def test_an_officer_is_not_found_on_the_drivers_endpoint(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit)
    assert mto_api.get(f"/api/drivers/{officer.id}/").status_code == 404


def test_pause_blocks_login_and_resume_restores_it(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    paused = mto_api.post(f"/api/drivers/{driver.id}/pause/")
    assert paused.status_code == 200
    assert paused.json()["status"] == "PAUSED"
    driver.refresh_from_db()
    assert driver.status == UserStatus.PAUSED
    assert driver.is_active is False

    resumed = mto_api.post(f"/api/drivers/{driver.id}/resume/")
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "ACTIVE"
    driver.refresh_from_db()
    assert driver.is_active is True


def test_list_filters_do_not_hide_the_person_an_action_is_about(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    response = mto_api.post(f"/api/drivers/{driver.id}/pause/?status=ACTIVE&search=nobody")
    assert response.status_code == 200
    assert response.json()["status"] == "PAUSED"


def test_pause_and_resume_only_from_the_right_status(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    refused = mto_api.post(f"/api/drivers/{driver.id}/resume/")
    assert refused.status_code == 400
    assert refused.json() == {"detail": "Only paused people can be resumed."}
    mto_api.post(f"/api/drivers/{driver.id}/pause/")
    refused = mto_api.post(f"/api/drivers/{driver.id}/pause/")
    assert refused.status_code == 400
    assert refused.json() == {"detail": "Only active people can be paused."}


def test_terminate_ends_the_vehicle_link_and_cannot_be_repeated(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    vehicle = link_driver(mto, driver)
    response = mto_api.post(f"/api/drivers/{driver.id}/terminate/")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "TERMINATED"
    assert body["current_vehicles"] == []
    driver.refresh_from_db()
    assert driver.is_active is False
    link = driver.vehicle_assignments.get(vehicle=vehicle)
    assert link.ended_at is not None
    assert link.ended_by == mto

    again = mto_api.post(f"/api/drivers/{driver.id}/terminate/")
    assert again.status_code == 400
    assert again.json() == {"detail": "This person is already removed."}


def test_a_paused_driver_can_be_terminated(mto_api, mto):
    driver = DriverFactory(unit=mto.unit, status=UserStatus.PAUSED)
    response = mto_api.post(f"/api/drivers/{driver.id}/terminate/")
    assert response.status_code == 200
    assert response.json()["status"] == "TERMINATED"


def test_a_terminated_driver_cannot_be_paused_or_resumed(mto_api, mto):
    driver = DriverFactory(unit=mto.unit, status=UserStatus.TERMINATED)
    assert mto_api.post(f"/api/drivers/{driver.id}/pause/").status_code == 400
    assert mto_api.post(f"/api/drivers/{driver.id}/resume/").status_code == 400


def test_reset_password_sets_a_new_one_and_forces_a_change(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    response = mto_api.post(f"/api/drivers/{driver.id}/reset-password/", {"password": "Fresh-pass-2026"})
    assert response.status_code == 204
    driver.refresh_from_db()
    assert driver.check_password("Fresh-pass-2026")
    assert not driver.check_password(PASSWORD)
    assert driver.must_change_password is True
    login = APIClient().post("/api/auth/login/", {"username": driver.username, "password": "Fresh-pass-2026"})
    assert login.status_code == 200


def test_reset_password_rejects_a_weak_password(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    response = mto_api.post(f"/api/drivers/{driver.id}/reset-password/", {"password": "password"})
    assert response.status_code == 400
    assert "password" in response.json()
    driver.refresh_from_db()
    assert driver.check_password(PASSWORD)


def test_reset_password_needs_a_password(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    response = mto_api.post(f"/api/drivers/{driver.id}/reset-password/", {})
    assert response.status_code == 400
    assert response.json()["password"] == ["This field is required."]


def test_patch_changes_details_but_never_the_password(mto_api, mto):
    driver = DriverFactory(unit=mto.unit, mobile="9000000001")
    response = mto_api.patch(
        f"/api/drivers/{driver.id}/",
        {"mobile": "9000000002", "password": "Sneaky-pass-2026", "status": "TERMINATED", "role": "PTO"},
    )
    assert response.status_code == 200
    assert response.json()["mobile"] == "9000000002"
    driver.refresh_from_db()
    assert driver.mobile == "9000000002"
    assert driver.check_password(PASSWORD)
    assert (driver.status, driver.role) == (UserStatus.ACTIVE, Role.DRIVER)


def test_patch_can_keep_the_same_emp_id(mto_api, mto):
    driver = DriverFactory(unit=mto.unit, emp_id="AP7001")
    response = mto_api.patch(f"/api/drivers/{driver.id}/", {"emp_id": "ap7001"})
    assert response.status_code == 200
    assert response.json()["emp_id"] == "AP7001"


def test_patch_refuses_another_persons_emp_id(mto_api, mto):
    DriverFactory(unit=mto.unit, emp_id="AP7001")
    driver = DriverFactory(unit=mto.unit, emp_id="AP7002")
    response = mto_api.patch(f"/api/drivers/{driver.id}/", {"emp_id": "ap7001"})
    assert response.status_code == 400
    assert response.json()["emp_id"] == ["This Emp ID is already registered."]


def test_a_driver_cannot_use_the_drivers_endpoints(api):
    driver = DriverFactory()
    api.force_login(driver)
    assert api.get("/api/drivers/").status_code == 403
    assert api.post("/api/drivers/", driver_payload()).status_code == 403
    assert api.post(f"/api/drivers/{driver.id}/pause/").status_code == 403


def test_the_pto_cannot_use_the_drivers_endpoints(api):
    api.force_login(PTOFactory())
    assert api.get("/api/drivers/").status_code == 403


def test_delete_and_put_are_not_allowed(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    assert mto_api.delete(f"/api/drivers/{driver.id}/").status_code == 405
    assert mto_api.put(f"/api/drivers/{driver.id}/", driver_payload()).status_code == 405
