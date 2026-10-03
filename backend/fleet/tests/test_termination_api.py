import pytest

from approvals.models import ApprovalKind, ApprovalRequest, ApprovalStatus
from fleet.models import VehicleStatus
from notifications.models import Notification
from testing.factories import MTOFactory, OfficerFactory, PTOFactory, UnitFactory, VehicleFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def mto():
    return MTOFactory()


@pytest.fixture
def mto_api(api, mto):
    api.force_login(mto)
    return api


@pytest.mark.parametrize("payload", [{}, {"note": ""}, {"note": "   "}])
def test_a_reason_is_required(mto_api, mto, payload):
    vehicle = VehicleFactory(unit=mto.unit)

    response = mto_api.post(f"/api/vehicles/{vehicle.id}/request-termination/", payload)

    assert response.status_code == 400
    assert "note" in response.json()
    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.ACTIVE
    assert ApprovalRequest.objects.count() == 0


@pytest.mark.parametrize("status", [VehicleStatus.ACTIVE, VehicleStatus.PAUSED])
def test_requesting_termination_parks_the_vehicle(mto_api, mto, status):
    pto = PTOFactory()
    vehicle = VehicleFactory(unit=mto.unit, status=status)

    response = mto_api.post(f"/api/vehicles/{vehicle.id}/request-termination/", {"note": "Beyond repair"})

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == vehicle.id
    assert body["status"] == "TERMINATION_PENDING"
    assert body["status_label"] == "Termination waiting for PTO"
    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.TERMINATION_PENDING
    approval = ApprovalRequest.objects.get(vehicle=vehicle)
    assert approval.kind == ApprovalKind.VEHICLE_TERMINATE
    assert approval.status == ApprovalStatus.PENDING
    assert approval.previous_status == status
    assert approval.request_note == "Beyond repair"
    assert approval.requested_by == mto
    assert Notification.objects.filter(recipient=pto, title="Vehicle termination waiting for approval").count() == 1


def test_a_vehicle_waiting_for_termination_cannot_be_paused_resumed_or_sent_again(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit)
    mto_api.post(f"/api/vehicles/{vehicle.id}/request-termination/", {"note": "Beyond repair"})

    paused = mto_api.post(f"/api/vehicles/{vehicle.id}/pause/")
    assert paused.status_code == 400
    assert paused.json()["detail"] == "Only active vehicles can be paused."
    resumed = mto_api.post(f"/api/vehicles/{vehicle.id}/resume/")
    assert resumed.status_code == 400
    assert resumed.json()["detail"] == "Only paused vehicles can be resumed."
    again = mto_api.post(f"/api/vehicles/{vehicle.id}/request-termination/", {"note": "Again"})
    assert again.status_code == 400
    assert again.json()["detail"] == "Only active or paused vehicles can be sent for termination."

    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.TERMINATION_PENDING
    assert ApprovalRequest.objects.filter(vehicle=vehicle).count() == 1


def test_a_terminated_vehicle_cannot_be_sent_for_termination(mto_api, mto):
    vehicle = VehicleFactory(unit=mto.unit, status=VehicleStatus.TERMINATED)
    response = mto_api.post(f"/api/vehicles/{vehicle.id}/request-termination/", {"note": "Again"})
    assert response.status_code == 400
    assert response.json()["detail"] == "Only active or paused vehicles can be sent for termination."


def test_another_units_vehicle_is_not_found(mto_api):
    foreign = VehicleFactory(unit=UnitFactory())
    response = mto_api.post(f"/api/vehicles/{foreign.id}/request-termination/", {"note": "Mine now"})
    assert response.status_code == 404
    foreign.refresh_from_db()
    assert foreign.status == VehicleStatus.ACTIVE


@pytest.mark.parametrize("factory", [PTOFactory, OfficerFactory])
def test_only_an_mto_can_request_termination(api, mto, factory):
    vehicle = VehicleFactory(unit=mto.unit)
    api.force_login(factory())
    response = api.post(f"/api/vehicles/{vehicle.id}/request-termination/", {"note": "No"})
    assert response.status_code == 403
    vehicle.refresh_from_db()
    assert vehicle.status == VehicleStatus.ACTIVE
