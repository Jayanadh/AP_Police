import pytest

from accounts.models import UserStatus
from approvals import services
from approvals.models import ApprovalStatus
from fleet import services as fleet_services
from fleet.models import VehicleStatus
from notifications.models import Notification
from testing.factories import (
    DriverFactory,
    MTOFactory,
    OfficerFactory,
    PTOFactory,
    VehicleFactory,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def pto():
    return PTOFactory()


@pytest.fixture
def mto():
    return MTOFactory()


def new_officer_request(mto, **fields):
    officer = OfficerFactory(unit=mto.unit, status=UserStatus.PENDING_APPROVAL, **fields)
    return services.request_officer_approval(officer, mto, note="Please approve")


def termination_request(mto, **fields):
    vehicle = VehicleFactory(unit=mto.unit, **fields)
    return services.request_vehicle_termination(vehicle, mto, "Beyond repair")


def test_pto_sees_pending_requests_of_all_units_and_mto_only_their_own(api, pto, mto):
    other_mto = MTOFactory()
    mine = new_officer_request(mto)
    theirs = termination_request(other_mto)

    api.force_login(pto)
    rows = api.get("/api/approvals/", {"status": "PENDING"}).json()
    assert {row["id"] for row in rows} == {mine.id, theirs.id}

    api.force_login(mto)
    rows = api.get("/api/approvals/", {"status": "PENDING"}).json()
    assert [row["id"] for row in rows] == [mine.id]


def test_list_is_newest_first_and_filters_by_status(api, pto, mto):
    older = new_officer_request(mto)
    newer = termination_request(mto)
    services.decide(older, pto, approve=True)
    api.force_login(pto)

    everything = api.get("/api/approvals/").json()
    assert [row["id"] for row in everything] == [newer.id, older.id]
    assert [row["id"] for row in api.get("/api/approvals/", {"status": "PENDING"}).json()] == [newer.id]
    assert [row["id"] for row in api.get("/api/approvals/", {"status": "APPROVED"}).json()] == [older.id]
    assert api.get("/api/approvals/", {"status": "REJECTED"}).json() == []


def test_officer_request_shape(api, pto, mto):
    approval = new_officer_request(mto, full_name="Ravi Kumar", emp_id="EMP7001", mobile="9876543210")
    api.force_login(pto)

    body = api.get(f"/api/approvals/{approval.id}/").json()

    assert set(body) == {
        "id", "kind", "kind_label", "unit", "unit_name", "status", "officer", "vehicle", "request_note",
        "requested_by_name", "requested_at", "decision_note", "decided_by_name", "decided_at",
    }
    assert body["kind"] == "OFFICER_CREATE"
    assert body["kind_label"] == "New officer"
    assert body["unit"] == mto.unit.id
    assert body["unit_name"] == mto.unit.name
    assert body["status"] == "PENDING"
    assert body["officer"] == {
        "id": approval.officer_id,
        "full_name": "Ravi Kumar",
        "emp_id": "EMP7001",
        "designation_name": "Inspector of Police",
        "mobile": "9876543210",
    }
    assert body["vehicle"] is None
    assert body["request_note"] == "Please approve"
    assert body["requested_by_name"] == mto.full_name
    assert body["decision_note"] == ""
    assert body["decided_by_name"] is None
    assert body["decided_at"] is None


def test_termination_request_shape(api, pto, mto):
    approval = termination_request(mto, registration_number="AP39PA1234")
    api.force_login(pto)

    body = api.get(f"/api/approvals/{approval.id}/").json()

    assert body["kind"] == "VEHICLE_TERMINATE"
    assert body["kind_label"] == "Vehicle termination"
    assert body["officer"] is None
    assert body["vehicle"] == {
        "id": approval.vehicle_id,
        "registration_number": "AP39PA1234",
        "vehicle_type": "JEEP",
        "make": "Mahindra",
        "model": "Bolero",
    }
    assert body["request_note"] == "Beyond repair"


def test_an_officer_without_a_designation_has_a_null_designation_name(api, pto, mto):
    approval = new_officer_request(mto, designation=None)
    api.force_login(pto)
    assert api.get(f"/api/approvals/{approval.id}/").json()["officer"]["designation_name"] is None


def test_mto_cannot_see_another_units_request(api, mto):
    foreign = termination_request(MTOFactory())
    api.force_login(mto)
    assert api.get(f"/api/approvals/{foreign.id}/").status_code == 404


@pytest.mark.parametrize("factory", [OfficerFactory, DriverFactory])
def test_officers_and_drivers_cannot_use_approvals(api, mto, factory):
    approval = new_officer_request(mto)
    api.force_login(factory(unit=mto.unit))
    assert api.get("/api/approvals/").status_code == 403
    assert api.get(f"/api/approvals/{approval.id}/").status_code == 403
    assert api.post(f"/api/approvals/{approval.id}/approve/").status_code == 403


def test_anonymous_callers_are_refused(api):
    assert api.get("/api/approvals/").status_code == 403


def test_list_uses_a_fixed_number_of_queries(api, pto, mto, django_assert_max_num_queries):
    for _ in range(3):
        new_officer_request(mto)
        termination_request(mto)
    api.force_login(pto)
    with django_assert_max_num_queries(6):
        response = api.get("/api/approvals/")
    assert len(response.json()) == 6


def test_pto_approves_a_new_officer(api, pto, mto):
    approval = new_officer_request(mto)
    api.force_login(pto)

    response = api.post(f"/api/approvals/{approval.id}/approve/", {"note": "Verified"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "APPROVED"
    assert body["decision_note"] == "Verified"
    assert body["decided_by_name"] == pto.full_name
    assert body["decided_at"] is not None
    approval.officer.refresh_from_db()
    assert approval.officer.status == UserStatus.ACTIVE
    assert approval.officer.is_active is True
    assert Notification.objects.filter(recipient=mto, title="Officer approved").count() == 1


def test_the_status_filter_applies_to_the_list_only(api, pto, mto):
    approval = new_officer_request(mto)
    api.force_login(pto)
    response = api.post(f"/api/approvals/{approval.id}/approve/?status=PENDING")
    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_approving_needs_no_note(api, pto, mto):
    approval = new_officer_request(mto)
    api.force_login(pto)
    response = api.post(f"/api/approvals/{approval.id}/approve/")
    assert response.status_code == 200
    assert response.json()["decision_note"] == ""


def test_pto_approves_a_termination_and_the_links_end(api, pto, mto):
    vehicle = VehicleFactory(unit=mto.unit)
    driver_link = fleet_services.assign_person(vehicle, DriverFactory(unit=mto.unit), mto)
    approval = services.request_vehicle_termination(vehicle, mto, "Beyond repair")
    api.force_login(pto)

    response = api.post(f"/api/approvals/{approval.id}/approve/", {"note": "Go ahead"})

    assert response.status_code == 200
    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.TERMINATED
    driver_link.refresh_from_db()
    assert driver_link.ended_at is not None
    assert Notification.objects.filter(recipient=mto, title="Vehicle termination approved").count() == 1


def test_pto_rejects_with_a_reason(api, pto, mto):
    approval = termination_request(mto, status=VehicleStatus.PAUSED)
    api.force_login(pto)

    response = api.post(f"/api/approvals/{approval.id}/reject/", {"note": "Still serviceable"})

    assert response.status_code == 200
    assert response.json()["status"] == "REJECTED"
    assert response.json()["decision_note"] == "Still serviceable"
    approval.vehicle.refresh_from_db()
    assert approval.vehicle.status == VehicleStatus.PAUSED


@pytest.mark.parametrize("payload", [{}, {"note": ""}, {"note": "   "}])
def test_rejecting_without_a_reason_is_refused(api, pto, mto, payload):
    approval = new_officer_request(mto)
    api.force_login(pto)

    response = api.post(f"/api/approvals/{approval.id}/reject/", payload)

    assert response.status_code == 400
    assert response.json() == {"detail": "Give a reason for rejecting."}
    approval.refresh_from_db()
    assert approval.status == ApprovalStatus.PENDING
    approval.officer.refresh_from_db()
    assert approval.officer.status == UserStatus.PENDING_APPROVAL


def test_mto_cannot_approve_or_reject_even_their_own_request(api, mto):
    approval = new_officer_request(mto)
    api.force_login(mto)

    assert api.post(f"/api/approvals/{approval.id}/approve/").status_code == 403
    assert api.post(f"/api/approvals/{approval.id}/reject/", {"note": "No"}).status_code == 403
    approval.refresh_from_db()
    assert approval.status == ApprovalStatus.PENDING


def test_deciding_twice_over_the_api_is_refused(api, pto, mto):
    approval = termination_request(mto)
    api.force_login(pto)
    assert api.post(f"/api/approvals/{approval.id}/approve/").status_code == 200

    response = api.post(f"/api/approvals/{approval.id}/reject/", {"note": "Too late"})

    assert response.status_code == 400
    assert response.json() == {"detail": "This request has already been decided."}
    approval.vehicle.refresh_from_db()
    assert approval.vehicle.status == VehicleStatus.TERMINATED


def test_deciding_an_unknown_request_is_not_found(api, pto):
    api.force_login(pto)
    assert api.post("/api/approvals/999999/approve/").status_code == 404
    assert api.post("/api/approvals/999999/reject/", {"note": "No"}).status_code == 404


def test_approvals_cannot_be_created_edited_or_deleted_over_the_api(api, pto, mto):
    approval = new_officer_request(mto)
    api.force_login(pto)
    assert api.post("/api/approvals/", {"kind": "OFFICER_CREATE"}).status_code == 405
    assert api.patch(f"/api/approvals/{approval.id}/", {"status": "APPROVED"}).status_code == 405
    assert api.delete(f"/api/approvals/{approval.id}/").status_code == 405
