import pytest
from rest_framework.test import APIClient

from accounts.models import Role, User, UserStatus
from approvals.models import ApprovalKind, ApprovalRequest, ApprovalStatus
from fleet import services as fleet_services
from masters.models import Cadre, Designation, District
from notifications.models import Notification
from testing.factories import DriverFactory, MTOFactory, OfficerFactory, PTOFactory, UnitFactory, VehicleFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


def officer_payload(**overrides):
    payload = {
        "full_name": "M. Venkata Rao",
        "emp_id": "ap8001",
        "designation": Designation.objects.get(name="Inspector of Police").id,
        "district": District.objects.get(name="Sri Potti Sriramulu Nellore").id,
        "cadre": Cadre.objects.get(name="Civil").id,
        "mobile": "9123456780",
        "password": "Officer-pass-2026",
    }
    payload.update(overrides)
    return payload


def test_creating_an_officer_waits_for_pto_approval(mto_api, mto):
    response = mto_api.post("/api/officers/", officer_payload())
    assert response.status_code == 201
    body = response.json()
    assert body["emp_id"] == "AP8001"
    assert body["username"] == "ap8001"
    assert body["status"] == "PENDING_APPROVAL"
    assert body["status_label"] == "Waiting for PTO approval"
    officer = User.objects.get(pk=body["id"])
    assert officer.role == Role.OFFICER
    assert officer.unit == mto.unit
    assert officer.must_change_password is True
    assert officer.is_active is False
    approval = ApprovalRequest.objects.get(officer=officer)
    assert approval.kind == ApprovalKind.OFFICER_CREATE
    assert approval.status == ApprovalStatus.PENDING
    assert approval.requested_by == mto
    assert approval.unit == mto.unit


def test_the_pto_is_alerted_to_a_new_officer(mto_api):
    pto = PTOFactory()
    mto_api.post("/api/officers/", officer_payload())
    alert = Notification.objects.get(recipient=pto)
    assert alert.title == "New officer waiting for approval"


def test_a_pending_officer_cannot_log_in_yet(mto_api):
    mto_api.post("/api/officers/", officer_payload())
    login = APIClient().post("/api/auth/login/", {"username": "ap8001", "password": "Officer-pass-2026"})
    assert login.status_code == 400
    assert login.json() == {"detail": "Your account is waiting for PTO approval."}


def test_an_invalid_officer_creates_no_approval_request(mto_api):
    response = mto_api.post("/api/officers/", officer_payload(password="password"))
    assert response.status_code == 400
    assert not ApprovalRequest.objects.exists()
    assert not User.objects.filter(username="ap8001").exists()


def test_a_pending_officer_cannot_be_paused(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit, status=UserStatus.PENDING_APPROVAL)
    response = mto_api.post(f"/api/officers/{officer.id}/pause/")
    assert response.status_code == 400
    assert response.json() == {"detail": "Only active people can be paused."}


def test_a_pending_officer_cannot_be_terminated(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit, status=UserStatus.PENDING_APPROVAL)
    response = mto_api.post(f"/api/officers/{officer.id}/terminate/")
    assert response.status_code == 400
    assert response.json() == {"detail": "This person is waiting for PTO approval."}
    officer.refresh_from_db()
    assert officer.status == UserStatus.PENDING_APPROVAL


def test_a_rejected_officer_cannot_be_terminated(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit, status=UserStatus.REJECTED)
    response = mto_api.post(f"/api/officers/{officer.id}/terminate/")
    assert response.status_code == 400
    assert response.json() == {"detail": "This person is already removed."}


def test_terminating_an_officer_ends_every_vehicle_link(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit)
    for _ in range(2):
        fleet_services.assign_person(VehicleFactory(unit=mto.unit), officer, assigned_by=mto)
    response = mto_api.post(f"/api/officers/{officer.id}/terminate/")
    assert response.status_code == 200
    assert response.json()["status"] == "TERMINATED"
    assert response.json()["current_vehicles"] == []
    assert not officer.vehicle_assignments.filter(ended_at__isnull=True).exists()


def test_an_active_officer_lists_all_their_vehicles(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit)
    vehicles = [VehicleFactory(unit=mto.unit) for _ in range(2)]
    for vehicle in vehicles:
        fleet_services.assign_person(vehicle, officer, assigned_by=mto)
    body = mto_api.get(f"/api/officers/{officer.id}/").json()
    assert sorted(v["registration_number"] for v in body["current_vehicles"]) == sorted(
        v.registration_number for v in vehicles
    )


def test_officer_list_excludes_drivers_and_other_offices(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit)
    DriverFactory(unit=mto.unit)
    OfficerFactory(unit=UnitFactory())
    response = mto_api.get("/api/officers/")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()] == [officer.id]


def test_officer_pause_resume_and_reset_password(mto_api, mto):
    officer = OfficerFactory(unit=mto.unit)
    assert mto_api.post(f"/api/officers/{officer.id}/pause/").json()["status"] == "PAUSED"
    assert mto_api.post(f"/api/officers/{officer.id}/resume/").json()["status"] == "ACTIVE"
    reset = mto_api.post(f"/api/officers/{officer.id}/reset-password/", {"password": "Fresh-pass-2026"})
    assert reset.status_code == 204
    officer.refresh_from_db()
    assert officer.check_password("Fresh-pass-2026")
    assert officer.must_change_password is True


def test_a_driver_is_not_found_on_the_officers_endpoint(mto_api, mto):
    driver = DriverFactory(unit=mto.unit)
    assert mto_api.get(f"/api/officers/{driver.id}/").status_code == 404


def test_only_an_mto_may_use_the_officers_endpoints(api):
    api.force_login(OfficerFactory())
    assert api.get("/api/officers/").status_code == 403
    assert api.post("/api/officers/", officer_payload()).status_code == 403
